// Preserve legacy role behavior; newly provisioned workspace capabilities cannot
// turn a branch/self-scoped account into a global complaint investigator.
module.exports = (req, res, next) => {
  const access = req.staffAccess;
  const permissions = new Set(access?.permissions || []);
  if (!access?.isHeadOffice &&
      ["operations.workspace.view", "support.workspace.view"].some((p) => permissions.has(p)) &&
      access?.scope?.type !== "GLOBAL") {
    return res.status(403).json({ success: false, message: "A globally scoped support role is required." });
  }
  return next();
};
