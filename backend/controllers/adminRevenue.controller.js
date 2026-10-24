const revenue = require("../services/revenueAccount.service");
const HEADERS = ["Transaction ID","Customer Name","Service","Customer Payment","Provider Cost","Gross Profit","Fees","Commissions","Other Direct Costs","Net Profit","Date","Status","Accounting Status"];
const values = r => [r.reference || r.transactionId,r.customerName,r.serviceType,r.customerPayment,r.providerCost,r.grossProfit,r.fees,r.commissions,r.otherDirectCosts,r.netProfit,r.date,r.status,r.accountingStatus];
const endpoint = fn => async (req,res) => {
  try { return res.json({ success: true, data: await fn(req) }); }
  catch (e) { return res.status(e.statusCode || 503).json({ success: false, message: e.statusCode ? e.message : "Revenue reporting is temporarily unavailable." }); }
};
exports.summary = endpoint(req => revenue.summary(req.query));
exports.transactions = endpoint(async req => revenue.page((await revenue.rows(req.query)).map(revenue.publicRow), req.query));
exports.ledger = endpoint(req => revenue.ledger(req.query));
exports.reconcile = endpoint(req => revenue.reconcile(req.user));
const csv = v => {
  let s = v === null ? "UNCONFIRMED" : String(v ?? "");
  if (typeof v === "string" && /^[\s\u0000-\u001f]*[=+\-@]/u.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"','""') + '"';
};
exports.export = async (req,res) => {
  try {
    const format = req.query.format;
    if (!["csv","xlsx","pdf"].includes(format)) return res.status(400).json({ success:false,message:"Choose CSV, Excel or PDF." });
    const rows = await revenue.rows(req.query);
    res.set("Cache-Control","no-store");
    res.attachment("Servicepay-Revenue-" + new Date().toISOString().slice(0,10) + "." + format);
    if (format === "csv") {
      res.type("text/csv; charset=utf-8");
      return res.send("\ufeff" + [HEADERS,...rows.map(values)].map(r=>r.map(csv).join(",")).join("\r\n"));
    }
    if (format === "xlsx") {
      const Excel = require("exceljs"); const book = new Excel.Workbook(); const sheet = book.addWorksheet("Revenue Account");
      sheet.addRow(HEADERS); rows.forEach(r=>sheet.addRow(values(r).map(v=>v===null?"UNCONFIRMED":v))); sheet.views=[{state:"frozen",ySplit:1}];
      sheet.getRow(1).font={bold:true}; sheet.columns.forEach(c=>{c.width=23;});
      for(let column=4;column<=10;column++) sheet.getColumn(column).numFmt="#,##0.00";
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.send(Buffer.from(await book.xlsx.writeBuffer()));
    }
    const PDF = require("pdfkit"); const doc = new PDF({size:"A3",layout:"landscape",margin:24});
    res.type("application/pdf"); doc.pipe(res);
    doc.fontSize(17).text("Servicepay Revenue Account");
    doc.fontSize(9).text("Amounts in NGN. Read-only accounting. UNCONFIRMED means no verified historical cost/profit; customer service fees are revenue, not provider expenses.");
    doc.moveDown();
    const weights=[112,120,67,82,82,82,65,80,80,82,135,85,120];
    const widthSum=weights.reduce((a,b)=>a+b,0);
    const widths=weights.map(w=>w*(doc.page.width-48)/widthSum);
    function line(cells,header=false) {
      doc.font(header?"Helvetica-Bold":"Helvetica").fontSize(7);
      const texts=cells.map(v=>v===null?"UNCONFIRMED":String(v));
      const height=Math.max(24,...texts.map((v,i)=>doc.heightOfString(v,{width:widths[i]-4})+6));
      if(!header&&doc.y+height>doc.page.height-24){doc.addPage();line(HEADERS,true);}
      const y=doc.y;let x=24;
      texts.forEach((v,i)=>{doc.font(header?"Helvetica-Bold":"Helvetica").fontSize(7).text(v,x,y,{width:widths[i]-4,height:height-4});x+=widths[i];});
      doc.y=y+height;
    }
    line(HEADERS,true);
    for(const row of rows)line(values(row));
    doc.end();
  } catch(e) {
    if (!res.headersSent) res.status(e.statusCode||503).json({success:false,message:e.statusCode?e.message:"Revenue export unavailable."});
    else res.destroy();
  }
};
