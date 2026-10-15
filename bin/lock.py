#!/usr/bin/env python3
"""Holds the player lock, so one Claude Code session plays the stream at a time.

Prints "busy" while another process holds the lock, then "acquired" once it is
ours. The lock lasts while this process runs: it is killed on stop, and exits
by itself when the session that started it is gone. The kernel releases the
lock either way, even after a crash.
"""

import fcntl
import os
import sys
import time


def main():
    path = sys.argv[1]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    parent = os.getppid()
    with open(path, "a", encoding="utf-8") as f:
        said_busy = False
        while True:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not said_busy:
                    print("busy", flush=True)
                    said_busy = True
            if os.getppid() != parent:
                return
            time.sleep(1)
        print("acquired", flush=True)
        while os.getppid() == parent:
            time.sleep(1)


if __name__ == "__main__":
    main()
