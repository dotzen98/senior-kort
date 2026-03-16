#!/usr/bin/env python3
"""Simple HTTP server that also handles POST /api/save to write data.json."""
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/save':
            try:
                length = int(self.headers['Content-Length'])
                body = self.rfile.read(length)
                data = json.loads(body.decode('utf-8'))
                with open('data/data.json', 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                self._json(200, {'ok': True})
            except Exception as e:
                self._json(500, {'error': str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} - {fmt % args}")


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)) or '.')
    port = 8000
    server = HTTPServer(('localhost', port), Handler)
    print(f"Server kører på http://localhost:{port}")
    print("Tryk Ctrl+C for at stoppe.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stoppet.")
