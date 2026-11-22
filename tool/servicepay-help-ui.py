#!/usr/bin/env python3
"""ServicePay customer help UI: enhances /knowledge/ and creates /knowledge/search/.

Writes only web/knowledge/index.html and web/knowledge/search/index.html.
Preserves the existing <head> (title, description, canonical, schema), header and footer.
Usage: python3 scripts/src/servicepay-help-ui.py [web_root]
"""
import html
import re
import sys
from pathlib import Path

ASSET_TAGS = ('<link rel="stylesheet" href="{rel}assets/knowledge-ui.css">'
              '<script defer src="{rel}assets/knowledge-engine.js"></script>'
              '<script defer src="{rel}assets/knowledge-app.js"></script>')

KNOW = [("Getting started", [("/how-to-register/", "How to register"), ("/how-to-use/", "How to use ServicePay"), ("/download/", "Download the app")]),
        ("Account and support", [("/account-wallet/", "Account and wallet"), ("/virtual-account/", "Virtual account"), ("/transactions/", "Transactions"), ("/security/", "Security and account protection"), ("/complaints/", "Complaints and support")]),
        ("Everyday services", [("/data/", "Data"), ("/airtime/", "Airtime"), ("/electricity/", "Electricity"), ("/nin-verification/", "NIN verification")]),
        ("Commerce and delivery", [("/marketplace/", "Marketplace"), ("/delivery/", "Delivery"), ("/logistics/", "Logistics")]),
        ("Programmes and education", [("/edupay/", "EduPay"), ("/solar/", "Solar"), ("/empowerment/", "Empowerment"), ("/amana/", "Amana")]),
        ("Company and policies", [("/about/", "About"), ("/company/", "Company"), ("/terms-and-conditions", "Terms"), ("/privacy-policy", "Privacy"), ("/faq/", "FAQ"), ("/contact/", "Contact")])]

POPULAR = [
    "My data purchase is pending",
    "How do I register on ServicePay?",
    "Will I get a virtual account number?",
    "How do I pay for electricity?",
    "Ina zan sami taimako?",
    "How do I contact support?",
]


def e(s):
    return html.escape(s, quote=True)


def grab(src, pattern, name):
    m = re.search(pattern, src, re.S)
    if not m:
        raise SystemExit(f"servicepay-help-ui: could not find {name} in knowledge/index.html")
    return m.group(0)


def search_form(mode):
    action = "./" if mode == "search" else "search/"
    return f"""<form class="kc-search" role="search" action="{action}" method="get" data-kc-form novalidate>
<label class="kc-label" for="kc-q">Search ServicePay guides</label>
<div class="kc-field">
<svg class="kc-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
<input id="kc-q" type="search" autocomplete="off" spellcheck="false" maxlength="120" placeholder="Try: pending data, NIN, rajista" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="kc-suggest" aria-describedby="kc-privacy-hint" disabled>
<button type="button" class="kc-mic" data-kc-mic hidden aria-label="Search by voice"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>
<button type="submit" class="kc-go" disabled>Search</button>
</div>
<ul id="kc-suggest" class="kc-suggest" role="listbox" aria-label="Suggestions" hidden></ul>
<p id="kc-privacy-hint" class="kc-hint">Your search stays on this device. Never type a PIN, password, BVN, NIN or account number here.</p>
<div class="kc-voice" data-kc-voice hidden></div>
<p class="kc-status" data-kc-status role="status" aria-live="polite"></p>
</form>"""


def crawl_links():
    out = '<section class="section kc-browse" aria-labelledby="kc-browse-h"><div class="wrap"><h2 id="kc-browse-h">Browse every guide</h2><div class="kc-browse-grid">'
    for t, links in KNOW:
        out += f'<div class="kc-group"><h3>{e(t)}</h3><ul>' + "".join(f'<li><a href="{h}">{e(n)}</a></li>' for h, n in links) + "</ul></div>"
    return out + "</div></div></section>"


SUPPORT = """<section class="section kc-support" id="kc-support" aria-labelledby="kc-support-h"><div class="wrap kc-support-grid">
<div><span class="eyebrow">Your own account</span><h2 id="kc-support-h">Need help with a payment or your account?</h2>
<p class="muted">Public guides cannot see your transactions, and nobody here will ask for them. For anything about your money, sign in first.</p>
<ol class="kc-path"><li>Sign in to ServicePay.</li><li>Open <b>All Services</b>, then <b>AI Support</b> for English or Hausa AI chat and to select your own transaction.</li><li>For complaints, open the dashboard <b>Help &amp; support</b> button, then create a ticket.</li></ol>
<a class="button" href="/?mode=login">Sign in for private support</a></div>
<div class="kc-contact"><h3>Talk to a person</h3><a class="kc-contact-row" href="mailto:support@servicepay.ng"><span>Email</span><b>support@servicepay.ng</b></a><a class="kc-contact-row" href="tel:+2349136151515"><span>Phone</span><b>+234 913 615 1515</b></a>
<p class="kc-small">Send only the reference shown in History. Never send your password, PIN or verification codes.</p></div>
</div></section>"""


def landing_main():
    pop = "".join(f'<li><a href="search/" data-kc-pop="{e(q)}">{e(q)}</a></li>' for q in POPULAR)
    return f"""<main id="main" class="kc" data-kc-mode="landing"><div class="wrap crumb"><nav aria-label="Breadcrumb"><a href="/">ServicePay</a> / <span aria-current="page">Knowledge</span></nav></div>
<section class="hero kc-hero"><div class="wrap"><span class="eyebrow">ServicePay help</span><h1>Knowledge centre</h1><p class="lead">Plain-language guides to everything in ServicePay. Ask in English or Hausa.</p>
{search_form("landing")}
<div class="actions"><a class="button" href="/?mode=register">Create account</a><a class="button alt" href="/?mode=login">Sign in</a></div></div></section>
<section class="section kc-tight" aria-labelledby="kc-cat-h"><div class="wrap"><h2 id="kc-cat-h" class="kc-h2">Search by topic</h2><div class="kc-cats" data-kc-cats><p class="kc-small">Topics load with search. All guides are listed below.</p></div></div></section>
<section class="section kc-tight" aria-labelledby="kc-pop-h"><div class="wrap kc-two"><div><h2 id="kc-pop-h" class="kc-h2">Popular questions</h2><ul class="kc-pop">{pop}</ul></div>
<div class="kc-assist" data-kc-assist><h2 class="kc-h2">Instant guide answers</h2><p class="kc-small">Short answers taken from verified, published ServicePay guidance. This is not an AI chat and nothing you type leaves this device.</p><div class="kc-answer-slot" data-kc-answer><p class="kc-small">Search above to see an instant answer.</p></div></div></div></section>
<section class="section kc-tight" data-kc-history-wrap hidden aria-labelledby="kc-hist-h"><div class="wrap"><h2 id="kc-hist-h" class="kc-h2">On this device</h2><div data-kc-history></div></div></section>
{crawl_links()}
{SUPPORT}
</main>"""


def search_main():
    return f"""<main id="main" class="kc" data-kc-mode="search"><div class="wrap crumb"><nav aria-label="Breadcrumb"><a href="/">ServicePay</a> / <a href="/knowledge/">Knowledge</a> / <span aria-current="page">Search</span></nav></div>
<section class="kc-hero kc-hero-sm"><div class="wrap"><h1>Search guides</h1>
{search_form("search")}
<div class="kc-filter" data-kc-filter></div></div></section>
<section class="section kc-tight"><div class="wrap kc-results-layout">
<div><div class="kc-assist kc-assist-inline" data-kc-assist><div class="kc-answer-slot" data-kc-answer></div></div>
<div data-kc-results aria-live="polite"><noscript><p>Search needs JavaScript. <a href="/knowledge/">Browse every guide</a> instead.</p></noscript></div></div>
<aside class="kc-side" aria-label="Search help"><div data-kc-related></div><div data-kc-history></div></aside>
</div></section>
{crawl_links()}
{SUPPORT}
</main>"""


def enhance(root):
    root = Path(root)
    src_path = root / "knowledge" / "index.html"
    src = src_path.read_text(encoding="utf-8")
    head = grab(src, r"<head>.*?</head>", "head")
    head = re.sub(r'<link rel="stylesheet" href="\.\./assets/knowledge-ui\.css">.*?knowledge-app\.js"></script>', "", head, flags=re.S)
    header = grab(src, r'<a class="skip".*?</header>', "header")
    footer = grab(src, r"<footer.*?</footer>", "footer")
    html_open = grab(src, r"<!doctype html>\s*<html[^>]*>", "html tag")

    land_head = head.replace("</head>", ASSET_TAGS.format(rel="../") + "</head>")
    landing = f'{html_open}{land_head}\n<body class="public-knowledge kc-page">{header}\n{landing_main()}\n{footer}\n</body></html>\n'
    src_path.write_text(landing, encoding="utf-8")

    # search route: no schema, noindex, canonical to landing, paths one level deeper
    s_head = re.sub(r'<script type="application/ld\+json">.*?</script>', "", head, flags=re.S)
    s_head = re.sub(r"<title>.*?</title>", "<title>Search ServicePay guides | Knowledge Centre</title>", s_head, flags=re.S)
    s_head = re.sub(r'<meta property="og:[^>]*>|<meta name="twitter:[^>]*>', "", s_head)
    s_head = s_head.replace('<meta name="description"', '<meta name="robots" content="noindex,follow"><meta name="referrer" content="no-referrer"><meta name="description"', 1)
    s_head = s_head.replace('href="../', 'href="../../')
    s_head = s_head.replace("</head>", ASSET_TAGS.format(rel="../../") + "</head>")
    s_header = header.replace('src="../', 'src="../../')
    out = root / "knowledge" / "search" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(f'{html_open}{s_head}\n<body class="public-knowledge kc-page">{s_header}\n{search_main()}\n{footer}\n</body></html>\n', encoding="utf-8")
    return [src_path, out]


if __name__ == "__main__":
    default = Path(__file__).resolve().parents[2] / "artifacts/servicepay-customer/flutter/web"
    for p in enhance(sys.argv[1] if len(sys.argv) > 1 else default):
        print("wrote", p)
