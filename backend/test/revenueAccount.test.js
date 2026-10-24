const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const rules = require("../services/revenueAccountingRules");
const service = require("../services/revenueAccount.service");
const Transaction = require("../models/transaction.model");
const Commission = require("../models/commission.model");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const controller = require("../controllers/adminRevenue.controller");
const { headOfficeOnly } = require("../routes/adminRevenue.routes");
const oid = n => new mongoose.Types.ObjectId(n.toString(16).padStart(24,"0"));
const source = (extra={}) => ({
  _id:oid(1),customerId:oid(20),reference:"REV-TEST",serviceType:"DATA",provider:"TELECOM_ABODE",
  amount:150,status:"SUCCESSFUL",createdAt:new Date("2026-10-23T23:30:00Z"),
  agentCommission:2,stateManagerCommission:1,zonalManagerCommission:1,
  providerResponse:{providerPrice:100,telecomAbodeSettlement:{outcome:"SUCCESS",requestIdMatches:true}},...extra,
});
test("transaction-time provider cost, commission and expenses determine profit",()=>{
  const r=rules.projectTransaction(source());
  assert.equal(r.grossProfit,50);assert.equal(r.commissions,4);assert.equal(r.netProfit,46);
  assert.equal(r.costSource,"TRANSACTION_PROVIDER_PRICE_SNAPSHOT");
});
test("unknown Airtime invoice cost never becomes zero-cost profit",()=>{
  const r=rules.projectTransaction(source({serviceType:"AIRTIME",providerResponse:{
    financialAccounting:{providerCost:null,serviceFee:10},airtimeLifecycle:{reasonCode:"CORRELATED_PROVIDER_SUCCESS"}}}));
  assert.equal(r.providerCost,null);assert.equal(r.netProfit,null);
  assert.equal(rules.totals([r]).netProfit,null);assert.equal(rules.totals([r]).uncostedTransactions,1);
});
test("customer service fee is not subtracted again as provider expense",()=>{
  const r=rules.projectTransaction(source({amount:110,serviceType:"AIRTIME",providerResponse:{
    financialAccounting:{providerCost:95,status:"CONFIRMED",serviceFee:10,providerFee:2,processingFee:1,otherDirectCosts:1},
    airtimeLifecycle:{reasonCode:"CORRELATED_PROVIDER_SUCCESS"}}}));
  assert.equal(r.grossProfit,15);assert.equal(r.fees,3);assert.equal(r.netProfit,7);
});
test("successful label without correlated evidence is excluded from earned revenue",()=>{
  const r=rules.projectTransaction(source({providerResponse:{providerPrice:100}}));
  assert.equal(r.confirmed,false);assert.equal(rules.totals([r]).grossRevenue,0);
  assert.equal(rules.totals([r]).unverifiedTransactions,1);
});
for(const status of ["PENDING","FAILED","REFUNDED","REVERSED","REVERSAL_PENDING","UNDER_REVIEW"]) {
  test(status+" cannot inflate earned revenue",()=>{
    const row=rules.projectTransaction(source({status}));
    assert.equal(rules.totals([row]).grossRevenue,0);assert.equal(rules.transition(null,row),null);
  });
}
test("negative margin is retained rather than clamped to fake zero profit",()=>{
  assert.equal(rules.projectTransaction(source({amount:90})).netProfit,-14);
});
test("completed commission totals override legacy transaction defaults",()=>{
  assert.equal(rules.projectTransaction(source(),1000).netProfit,40);
});
test("duplicate reconciliation produces no additional entry",()=>{
  const row=rules.projectTransaction(source());const first=rules.transition(null,row);
  assert.equal(rules.transition(first,row),null);
});
test("a later refund creates exact linked compensating amounts",()=>{
  const sale=rules.projectTransaction(source());const first=rules.transition(null,sale);
  const reversal=rules.transition(first,rules.projectTransaction(source({status:"REFUNDED"})));
  assert.equal(reversal.eventType,"REVENUE_REVERSED");
  assert.equal(reversal.delta.customerPayment,-15000);assert.equal(reversal.delta.netProfit,-4600);
});
test("late invoice evidence creates a delta adjustment, not duplicate sales",()=>{
  const noCost=source({serviceType:"AIRTIME",providerResponse:{financialAccounting:{providerCost:null},airtimeLifecycle:{reasonCode:"CORRELATED_PROVIDER_SUCCESS"}}});
  const first=rules.transition(null,rules.projectTransaction(noCost));
  const charged=structuredClone(noCost);charged.providerResponse.financialAccounting={providerCost:100,status:"CONFIRMED"};
  const next=rules.transition(first,rules.projectTransaction(charged));
  assert.equal(next.eventType,"REVENUE_ADJUSTED");assert.equal(next.delta.customerPayment,0);
  assert.equal(next.delta.providerCost,10000);assert.equal(next.delta.netProfit,4600);
});
test("reversal references disqualify otherwise successful source rows",()=>{
  assert.equal(rules.projectTransaction(source({reversalReference:"REFUND"})).confirmed,false);
});
test("date/service filters reject invalid input and use inclusive Nigeria days",()=>{
  for(const query of [{from:"2026-99-99"},{from:"2026-02-31"},{from:"2026-02-02",to:"2026-01-01"},{service:"WALLET"},{q:"x".repeat(121)}])
    assert.throws(()=>service.filters(query));
  const f=service.sourceFilter(service.filters({from:"2026-10-01",to:"2026-10-01"}));
  assert.equal(f.createdAt.$gte.toISOString(),"2026-09-30T23:00:00.000Z");
  assert.equal(f.createdAt.$lt.toISOString(),"2026-10-01T23:00:00.000Z");
});
test("Head Office global scope required even with a wildcard staff grant",()=>{
  for(const context of [undefined,{isHeadOffice:false,permissions:["*"],scope:{type:"GLOBAL"}},{isHeadOffice:true,scope:{type:"BRANCH"}}]){
    let denied=false;headOfficeOnly({staffAccess:context},{status(n){assert.equal(n,403);return this},json(){denied=true}},()=>assert.fail("unauthorized"));
    assert.equal(denied,true);
  }
  let allowed=false;headOfficeOnly({staffAccess:{isHeadOffice:true,scope:{type:"GLOBAL"}}},{},()=>allowed=true);assert.ok(allowed);
});
test("system ledger actor exception cannot remove actor requirement from other audits",async()=>{
  const ledger=new Audit({actorRole:"SYSTEM",action:"REVENUE_RECOGNIZED",reason:"Recorded source reconciliation.",metadata:{revenueLedger:true}});
  await ledger.validate();
  const other=new Audit({actorRole:"SYSTEM",action:"SYSTEM_SETTING_UPDATED",reason:"Recorded source reconciliation.",metadata:{revenueLedger:true}});
  await assert.rejects(other.validate(),/actorId/);
});
// Repository doubles: no ambient Atlas connection, writes, provider calls or wallet access.
let auditRows=[], txRows=[], commissionRows=[], users=[], server,base,originals;
const get=(o,p)=>p.split(".").reduce((x,k)=>x?.[k],o);
const match=(o,f)=>Object.entries(f).every(([k,v])=>{
  const a=get(o,k);
  if(v&&typeof v==="object"&&!(v instanceof Date)&&!(v instanceof mongoose.Types.ObjectId)){
    return Object.entries(v).every(([op,b])=>op==="$in"?b.map(String).includes(String(a)):op==="$nin"?!b.map(String).includes(String(a)):
      op==="$ne"?String(a)!==String(b):op==="$gt"?String(a)>String(b):op==="$gte"?a>=b:op==="$lt"?a<b:true);
  }return String(a)===String(v);
});
function query(items,filter={},one=false){
  let result=items.filter(x=>match(x,filter));const q={
    sort(spec){const [key,direction]=Object.entries(spec)[0];result.sort((a,b)=>(get(a,key)>get(b,key)?1:get(a,key)<get(b,key)?-1:0)*direction);return q},
    select(){return q},limit(n){result=result.slice(0,n);return q},lean:async()=>one?(result[0]||null):result,
  };return q;
}
before(async()=>{
  originals={tx:Transaction.find,com:Commission.find,user:User.find,find:Audit.find,one:Audit.findOne,create:Audit.create,index:Audit.collection.createIndex,aggregate:Audit.aggregate};
  Transaction.find=f=>query(txRows,f);Commission.find=f=>query(commissionRows,f);User.find=f=>query(users,f);
  Audit.find=f=>query(auditRows,f);Audit.findOne=f=>query(auditRows,f,true);
  Audit.aggregate=async pipeline=>{
    assert.ok(!JSON.stringify(pipeline).includes("$out"));assert.ok(!JSON.stringify(pipeline).includes("$merge"));
    const latest=new Map();
    const result={grossRevenue:0,netProfit:0,entries:auditRows.length,active:0,costed:0};
    for(const entry of auditRows){
      result.grossRevenue+=entry.metadata.accounting.delta.customerPayment;
      result.netProfit+=entry.metadata.accounting.delta.netProfit;
      const old=latest.get(entry.metadata.revenueTransactionId);
      if(!old||old.revenueSequence<entry.metadata.revenueSequence)latest.set(entry.metadata.revenueTransactionId,entry.metadata);
    }
    for(const meta of latest.values())if(meta.accounting.state.customerPayment>0){
      result.active++;if(meta.accounting.state.providerCost!==null)result.costed++;
    }
    return auditRows.length?[result]:[];
  };
  Audit.collection.createIndex=async()=>{};
  Audit.create=async row=>{
    await new Audit(row).validate();
    if(auditRows.some(r=>r.metadata.revenuePreviousKey===row.metadata.revenuePreviousKey))throw Object.assign(new Error("duplicate"),{code:11000});
    const created={...row,_id:new mongoose.Types.ObjectId(),createdAt:new Date()};auditRows.push(created);return created;
  };
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{if(req.headers.authorization!=="Bearer local-head-office")return res.sendStatus(401);req.user={_id:oid(99),role:"HEAD_OFFICE"};req.staffAccess={isHeadOffice:true,scope:{type:"GLOBAL"}};next()});
  app.use(headOfficeOnly);app.get("/summary",controller.summary);app.get("/transactions",controller.transactions);
  app.get("/export",controller.export);app.get("/ledger",controller.ledger);
  server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));base="http://127.0.0.1:"+server.address().port;
});
after(async()=>{Object.assign(Transaction,{find:originals.tx});Commission.find=originals.com;User.find=originals.user;
  Audit.find=originals.find;Audit.findOne=originals.one;Audit.create=originals.create;Audit.collection.createIndex=originals.index;Audit.aggregate=originals.aggregate;
  await new Promise(r=>server.close(r));});
test("atomic previous-entry key prevents concurrent duplicate recognition",async()=>{
  auditRows=[];const row=rules.projectTransaction(source());
  await Promise.all([service.append(row),service.append(row),service.append(row)]);
  assert.equal(auditRows.length,1);assert.equal(auditRows[0].metadata.revenueSequence,1);
  await service.append(rules.projectTransaction(source({status:"REFUNDED"})));
  assert.equal(auditRows.length,2);assert.equal(auditRows[1].metadata.accounting.linkedEntryId,String(auditRows[0]._id));
  assert.equal(auditRows.reduce((n,r)=>n+r.metadata.accounting.delta.customerPayment,0),0);
});
test("a correction returning to an earlier amount remains a new linked adjustment",async()=>{
  auditRows=[];await service.append(rules.projectTransaction(source()));
  await service.append(rules.projectTransaction(source({amount:160})));
  await service.append(rules.projectTransaction(source()));
  assert.equal(auditRows.length,3);assert.equal(auditRows.reduce((n,r)=>n+r.metadata.accounting.delta.customerPayment,0),15000);
});
const request=(path)=>fetch(base+path,{headers:{Authorization:"Bearer local-head-office"}});
test("summary/history agree and serialize no source credentials or phone numbers",async()=>{
  txRows=[source()];users=[{_id:oid(20),fullName:"Revenue Test Customer"}];commissionRows=[];
  const history=await (await request("/transactions")).json();const sum=await(await request("/summary")).json();
  assert.equal(history.data.total,1);assert.equal(sum.data.totals.grossRevenue,150);
  assert.equal(history.data.items[0].customerName,"Revenue Test Customer");
  assert.ok(!JSON.stringify(history).includes("providerResponse"));assert.ok(!JSON.stringify(history).includes("_state"));
  assert.equal((await fetch(base+"/summary")).status,401);
});
test("CSV search is consistent and formula-like customer names are escaped",async()=>{
  users=[{_id:oid(20),fullName:"=MALICIOUS()"}];
  const res=await request("/export?format=csv&q=REV-TEST");const body=await res.text();
  assert.equal(res.status,200);assert.ok(body.includes("'=MALICIOUS()"));assert.match(res.headers.get("content-disposition"),/\\.csv|\.csv/);
  const empty=await(await request("/transactions?q=not-present")).json();assert.equal(empty.data.total,0);
});
test("Excel and PDF exports are real files and expose unknown costs explicitly",async()=>{
  txRows=[source({serviceType:"AIRTIME",providerResponse:{financialAccounting:{providerCost:null},airtimeLifecycle:{reasonCode:"CORRELATED_PROVIDER_SUCCESS"}}})];
  const excel=await request("/export?format=xlsx");const bytes=Buffer.from(await excel.arrayBuffer());
  assert.equal(excel.status,200);assert.equal(bytes.subarray(0,2).toString(),"PK");
  const Workbook=require("exceljs").Workbook;const book=new Workbook();await book.xlsx.load(bytes);
  assert.equal(book.worksheets[0].getCell("E2").value,"UNCONFIRMED");
  const pdf=await request("/export?format=pdf");assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),"%PDF-");
});
test("reconciliation only appends audits; original transaction records stay unchanged",async()=>{
  txRows=[source({_id:oid(5)})];commissionRows=[];auditRows=[];const before=JSON.stringify(txRows);
  await service.reconcile();assert.equal(JSON.stringify(txRows),before);assert.equal(auditRows.length,1);
  await service.reconcile();assert.equal(auditRows.length,1);
});
test("manual reconciliation audits cannot leak global finance through scoped self-audits",async()=>{
  auditRows=[];await service.append(rules.projectTransaction(source()),{_id:oid(99),role:"HEAD_OFFICE"});
  assert.equal(auditRows[0].actorId,null);assert.equal(auditRows[0].actorRole,"SYSTEM");
  assert.equal(auditRows[0].metadata.revenueInitiatorId,String(oid(99)));
});
test("posted uncosted transactions never present zero as verified profit",async()=>{
  auditRows=[];txRows=[source({serviceType:"AIRTIME",providerResponse:{financialAccounting:{providerCost:null},airtimeLifecycle:{reasonCode:"CORRELATED_PROVIDER_SUCCESS"}}})];
  await service.append(rules.projectTransaction(txRows[0]));
  const result=await service.summary({});assert.equal(result.ledger.netProfit,null);assert.equal(result.ledger.uncostedTransactions,1);
  assert.equal((await service.ledger({})).items[0].netProfit,null);
});
test("fresh confirmations are processed even beyond the archive batch",async()=>{
  auditRows=[];txRows=Array.from({length:150},(_,n)=>source({_id:oid(n+200),updatedAt:new Date(n*1000),status:"PENDING"}));
  txRows.push(source({_id:oid(999),updatedAt:new Date()}));
  const before=JSON.stringify(txRows);await service.reconcile();
  assert.equal(auditRows.length,1);assert.equal(auditRows[0].metadata.revenueTransactionId,String(oid(999)));
  assert.equal(JSON.stringify(txRows),before);
});
