"""Serve the real ServicePay Admin web build with same-origin API proxying."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import argparse


class AdminPreviewHandler(SimpleHTTPRequestHandler):
    build_root: Path
    api_origin: str

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(self.build_root), **kwargs)

    def _proxy_api(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length) if content_length else None
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {"host", "content-length", "connection"}
        }
        request = Request(
            f"{self.api_origin}{self.path}",
            data=body,
            headers=headers,
            method=self.command,
        )
        try:
            response = urlopen(request, timeout=30)
        except HTTPError as error:
            response = error

        payload = response.read()
        self.send_response(response.status)
        for key, value in response.headers.items():
            if key.lower() not in {
                "transfer-encoding",
                "connection",
                "content-length",
                "content-encoding",
            }:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_web(self) -> None:
        request_path = urlsplit(self.path).path
        requested = (self.build_root / request_path.lstrip("/")).resolve()
        if request_path != "/" and (
            self.build_root.resolve() not in requested.parents
            or not requested.exists()
        ):
            self.path = "/index.html"
        super().do_GET()

    def do_GET(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_api()
        else:
            self._serve_web()

    def do_POST(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_api()
        else:
            self.send_error(404)

    def do_PATCH(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_api()
        else:
            self.send_error(404)

    def do_PUT(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_api()
        else:
            self.send_error(404)

    def do_DELETE(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_api()
        else:
            self.send_error(404)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--api-origin", default="http://127.0.0.1:3000")
    args = parser.parse_args()

    AdminPreviewHandler.build_root = Path(args.directory).resolve()
    AdminPreviewHandler.api_origin = args.api_origin.rstrip("/")
    ThreadingHTTPServer(("0.0.0.0", args.port), AdminPreviewHandler).serve_forever()


if __name__ == "__main__":
    main()