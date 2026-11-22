#!/usr/bin/env python3
"""Extend verified public guides; build a public-only search index, never query a database."""
import importlib.util
import json
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "artifacts/servicepay-customer/flutter/web"
if not ROOT.is_dir():
    ROOT = Path(__file__).resolve().parents[1] / "web"
BASE = "https://servicepay.ng"
NS = "http://www.sitemaps.org/schemas/sitemap/0.9"

CATEGORIES = [
    ("registration", "Account Registration", "Buɗe Asusun", "Registration and getting started."),
    ("wallet", "Account and Wallet", "Asusu da Wallet", "Account and wallet guidance."),
    ("virtual-account", "Virtual Account", "Asusun Bankin Virtual", "Account availability and safe troubleshooting."),
    ("data", "Data Subscription", "Siyan Data", "Mobile data plans and delivery."),
    ("airtime", "Airtime", "Katin Waya", "Phone top-ups and recipient checks."),
    ("electricity", "Electricity", "Wutar Lantarki", "Meters, tokens and payment records."),
    ("nin", "NIN Verification", "Tabbatar da NIN", "Using the secure verification flow."),
    ("edupay", "EduPay", "Kuɗin Makaranta", "Participating schools and payments."),
    ("delivery", "Delivery", "Kai Kaya", "Delivery requests and order tracking."),
    ("logistics", "Logistics", "Sufurin Kaya", "Dispatch and interstate guidance."),
    ("marketplace", "Marketplace", "Kasuwa", "Listings, orders and seller availability."),
    ("solar", "ServicePay Solar", "Hasken Rana", "Solar applications and approvals."),
    ("empowerment", "ServicePay Empowerment", "Tallafin Empowerment", "Programme eligibility and applications."),
    ("amana", "ServicePay Amana", "Tallafin Amana", "Family support programme guidance."),
    ("transactions", "Transactions", "Ma'amaloli", "History and uncertain outcomes."),
    ("security", "Security and Account Protection", "Tsaron Asusu", "Passwords, PINs and fraud prevention."),
    ("support", "Complaints and Customer Support", "Ƙorafi da Taimako", "Secure tickets and human assistance."),
]

GUIDES = [
    ("account-wallet", "Account and Wallet help", "Understand account access, wallet records and safe funding troubleshooting.",
     [("Check your own records", "Sign in to your own account to view the Wallet and Transaction History. Public search cannot read your balance or confirm that a deposit arrived."),
      ("Funding not reflected", "Compare the funding status and reference shown in the app with your bank record. Do not blindly repeat an uncertain transfer. Use Help & Support to create a ticket for the support team. Never post your account number, balance or banking details in public search."),
      ("Secure support", "AI Smart Support can guide you and, where enabled, investigate a record you select after authentication. A stored status is not necessarily fresh provider confirmation. AI cannot move money or promise a refund.")]),
    ("virtual-account", "Virtual Account troubleshooting", "Safe guidance for existing accounts, unavailable generation and uncertain requests.",
     [("View an existing account", "Sign in and open Wallet to view any virtual account already linked to your profile. Do not use a public lookup tool or share account details with a search assistant."),
      ("Generation temporarily unavailable", "This message does not establish that a previous generation attempt created no account. Do not repeatedly generate accounts. Use the existing support workflow so staff can check stored attempts and verified provider evidence."),
      ("Avoid duplicates", "A previous FAILED or unknown attempt may require reconciliation before another request is safe. Only an authorized workflow with verified provider evidence may resolve that uncertainty. Public guides cannot confirm provider authorization or create an account.")]),
    ("transactions", "Transaction status and troubleshooting", "Understand successful, pending and failed transactions without risking duplicate purchases.",
     [("SUCCESSFUL", "Review the transaction details in History. If service delivery is missing despite a successful record, report that record through authenticated support; a public assistant cannot independently confirm delivery."),
      ("PENDING or processing", "The outcome is not yet definitive. Refresh History and avoid repeating the same uncertain purchase. A pending record must not be treated as proof of success, failure or refund. A separate new purchase still requires its own confirmation and authorization in the app."),
      ("FAILED", "Read the transaction and wallet records in your own account. A failed label by itself does not prove that a refund is due or has arrived. Support can review the linked records. Never rely on public search to authorize a refund."),
      ("Create a complaint", "After signing in, open Help & Support, create a ticket and select the relevant record where offered. Keep the complaint reference returned by the application. Do not send PINs, passwords or OTPs.")]),
    ("security", "Account security and recovery", "Protect your ServicePay account and use secure password or PIN recovery.",
     [("Protect your credentials", "Never share passwords, transaction PINs, OTPs, full BVN, NIN or card details in search, email or AI chat. ServicePay public help does not request them."),
      ("Password recovery", "Use the app's existing password-recovery flow and the verified contact channel it offers. Customer identity verification remains mandatory. Authorized Head Office recovery requires explicit permissions and fresh administrator authentication, not a second-person approval."),
      ("PIN recovery", "Only the customer should set a new transaction PIN through the secure recovery flow after the required stronger verification. Public help cannot reset a PIN, unlock compliance restrictions or approve recovery."),
      ("Suspicious activity", "Contact support through the official app or support@servicepay.ng. Describe the issue without disclosing secret credentials. Do not follow instructions to transfer money to verify your identity.")]),
    ("complaints", "Complaints, tickets and human support", "Create a secure ServicePay complaint and keep its reference.",
     [("Create and track a ticket", "Sign in, open Help & Support and use the existing complaint form. Choose the appropriate category and explain the issue without secrets. The application returns a ticket reference after successful creation. Track and reply to your own tickets in the app."),
      ("AI and human assistance", "Open All Services, then AI Support for English or Hausa text assistance where enabled. For an unresolved issue use its human escalation option or the dashboard Help & support button. Account-specific investigation requires authentication and selecting your own record."),
      ("Public page feedback", "A helpful or not-helpful vote on a public guide is only a local browsing preference, not a complaint or an acknowledgment from the support team. To notify support, create an authenticated ticket or send an email to support@servicepay.ng."),
      ("Response expectations", "Do not assume a response time, refund or compensation that has not been confirmed through the authorized support process.")]),
]
ROUTE_CATEGORIES = {
    "/": ["registration", "support"], "/about/": ["registration"], "/company/": ["support"],
    "/products/": ["registration"], "/services/": ["registration"], "/how-to-register/": ["registration", "security"],
    "/how-to-use/": ["registration", "transactions"], "/download/": ["registration"], "/faq/": ["support", "transactions"],
    "/help/": ["support"], "/knowledge/": ["support"], "/contact/": ["support"], "/news/": ["support"],
    "/privacy-policy": ["security"], "/delete-account": ["security"], "/terms-and-conditions": ["security"],
    "/account-wallet/": ["wallet"], "/virtual-account/": ["virtual-account", "wallet"],
    "/transactions/": ["transactions"], "/security/": ["security"], "/complaints/": ["support"],
    "/nin-verification/": ["nin", "security"],
}
for slug in ["data", "airtime", "electricity", "edupay", "delivery", "logistics", "marketplace", "solar", "empowerment", "amana"]:
    ROUTE_CATEGORIES[f"/{slug}/"] = [slug]

ANSWERS = [
    ("pending", ["pending", "processing", "transaction pending", "jiran"],
     "PENDING means the outcome is not yet definitive. Check History and do not repeat the same uncertain purchase. Sign in and select your own record in support for investigation. This guide cannot confirm or change a transaction.",
     "PENDING na nufin ba a tabbatar da sakamakon ba tukuna. Duba History, kada ka maimaita wannan sayen da sakamakonsa bai tabbata ba. Shiga asusunka ka zaɓi ma'amalarka a sashen taimako. Wannan jagora ba ya tabbatarwa ko canza ma'amala.",
     [("Transaction guidance", "/transactions/")]),
    ("data", ["data", "data missing", "intanet"],
     "Choose Data, select the network, recipient and available plan, then review the price before authorizing. If delivery is missing, check History and use authenticated support with the selected record. Do not repeat an uncertain purchase.",
     "Zaɓi Data, ka duba network, lambar mai karɓa da shirin da yake samuwa, sannan ka tabbatar da farashi kafin izini. Idan data ba ta shiga ba, duba History ka nemi taimako daga cikin asusunka. Kada ka maimaita sayen da sakamakonsa bai tabbata ba.",
     [("Data guide", "/data/"), ("Transaction guidance", "/transactions/")]),
    ("airtime", ["airtime", "recharge", "katin waya"],
     "Choose Airtime and confirm the network, recipient number and amount before authorizing. Check the stored result in History. If the result or delivery is unclear, contact support rather than repeating the same request.",
     "Zaɓi Airtime ka tabbatar da network, lambar mai karɓa da adadi kafin izini. Duba sakamakon a History. Idan akwai rashin tabbas, tuntuɓi taimako maimakon maimaita buƙatar.",
     [("Airtime guide", "/airtime/")]),
    ("electricity", ["electricity", "wuta", "meter"],
     "Use Electricity to select the available provider and enter the meter details. Review validation and the quoted price in the app. Keep the record in History and contact support if a token or delivery is missing.",
     "Yi amfani da Electricity ka zaɓi kamfanin da yake samuwa ka saka bayanan mita. Duba bayanan tabbatarwa da farashin cikin app. Ajiye bayanin a History ka tuntuɓi taimako idan token ko sabis bai iso ba.",
     [("Electricity guide", "/electricity/")]),
    ("virtual-account", ["virtual account", "virtual", "asusun banki"],
     "Sign in and view Wallet for an existing linked account. If generation is unavailable or an earlier attempt is uncertain, do not repeatedly generate accounts. Support must check the previous attempt using verified provider evidence before a retry.",
     "Shiga asusunka ka duba Wallet don asusun bankin da aka riga aka haɗa. Idan samar da asusu bai samu ba ko tsohuwar buƙata ba ta da tabbataccen sakamako, kada ka maimaita ta. Taimako zai duba shaidar kamfanin sabis kafin sake gwadawa.",
     [("Virtual Account help", "/virtual-account/")]),
    ("wallet", ["wallet", "funding", "kudi", "balance"],
     "Your wallet and funding status are private. Sign in to view them. For a bank debit that has not reflected, compare your own records and create a secure complaint. Do not enter account numbers or balances in public search.",
     "Wallet da matsayin kuɗinka sirri ne. Shiga asusunka don duba su. Idan banki ya cire kuɗi amma ba su bayyana ba, duba bayananka ka aika ƙorafi daga cikin asusunka. Kada ka saka lambar asusu ko adadin kuɗinka a binciken jama'a.",
     [("Account and Wallet help", "/account-wallet/")]),
    ("register", ["register", "registration", "rajista"],
     "Use Create account on servicepay.ng and follow the registration form. Provide your own information and complete the verification the application requires. Eligibility and service availability still apply.",
     "Yi amfani da Create account a servicepay.ng ka bi fom ɗin rajista. Saka bayananka ka kammala tabbatarwar da app ya nema. Sharuɗɗan cancanta da samuwar sabis suna nan.",
     [("Registration guide", "/how-to-register/")]),
    ("password", ["forgot password", "password", "manta kalmar sirri", "security"],
     "Use the existing password-recovery flow and a verified contact channel. Do not share a password, PIN or OTP here. Only the customer should set new credentials in the secure recovery form.",
     "Yi amfani da hanyar dawo da kalmar sirri da hanyar tuntuɓa da aka tabbatar. Kada ka tura kalmar sirri, PIN ko OTP a nan. Abokin ciniki ne kawai zai saita sabbin bayanan sirri a fom mai tsaro.",
     [("Account security", "/security/")]),
    ("complaint", ["support", "complaint", "korafi", "taimako"],
     "Sign in and open the dashboard Help & support button to create a ticket and receive its actual reference. For AI text guidance open All Services → AI Support. For unresolved issues request human support. A local guide vote does not create a complaint.",
     "Shiga asusunka ka buɗe Help & support don aika ƙorafi da samun lambar bibiyarsa. Don taimakon AI na rubutu, buɗe All Services → AI Support. Idan ba a warware matsala ba ka nemi ma'aikacin taimako. Zaɓen amfani na jagora ba ƙorafi ba ne.",
     [("Complaints and human support", "/complaints/"), ("Contact support", "/contact/")]),
]
ANSWERS.extend([
    ("edupay", ["edupay", "school", "makaranta"],
     "EduPay supports school-fee journeys for participating schools. Sign in and check whether the school and payment option are available. Confirm the student and actual payment details shown before authorizing.",
     "EduPay yana taimaka wa biyan kuɗin makarantu masu shiga tsarin. Shiga asusunka ka duba ko makarantar da hanyar biya suna samuwa. Tabbatar da ɗalibi da bayanan biya kafin izini.",
     [("EduPay guide", "/edupay/")]),
    ("delivery", ["delivery", "courier", "kai kaya"],
     "Use Delivery to enter the real parcel and route details. Review the quoted fee in the app; prices and interstate routes depend on current configuration and availability. Check the order record for updates.",
     "Yi amfani da Delivery ka saka ainihin bayanan kaya da hanya. Duba farashin da app ya nuna; farashi da hanyoyin jihohi sun dogara da saituna da samuwar sabis. Duba bayanin odarka don sabuntawa.",
     [("Delivery guide", "/delivery/"), ("Logistics guide", "/logistics/")]),
    ("logistics", ["logistics", "dispatch", "interstate"],
     "Logistics availability depends on the supported route and dispatch arrangements. Use the actual quote and tracking information shown in your delivery flow. Do not assume that every interstate route is active.",
     "Samuwar logistics ta dogara da hanyar da ake tallafawa da tsarin kai kaya. Yi amfani da farashi da bayanin bibiyar da app ya nuna. Kada ka ɗauka duk hanyoyin jihohi suna aiki.",
     [("Logistics guide", "/logistics/")]),
    ("nin", ["nin", "verification"],
     "Use the secure in-app NIN Verification flow where available. Do not enter a NIN or BVN in public search or AI chat. Review the shown fee and requirements; a public guide cannot verify an identity.",
     "Yi amfani da hanyar NIN Verification mai tsaro a cikin app idan tana samuwa. Kada ka saka NIN ko BVN a binciken jama'a ko tattaunawar AI. Duba kuɗi da sharuɗɗan da aka nuna; jagora ba zai tabbatar da shaida ba.",
     [("NIN Verification guide", "/nin-verification/")]),
    ("marketplace", ["marketplace", "shopping", "kasuwa"],
     "Browse the Marketplace for available seller listings. Review the item, seller, delivery arrangements and actual checkout details. Listing availability is not a guarantee that an item or seller is available everywhere.",
     "Duba Marketplace don kayan masu sayarwa da suke samuwa. Tabbatar da kaya, mai sayarwa, hanyar isarwa da bayanan biya. Bayyanar kaya ba tabbacin samuwarsu a ko'ina ba ne.",
     [("Marketplace guide", "/marketplace/")]),
    ("solar", ["solar", "hasken rana"],
     "ServicePay Solar provides an application journey for available solar products and possible financing. Approval and funding are not guaranteed. Review the actual offer and conditions in the app.",
     "ServicePay Solar yana da hanyar neman kayan hasken rana da yiwuwar tallafin biya. Ba a tabbatar da amincewa ko samun kuɗi ba. Duba tayin gaske da sharuɗɗansa a cikin app.",
     [("Solar guide", "/solar/")]),
    ("empowerment", ["empowerment", "grant"],
     "Browse available Empowerment programmes, check eligibility and follow the application process. An application or approval does not guarantee a grant or funding. Follow the programme's actual terms.",
     "Duba shirye-shiryen Empowerment, cancanta da hanyar nema. Aika buƙata ko amincewa ba tabbacin samun tallafi ko kuɗi ba ne. Bi ainihin sharuɗɗan shirin.",
     [("Empowerment guide", "/empowerment/")]),
    ("amana", ["amana"],
     "ServicePay Amana is a family-support application journey. Check the requirements, availability and any approval conditions in the app. Do not assume that submitting a request guarantees assistance.",
     "ServicePay Amana hanya ce ta neman taimakon iyali. Duba buƙatu, samuwar shirin da sharuɗɗan amincewa a cikin app. Aika buƙata ba tabbacin samun taimako ba ne.",
     [("Amana guide", "/amana/")]),
    ("delete", ["delete account", "deletion"],
     "Use the published account-deletion instructions or the in-app account-deletion flow. The approved processing period is 30 calendar days. Read the actual policy for request verification and information handling.",
     "Bi umarnin goge asusu da aka wallafa ko hanyar da ke cikin app. Lokacin sarrafa buƙata da aka amince da shi kwanakin kalanda 30 ne. Karanta manufar don tabbatar da buƙata da kula da bayanai.",
     [("Account deletion", "/delete-account")]),
])


class TextReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.parts = []
        self.title = ""
        self.description = ""
        self.headings = []
        self.tag = ""
    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag in ("script", "style", "nav", "footer", "header", "noscript"):
            self.skip += 1
        if tag == "meta" and attr.get("name") == "description":
            self.description = attr.get("content", "")
        self.tag = tag
    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "footer", "header", "noscript"):
            self.skip = max(0, self.skip - 1)
        self.tag = ""
    def handle_data(self, data):
        if self.skip or not data.strip():
            return
        t = re.sub(r"\s+", " ", data).strip()
        if self.tag == "title":
            self.title += t
        else:
            self.parts.append(t)
        if self.tag in ("h1", "h2", "h3"):
            self.headings.append(t)


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    here = Path(__file__).resolve().parent
    original = here / "servicepay-public-pages.py"
    if not original.exists():
        original = here / "generate_public_pages.py"
    public = load_module(original, "servicepay_public")
    ui = load_module(here / "servicepay-help-ui.py", "servicepay_help_ui")
    for slug, title, desc, sections in GUIDES:
        pg = dict(slug=slug, title=f"{title} | ServicePay", desc=desc, h1=title,
                  intro=desc, crumb=[("Knowledge", "/knowledge/"), (title, f"/{slug}/")],
                  body="".join(public.sec(h, public.p(public.e(b))) for h, b in sections))
        out = ROOT / slug / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(public.render(pg), encoding="utf-8")
    ui.enhance(ROOT)
    ET.register_namespace("", NS)
    tree = ET.parse(ROOT / "sitemap.xml")
    urls = {node.text for node in tree.findall(f".//{{{NS}}}loc")}
    for slug, *_ in GUIDES:
        url = f"{BASE}/{slug}/"
        if url not in urls:
            ET.SubElement(ET.SubElement(tree.getroot(), f"{{{NS}}}url"), f"{{{NS}}}loc").text = url
    ET.indent(tree, space="  ")
    tree.write(ROOT / "sitemap.xml", encoding="utf-8", xml_declaration=True)
    documents = []
    for node in tree.findall(f".//{{{NS}}}loc"):
        route = node.text.removeprefix(BASE)
        if route == "/":
            path = ROOT / "index.html"
        elif route.endswith("/"):
            path = ROOT / route.lstrip("/") / "index.html"
        else:
            path = ROOT / (route.lstrip("/") + ".html")
        reader = TextReader()
        reader.feed(path.read_text(encoding="utf-8"))
        documents.append(dict(id=route.strip("/") or "home", url=route, title=reader.title,
                              description=reader.description, text=" ".join(reader.parts),
                              categories=ROUTE_CATEGORIES.get(route, ["support"]), headings=reader.headings))
        if route not in ("/", "/knowledge/"):
            text = path.read_text(encoding="utf-8")
            marker = "<!-- ServicePay public guide tools -->"
            if marker not in text:
                enhancement = (marker + '\n<link rel="stylesheet" href="/assets/knowledge-ui.css">'
                               '\n<script defer src="/assets/knowledge-guide.js"></script>\n')
                path.write_text(text.replace("</body>", enhancement + "</body>"), encoding="utf-8")
    data = dict(version=1, documents=documents,
                categories=[dict(id=i, name=n, ha=h, description=d) for i, n, h, d in CATEGORIES],
                answers=[dict(id=i, terms=t, en=en, ha=ha, links=[dict(title=l, url=u) for l, u in links])
                         for i, t, en, ha, links in ANSWERS])
    (ROOT / "assets/knowledge-index.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    robots = ROOT / "robots.txt"
    text = robots.read_text(encoding="utf-8")
    # Crawlers must be able to read the results page's noindex directive.
    # Blocking that URL in robots.txt would prevent them from seeing noindex.
    text = text.replace("Disallow: /knowledge/search/\n", "")
    robots.write_text(text, encoding="utf-8")
    llms = ROOT / "llms.txt"
    text = llms.read_text(encoding="utf-8")
    if "## Customer search and help" not in text:
        text += ("\n## Customer search and help\n"
                 "- [Search and Help Centre](https://servicepay.ng/knowledge/): browse public guides; "
                 "search results are not indexable and do not expose private accounts.\n"
                 "- [Virtual Account help](https://servicepay.ng/virtual-account/)\n"
                 "- [Account and Wallet help](https://servicepay.ng/account-wallet/)\n"
                 "- [Transaction guidance](https://servicepay.ng/transactions/)\n"
                 "- [Account security](https://servicepay.ng/security/)\n"
                 "- [Complaints and human support](https://servicepay.ng/complaints/)\n"
                 "Public guide answers quote curated guidance, not live account evidence. "
                 "AI Smart Support and complaint records require customer sign-in.\n")
        llms.write_text(text, encoding="utf-8")
    print(f"Indexed {len(documents)} public pages, {len(CATEGORIES)} categories and {len(ANSWERS)} bilingual answers.")


if __name__ == "__main__":
    main()
