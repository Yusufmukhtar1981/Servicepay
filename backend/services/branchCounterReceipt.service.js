const fs = require("node:fs");
const path = require("node:path");
const escape = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = value => `₦${Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let logo;
function receiptHtml(o, layout = "A4", configuredContacts = []) {
  logo ||= fs.readFileSync(path.join(__dirname, "../assets/branch-counter-logo.png")).toString("base64");
  const line = (label, value) => `<div class="line"><b>${escape(label)}</b><span>${escape(value)}</span></div>`;
  const thermal = layout === "THERMAL";
  const contacts = configuredContacts;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ServicePay Receipt ${escape(o.receiptNumber)}</title><style>
@page{size:${thermal ? "auto" : "A4"};margin:${thermal ? "3mm" : "15mm"}}
*{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#172e24;margin:0;background:white}
main{max-width:${thermal ? "74mm" : "760px"};margin:auto;padding:${thermal ? "3mm" : "24px"}}
header{text-align:center;border-bottom:3px solid #08783e;padding-bottom:18px}img{width:64px;height:64px;object-fit:contain}
h1{font-size:${thermal ? "15px" : "22px"};margin:10px 0;color:#08783e}h2{font-size:14px;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:20px}
.line{display:flex;gap:12px;justify-content:space-between;margin:7px 0;overflow-wrap:anywhere}.line span{text-align:right}
.tracking{font-size:${thermal ? "13px" : "20px"};font-weight:bold;overflow-wrap:anywhere}.notice{border:1px solid #ddd;padding:10px;font-weight:bold}
footer{text-align:center;margin-top:24px;font-size:12px}.controls{padding:12px;text-align:center}
@media print{.controls{display:none}main{padding:0}body{background:white}h2,.line{break-inside:avoid}}
</style></head><body><div class="controls"><button onclick="window.print()">Print receipt</button></div><main>
<header><img alt="ServicePay logo" src="data:image/png;base64,${logo}"><h1>SERVICEPAY DELIVERY &amp; LOGISTICS</h1><div>Yumpay Global Tech Ltd.</div></header>
${line("Receipt Number", o.receiptNumber)}<div class="tracking">Tracking: ${escape(o.trackingNumber)}</div>
${line("Date & Time", new Date(o.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false }) + " WAT")}
${line("Branch", o.branch.name)}${o.branch.address ? line("Office Address", o.branch.address) : ""}
<h2>SENDER</h2>${line("Name", o.sender.name)}${line("Phone", o.sender.phone)}${line("Origin / Pickup Address", o.sender.address)}
<h2>RECEIVER</h2>${line("Name", o.receiver.name)}${line("Phone", o.receiver.phone)}${line("Destination Address", o.receiver.address)}
<h2>PARCEL DETAILS</h2>${line("Item Description", o.parcel.description)}${line("Quantity", o.parcel.quantity)}
${line("Package Type", o.parcel.category)}${o.parcel.weightKg ? line("Weight", `${o.parcel.weightKg} kg`) : ""}
${o.parcel.specialHandlingNote ? line("Special Instructions", o.parcel.specialHandlingNote) : ""}
${line("Route", `${o.sender.lga}, ${o.sender.state} → ${o.receiver.lga}, ${o.receiver.state}`)}
<h2>PAYMENT DETAILS</h2>${line("Delivery Fee", money(o.deliveryFee))}${o.charges ? line("Applicable Charges", money(o.charges)) : ""}${line("Total Amount", money(o.total))}
${line("Amount Paid", money(o.amountPaid))}${line("Payment Method", o.payment.method.replace(/_/g, " "))}
<div class="notice">Payment Status: ${escape(o.paymentStatus)}</div>
${o.paymentStatus === "UNPAID" ? "<p>Payment is not confirmed. This receipt is not proof of payment.</p>" : ""}
${line("Processed By", o.createdByName)}
<footer>Thank you for choosing Servicepay Delivery &amp; Logistics.${contacts.length ? `<p>${contacts.map(escape).join(" · ")}</p>` : ""}</footer>
</main></body></html>`;
}
module.exports = { receiptHtml, escape };