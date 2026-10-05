const service = require("../services/adminDeliveryPricing.service");
function error(res, e) {
  return res.status(e.code === 11000 ? 409 : e.status || 400).json({
    success: false, code: e.code === 11000 ? "ROUTE_ALREADY_EXISTS" : e.code,
    message: e.code === 11000 ?
      "An active route already exists for this origin/destination direction, or this branch pair already has a route. Edit or restore it instead." : e.message,
  });
}
exports.overview = async (req, res) => {
  try { res.set("Cache-Control", "no-store"); res.json({ success: true, ...await service.overview() }); } catch (e) { error(res, e); }
};
exports.intraState = async (req, res) => {
  try { res.json({ success: true, intraState: await service.changeIntraState(req) }); } catch (e) { error(res, e); }
};
exports.remove = async (req, res) => {
  try { res.json({ success: true, ...await service.remove(req) }); } catch (e) { error(res, e); }
};
exports.error = error;