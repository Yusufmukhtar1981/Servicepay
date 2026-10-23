"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { finished } = require("node:stream/promises");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const HEADERS = ["Full Name", "Phone Number", "Email Address"];
const MIME = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};
const values = (row) => [row.fullName, row.phone, row.email].map((v) => String(v ?? ""));
// Quoting alone does not prevent spreadsheet formula injection.
const csvCell = (value) => {
  const text = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};
const csvLine = (row) => row.map(csvCell).join(",") + "\r\n";

async function writeExport(filename, format, rows, signal) {
  if (!MIME[format]) throw new Error("Unsupported export format.");
  let count = 0;
  const output = fs.createWriteStream(filename, { flags: "wx", mode: 0o600 });
  // Attach rejection handlers immediately; stream errors must not be unhandled
  // while the database cursor is awaiting its next batch.
  const complete = finished(output);
  complete.catch(() => {});
  const check = () => {
    if (signal?.aborted) throw new Error("Customer export cancelled.");
    if (output.errored) throw output.errored;
  };
  try {
    if (format === "csv") {
      output.write("\uFEFF" + csvLine(HEADERS));
      for await (const row of rows) {
        check();
        if (!output.write(csvLine(values(row)))) await once(output, "drain");
        count++;
      }
      output.end();
    } else if (format === "xlsx") {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: output, useStyles: false, useSharedStrings: false,
      });
      const sheet = workbook.addWorksheet("Customers");
      sheet.columns = [{ width: 38 }, { width: 24 }, { width: 46 }];
      sheet.addRow(HEADERS).commit();
      for await (const row of rows) {
        check();
        // Plain string cells, never formula objects; preserves leading zeros.
        sheet.addRow(values(row)).commit();
        count++;
        if (count >= 1048576) throw new Error("Excel row limit exceeded; use CSV.");
      }
      sheet.commit();
      await workbook.commit();
    } else {
      const pdf = new PDFDocument({ size: "A4", margin: 36, info: { Title: "Servicepay Customers" } });
      pdf.on("error", (error) => output.destroy(error));
      pdf.pipe(output);
      // Bundled licensed Unicode font, independent of the host's fonts.
      pdf.font(path.join(__dirname, "../assets/DejaVuSans.ttf"));
      const widths = [177, 134, 212];
      const xs = [36, 213, 347];
      const header = () => {
        pdf.fontSize(15).text("Servicepay — Customer Contacts", 36, 36);
        pdf.fontSize(9).text("Confidential — authorized administrative use only", 36, 60);
        HEADERS.forEach((cell, i) => pdf.text(cell, xs[i], 85, { width: widths[i] - 8 }));
        pdf.moveTo(36, 103).lineTo(559, 103).stroke();
        pdf.y = 112;
      };
      header();
      for await (const row of rows) {
        check();
        const cells = values(row);
        pdf.fontSize(9);
        const height = Math.max(18, ...cells.map((cell, i) =>
          pdf.heightOfString(cell || " ", { width: widths[i] - 8 }) + 8));
        if (height > 650) {
          // Unusually long legacy fields use flowing paragraphs rather than
          // truncation or an oversized table cell. Preserve the complete value.
          pdf.addPage(); header();
          for (let i = 0; i < cells.length; i++) {
            pdf.text(`${HEADERS[i]}: ${cells[i]}`, 36, pdf.y, { width: 523 });
            pdf.moveDown();
          }
          pdf.addPage(); header();
          count++;
          continue;
        }
        if (pdf.y + height > 795) { pdf.addPage(); header(); }
        const y = pdf.y;
        cells.forEach((cell, i) => pdf.text(cell, xs[i], y, { width: widths[i] - 8 }));
        pdf.y = y + height;
        count++;
      }
      pdf.end();
    }
    await complete;
    return count;
  } catch (error) {
    output.destroy(error);
    await complete.catch(() => {});
    throw error;
  }
}

module.exports = { MIME, HEADERS, csvCell, writeExport };
