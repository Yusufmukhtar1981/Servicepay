const { DeviceCompanion } = require("../services/deviceCompanion.service");
const { DeviceError } = require("../services/deviceValidation.service");
function handler(work) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { return res.json({ success: true, data: await work(req) }); }
    catch (error) {
      if (error instanceof DeviceError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      if (error.code === 11000) return res.status(409).json({ success: false, code: "DEVICE_DUPLICATE",
        message: "A device identifier, installation, request or settings revision already exists. Refresh and check the existing record." });
      return res.status(500).json({ success: false, code: "DEVICE_OPERATION_FAILED", message: "The device operation could not be completed safely." });
    }
  };
}
function controller(connection) {
  const service = new DeviceCompanion(connection);
  const actor = (req) => String(req.user._id);
  return {
    service,
    ready: async (req, res, next) => {
      try { await service.ready(); next(); } catch (error) {
        res.status(503).json({ success: false, code: error.code || "DEVICE_NOT_READY",
          message: "Enterprise Devices is unavailable until its dedicated collections, unique indexes and transaction support are explicitly provisioned and verified. No maintenance was run." });
      }
    },
    overview: handler(() => service.overview()),
    search: handler((req) => service.search(req.body)),
    register: handler(async (req) => ({ device: await service.register(req.body, actor(req)) })),
    details: handler((req) => service.get(req.params.id, actor(req))),
    staff: handler((req) => service.directory(req.query)),
    history: handler((req) => service.history(req.params.id, req.query)),
    assign: handler(async (req) => ({ device: await service.assign(req.params.id, req.body, actor(req)) })),
    status: handler(async (req) => ({ device: await service.status(req.params.id, req.body, actor(req)) })),
    enrollment: handler((req) => service.issueEnrollment(req.params.id, req.body, actor(req))),
    revoke: handler((req) => service.revoke(req.params.id, req.body, actor(req))),
    settings: handler(async () => ({ settings: await service.settings() })),
    saveSettings: handler(async (req) => ({ settings: await service.updateSettings(req.body, actor(req)) })),
    reports: handler((req) => service.reports(actor(req))),
    enroll: handler((req) => service.enroll(req.body)),
    sync: handler((req) => service.sync(req.deviceAuth, req.body)),
    heartbeat: handler((req) => service.sync(req.deviceAuth, req.body, true)),
    config: handler((req) => service.configuration(req.deviceAuth.device)),
    rotate: handler((req) => service.rotate(req.deviceAuth, req.body)),
  };
}
module.exports = { controller, handler };
