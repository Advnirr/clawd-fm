#!/usr/bin/env python3
"""Sends one JSON command to mpv's IPC socket and prints the reply."""

import json
import socket
import sys

sock = socket.socket(socket.AF_UNIX)
sock.settimeout(2)
sock.connect(sys.argv[1])
sock.sendall(sys.argv[2].encode() + b"\n")
buf = b""
while True:
    chunk = sock.recv(4096)
    if not chunk:
        break
    buf += chunk
    *lines, buf = buf.split(b"\n")
    for line in lines:
        msg = json.loads(line)
        if "error" in msg:  # skip async events
            print(line.decode())
            sys.exit(0)
