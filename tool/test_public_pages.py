"""Offline checks for ServicePay's public HTML without touching Flutter or data."""
import json
import re
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("artifacts/servicepay-customer/flutter/web")
sys.argv = sys.argv[:1]
PUBLIC = [
    "/", "/about/", "/company/", "/services/", "/products/", "/delivery/",
    "/logistics/", "/data/", "/airtime/", "/electricity/", "/nin-verification/",
    "/marketplace/", "/edupay/", "/solar/", "/empowerment/", "/amana/",
    "/faq/", "/how-to-register/", "/how-to-use/", "/contact/", "/help/",
    "/download/", "/knowledge/", "/privacy-policy", "/delete-account",
    "/terms-and-conditions", "/news/",
]


def page_file(route):
    if route == "/":
        return ROOT / "index.html"
    if route.endswith("/"):
        return ROOT / route.strip("/") / "index.html"
    return ROOT / (route.strip("/") + ".html")


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.schemas = []
        self.in_schema = False
        self.schema_text = ""
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if tag == "script" and attrs.get("type") == "application/ld+json":
            self.in_schema = True
            self.schema_text = ""

    def handle_data(self, data):
        if self.in_schema:
            self.schema_text += data

    def handle_endtag(self, tag):
        if tag == "script" and self.in_schema:
            self.schemas.append(json.loads(self.schema_text))
            self.in_schema = False


class PublicChecks(unittest.TestCase):
    def test_pages_metadata_schema_and_links(self):
        titles = set()
        descriptions = set()
        for route in PUBLIC:
            with self.subTest(route=route):
                text = page_file(route).read_text()
                page = Page(text)
                title = re.findall(r"<title>(.*?)</title>", text, re.S)
                self.assertEqual(len(title), 1)
                self.assertNotIn(title[0], titles)
                titles.add(title[0])
                metas = [a for t, a in page.tags if t == "meta"]
                desc = [a["content"] for a in metas if a.get("name") == "description"]
                self.assertEqual(len(desc), 1)
                self.assertNotIn(desc[0], descriptions)
                descriptions.add(desc[0])
                self.assertEqual(len([1 for t, _ in page.tags if t == "h1"]), 1)
                canonical = [a["href"] for t, a in page.tags if t == "link" and a.get("rel") == "canonical"]
                self.assertEqual(canonical, ["https://servicepay.ng" + route])
                for key in ["og:title", "og:description", "og:url", "og:type"]:
                    self.assertEqual(len([a for a in metas if a.get("property") == key]), 1)
                self.assertTrue(page.schemas, "JSON-LD missing")
                self.assertNotIn("1895531", text, "Unverified registration claim")
                for tag, attrs in page.tags:
                    if tag == "img":
                        self.assertTrue(attrs.get("alt"))
                    if tag != "a" or "href" not in attrs:
                        continue
                    href = urlsplit(urljoin("https://servicepay.ng" + route, attrs["href"]))
                    if href.netloc != "servicepay.ng" or href.scheme != "https":
                        continue
                    if href.path == "/":
                        continue
                    self.assertTrue(href.path in PUBLIC or href.path + "/" in PUBLIC,
                                    "Unknown internal link: " + href.path)

    def test_discovery_files(self):
        xml = ET.fromstring((ROOT / "sitemap.xml").read_text())
        urls = [node.text for node in xml.findall(".//{*}loc")]
        self.assertEqual(set(urls), {"https://servicepay.ng" + p for p in PUBLIC})
        self.assertEqual(len(urls), len(set(urls)))
        robots = (ROOT / "robots.txt").read_text()
        self.assertIn("Sitemap: https://servicepay.ng/sitemap.xml", robots)
        self.assertIn("Disallow: /api", robots)
        self.assertIn("Disallow: /admin", robots)
        llms = (ROOT / "llms.txt").read_text()
        self.assertTrue(llms.startswith("# ServicePay"))
        self.assertIn("YUMPAY GLOBAL TECH. LTD", llms)

    def test_flutter_bootstrap_and_session_preserved(self):
        text = (ROOT / "index.html").read_text()
        self.assertIn('id="servicepay-public-shell"', text)
        self.assertIn('id="servicepay-session-shell"', text)
        self.assertIn("flutter-first-frame", text)
        self.assertIn("flutter.servicepay_secure_session_present", text)
        self.assertIn('<base href="$FLUTTER_BASE_HREF">', text)
        self.assertIn('<script src="flutter_bootstrap.js" async></script>', text)


if __name__ == "__main__":
    unittest.main()
