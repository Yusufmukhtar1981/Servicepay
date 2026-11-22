#!/usr/bin/env python3
"""Deterministic generator for ServicePay customer public HTML knowledge pages.

Writes only into artifacts/servicepay-customer/flutter/web/<slug>/index.html and
terms-and-conditions.html. Never touches index.html, robots.txt, sitemap.xml,
llms.txt, privacy-policy.html, delete-account.html or news/.
Run: python3 scripts/src/servicepay-public-pages.py
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "artifacts/servicepay-customer/flutter/web"
if not ROOT.is_dir():
    ROOT = Path(__file__).resolve().parents[1] / "web"
BASE = "https://servicepay.ng"
LOGO = BASE + "/assets/assets/image/servicepay_logo.png"
PLAY = "https://play.google.com/store/apps/details?id=ng.servicepay.app"
OWNER = "YUMPAY GLOBAL TECH. LTD"
ORG = {
    "@type": "Organization", "@id": BASE + "/#organization", "name": "ServicePay",
    "url": BASE + "/", "logo": LOGO,
    "legalName": OWNER,
    "address": {"@type": "PostalAddress", "addressLocality": "Kano", "addressRegion": "Kano State", "addressCountry": "NG"},
    "email": "support@servicepay.ng",
    "contactPoint": [{"@type": "ContactPoint", "contactType": "customer support", "email": "support@servicepay.ng", "telephone": "+2349136151515", "areaServed": "NG"}],
}
WEBSITE = {"@type": "WebSite", "@id": BASE + "/#website", "name": "ServicePay", "url": BASE + "/", "publisher": {"@id": BASE + "/#organization"}}

NAV = [("/about/", "About"), ("/services/", "Services"), ("/knowledge/", "Knowledge"), ("/how-to-use/", "How to use"), ("/faq/", "FAQ"), ("/help/", "Help"), ("/contact/", "Contact")]
FOOT = [("/company/", "Company"), ("/download/", "Download"), ("/how-to-register/", "Register guide"), ("/news/", "News"),
        ("/terms-and-conditions", "Terms"), ("/privacy-policy", "Privacy"), ("/delete-account", "Delete account"), ("/contact/", "Contact")]

AVAIL = ("Availability depends on your account status, service provider, the current catalogue, any required approval and your location. "
         "A feature appearing in the app does not mean it is open to every customer at every moment.")
PURCHASE_STEPS = [
    "Sign in to ServicePay (or create an account) at servicepay.ng.",
    "Choose the service, then enter or select the recipient and pick the plan, bundle or amount shown in the app.",
    "Review the actual price and details shown on the confirmation screen before you continue.",
    "Authorize the payment with your PIN or the verification the app asks for.",
    "Check History. History is the authoritative record of whether the transaction succeeded, failed or is pending.",
]
PENDING_NOTE = ("If a transaction shows as pending or the result is unclear, do not blindly retry the same purchase. "
                "Wait for History to update, then contact support@servicepay.ng with the reference shown in History if it does not resolve.")


def e(s):
    return html.escape(s, quote=True)


def ul(items):
    return '<ul class="list">' + "".join(f"<li><span>{i}</span></li>" for i in items) + "</ul>"


def ol(items):
    return '<ol class="steps">' + "".join(f"<li>{i}</li>" for i in items) + "</ol>"


def sec(title, body):
    return f"<h2>{e(title)}</h2>{body}"


def p(t):
    return f"<p>{t}</p>"


def service_page(slug, name, desc, h1, intro, what, extra=None, steps=None, cta=True):
    body = sec(f"What {name} is", p(what))
    if steps:
        body += sec(f"How to use {name}", ol(steps))
    if extra:
        body += extra
    body += sec("Availability", p(e(AVAIL)))
    return dict(slug=slug, title=f"{name} on ServicePay | Nigeria", desc=desc, h1=h1, intro=intro,
                body=body, crumb=[("Services", "/services/"), (name, f"/{slug}/")], service=name, cta=cta)


PAGES = []

PAGES.append(dict(slug="about", title="About ServicePay | Digital services from Kano, Nigeria",
    desc="ServicePay is a Nigerian digital services platform owned and operated by YUMPAY GLOBAL TECH. LTD, based in Kano. Learn what the app does and how to reach us.",
    h1="Useful services, made closer to home.",
    intro="ServicePay is a Nigerian platform for everyday digital services, commerce and delivery, owned and operated by YUMPAY GLOBAL TECH. LTD in Kano.",
    body=sec("Who we are", p(f"ServicePay is owned and operated by {OWNER}, based in Kano, Kano State, Nigeria. The platform brings everyday services together in one account with a clear History of each activity."))
    + sec("What you can do", ul(['<a href="/data/">Buy mobile data</a> and <a href="/airtime/">airtime</a>', '<a href="/electricity/">Pay for electricity</a>', '<a href="/marketplace/">Shop on the marketplace</a> and request <a href="/delivery/">delivery</a>', 'Request <a href="/nin-verification/">NIN verification</a>', 'Apply for programmes such as <a href="/solar/">Solar</a>, <a href="/empowerment/">Empowerment</a> and <a href="/amana/">Amana</a>']))
    + p(e(AVAIL)) + sec("Contact", p('Support: <a href="mailto:support@servicepay.ng">support@servicepay.ng</a>, <a href="tel:+2349136151515">+234 913 615 1515</a>.')),
    crumb=[("About", "/about/")], page_type="AboutPage"))

PAGES.append(dict(slug="company", title="Company information | ServicePay by YUMPAY GLOBAL TECH. LTD",
    desc="Official company identity for ServicePay: owned and operated by YUMPAY GLOBAL TECH. LTD, Kano, Kano State, Nigeria. Support and administrative contacts.",
    h1="Company information", intro="The official identity behind ServicePay.",
    body=sec("Owner and operator", p(f"ServicePay is owned and operated by <strong>{OWNER}</strong>."))
    + sec("Location", p("Kano, Kano State, Nigeria."))
    + sec("Official contacts", ul(['Customer support: <a href="mailto:support@servicepay.ng">support@servicepay.ng</a>', 'Phone: <a href="tel:+2349136151515">+234 913 615 1515</a>', 'Administrative enquiries: <a href="mailto:admin@servicepay.ng">admin@servicepay.ng</a>', 'Website: <a href="/">servicepay.ng</a>']))
    + sec("Registration and licensing details", p("Registration numbers, licences and partner certifications are not published on this page. For verified company documentation, write to admin@servicepay.ng.")),
    crumb=[("Company", "/company/")], page_type="AboutPage"))

svc_links = [("data", "Data", "Mobile data bundles for Nigerian networks."), ("airtime", "Airtime", "Top up a phone number."),
             ("electricity", "Electricity", "Pay for prepaid or postpaid meters where supported."), ("nin-verification", "NIN verification", "Request National Identification Number verification."),
             ("marketplace", "Marketplace", "Browse and buy from listed sellers."), ("delivery", "Delivery", "Request delivery of items."),
             ("logistics", "Logistics", "Delivery and dispatch operations."), ("edupay", "EduPay", "School fee payments for participating schools."),
             ("solar", "Solar", "Apply for solar products and possible financing."), ("empowerment", "Empowerment", "Apply to empowerment and grant programmes."),
             ("amana", "Amana", "Request family support assistance.")]
PAGES.append(dict(slug="services", title="ServicePay services | Data, airtime, electricity and more",
    desc="Overview of services available in the ServicePay app in Nigeria: data, airtime, electricity, NIN verification, marketplace, delivery, EduPay, Solar, Empowerment and Amana.",
    h1="Services in ServicePay", intro="One account for everyday services. Each page explains what the service does and what to expect.",
    body='<h2>Explore service guides</h2><div class="grid">' + "".join(f'<a class="card svc" href="/{s}/"><h3>{n}</h3><p>{d}</p></a>' for s, n, d in svc_links) + "</div>"
    + sec("Availability", p(e(AVAIL)))
    + sec("Other features and availability", p("The current customer interface does not promote transfers, withdrawals, cable TV, exam PINs or airtime-to-cash as available services. This does not remove historical records. Flight information, where shown, does not include actual ticket booking. Other enabled services, including Keke Napep transport, may appear in All Services; check their current availability after signing in.")),
    crumb=[("Services", "/services/")], page_type="CollectionPage"))

PAGES.append(dict(slug="products", title="ServicePay products | App and web access",
    desc="ServicePay products: the ServicePay customer app on Android and the web app at servicepay.ng, giving access to data, airtime, electricity, marketplace and more.",
    h1="ServicePay products", intro="ServicePay is available as a web app and an Android app on Google Play.",
    body=sec("ServicePay web app", p('Open <a href="/">servicepay.ng</a> in a modern browser to sign in or register.'))
    + sec("ServicePay for Android", p(f'Install from <a href="{PLAY}" rel="noopener noreferrer">Google Play</a>. An iOS app is not currently announced.'))
    + sec("What is inside", p('See <a href="/services/">all services</a> for a description of each feature.')) + p(e(AVAIL)),
    crumb=[("Products", "/products/")], app=True))

PAGES.append(service_page("delivery", "Delivery", "Request delivery through ServicePay in Nigeria. Learn how delivery requests work, how to track them and where availability depends on location.",
    "Delivery with ServicePay", "Request delivery of items and follow progress in the app.",
    "ServicePay delivery lets signed-in customers request delivery of items, including marketplace orders where delivery is offered. Fees, if any, are shown in the app before you confirm.",
    steps=["Sign in and open Delivery or your marketplace order.", "Enter pickup and drop-off details.", "Review the fee and details shown.", "Confirm and follow status in the app."],
    extra=sec("Privacy", p("You only see your own delivery records."))))
PAGES.append(service_page("logistics", "Logistics", "How ServicePay logistics supports delivery and dispatch in Nigeria, and where customers can follow the status of their deliveries.",
    "Logistics at ServicePay", "The delivery and dispatch work that supports marketplace orders and delivery requests.",
    'ServicePay logistics covers the dispatch side of <a href="/delivery/">delivery</a>: assigning, moving and handing over items. Coverage depends on location and rider availability, and timelines are not guaranteed.'))
PAGES.append(service_page("data", "Data", "Buy mobile data bundles for Nigerian networks with ServicePay. Review the actual price before you pay and confirm results in History.",
    "Buy mobile data with ServicePay", "Choose a network bundle, review the price and pay from your account.",
    "Buy data bundles for Nigerian mobile numbers. Plans and prices come from the current catalogue and are shown in the app before you pay.",
    steps=PURCHASE_STEPS, extra=sec("If a purchase is pending", p(e(PENDING_NOTE)))))
PAGES.append(service_page("airtime", "Airtime", "Buy airtime for Nigerian mobile numbers on ServicePay. Choose a recipient and amount, review, authorize and confirm in History.",
    "Buy airtime with ServicePay", "Top up your own number or someone else's.",
    "Buy airtime for Nigerian mobile numbers. Amounts and any charges are shown in the app before you confirm.",
    steps=PURCHASE_STEPS, extra=sec("If a purchase is pending", p(e(PENDING_NOTE)))))
PAGES.append(service_page("electricity", "Electricity", "Pay electricity bills on ServicePay for supported Nigerian distribution companies. Verify the meter, review, authorize and check History.",
    "Pay for electricity with ServicePay", "Pay for supported prepaid or postpaid meters.",
    "Pay electricity bills for supported distribution companies. Check the meter name returned by the app before paying. Prepaid tokens, when issued, appear in History.",
    steps=PURCHASE_STEPS, extra=sec("If a payment is pending", p(e(PENDING_NOTE)))))
PAGES.append(service_page("nin-verification", "NIN verification", "Request National Identification Number (NIN) verification in the ServicePay app. Learn what to expect and how your data is handled.",
    "NIN verification", "Request verification of a National Identification Number from inside the app.",
    'Signed-in customers can submit a NIN verification request where the service is available. Any fee is shown before you confirm. Only submit a NIN you are authorised to use. See the <a href="/privacy-policy">privacy policy</a>.',
    steps=["Sign in and open NIN verification.", "Enter the NIN and requested details.", "Review any fee shown and confirm.", "Check the result and History."]))
PAGES.append(service_page("marketplace", "Marketplace", "Shop the ServicePay marketplace in Nigeria. Browse listed products, review prices and delivery options in the app, and follow your order.",
    "ServicePay Marketplace", "Browse products from listed sellers and order from your account.",
    "The marketplace lists products from sellers on ServicePay. Product availability, prices and delivery options are set per listing and shown in the app.",
    steps=["Sign in and open Marketplace.", "Browse and add items.", "Review the price and delivery option shown.", "Confirm and follow the order status."]))
PAGES.append(service_page("edupay", "EduPay", "EduPay on ServicePay supports school fee payments for participating schools only. Learn how it works and how to check if your school participates.",
    "EduPay school payments", "School fee payments for participating schools.",
    "EduPay lets parents and guardians pay school fees to schools that participate in EduPay. It is restricted to participating schools; if your school is not listed in the app, EduPay is not available for it.",
    steps=["Sign in and open EduPay.", "Find your participating school and student.", "Review the amount shown.", "Authorize and keep the record from History."]))
PAGES.append(service_page("solar", "Solar", "Apply for solar products through ServicePay. Applications are reviewed; approval, financing and installation are not guaranteed.",
    "Solar applications", "Submit a solar application from the app for review.",
    "Customers can submit a solar application in the app. Applications are reviewed, and some approved applications may be offered a solar finance arrangement. Submitting an application does not guarantee approval, financing, pricing or installation dates. Terms of any approved arrangement are provided to you at that stage.",
    steps=["Sign in and open Solar.", "Complete the application form.", "Submit and wait for review.", "Track your application status in the app."]))
PAGES.append(service_page("empowerment", "Empowerment", "Apply to empowerment and grant programmes through ServicePay. Eligibility and review apply; benefits are not guaranteed.",
    "Empowerment and grants", "Apply to open empowerment programmes from the app.",
    "When an empowerment or grant programme is open, eligible customers can apply in the app. Applications are reviewed against each programme's eligibility rules. Approved and paid benefits appear in the app. Applying does not guarantee selection, funding or returns.",
    steps=["Sign in and open Empowerment.", "Read the programme requirements.", "Submit your application.", "Track the review status in the app."]))
PAGES.append(service_page("amana", "Amana", "Amana on ServicePay lets customers request family support such as food, school fees or medical assistance. Requests are reviewed and not guaranteed.",
    "Amana family support requests", "Request support for food, school fees or medical needs.",
    "Amana lets customers submit a family support request, for example for food, school fees or medical assistance, with supporting documents where asked. Requests are reviewed; submitting one does not guarantee assistance or any amount.",
    steps=["Sign in and open Amana.", "Describe the need and attach requested documents.", "Submit the request.", "Follow the review status in the app."]))

faqs = [
    ("What is ServicePay?", f"A Nigerian digital services app owned and operated by {OWNER}, based in Kano."),
    ("How do I create an account?", 'Go to <a href="/?mode=register">servicepay.ng/?mode=register</a> and follow the steps. See the <a href="/how-to-register/">registration guide</a>.'),
    ("Is every service available to everyone?", e(AVAIL)),
    ("My purchase is pending. Should I try again?", e(PENDING_NOTE)),
    ("Will I get a virtual bank account instantly?", "Not necessarily. Creation of new virtual accounts with our current provider is temporarily unavailable, so we do not promise instant account numbers."),
    ("Can I send money or withdraw to a bank?", "Wallet transfers and withdrawals are not currently offered to customers in the app."),
    ("Can I book flights?", "No. ServicePay does not currently book flight tickets."),
    ("Is there an iPhone app?", f'No iOS app is currently announced. Use the web app at servicepay.ng or the <a href="{PLAY}" rel="noopener noreferrer">Android app</a>.'),
    ("How do I delete my account?", 'Follow the steps on the <a href="/delete-account">delete account</a> page.'),
    ("How do I contact support?", 'Email <a href="mailto:support@servicepay.ng">support@servicepay.ng</a> or call <a href="tel:+2349136151515">+234 913 615 1515</a>.'),
]
PAGES.append(dict(slug="faq", title="ServicePay FAQ | Common questions answered",
    desc="Answers to common ServicePay questions: registration, service availability, pending purchases, virtual accounts, Android app, account deletion and support.",
    h1="Frequently asked questions", intro="Straight answers about using ServicePay.",
    body="".join(f'<details class="faq"><summary>{e(q)}</summary><p>{a}</p></details>' for q, a in faqs),
    crumb=[("FAQ", "/faq/")]))

PAGES.append(dict(slug="how-to-register", title="How to register on ServicePay | Step-by-step",
    desc="Step-by-step guide to creating a ServicePay account on the web or Android app, verifying your details and signing in securely.",
    h1="How to register on ServicePay", intro="Create your account in a few steps.",
    body=sec("Steps", ol(['Open <a href="/?mode=register">servicepay.ng/?mode=register</a> or install the <a href="' + PLAY + '" rel="noopener noreferrer">Android app</a>.', "Enter the details requested, including your phone number and email.", "Complete any verification code sent to you.", "Set a secure password and transaction PIN. Never share them.", 'Sign in at <a href="/?mode=login">servicepay.ng/?mode=login</a>.']))
    + sec("About virtual accounts", p("New virtual account creation with our current provider is temporarily unavailable, so an account number may not be issued immediately after registration.")),
    crumb=[("Help", "/help/"), ("How to register", "/how-to-register/")], howto=True))

PAGES.append(dict(slug="how-to-use", title="How to use ServicePay | Purchases, History and support",
    desc="Learn how to use ServicePay: choose a service, review the real price, authorize, and confirm in History. What to do if a transaction is pending.",
    h1="How to use ServicePay", intro="The same simple pattern works across most services.",
    body=sec("Making a purchase", ol(PURCHASE_STEPS)) + sec("Pending or unclear results", p(e(PENDING_NOTE)))
    + sec("Applications and requests", p('Solar, Empowerment and Amana are applications or requests that are reviewed. Follow status in the app; approval is not guaranteed.'))
    + sec("Keep your account safe", ul(["Never share your password, PIN or verification codes.", "ServicePay support will not ask for your PIN."])),
    crumb=[("Help", "/help/"), ("How to use", "/how-to-use/")], howto=True))

PAGES.append(dict(slug="contact", title="Contact ServicePay | Customer support",
    desc="Contact ServicePay customer support by email at support@servicepay.ng or phone +2349136151515. Administrative enquiries: admin@servicepay.ng. Kano, Nigeria.",
    h1="Contact ServicePay", intro="We are here to help with your account and transactions.",
    body='<div class="contact-grid"><div class="card contact-card"><h3>Support email</h3><a href="mailto:support@servicepay.ng">support@servicepay.ng</a></div><div class="card contact-card"><h3>Support phone</h3><a href="tel:+2349136151515">+234 913 615 1515</a></div><div class="card contact-card"><h3>Administrative</h3><a href="mailto:admin@servicepay.ng">admin@servicepay.ng</a></div><div class="card contact-card"><h3>Location</h3><p>Kano, Kano State, Nigeria</p></div></div>'
    + sec("When contacting support", p("Include the transaction reference from History. Never send your password, PIN or verification codes.")),
    crumb=[("Contact", "/contact/")], page_type="ContactPage"))

PAGES.append(dict(slug="help", title="ServicePay Help Centre | Guides and support",
    desc="ServicePay help centre: registration and usage guides, FAQ, pending transaction advice, account deletion and how to contact customer support.",
    h1="Help centre", intro="Find a guide or reach support.",
    body=ul(['<a href="/how-to-register/">How to register</a>', '<a href="/how-to-use/">How to use ServicePay</a>', '<a href="/faq/">Frequently asked questions</a>', '<a href="/knowledge/">Knowledge centre</a>', '<a href="/delete-account">Delete your account</a>', '<a href="/privacy-policy">Privacy policy</a>', '<a href="/contact/">Contact support</a>'])
    + sec("Pending transactions", p(e(PENDING_NOTE))),
    crumb=[("Help", "/help/")]))

PAGES.append(dict(slug="download", title="Download ServicePay | Android app and web",
    desc="Get ServicePay on Android from Google Play or use the web app at servicepay.ng. No iOS app is currently announced.",
    h1="Get ServicePay", intro="Use ServicePay on Android or in your browser.",
    body=sec("Android", p(f'<a class="button" href="{PLAY}" rel="noopener noreferrer">Get it on Google Play</a>'))
    + sec("Web", p('<a href="/?mode=login">Sign in</a> or <a href="/?mode=register">register</a> at servicepay.ng.'))
    + sec("iPhone", p("An iOS app is not currently announced. You can use the web app in Safari.")),
    crumb=[("Download", "/download/")], app=True))

know = [("Getting started", [("/how-to-register/", "How to register"), ("/how-to-use/", "How to use ServicePay"), ("/download/", "Download the app")]),
        ("Everyday services", [("/data/", "Data"), ("/airtime/", "Airtime"), ("/electricity/", "Electricity"), ("/nin-verification/", "NIN verification")]),
        ("Commerce and delivery", [("/marketplace/", "Marketplace"), ("/delivery/", "Delivery"), ("/logistics/", "Logistics")]),
        ("Programmes and education", [("/edupay/", "EduPay"), ("/solar/", "Solar"), ("/empowerment/", "Empowerment"), ("/amana/", "Amana")]),
        ("Company and policies", [("/about/", "About"), ("/company/", "Company"), ("/terms-and-conditions", "Terms"), ("/privacy-policy", "Privacy"), ("/faq/", "FAQ"), ("/contact/", "Contact")])]
PAGES.append(dict(slug="knowledge", title="ServicePay Knowledge Centre | Guides for every service",
    desc="The ServicePay knowledge centre: plain-language guides to data, airtime, electricity, NIN verification, marketplace, delivery, EduPay, Solar, Empowerment and Amana.",
    h1="Knowledge centre", intro="Plain-language guides to everything in ServicePay.",
    body="".join(sec(t, ul([f'<a href="{h}">{n}</a>' for h, n in links])) for t, links in know),
    crumb=[("Knowledge", "/knowledge/")], page_type="CollectionPage"))

PAGES.append(dict(slug="terms-and-conditions.html", title="Terms and conditions | ServicePay",
    desc="Status of ServicePay terms and conditions: no comprehensive public terms have been published yet. Service-specific terms apply; contact support for questions.",
    h1="Terms and conditions", intro="An honest note on the current status of our terms.",
    body=sec("Current status", p("Comprehensive public terms and conditions for ServicePay have not yet been published on this website. This page will be updated when they are."))
    + sec("What applies now", ul(["Service-specific terms, notices and confirmation details shown in the app at the time you use a service.", "The terms of any approved application or programme, provided to you at that stage.", 'Our <a href="/privacy-policy">privacy policy</a> for how personal data is handled.']))
    + sec("Questions", p('Contact <a href="mailto:support@servicepay.ng">support@servicepay.ng</a> or <a href="tel:+2349136151515">+234 913 615 1515</a>. Administrative enquiries: <a href="mailto:admin@servicepay.ng">admin@servicepay.ng</a>.')),
    crumb=[("Terms and conditions", "/terms-and-conditions")]))

EXTRA_CSS = """
/* knowledge-centre additions (generated pages) */
.skip{position:absolute;left:-9999px}.skip:focus{left:14px;top:10px;z-index:9;background:#fff;padding:8px 12px;border-radius:8px}
.mnav{display:none}.mnav summary{list-style:none;cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 12px;color:var(--green);font-weight:700}.mnav summary::-webkit-details-marker{display:none}
.mnav nav{display:grid;gap:4px;margin-top:10px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px}.mnav nav a{padding:8px 10px;text-decoration:none}
.steps{padding-left:22px}.steps li{margin:8px 0;color:var(--muted)}a.card.svc{text-decoration:none;color:var(--ink);display:block}a.card.svc:hover{border-color:var(--green)}
.prose .grid{margin-top:20px}
@media(max-width:760px){.nav .links{display:none}.mnav{display:block;order:3;width:100%}}
"""


def jsonld(pg):
    url = BASE + ("/" + pg["slug"].removesuffix(".html") if pg["slug"].endswith(".html") else f"/{pg['slug']}/")
    crumbs = [("ServicePay", "/")] + pg["crumb"]
    graph = [ORG, WEBSITE,
             {"@type": pg.get("page_type", "WebPage"), "@id": url + "#webpage", "url": url, "name": pg["title"], "description": pg["desc"],
              "isPartOf": {"@id": BASE + "/#website"}, "about": {"@id": BASE + "/#organization"}, "inLanguage": "en-NG"},
             {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": BASE + h} for i, (n, h) in enumerate(crumbs)]}]
    if pg.get("service"):
        graph.append({"@type": "Service", "name": pg["service"], "serviceType": pg["service"], "provider": {"@id": BASE + "/#organization"}, "areaServed": {"@type": "Country", "name": "Nigeria"}, "url": url})
    if pg.get("app"):
        graph.append({"@type": "SoftwareApplication", "name": "ServicePay", "operatingSystem": "Android", "applicationCategory": "FinanceApplication", "installUrl": PLAY, "publisher": {"@id": BASE + "/#organization"}})
    return url, json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, sort_keys=False, separators=(",", ":"))


def render(pg):
    url, ld = jsonld(pg)
    path = "/" + pg["slug"].removesuffix(".html") if pg["slug"].endswith(".html") else f"/{pg['slug']}/"
    rel = "" if pg["slug"].endswith(".html") else "../"
    links = "".join(f'<a href="{h}"' + (' aria-current="page"' if h == path else "") + f">{n}</a>" for h, n in NAV)
    crumbs = [("ServicePay", "/")] + pg["crumb"]
    bc = " / ".join(f'<a href="{h}">{e(n)}</a>' if i < len(crumbs) - 1 else f'<span aria-current="page">{e(n)}</span>' for i, (n, h) in enumerate(crumbs))
    ctas = '<div class="actions"><a class="button" href="/?mode=register">Create account</a><a class="button alt" href="/?mode=login">Sign in</a></div>'
    foot = "".join(f'<a href="{h}">{n}</a>' for h, n in FOOT)
    t, d = e(pg["title"]), e(pg["desc"])
    return f"""<!doctype html>
<html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{t}</title><meta name="description" content="{d}"><link rel="canonical" href="{url}">
<meta property="og:site_name" content="ServicePay"><meta property="og:title" content="{t}"><meta property="og:description" content="{d}"><meta property="og:url" content="{url}"><meta property="og:type" content="website"><meta property="og:image" content="{LOGO}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="{t}"><meta name="twitter:description" content="{d}"><meta name="twitter:image" content="{LOGO}">
<script type="application/ld+json">{ld}</script>
<link rel="stylesheet" href="{rel}assets/seo-public.css"><link rel="icon" href="{rel}favicon.png"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap nav"><a class="brand" href="/"><img src="{rel}assets/assets/image/servicepay_logo.png" alt="ServicePay logo" width="46" height="46"><span>Service<b>Pay</b></span></a>
<nav class="links" aria-label="Main">{links}</nav><a class="nav-cta" href="/?mode=login">Open ServicePay</a>
<details class="mnav"><summary aria-label="Open menu">Menu</summary><nav aria-label="Mobile">{links}<a href="/?mode=register">Create account</a></nav></details></div></header>
<main id="main"><div class="wrap crumb"><nav aria-label="Breadcrumb">{bc}</nav></div>
<section class="hero"><div class="wrap"><span class="eyebrow">ServicePay</span><h1>{e(pg["h1"])}</h1><p class="lead">{e(pg["intro"])}</p>{ctas}</div></section>
<section class="section"><div class="wrap prose">{pg["body"]}</div></section></main>
<footer class="site-footer"><div class="wrap footer-grid"><span>&copy; 2026 {OWNER}. Kano, Nigeria.</span><div class="footer-links">{foot}</div></div></footer>
</body></html>
"""


def main():
    for pg in PAGES:
        out = ROOT / pg["slug"] if pg["slug"].endswith(".html") else ROOT / pg["slug"] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render(pg), encoding="utf-8")
    css = ROOT / "assets/seo-public.css"
    s = css.read_text(encoding="utf-8")
    marker = "/* knowledge-centre additions (generated pages) */"
    if marker in s:
        s = s[: s.index(marker)].rstrip() + "\n"
    css.write_text(s + EXTRA_CSS.lstrip("\n"), encoding="utf-8")
    print(f"wrote {len(PAGES)} pages")


if __name__ == "__main__":
    main()
