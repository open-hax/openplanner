# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded lifecycle fixture; never imports or calls a model runtime."""
import json
import os
import pathlib
import signal
import sys
import time


def main():
    mode, directory = sys.argv[1:]
    if mode == "exit-error":
        return 23
    if mode in ("stubborn", "orphan"):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    child = None
    if mode == "orphan":
        reader, writer = os.pipe()
        child = os.fork()
        if child == 0:
            os.close(reader)
            os.setsid()  # A different process group still belongs to the cgroup.
            os.write(writer, b"ready")
            os.close(writer)
            while True:
                time.sleep(1)
        os.close(writer)
        if os.read(reader, 5) != b"ready":
            return 24
        os.close(reader)
    data = {"pid": os.getpid(), "child": child,
            "uid": os.getuid(), "loginuid": pathlib.Path("/proc/self/loginuid").read_text().strip()}
    path = pathlib.Path(directory) / "ready.next"
    with path.open("x") as handle:
        json.dump(data, handle)
    path.replace(path.with_name("ready.json"))
    if mode == "orphan":
        return 0
    while True:
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main())
