"""Tests for bin/collect.py: OCR fixes, marquee stitching and the tracklist file.

Run: python3 -m unittest discover -s tests
"""

import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("collect", ROOT / "bin" / "collect.py")
collect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect)

WIDTH = 24  # characters the plate shows at once


def frames(unit, step=3):
    """One scroll cycle of the marquee as OCR sees it: a pause, then the text sliding left."""
    loop = unit + "    "
    strip = loop * 3
    shown = [strip[:WIDTH]] * 3  # the pause at the start of a cycle
    shown += [strip[off : off + WIDTH] for off in range(step, len(loop) + 1, step)]
    return shown


class FixOcrTest(unittest.TestCase):
    def test_track_numbers(self):
        self.assertEqual(collect.fix_ocr("0l - Between Dreams"), "01 - Between Dreams")
        self.assertEqual(collect.fix_ocr("l2 - Drift"), "12 - Drift")

    def test_digits_inside_words_follow_the_dictionary(self):
        with mock.patch.object(collect, "WORDS", {"fields", "tourist"}):
            self.assertEqual(collect.fix_ocr("Fie1ds of Ethera"), "Fields of Ethera")
            self.assertEqual(collect.fix_ocr("Tour1st"), "Tourist")

    def test_without_a_dictionary_1_is_i_inside_and_l_at_the_end(self):
        with mock.patch.object(collect, "WORDS", set()):
            self.assertEqual(collect.fix_word("Tour1st"), "Tourist")
            self.assertEqual(collect.fix_word("Be1"), "Bel")
            self.assertEqual(collect.fix_word("Ech0es"), "Echoes")

    def test_plain_words_and_numbers_stay(self):
        self.assertEqual(collect.fix_ocr("Joya — Sunday 2024"), "Joya — Sunday 2024")


class NormTest(unittest.TestCase):
    def test_keeps_letters_and_digits_only(self):
        self.assertEqual(collect.norm("Ol' Burger Beats — 01 - Lo-Fi!"), "olburgerbeats01lofi")
        self.assertEqual(collect.norm("Ёлка — Привет"), "ёлкапривет")


class MarqueeTest(unittest.TestCase):
    def run_marquee(self, *units, cycles=2):
        tracks, nows = [], []
        m = collect.Marquee(lambda a, t: tracks.append((a, t)), lambda a, t: nows.append((a, t)))
        for unit in units:
            for _ in range(cycles):
                for line in frames(unit):
                    m.feed(line)
            # The next cycle's pause closes the last one.
            for line in frames(unit)[:3]:
                m.feed(line)
        m.flush()
        return tracks, nows

    def test_a_scrolling_line_is_stitched_into_one_track(self):
        tracks, nows = self.run_marquee("Siren and the Sea — Swimwave Dreams")
        self.assertEqual(tracks, [("Siren and the Sea", "Swimwave Dreams")])
        self.assertEqual(nows, [("Siren and the Sea", "Swimwave Dreams")])

    def test_a_new_track_closes_the_previous_one(self):
        tracks, _ = self.run_marquee("Joya — Sunday Morning Light", "Astor — 01 - Drift Away Slowly")
        self.assertEqual(tracks, [("Joya", "Sunday Morning Light"), ("Astor", "01 - Drift Away Slowly")])

    def test_blank_frames_and_a_line_without_separator_give_nothing(self):
        tracks = []
        m = collect.Marquee(lambda a, t: tracks.append((a, t)))
        m.feed("")
        m.feed("   ")
        for _ in range(2):
            for line in frames("Claude FM live radio stream now"):
                m.feed(line)
        m.flush()
        self.assertEqual(tracks, [])


class TracklistTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = str(pathlib.Path(self.dir.name) / "deep" / "tracks.json")
        # Tracklist.add announces new tracks on stderr.
        quiet = contextlib.redirect_stderr(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)

    def tearDown(self):
        self.dir.cleanup()

    def read(self):
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    def test_a_new_track_is_written_with_its_first_play(self):
        collect.Tracklist(self.path).add("Joya", "Sunday")
        [t] = self.read()
        self.assertEqual((t["artist"], t["title"], t["plays"]), ("Joya", "Sunday", 1))
        self.assertEqual(t["first_seen"], t["last_seen"])

    def test_the_same_track_read_slightly_differently_counts_as_a_replay(self):
        tl = collect.Tracklist(self.path)
        tl.add("Peripheral Bliss", "01 - Between Dreams")
        tl.add("Peripheral Bl1ss", "01 - Between Dreams")
        tl.add("Kyle Preston", "Coastline")
        plays = [(t["artist"], t["plays"]) for t in self.read()]
        self.assertEqual(plays, [("Peripheral Bliss", 2), ("Kyle Preston", 1)])

    def test_tracks_survive_a_restart(self):
        collect.Tracklist(self.path).add("Ardley", "Lanterns")
        tl = collect.Tracklist(self.path)
        self.assertEqual(len(tl.tracks), 1)
        tl.add("Ardley", "Lanterns")
        self.assertEqual(self.read()[0]["plays"], 2)
        self.assertFalse(pathlib.Path(self.path + ".tmp").exists())


class FilterTest(unittest.TestCase):
    def test_plugin_and_collector_crop_the_same_plate(self):
        register = (ROOT / "hooks" / "register.tsx").read_text(encoding="utf-8")
        self.assertIn(f"const PLATE_VF = '{collect.MPV_VF}'", register)


if __name__ == "__main__":
    unittest.main()
