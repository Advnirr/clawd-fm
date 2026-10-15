#!/usr/bin/env python3
"""Collects the Claude FM tracklist by reading the "now playing" marquee off the live stream.

The stream shows `Artist — Title` in a scrolling plate in the top-right corner.
Each scroll cycle starts with a short pause, which OCR sees as identical
consecutive frames; the text between two pauses is stitched into one full line.

Needs: yt-dlp, ffmpeg, tesseract.
"""

import argparse
import contextlib
import datetime as dt
import difflib
import fcntl
import functools
import json
import os
import re
import shutil

# Every subprocess call below passes an argv list to a program found by tool(); no shell.
import subprocess  # nosec B404
import sys
import time
from collections import Counter

STREAM_URL = "https://www.youtube.com/@claude/live"
FPS = 2
# The marquee plate on a 1280x720 frame, without the note icon.
CROP = "crop=280:32:955:30"
# Upscale and invert for tesseract.
PREP = "scale=iw*4:ih*4:flags=lanczos,negate,format=gray"
# The same as an mpv video filter, for --frames-dir.
MPV_VF = f"lavfi=[fps={FPS},scale=1280:720,{CROP},{PREP}]"
SEP = " — "
# Word gap on the 4x plate: one space is 40-53 px, the marquee's two are ~85.
SEP_GAP_PX = 70


def load_words():
    try:
        with open("/usr/share/dict/cracklib-small", encoding="utf-8", errors="ignore") as f:
            return {w.strip().lower() for w in f}
    except OSError:
        return set()


WORDS = load_words()


def fix_word(word):
    """Digits OCR'd inside a lowercase word: Tour1st -> Tourist, Fie1ds -> Fields."""
    if not re.search(r"[a-z][01]|[01][a-z]", word):
        return word
    holes = [i for i, ch in enumerate(word) if ch in "01"]
    options = [""]
    for i, ch in enumerate(word):
        alts = ("i", "l") if ch == "1" and i in holes else ("o",) if ch == "0" and i in holes else (ch,)
        options = [o + a for o in options for a in alts][:64]
    for o in options:
        if o.lower().strip(".,'()") in WORDS:
            return o
    # No dictionary hit: inside a word 1 is i, at its end l.
    word = re.sub(r"(?<=[a-z])1(?=[a-z])", "i", word)
    word = re.sub(r"(?<=[a-z])1\b", "l", word)
    return re.sub(r"(?<=[a-z])0(?=[a-z])", "o", word)


def fix_ocr(s):
    # Track numbers: 0l -> 01, l2 -> 12.
    s = re.sub(r"\b([0-9])[lI|](?=\b|[0-9])", r"\g<1>1", s)
    s = re.sub(r"\b[lI|]([0-9])\b", r"1\g<1>", s)
    return " ".join(fix_word(w) for w in s.split(" "))


def now():
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def norm(s):
    return re.sub(r"[^0-9a-zа-яё]+", "", s.lower())  # noqa: RUF001 (Cyrillic on purpose)


class Marquee:
    """Turns a stream of OCR'd marquee frames into finished `Artist — Title` lines."""

    def __init__(self, on_track, on_now=None):
        self.on_track = on_track
        self.on_now = on_now
        self.now = None  # best guess for the current track
        self.prev = None
        self.paused = False
        self.anchor = None  # text of the paused frame that starts a cycle
        self.text = ""  # stitched text of the current cycle
        self.votes = Counter()

    def feed(self, line):
        line = line.strip()
        if not line:
            return
        if line == self.prev:
            if not self.paused:
                self.paused = True
                self._cycle_start(line)
            return
        self.prev = line
        self.paused = False
        if self.anchor is not None:
            self._stitch(line[1:-1])  # edge glyphs are cut off by the crop

    def flush(self):
        self._finish_track()

    def _cycle_start(self, line):
        self._finish_cycle()
        if self.anchor and norm(line)[:10] != norm(self.anchor)[:10]:
            self._finish_track()
        self.anchor = line
        self.text = line[:-1]

    def _stitch(self, frag):
        if len(frag) < 8:
            return
        # The overlap may be broken by OCR noise near the fragment's start,
        # so take the longest common run instead of an exact prefix.
        tail = self.text[-40:]
        m = difflib.SequenceMatcher(None, tail, frag, autojunk=False).find_longest_match(
            0, len(tail), 0, len(frag)
        )
        if m.size >= 6 and m.b <= 4 and m.a + m.size >= len(tail) - 4:
            self.text = self.text[: len(self.text) - len(tail) + m.a - m.b] + frag

    def _finish_cycle(self):
        if not self.anchor:
            return
        head = self.anchor[:12]
        i = self.text.find(head, len(head))
        unit = (self.text[:i] if i > 0 else "").split("  ")[0].strip(" |")
        if SEP in unit:
            self.votes[fix_ocr(re.sub(r"\s+", " ", unit))] += 1
            best = self.votes.most_common(1)[0][0]
            if self.on_now and best != self.now:
                self.now = best
                self.on_now(*(part.strip() for part in best.split(SEP, 1)))
        self.text = ""

    def _finish_track(self):
        if self.votes:
            unit, _ = self.votes.most_common(1)[0]
            artist, title = unit.split(SEP, 1)
            self.on_track(artist.strip(), title.strip())
        self.votes.clear()


class Tracklist:
    """tracks.json, shared with other collectors: each add re-reads it under a lock."""

    def __init__(self, path):
        self.path = path
        self.tracks = self._load()

    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return []

    def add(self, artist, title):
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        with open(self.path + ".lock", "a", encoding="utf-8") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.tracks = self._load()
            self._add(artist, title)

    def _add(self, artist, title):
        key = norm(artist + title)
        for t in self.tracks:
            if difflib.SequenceMatcher(None, key, norm(t["artist"] + t["title"])).ratio() > 0.9:
                t["last_seen"] = now()
                t["plays"] += 1
                break
        else:
            t = {"artist": artist, "title": title, "first_seen": now(), "last_seen": now(), "plays": 1}
            self.tracks.append(t)
            print(f"+ {artist} — {title}", file=sys.stderr, flush=True)
        tmp = f"{self.path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.tracks, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)


@functools.cache
def tool(name):
    """Absolute path of a required program, or exit naming it."""
    path = shutil.which(name)
    if not path:
        sys.exit(f"collect.py needs {name}; install it and try again")
    return path


def ocr(pgm):
    """OCRs one plate; a wide word gap (the marquee's separator) becomes a double space."""
    # A failed OCR is an empty line, not an error.
    out = subprocess.run(  # noqa: S603  # nosec B603
        [tool("tesseract"), "stdin", "stdout", "--psm", "7", "-l", "eng", "tsv"],
        input=pgm,
        capture_output=True,
        check=False,
    ).stdout.decode("utf-8", "replace")
    words = []
    for row in out.splitlines()[1:]:
        cols = row.split("\t")
        if len(cols) == 12 and cols[0] == "5" and cols[11].strip():
            words.append((int(cols[6]), int(cols[8]), cols[11].strip()))
    line, prev_end = "", None
    for left, width, text in words:
        if prev_end is not None:
            line += "  " if left - prev_end > SEP_GAP_PX else " "
        line += text
        prev_end = left + width
    return line


def read_pgm(stream):
    header = b""
    while header.count(b"\n") < 3:
        c = stream.read(1)
        if not c:
            return None
        header += c
    w, h = map(int, header.split()[1:3])
    body = stream.read(w * h)
    return header + body if len(body) == w * h else None


def hls_url(cookies):
    cmd = [tool("yt-dlp"), "-q", "-f", "95/best[height<=720]", "-g", STREAM_URL]
    if cookies:
        cmd[1:1] = ["--cookies-from-browser", cookies]
    # cookies is one argument to yt-dlp, never parsed by a shell.
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()  # noqa: S603  # nosec B603


def feed(marquee, line, ocr_log):
    if ocr_log:
        print(time.strftime("%H:%M:%S"), line, file=ocr_log, flush=True)
    marquee.feed(line)


def watch(marquee, cookies, ocr_log):
    delay = 5
    while True:
        try:
            url = hls_url(cookies)
        except subprocess.CalledProcessError as e:
            print("yt-dlp failed:", e.stderr.strip()[-300:], file=sys.stderr, flush=True)
            time.sleep(60)
            continue
        started = time.monotonic()
        vf = f"fps={FPS},scale=1280:720,{CROP},{PREP}"
        argv = [
            tool("ffmpeg"),
            "-loglevel",
            "error",
            "-i",
            url,
            "-vf",
            vf,
            "-f",
            "image2pipe",
            "-c:v",
            "pgm",
            "-",
        ]
        ff = subprocess.Popen(argv, stdout=subprocess.PIPE)  # noqa: S603  # nosec B603
        while (frame := read_pgm(ff.stdout)) is not None:
            feed(marquee, ocr(frame), ocr_log)
        ff.wait()
        # Back off when the stream keeps dropping (YouTube answers 429).
        delay = 5 if time.monotonic() - started > 120 else min(delay * 2, 300)
        print(f"stream ended, reconnecting in {delay}s", file=sys.stderr, flush=True)
        time.sleep(delay)


def watch_dir(marquee, frames_dir, ocr_log):
    """Reads plate frames a player writes, e.g. mpv --vo=image with MPV_VF."""
    while True:
        try:
            names = sorted(n for n in os.listdir(frames_dir) if n.endswith(".png"))
        except FileNotFoundError:
            names = []
        for name in names[:-1]:  # the newest may still be written
            path = os.path.join(frames_dir, name)
            with open(path, "rb") as f:
                data = f.read()
            os.remove(path)
            feed(marquee, ocr(data), ocr_log)
        time.sleep(0.25)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", default="tracks.json")
    p.add_argument("--now", action="store_true", help="print the current track to stdout as JSON lines")
    p.add_argument(
        "--cookies-from-browser",
        metavar="BROWSER[:PROFILE]",
        help="passed to yt-dlp, e.g. firefox:~/.config/zen/xxxx.default-release",
    )
    p.add_argument("--ocr-log", metavar="FILE", help="append every raw OCR line here, for debugging")
    p.add_argument("--replay", metavar="FILE", help="feed OCR lines from a file instead of the stream")
    p.add_argument(
        "--frames-dir",
        metavar="DIR",
        help="OCR plate frames a player writes here instead of opening the stream",
    )
    a = p.parse_args()

    tracks = Tracklist(a.out)

    def now_playing(artist, title):
        print(json.dumps({"artist": artist, "title": title}, ensure_ascii=False), flush=True)

    marquee = Marquee(tracks.add, now_playing if a.now else None)
    try:
        if a.replay:
            with open(a.replay, encoding="utf-8") as f:
                for line in f:
                    marquee.feed(line)
        else:
            log = open(a.ocr_log, "a", encoding="utf-8") if a.ocr_log else contextlib.nullcontext()  # noqa: SIM115
            with log as ocr_log:
                if a.frames_dir:
                    watch_dir(marquee, a.frames_dir, ocr_log)
                else:
                    watch(marquee, a.cookies_from_browser, ocr_log)
    except KeyboardInterrupt:
        pass
    marquee.flush()


if __name__ == "__main__":
    main()
