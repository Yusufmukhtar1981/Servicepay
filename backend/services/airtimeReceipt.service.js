"use strict";
// Read-only presentation. This module never calls a provider or moves funds.
const crypto = require("node:crypto");
const path = require("node:path");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const User = require("../models/user.model");
const fail = (message, status) => Object.assign(new Error(message), { status });

async function load(userId, identity) {
  if (!userId) throw fail("Authentication required.", 401);
  if (typeof identity !== "string" || !identity || identity.length > 160) throw fail("Invalid Airtime identity.", 400);
  const key = crypto.createHash("sha256").update(identity).digest("hex");
  const owner = { customerId: userId, serviceType: "AIRTIME" };
  // A literal transaction reference wins; never let a separately submitted
  // request key equal to an older reference resolve to the wrong purchase.
  const transaction = await Transaction.findOne({ ...owner, reference: identity }).lean() ||
    await Transaction.findOne({ ...owner, idempotencyKey: key }).lean();
  if (!transaction) throw fail("Airtime transaction not found. An unavailable record does not prove that no charge occurred.", 404);
  const customer = await User.findById(userId).select("_id fullName").lean();
  if (!customer) throw fail("Customer not found.", 404);
  const [debit, credit] = await Promise.all([
    transaction.debitLedgerEntryId ? LedgerEntry.findById(transaction.debitLedgerEntryId).lean() : null,
    transaction.reversalLedgerEntryId ? LedgerEntry.findById(transaction.reversalLedgerEntryId).lean() : null,
  ]);
  const bound = (row, service) => row && String(row.user) === String(userId) &&
    String(row.transactionId) === String(transaction._id) && row.service === service &&
    row.reference === transaction.reference &&
    Number(row.amount) === Number(transaction.amount);
  const charged = bound(debit, "AIRTIME") && debit.direction === "DEBIT" &&
    ["POSTED", "REVERSED"].includes(debit.status) ? true : null;
  const refundRecorded = charged === true && bound(credit, "AIRTIME_REVERSAL") &&
    credit.direction === "CREDIT" && credit.status === "POSTED" &&
    String(credit.reversalOf) === String(debit._id);
  const status = String(transaction.status || "PENDING").toUpperCase();
  const lifecycle = transaction.providerResponse?.airtimeLifecycle || {};
  const networkCode = lifecycle.network || transaction.network || null;
  const network = ({ "01": "MTN", "02": "GLO", "03": "9mobile", "04": "Airtel" })[networkCode] || networkCode;
  const failed = ["FAILED", "REFUNDED", "REVERSED"].includes(status);
  const message = status === "SUCCESSFUL" ? "Airtime purchase was successful." : failed
    ? refundRecorded ? "Airtime purchase failed. The wallet refund is recorded."
      : charged ? "Airtime purchase failed. A wallet debit is recorded; a matching refund is not yet confirmed. Contact Support."
        : "Airtime purchase failed. The wallet charge or refund could not be independently confirmed; check History or contact Support."
    : "This transaction is still being verified. Do not repeat this purchase.";
  return { raw: transaction, view: {
    id: "transaction:" + transaction._id, reference: transaction.reference,
    status, serviceType: "AIRTIME", amount: transaction.amount,
    network,
    phone: transaction.phone || null, createdAt: transaction.createdAt,
    paymentMethod: "Wallet", description: "Airtime purchase",
    customerName: customer.fullName, customerId: String(customer._id),
    refundStatus: refundRecorded ? "REFUNDED" : "UNCONFIRMED",
    charged, refundRecorded: Boolean(refundRecorded),
    failureReason: failed ? "Recorded Airtime delivery failure." : null, message,
  } };
}

function assertReceiptable(raw) {
  if (raw.status !== "SUCCESSFUL" || raw.reversalLedgerEntryId ||
      raw.reversalTransactionId || raw.reversalReference) {
    throw fail("A successful receipt is available only for an unreversed successful Airtime purchase.", 409);
  }
}
function pdf(view) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: 48,
    info: { Title: "ServicePay Airtime Purchase Receipt", Author: "ServicePay" } });
  const logo = path.join(__dirname, "../public/servicepay-logo.png");
  doc.image(logo, 48, 40, { fit: [64, 64] });
  doc.fillColor("#08783E").font("Helvetica-Bold").fontSize(21)
    .text("SERVICEPAY", 128, 52);
  doc.fontSize(13).text("AIRTIME PURCHASE RECEIPT", 128, 80);
  doc.moveTo(48, 120).lineTo(547, 120).strokeColor("#08783E").stroke();
  const date = new Date(view.createdAt);
  const datePart = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "long" }).format(date);
  const timePart = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", timeStyle: "medium" }).format(date);
  const rows = [
    ["Transaction Status", "SUCCESSFUL"], ["Transaction Reference", view.reference],
    ["Customer Name", view.customerName], ["Customer ID", view.customerId],
    ["Network Provider", view.network || "Not recorded"], ["Recipient Phone Number", view.phone || "Not recorded"],
    ["Amount", "NGN " + Number(view.amount).toFixed(2)], ["Transaction Date", datePart],
    ["Transaction Time", timePart + " (Africa/Lagos)"], ["Payment Method", view.paymentMethod],
    ["Transaction Description", view.description],
  ];
  let y = 148;
  for (const [label, value] of rows) {
    doc.fillColor("#456052").font("Helvetica").fontSize(10).text(label, 48, y, { width: 160 });
    doc.fillColor(label === "Transaction Status" ? "#08783E" : "#152B20")
      .font("Helvetica-Bold").fontSize(11).text(String(value ?? "Not recorded"), 218, y, { width: 325 });
    y += Math.max(38, doc.heightOfString(String(value ?? ""), { width: 325 }) + 16);
  }
  doc.fillColor("#456052").font("Helvetica").fontSize(9)
    .text("Generated from the current ServicePay transaction record. Keep your transaction reference for support.", 48, y + 18, { width: 499 });
  return doc;
}
module.exports = { load, assertReceiptable, pdf };
