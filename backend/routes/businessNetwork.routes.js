"use strict";
const express = require("express");
const c = require("../controllers/businessNetwork.controller");
const premium = require("../controllers/businessNetwork.premium.controller");
const S = require("../services/businessNetwork.service");
const { protect } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission, requireExplicitPermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P } = require("../config/staffPermissions");
function createRouter({ authenticate = protect, loadRole = loadStaffRole, ready = S.ensureReady } = {}) {
  const router = express.Router();
  // Public, opt-in, informational business profiles contain no customer identity,
  // wallet data or payment authority.
  router.get("/public/:networkId", premium.publicProfile);
  router.use(authenticate);
  router.use(async (_req, _res, next) => { try { await ready(); next(); } catch (error) { next(error); } });
  const customer = c.userIsCustomer;
  const ho = (req, _res, next) => {
    try { if (!S.isHO(req.user)) S.P.fail("Only Head Office may administer the network.", "NETWORK_FORBIDDEN", 403); next(); } catch (error) { next(error); }
  };
  router.get("/me", customer, c.me);
  router.get("/catalogue", customer, premium.catalogue);
  router.get("/tools/:kind", customer, premium.tools);
  router.get("/directory/:kind", customer, premium.directory);
  router.post("/directory/:kind", customer, premium.saveCustomer);
  router.delete("/directory/:kind/:contactId", customer, premium.deleteCustomer);
  router.get("/expenses/:kind", customer, premium.expenses);
  router.post("/expenses/:kind", customer, premium.recordExpense);
  router.post("/public-profile/:kind", customer, premium.publish);
  router.get("/vouchers/:kind", customer, premium.vouchers);
  router.post("/vouchers/:kind/purchase", customer, (req, res, next) => {
    req.params.capability = req.body?.type === "data" ? "dataVouchers" : "rechargeVouchers";
    return premium.unavailable(req, res, next);
  });
  router.post("/capabilities/:capability", customer, premium.unavailable);
  router.put("/applications/:kind", customer, c.save);
  router.post("/applications/:kind/submit", customer, c.submit);
  router.get("/dashboard/:kind", customer, c.dashboard);
  router.get("/transactions/:kind", customer, c.transactions);
  router.post("/transactions/:kind", customer, c.link);
  router.get("/eligible-transactions/:kind", customer, c.eligible);
  router.get("/reports/:kind", customer, c.report);
  router.get("/commissions/:kind", customer, c.commissions);
  router.get("/profiles/:id/branches", c.branches);
  router.post("/profiles/:id/branches", c.createBranch);
  router.patch("/profiles/:id/branches/:branchId", c.updateBranch);
  router.get("/profiles/:id/staff", c.staff);
  router.post("/profiles/:id/staff", c.inviteStaff);
  router.patch("/staff/:id", c.staffStatus);
  router.post("/staff/:id/accept", customer, c.acceptStaff);
  router.post("/support", customer, c.support);
  router.use("/admin", loadRole, requirePermission(P.BUSINESS_NETWORK_VIEW));
  router.get("/admin/overview", c.overview);
  router.get("/admin/profiles", c.adminProfiles);
  router.get("/admin/profiles/:id", c.adminDetail);
  router.post("/admin/profiles/:id/review", ho, requirePermission(P.BUSINESS_NETWORK_MANAGE), c.review);
  router.get("/admin/transactions", c.adminTransactions);
  router.get("/admin/rules", c.rules);
  router.post("/admin/rules", ho, requireExplicitPermission(P.FINANCE_APPROVE), c.createRule);
  router.patch("/admin/rules/:id", ho, requireExplicitPermission(P.FINANCE_APPROVE), c.disableRule);
  router.get("/admin/commissions", c.adminCommissions);
  router.post("/admin/commissions/settle", ho, requireExplicitPermission(P.FINANCE_APPROVE), c.settle);
  router.get("/admin/reports", requirePermission(P.BUSINESS_NETWORK_EXPORT), c.adminReport);
  router.get("/admin/audit", c.audit);
  router.get("/admin/settings", c.settings);
  router.get("/admin/premium", premium.settings);
  router.put("/admin/premium", ho, requirePermission(P.BUSINESS_NETWORK_MANAGE), (req, res, next) => {
    const financial = req.body?.configuration &&
      ["loyalty", "levels"].some(key => Object.hasOwn(req.body.configuration, key));
    return financial ? requireExplicitPermission(P.FINANCE_APPROVE)(req, res, next) : next();
  }, premium.configure);
  router.get("/admin/performance", premium.performance);
  router.get("/admin/vouchers", premium.adminVouchers);
  router.get("/admin/loyalty", premium.loyaltyReport);
  router.post("/admin/profiles/:id/level", ho, requireExplicitPermission(P.FINANCE_APPROVE), premium.level);
  router.put("/admin/settings", ho, requirePermission(P.BUSINESS_NETWORK_MANAGE), c.saveSettings);
  router.use(c.errors);
  return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
