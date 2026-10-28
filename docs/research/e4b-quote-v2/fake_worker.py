# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded lifecycle fixture; never imports or calls a model runtime."""
import json
import http.server
import socket
import types
import os
import pathlib
import signal
import sys
import time


def serve_fixture(listener, directory, marker):
    """Fixed one-request fake HTTP response; never evaluates input or loads a model."""
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            length = self.headers.get('Content-Length', '')
            if self.path != '/api/chat' or not length.isdigit() or not 0 < int(length) <= 256:
                self.send_error(400)
                return
            try:
                body = json.loads(self.rfile.read(int(length)))
            except (ValueError, UnicodeError):
                self.send_error(400)
                return
            if body != {'fixture': marker}:
                self.send_error(400)
                return
            try:
                with (directory / 'request.json').open('x') as handle:
                    json.dump({'pid': os.getpid(), 'fixture': marker}, handle)
            except FileExistsError:
                self.send_error(409)
                return
            content = json.dumps({'fixture': marker})
            response = (json.dumps({'message': {'content': content}, 'done': True}) + '\n').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    with listener:
        while True:
            try:
                connection, address = listener.accept()
            except TimeoutError:
                continue
            with connection:
                connection.settimeout(.3)
                Handler(connection, address, types.SimpleNamespace())


def main():
    mode, directory, *extra = sys.argv[1:]
    listener = None
    if mode == "listener":
        if len(extra) != 1:
            raise ValueError("A fixed law-supplied fixture marker is required")
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(.1)
    elif extra:
        raise ValueError("Unexpected fixture arguments")
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
    if listener is not None:
        data["port"] = listener.getsockname()[1]
    path = pathlib.Path(directory) / "ready.next"
    with path.open("x") as handle:
        json.dump(data, handle)
    path.replace(path.with_name("ready.json"))
    if mode == "orphan":
        return 0
    if listener is not None:
        serve_fixture(listener, pathlib.Path(directory), extra[0])
        return 0
    while True:
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main())
