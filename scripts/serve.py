#!/usr/bin/env python3
"""No-cache static server for local builder/demo development.

    python3 scripts/serve.py [port]     (or PORT env; default 8409)

Serves the repo root with `Cache-Control: no-store` so edits to the renderer
or the builder's ES modules are never masked by browser heuristic caching —
plain `python3 -m http.server` sends no cache headers and Chrome will happily
serve a day-old module from disk cache across reloads.
"""
import http.server
import os
import sys
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('PORT', '8409'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.test(partial(Handler, directory=ROOT), port=PORT)
