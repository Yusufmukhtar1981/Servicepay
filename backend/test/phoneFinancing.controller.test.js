const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const routes = require("../routes/phoneFinancing.routes");
const User = require("../models/user.model");
const KycProfile = require("../models/kycProfile.model");
const Product = require("../models/phoneProduct.model");
const Application = require("../models/phoneApplication.model");
const Device = require("../models/phoneDevice.model");
const Finance = require("../models/phoneFinance.model");
const Payment = require("../models/phonePayment.model");
const ProviderEvent = require("../models/phoneProviderEvent.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

const models = [User,KycProfile,Product,Application,Device,Finance,Payment,ProviderEvent,Transaction,LedgerEntry,Notification,AdminAuditLog];
let repl, server, base, n = 0;
const makeUser = async (role = "CUSTOMER", balance = 5000) => {
  n += 1;
  return User.create({ fullName:`Phone ${n}`, phone:`0807${String(n).padStart(7,"0")}`, email:`phone${n}@test.local`, password:"password123", transactionPin:"1234", role, status:"ACTIVE", walletBalance:balance });
};
const api = async ({ method="GET", path, actor, body, headers={} }) => {
  const h={Accept:"application/json",...headers};
  if(actor) h.Authorization=`Bearer ${jwt.sign({id:String(actor._id)},process.env.JWT_SECRET)}`;
  if(body !== undefined) h["Content-Type"]="application/json";
  const r=await fetch(`${base}${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
};
const productBody = (sku, stock=2) => ({sku,name:`${sku} Phone`,brand:"Acme",cashPrice:1000,financedPrice:1000,depositPercent:20,interestPercent:0,weeklyInstallments:4,stock});
const applicationBody = productId => ({productId,occupation:"Trader",monthlyIncome:100000,residentialAddress:"1 Test Street",state:"Lagos",lga:"Ikeja",preferredDurationWeeks:4,consent:true});

test.before(async () => {
  process.env.JWT_SECRET="phone-financing-test-secret";
  repl=await MongoMemoryReplSet.create({replSet:{count:1,storageEngine:"wiredTiger"}});
  await mongoose.connect(repl.getUri(),{dbName:"phone-financing-tests"});
  await Promise.all(models.map(m=>m.init()));
  const app=express(); app.use(express.json()); app.use("/api/phone-financing",routes);
  await new Promise(resolve=>{server=app.listen(0,"127.0.0.1",()=>{base=`http://127.0.0.1:${server.address().port}`;resolve();});});
});
test.after(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await mongoose.disconnect();await repl.stop();});
test.beforeEach(async()=>Promise.all(models.map(m=>m.collection.deleteMany({}))));

test("admin device intake validates the canonical payload and updates inventory once", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const product = (await api({
    method: "POST",
    path: "/api/phone-financing/admin/products",
    actor: admin,
    body: productBody("IMEI-INTAKE"),
  })).body.product;

  for (const [body, message] of [
    [{ imei1: "111", serialNumber: "SER-1" }, "phoneProductId is required."],
    [{ phoneProductId: product._id, serialNumber: "SER-1" }, "imei1 is required."],
    [{ phoneProductId: product._id, imei1: "111" }, "serialNumber is required."],
  ]) {
    const response = await api({
      method: "POST",
      path: "/api/phone-financing/admin/devices",
      actor: admin,
      body,
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, message);
  }

  const legacyPayload = await api({
    method: "POST",
    path: "/api/phone-financing/admin/devices",
    actor: admin,
    body: { productId: product._id, imei1: "111", serialNumber: "SER-1" },
  });
  assert.equal(legacyPayload.status, 400);
  assert.equal(legacyPayload.body.message, "phoneProductId is required.");

  const invalidId = await api({
    method: "POST",
    path: "/api/phone-financing/admin/devices",
    actor: admin,
    body: { phoneProductId: "not-an-id", imei1: "111", serialNumber: "SER-1" },
  });
  assert.equal(invalidId.status, 400);
  assert.equal(invalidId.body.message, "phoneProductId must be a valid Phone Product ID.");

  const missingProduct = await api({
    method: "POST",
    path: "/api/phone-financing/admin/devices",
    actor: admin,
    body: {
      phoneProductId: new mongoose.Types.ObjectId(),
      imei1: "111",
      serialNumber: "SER-1",
    },
  });
  assert.equal(missingProduct.status, 404);
  assert.equal(missingProduct.body.message, "Phone product not found.");

  const first = await api({
    method: "POST",
    path: "/api/phone-financing/admin/devices",
    actor: admin,
    body: {
      phoneProductId: `  ${product._id}  `,
      imei1: " 111 111 ",
      imei2: "   ",
      serialNumber: " ser-1 ",
    },
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.device.imei1, "111111");
  assert.equal(first.body.device.imei2, undefined);
  assert.equal(first.body.device.serialNumber, "SER-1");
  assert.equal(first.body.device.status, "AVAILABLE");
  assert.equal(String(first.body.device.product), String(product._id));

  const second = await api({
    method: "POST",
    path: "/api/phone-financing/admin/devices",
    actor: admin,
    body: {
      phoneProductId: product._id,
      imei1: "222222",
      imei2: "333333",
      serialNumber: "SER-2",
    },
  });
  assert.equal(second.status, 201);

  for (const [body, message] of [
    [
      { phoneProductId: product._id, imei1: "111111", serialNumber: "SER-3" },
      "IMEI 1 already exists in inventory.",
    ],
    [
      {
        phoneProductId: product._id,
        imei1: "444444",
        imei2: "333333",
        serialNumber: "SER-4",
      },
      "IMEI 2 already exists in inventory.",
    ],
    [
      { phoneProductId: product._id, imei1: "555555", serialNumber: "ser-1" },
      "Serial number already exists in inventory.",
    ],
  ]) {
    const response = await api({
      method: "POST",
      path: "/api/phone-financing/admin/devices",
      actor: admin,
      body,
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.message, message);
  }

  assert.equal(await Device.countDocuments({ product: product._id }), 2);
  assert.equal((await Product.findById(product._id)).stock, 2);
});

test("phone financing protects ownership, money, inventory, schedules, and disabled provider evidence", async () => {
  const admin=await makeUser("HEAD_OFFICE"), customer=await makeUser(), other=await makeUser(), second=await makeUser(), officer=await makeUser("PHONE_FINANCING_OFFICER",0);
  officer.isStaff=true; await officer.save();
  const p1=(await api({method:"POST",path:"/api/phone-financing/admin/products",actor:admin,body:productBody("PX-ONE")})).body.product;
  const p2=(await api({method:"POST",path:"/api/phone-financing/admin/products",actor:admin,body:productBody("PX-TWO")})).body.product;
  const device=(await api({method:"POST",path:"/api/phone-financing/admin/devices",actor:admin,body:{phoneProductId:p1._id,imei1:"111111111111111",imei2:"222222222222222",serialNumber:"SER-1"}})).body.device;
  assert.equal((await api({path:"/api/phone-financing/products",actor:customer})).body.products.length,1);
  await api({method:"PATCH",path:`/api/phone-financing/admin/products/${p1._id}`,actor:admin,body:{stock:99}});
  assert.equal((await Product.findById(p1._id)).stock,1);
  assert.equal((await api({method:"POST",path:"/api/phone-financing/admin/products",actor:customer,body:productBody("NO")})).status,403);
  const submitted=await api({method:"POST",path:"/api/phone-financing/applications",actor:customer,body:applicationBody(p1._id)});
  assert.equal(submitted.status,201); const appId=submitted.body.application._id;
  assert.equal((await api({path:`/api/phone-financing/my-applications/${appId}`,actor:other})).status,404);
  assert.equal((await api({method:"PATCH",path:`/api/phone-financing/admin/applications/${appId}/status`,actor:admin,body:{status:"UNDER_REVIEW"}})).status,200);
  assert.equal((await api({method:"PATCH",path:`/api/phone-financing/admin/applications/${appId}/status`,actor:admin,body:{status:"AWAITING_DEPOSIT"}})).status,409);
  await api({method:"PATCH",path:`/api/phone-financing/admin/applications/${appId}/assign-officer`,actor:admin,body:{officerId:officer._id}});
  assert.equal((await api({method:"POST",path:`/api/phone-financing/admin/applications/${appId}/approve`,actor:admin,body:{}})).body.application.depositRequired,200);
  const wrongDeposit=await api({method:"POST",path:`/api/phone-financing/applications/${appId}/deposit`,actor:customer,body:{amount:201,transactionPin:"1234"},headers:{"Idempotency-Key":"dep-wrong"}});
  assert.equal(wrongDeposit.status,400);
  const dep={method:"POST",path:`/api/phone-financing/applications/${appId}/deposit`,actor:customer,body:{amount:200,transactionPin:"1234"},headers:{"Idempotency-Key":"deposit-1"}};
  const [d1,d2]=await Promise.all([api(dep),api(dep)]); assert.deepEqual([d1.status,d2.status].sort(),[200,201]);
  assert.equal((await api({...dep,body:{amount:201,transactionPin:"1234"}})).status,409);
  assert.equal((await Application.findById(appId)).outstandingBalance,800);
  assert.equal(await Payment.countDocuments({type:"DEPOSIT"}),1); assert.equal(await Transaction.countDocuments({serviceType:"PHONE_FINANCING_DEPOSIT"}),1); assert.equal(await LedgerEntry.countDocuments({service:"PHONE_FINANCING_DEPOSIT"}),1);
  const dupe=await api({method:"POST",path:"/api/phone-financing/admin/devices",actor:admin,body:{phoneProductId:p1._id,imei1:"111111111111111",serialNumber:"SER-2"}});assert.equal(dupe.status,409);
  const assign={method:"POST",path:`/api/phone-financing/admin/applications/${appId}/assign-device`,actor:admin,body:{deviceId:device._id}};
  const [a1,a2]=await Promise.all([api(assign),api(assign)]);assert.ok([200,409].includes(a1.status)&&[200,409].includes(a2.status));
  assert.equal((await Product.findById(p1._id)).stock,0);
  assert.equal((await api({method:"POST",path:`/api/phone-financing/admin/applications/${appId}/refund-deposit`,actor:admin,body:{reason:"Must fail after assignment"},headers:{"Idempotency-Key":"late-refund"}})).status,409);
  const handover=await api({method:"POST",path:`/api/phone-financing/admin/applications/${appId}/handover`,actor:admin,body:{}});assert.equal(handover.status,201);
  const financeId=handover.body.finance._id; assert.equal((await api({path:`/api/phone-financing/finance/${financeId}/schedule`,actor:customer})).body.schedule.length,4);
  const overdueFinance=await Finance.findById(financeId);overdueFinance.paymentSchedule[0].dueDate=new Date(Date.now()-86400000*5);overdueFinance.graceDays=0;await overdueFinance.save();
  assert.equal((await api({method:"POST",path:"/api/phone-financing/admin/overdue/evaluate",actor:admin,body:{}})).body.overdueUpdated,1);
  const restrict={method:"POST",path:`/api/phone-financing/admin/finance/${financeId}/provider-request`,actor:admin,body:{action:"RESTRICT"},headers:{"Idempotency-Key":"restriction-1"}};
  const r1=await api(restrict),r2=await api(restrict);assert.equal(r1.body.providerEnforcement,"DISABLED");assert.equal(r2.body.idempotent,true);assert.equal(await ProviderEvent.countDocuments(),1);
  assert.equal((await api({method:"POST",path:`/api/phone-financing/admin/finance/${financeId}/provider-request`,actor:admin,body:{action:"RESTORE"},headers:{"Idempotency-Key":"restore-1"}})).status,201);
  const detail=await api({path:`/api/phone-financing/admin/applications/${appId}`,actor:admin});assert.equal(detail.body.application.assignedOfficer.fullName,officer.fullName);assert.ok(detail.body.providerEvents.length>=2);
  assert.equal((await api({path:`/api/phone-financing/admin/applications?q=${encodeURIComponent(customer.fullName)}`,actor:admin})).body.applications.length,1);
  assert.equal((await api({path:"/api/phone-financing/admin/devices?q=111111111111111",actor:admin})).body.devices.length,1);
  for(const query of [handover.body.finance.reference,customer.fullName,customer.phone,customer.email,"111111111111111","222222222222222","SER-1"]){
    const found=await api({path:`/api/phone-financing/admin/finance?q=${encodeURIComponent(query)}`,actor:admin});
    assert.equal(found.body.finance.length,1,`finance search failed for ${query}`);
    assert.ok(found.body.finance[0].providerEvents.length>=2);
  }
  const pay={method:"POST",path:`/api/phone-financing/finance/${financeId}/pay`,actor:customer,body:{amount:200,transactionPin:"1234"},headers:{"Idempotency-Key":"weekly-1"}};
  const [w1,w2]=await Promise.all([api(pay),api(pay)]);assert.deepEqual([w1.status,w2.status].sort(),[200,201]);assert.equal(await Payment.countDocuments({type:"INSTALLMENT"}),1);
  assert.equal((await api({...pay,body:{amount:199,transactionPin:"1234"}})).status,409);
  assert.equal((await api({...pay,body:{amount:200,installmentNumber:99,transactionPin:"1234"}})).status,409);
  assert.equal((await Finance.findById(financeId)).status,"ACTIVE");assert.equal((await Application.findById(appId)).status,"ACTIVE");
  assert.equal((await Application.findById(appId)).outstandingBalance,600);
  assert.equal(await ProviderEvent.countDocuments({finance:financeId,action:"RESTORE",idempotencyKey:`overdue:${financeId}:restore`,outcome:"INTEGRATION_REQUIRED"}),1);
  assert.equal((await api({method:"POST",path:`/api/phone-financing/finance/${financeId}/pay`,actor:customer,body:{amount:199,transactionPin:"1234"},headers:{"Idempotency-Key":"bad-weekly"}})).status,400);
  for(let i=2;i<=4;i++) assert.equal((await api({method:"POST",path:`/api/phone-financing/finance/${financeId}/pay`,actor:customer,body:{amount:200,transactionPin:"1234"},headers:{"Idempotency-Key":`weekly-${i}`}})).status,201);
  assert.equal((await Finance.findById(financeId)).status,"COMPLETED");assert.equal((await Device.findById(device._id)).status,"COMPLETED");
  assert.equal((await Application.findById(appId)).outstandingBalance,0);
  const secondDevice=(await api({method:"POST",path:"/api/phone-financing/admin/devices",actor:admin,body:{phoneProductId:p2._id,imei1:"333333333333333",serialNumber:"SER-SECOND"}})).body.device;
  await api({method:"PATCH",path:`/api/phone-financing/admin/products/${p2._id}`,actor:admin,body:{interestPercent:20}});
  const secondApp=(await api({method:"POST",path:"/api/phone-financing/applications",actor:second,body:applicationBody(p2._id)})).body.application;
  assert.ok(secondApp.reference.startsWith("SPF-PHONE"));
  await api({method:"POST",path:`/api/phone-financing/admin/applications/${secondApp._id}/approve`,actor:admin,body:{}});
  assert.equal((await api({method:"POST",path:`/api/phone-financing/applications/${secondApp._id}/deposit`,actor:second,body:{amount:200,transactionPin:"1234"},headers:{"Idempotency-Key":"second-deposit"}})).status,201);
  assert.equal((await api({method:"POST",path:`/api/phone-financing/admin/applications/${secondApp._id}/assign-device`,actor:admin,body:{deviceId:secondDevice._id}})).status,200);
  assert.equal((await Device.findById(secondDevice._id)).customer.toString(),second._id.toString());
  const secondFinance=(await api({method:"POST",path:`/api/phone-financing/admin/applications/${secondApp._id}/handover`,actor:admin,body:{}})).body.finance;
  assert.equal(secondFinance.paymentSchedule[0].amount,250);
  assert.equal((await api({method:"PATCH",path:`/api/phone-financing/admin/products/${p2._id}/deactivate`,actor:admin,body:{}})).body.product.active,false);
  assert.ok((await api({path:"/api/phone-financing/admin/dashboard",actor:admin})).body.metrics.completed >= 1);
});

test("deposit atomically reserves scarce inventory and refund releases it exactly once",async()=>{
  const admin=await makeUser("HEAD_OFFICE"),first=await makeUser(),second=await makeUser();
  const product=(await api({method:"POST",path:"/api/phone-financing/admin/products",actor:admin,body:productBody("SCARCE")})).body.product;
  const device=(await api({method:"POST",path:"/api/phone-financing/admin/devices",actor:admin,body:{phoneProductId:product._id,imei1:"999999999999991",serialNumber:"SCARCE-1"}})).body.device;
  const applications=[];
  for(const customer of [first,second]){
    const submitted=(await api({method:"POST",path:"/api/phone-financing/applications",actor:customer,body:applicationBody(product._id)})).body.application;
    await api({method:"POST",path:`/api/phone-financing/admin/applications/${submitted._id}/approve`,actor:admin,body:{}});
    applications.push(submitted);
  }
  const deposits=applications.map((application,index)=>api({method:"POST",path:`/api/phone-financing/applications/${application._id}/deposit`,actor:index?second:first,body:{amount:200,transactionPin:"1234"},headers:{"Idempotency-Key":`scarce-deposit-${index}`}}));
  const results=await Promise.all(deposits);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const winnerIndex=results.findIndex(r=>r.status===201),winner=winnerIndex?second:first,loser=winnerIndex?first:second,winnerApp=applications[winnerIndex],loserApp=applications[winnerIndex?0:1];
  assert.equal((await User.findById(winner._id)).walletBalance,4800);
  assert.equal((await User.findById(loser._id)).walletBalance,5000);
  assert.equal(await Payment.countDocuments({type:"DEPOSIT"}),1);
  assert.equal((await Product.findById(product._id)).stock,0);
  const reserved=await Device.findById(device._id);assert.equal(reserved.status,"RESERVED");assert.equal(String(reserved.reservedForApplication),String(winnerApp._id));
  const refundRequest={method:"POST",path:`/api/phone-financing/admin/applications/${winnerApp._id}/refund-deposit`,actor:admin,body:{reason:"Unable to fulfil"},headers:{"Idempotency-Key":"scarce-refund"}};
  assert.equal((await api(refundRequest)).status,201);assert.equal((await api(refundRequest)).status,200);
  assert.equal((await User.findById(winner._id)).walletBalance,5000);
  assert.equal(await Payment.countDocuments({type:"REFUND"}),1);
  assert.equal(await Transaction.countDocuments({serviceType:"PHONE_FINANCING_REFUND"}),1);
  assert.equal(await LedgerEntry.countDocuments({service:"PHONE_FINANCING_REFUND"}),1);
  const refunded=await Application.findById(winnerApp._id),released=await Device.findById(device._id);
  assert.equal(refunded.status,"REFUNDED");assert.equal(refunded.depositPaid,0);assert.equal(refunded.outstandingBalance,0);
  assert.equal((await Product.findById(product._id)).stock,1);assert.equal(released.status,"AVAILABLE");assert.equal(released.reservedForApplication,null);assert.equal(released.reservedForCustomer,null);assert.equal(released.reservationExpiresAt,null);
  const loserDeposit=await api({method:"POST",path:`/api/phone-financing/applications/${loserApp._id}/deposit`,actor:loser,body:{amount:200,transactionPin:"1234"},headers:{"Idempotency-Key":"loser-after-refund"}});
  assert.equal(loserDeposit.status,201);
  await Device.updateOne({_id:device._id},{$set:{reservationExpiresAt:new Date(Date.now()-1000)}});
  const expiry=await api({method:"POST",path:"/api/phone-financing/admin/reservations/evaluate-expired",actor:admin,body:{}});
  assert.equal(expiry.body.expiredPaidReservations.length,1);
  assert.equal((await Device.findById(device._id)).status,"RESERVED");
  assert.equal((await Product.findById(product._id)).stock,0);
});

test("phone financing officers are lifecycle-scoped and cannot use admin financial or inventory actions", async () => {
  const admin = await makeUser("HEAD_OFFICE");
  const customer = await makeUser();
  const created = await api({
    method: "POST", path: "/api/phone-financing/admin/officers", actor: admin,
    body: { fullName: "Finance Officer", phone: "08123456789", email: "finance-officer@test.local", password: "password123", state: "Lagos", lga: "Ikeja" },
  });
  assert.equal(created.status, 201);
  const officer = await User.findById(created.body.officer._id);
  assert.equal(officer.role, "PHONE_FINANCING_OFFICER");
  assert.equal(officer.isStaff, true);
  assert.equal((await api({ path: "/api/phone-financing/admin/officers/count", actor: admin })).body.counts.active, 1);

  const product = (await api({ method: "POST", path: "/api/phone-financing/admin/products", actor: admin, body: productBody("OFFICER-SCOPE") })).body.product;
  assert.equal((await api({
    method: "POST", path: "/api/phone-financing/admin/devices", actor: admin,
    body: { phoneProductId: product._id, imei1: "888888888888888", serialNumber: "OFFICER-SCOPE-1" },
  })).status, 201);
  const submitted = await api({ method: "POST", path: "/api/phone-financing/applications", actor: customer, body: applicationBody(product._id) });
  const applicationId = submitted.body.application._id;
  assert.equal((await api({ method: "PATCH", path: `/api/phone-financing/admin/applications/${applicationId}/assign-officer`, actor: admin, body: { officerId: officer._id } })).status, 200);
  const assigned = await Application.findById(applicationId);
  assert.equal(assigned.assignmentState, "ACTIVE");
  assert.equal(assigned.assignmentTimeline.length, 1);
  assert.equal((await api({ path: "/api/phone-financing/officer/applications", actor: officer })).body.count, 1);
  assert.equal((await api({
    method: "POST", path: `/api/phone-financing/officer/applications/${applicationId}/verification`, actor: officer,
    body: { report: { recommendation: "APPROVE", checklist: { identityConfirmed: true, phoneConfirmed: true }, findings: "Identity and address reviewed.", incomeAssessment: "Income is consistent.", notes: "Identity and address reviewed." } },
  })).status, 200);
  assert.equal((await api({
    method: "POST", path: `/api/phone-financing/officer/applications/${applicationId}/follow-ups`, actor: officer,
    body: { note: "Customer contacted.", outcome: "Reached" },
  })).status, 201);
  assert.equal((await api({ path: "/api/phone-financing/admin/devices", actor: officer })).status, 403);
  assert.equal((await api({ method: "POST", path: `/api/phone-financing/admin/applications/${applicationId}/approve`, actor: officer, body: {} })).status, 403);
  assert.equal((await api({ method: "PATCH", path: `/api/phone-financing/admin/officers/${officer._id}/status`, actor: admin, body: { status: "SUSPENDED" } })).status, 409);
});

test("officer assignment and verification enforce active-review and report contracts", async () => {
  const admin = await makeUser("HEAD_OFFICE"), customer = await makeUser();
  const makeOfficer = async (suffix) => (await api({
    method: "POST", path: "/api/phone-financing/admin/officers", actor: admin,
    body: { fullName: `Officer ${suffix}`, phone: `0819${suffix}00000`, email: `officer-${suffix}@test.local`, password: "password123" },
  })).body.officer;
  const first = await makeOfficer("1"), second = await makeOfficer("2");
  const product = (await api({ method: "POST", path: "/api/phone-financing/admin/products", actor: admin, body: productBody("OFFICER-CONTRACT") })).body.product;
  await api({ method: "POST", path: "/api/phone-financing/admin/devices", actor: admin, body: { phoneProductId: product._id, imei1: "777777777777777", serialNumber: "OFFICER-CONTRACT-1" } });
  const applicationId = (await api({ method: "POST", path: "/api/phone-financing/applications", actor: customer, body: applicationBody(product._id) })).body.application._id;

  assert.equal((await api({ method: "PATCH", path: `/api/phone-financing/admin/officers/${second._id}/status`, actor: admin, body: { status: "SUSPENDED" } })).status, 200);
  assert.equal((await api({ method: "PATCH", path: `/api/phone-financing/admin/applications/${applicationId}/assign-officer`, actor: admin, body: { officerId: second._id } })).status, 400);
  await api({ method: "PATCH", path: `/api/phone-financing/admin/officers/${second._id}/status`, actor: admin, body: { status: "ACTIVE" } });
  const assigned = await api({ method: "PATCH", path: `/api/phone-financing/admin/applications/${applicationId}/assign-officer`, actor: admin, body: { officerId: first._id } });
  assert.equal(assigned.body.application.status, "UNDER_REVIEW");
  assert.equal(assigned.body.application.statusHistory.at(-1).status, "UNDER_REVIEW");
  const reassigned = await api({ method: "PATCH", path: `/api/phone-financing/admin/applications/${applicationId}/assign-officer`, actor: admin, body: { officerId: second._id } });
  assert.equal(reassigned.status, 200);
  assert.equal(reassigned.body.application.assignmentTimeline.length, 2);
  assert.equal(reassigned.body.application.assignmentTimeline.at(-1).action, "REASSIGNED");
  assert.equal(reassigned.body.application.assignmentSnapshot.fullName, "Officer 2");
  assert.equal((await api({ method: "POST", path: `/api/phone-financing/officer/applications/${applicationId}/verification`, actor: await User.findById(second._id), body: { report: { recommendation: "MAYBE" } } })).status, 400);
  const officer = await User.findById(second._id);
  assert.equal((await api({ method: "POST", path: `/api/phone-financing/officer/applications/${applicationId}/verification`, actor: officer, body: { report: { recommendation: "NEED_MORE_INFORMATION", checklist: { identityConfirmed: true }, findings: "Address needs confirmation.", incomeAssessment: "Income evidence reviewed.", notes: "Request utility bill." } } })).status, 200);
  assert.equal(await Notification.countDocuments({ userId: admin._id, referenceType: "PhoneApplicationVerification" }), 1);
  assert.equal((await api({ method: "POST", path: `/api/phone-financing/officer/applications/${applicationId}/follow-ups`, actor: officer, body: { note: "Requested utility bill.", outcome: "MORE_INFORMATION_REQUIRED" } })).status, 201);
  assert.equal(await Notification.countDocuments({ userId: customer._id, referenceType: "PhoneApplicationFollowUp" }), 1);
  assert.equal((await api({ method: "PATCH", path: `/api/phone-financing/admin/applications/${applicationId}/status`, actor: admin, body: { status: "MORE_INFORMATION_REQUIRED", note: "Upload utility bill" } })).status, 200);
  assert.equal(await Notification.countDocuments({ userId: customer._id, referenceType: "PhoneApplicationMoreInformation" }), 1);
  assert.equal((await api({ method: "PATCH", path: `/api/phone-financing/admin/applications/${applicationId}/assign-officer`, actor: admin, body: { officerId: first._id } })).status, 409);
  const officerList = await api({ path: "/api/phone-financing/admin/officers", actor: admin });
  assert.equal(officerList.body.officers.find((item) => item._id === second._id).completedVerifications, 1);
});