const express = require("express");
const { protect } = require("../middleware/auth.middleware");
const managedRecords = require("../controllers/managedRecords.controller");
const edupay = require("../controllers/edupay.controller");
const empowerment = require("../controllers/empowerment.controller");
const organizations = require("../controllers/organizations.controller");
const { manageAccess: empowermentManageAccess } = require(
  "../middleware/empowermentAccess.middleware"
);
const { getManagedRecordScope } = require("../services/aggregatorRecordScope.service");

const router = express.Router();
router.use(protect);

const role = (user) => String(user?.role || "").trim().toUpperCase();
const valuePresent = (value) => value !== undefined && value !== null && value !== "";
const comparable = (value) => String(value || "").trim().toUpperCase();
const idComparable = (value) => value ? String(value) : "";

function aggregatorOnly(req, res, next) {
  if (role(req.user) !== "AGENT") {
    return res.status(403).json({ success: false, message: "Only an Aggregator can create records through this route." });
  }
  return next();
}

async function rejectConflictingLineage(req, res, next) {
  try {
    const scope = await getManagedRecordScope(req.user);
    const actor = scope.actor;
    if (!actor || !scope.aggregatorIds.some((id) => idComparable(id) === idComparable(actor._id)) ||
        !actor.stateManagerId || !actor.zonalManagerId || !actor.state || !actor.zone) {
      return res.status(409).json({ success: false, message: "The Aggregator's active reporting line could not be verified." });
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const ids = [
      ["createdBy", actor._id],
      ["aggregatorId", actor._id],
      ["stateManagerId", actor.stateManagerId],
      ["zonalManagerId", actor.zonalManagerId],
    ];
    for (const [field, expected] of ids) {
      if (valuePresent(body[field]) && idComparable(body[field]) !== idComparable(expected)) {
        return res.status(409).json({ success: false, message: `The submitted ${field} conflicts with the authenticated reporting line.` });
      }
    }
    if (valuePresent(body.createdByRole) && comparable(body.createdByRole) !== "AGENT") {
      return res.status(409).json({ success: false, message: "The submitted creator role conflicts with the authenticated account." });
    }
    for (const field of ["state", "zone"]) {
      if (valuePresent(body[field]) && comparable(body[field]) !== comparable(actor[field])) {
        return res.status(409).json({ success: false, message: `The submitted ${field} conflicts with the Aggregator's assigned reporting line.` });
      }
    }
    req.managedOwnership = {
      createdBy: actor._id,
      createdByRole: "AGENT",
      aggregatorId: actor._id,
      stateManagerId: actor.stateManagerId,
      zonalManagerId: actor.zonalManagerId,
    };
    return next();
  } catch (error) { return next(error); }
}

router.get("/summary", managedRecords.summary);
router.get("/:section", managedRecords.list);
router.get("/:section/:id", managedRecords.detail);

router.post(
  "/schools",
  aggregatorOnly,
  rejectConflictingLineage,
  edupay.aggregatorCreateSchool,
);
router.post(
  "/empowerment/sponsors",
  empowermentManageAccess,
  aggregatorOnly,
  rejectConflictingLineage,
  empowerment.managedCreateOrganization,
);
router.post(
  "/empowerment/programs",
  empowermentManageAccess,
  aggregatorOnly,
  rejectConflictingLineage,
  empowerment.managedCreateProgram,
);
router.post(
  "/organizations",
  aggregatorOnly,
  rejectConflictingLineage,
  organizations.managedCreateOrganization,
);

module.exports = router;