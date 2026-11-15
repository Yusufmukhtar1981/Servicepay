const path = require("path");
const PDFDocument = require("pdfkit");
const Ledger = require("../models/ledgerEntry.model");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const { fail, dates } = require("./customerExperiencePolicy");

const moneyMinor = value => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw fail("Historical balance evidence is incomplete.", 409);
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || Math.abs(result / 100 - value) > 0.000001) {
    throw fail("Historical money values cannot be represented safely.", 409);
  }
  return result;
};
function reconcileRows({ entries, previous, transactions, customer, currentPeriod }) {
  let opening;
  if (previous) opening = moneyMinor(previous.closingBalance);
  else if (entries.length) {
    opening = moneyMinor(entries[0].openingBalance);
    if (opening !== 0) throw fail("A complete opening-balance anchor is unavailable for this period.", 409);
  } else if (!transactions.length && moneyMinor(customer.walletBalance) === 0) opening = 0;
  else throw fail("No authoritative opening-balance evidence is available for this period.", 409);
  let balance = opening, credits = 0, debits = 0;
  const byReference = new Map(transactions.map(t => [t.reference, t]));
  const represented = new Set();
  const rows = entries.map(entry => {
    const before = moneyMinor(entry.openingBalance), after = moneyMinor(entry.closingBalance);
    const amount = moneyMinor(entry.amount);
    if (before !== balance || amount <= 0 || !["CREDIT", "DEBIT"].includes(entry.direction)) {
      throw fail("This period contains an unresolved ledger continuity gap; no statement balance was fabricated.", 409);
    }
    const signed = entry.direction === "CREDIT" ? amount : -amount;
    if (before + signed !== after || after < 0) throw fail("Ledger balance evidence does not reconcile.", 409);
    balance = after;
    if (signed > 0) credits += amount; else debits += amount;
    const t = byReference.get(entry.reference);
    represented.add(entry.reference);
    return {
      date: entry.createdAt, reference: entry.reference, description: entry.narration || t?.serviceType || entry.service,
      type: entry.direction, debitMinor: signed < 0 ? amount : 0, creditMinor: signed > 0 ? amount : 0,
      status: t?.status || entry.status, balanceMinor: balance,
    };
  });
  for (const t of transactions) {
    if (represented.has(t.reference)) continue;
    if (["SUCCESS", "SUCCESSFUL", "COMPLETED", "REVERSED", "REFUNDED"].includes(t.status)) {
      throw fail("Some historical transactions lack matching immutable wallet entries. A balanced PDF cannot yet be certified.", 409);
    }
    rows.push({ date: t.createdAt, reference: t.reference, description: t.serviceType,
      type: "INFORMATION", debitMinor: 0, creditMinor: 0, status: t.status, balanceMinor: null });
  }
  if (currentPeriod && moneyMinor(customer.walletBalance) !== balance) {
    throw fail("The latest ledger balance does not reconcile with the wallet. No balances were changed.", 409);
  }
  for (const amount of [balance, credits, debits]) {
    if (!Number.isSafeInteger(amount)) throw fail("Statement totals exceed the supported range.", 409);
  }
  rows.sort((a, b) => new Date(a.date) - new Date(b.date) || a.reference.localeCompare(b.reference));
  return { openingMinor: opening, closingMinor: balance, creditsMinor: credits, debitsMinor: debits, rows };
}
async function statement(customerId, start, end) {
  const { from, to } = dates(start, end);
  // Snapshot all evidence together: a purchase occurring mid-read cannot
  // accidentally produce a certified statement from inconsistent balances.
  const session = await User.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const customer = await User.findOne({ _id: customerId, role: "CUSTOMER" })
        .select("fullName phone customerId walletBalance virtualAccount createdAt").session(session).lean();
      if (!customer) throw fail("Customer not found.", 404);
      const entries = await Ledger.find({ user: customerId, createdAt: { $gte: from, $lt: to } })
        .sort({ createdAt: 1, _id: 1 }).limit(5001).session(session).lean();
      const previous = await Ledger.findOne({ user: customerId, createdAt: { $lt: from } })
        .sort({ createdAt: -1, _id: -1 }).session(session).lean();
      const transactions = await Transaction.find({ customerId, createdAt: { $gte: from, $lt: to } })
        .select("reference serviceType amount status createdAt").sort({ createdAt: 1, _id: 1 }).limit(5001).session(session).lean();
      if (entries.length > 5000 || transactions.length > 5000) throw fail("Choose a shorter statement period (maximum 5,000 entries).", 422);
      result = { customer, start, end, ...reconcileRows({
        entries, previous, transactions, customer, currentPeriod: to > new Date(),
      }) };
    }, { readConcern: { level: "snapshot" }, maxCommitTimeMS: 10000 });
  } finally { await session.endSession(); }
  return result;
}
function pdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true,
      info: { Title: "ServicePay Account Statement", Author: "ServicePay" } });
    const chunks = [];
    doc.on("data", c => chunks.push(c)); doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const cash = minor => `NGN ${(minor / 100).toFixed(2)}`;
    const title = () => {
      doc.fillColor("#087A45").fontSize(19).text("ServicePay", 42, 42);
      doc.image(path.join(__dirname, "../public/servicepay-logo.png"), 492, 32, { fit: [58, 48] });
      doc.fontSize(13).text("ACCOUNT STATEMENT", 42, 72);
      doc.fillColor("#23372C").fontSize(10);
    };
    title();
    doc.text(`Customer: ${data.customer.fullName}`, 42, 102);
    doc.text(`Customer ID: ${data.customer.customerId || data.customer._id}`);
    const va = data.customer.virtualAccount;
    if (va?.accountNumber) doc.text(`Account: ${va.bankName || ""} ${va.accountNumber}`);
    doc.text(`Period: ${data.start} to ${data.end} (Africa/Lagos)`);
    doc.moveDown();
    doc.text(`Opening balance: ${cash(data.openingMinor)}`);
    doc.text(`Total credits: ${cash(data.creditsMinor)}   |   Total debits: ${cash(data.debitsMinor)}`);
    doc.text(`Closing balance: ${cash(data.closingMinor)}`);
    doc.moveDown().fontSize(8).text("Pending and failed records retain their actual status. Only posted ledger movements affect totals.");
    doc.moveDown();
    for (const row of data.rows) {
      if (doc.y > 704) { doc.addPage(); title(); doc.y = 105; }
      const timestamp = new Date(row.date).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false });
      doc.fillColor("#087A45").fontSize(9).text(`${timestamp} | ${row.type} | ${row.status}`);
      doc.fillColor("#23372C").fontSize(8).text(`Reference: ${row.reference}`);
      doc.text(String(row.description || "").replace(/[\r\n]/g, " ").slice(0, 240));
      doc.text(`Debit: ${cash(row.debitMinor)}   Credit: ${cash(row.creditMinor)}`);
      doc.moveDown(0.65);
    }
    if (!data.rows.length) doc.text("No transactions in this period.");
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fillColor("#66736B").fontSize(8).text(`ServicePay | Page ${i + 1} of ${pages.count}`, 42, 780, { lineBreak: false });
    }
    doc.end();
  });
}
module.exports = { moneyMinor, reconcileRows, statement, pdf };
