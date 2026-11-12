const test = require("node:test");
const assert = require("node:assert/strict");
const Settings = require("../models/appSettings.model");
const Config = require("../models/providerManagementConfig.model");
const service = require("../services/providerManagement.service");
const names = ["AIRTIME", "DATA", "ELECTRICITY", "CABLE"];
const docs = () => names.map(name => ({ service: name, ...structuredClone(service.DEFAULTS[name]) }));
const query = value => ({ select() { return this; }, session() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const originals = { settings: Settings.findOne, one: Config.findOne, many: Config.find };
test.afterEach(() => {
  Settings.findOne = originals.settings; Config.findOne = originals.one; Config.find = originals.many;
});
for (const mode of ["singleton", "legacy", "empty"]) {
  test(`fresh provider matrix preserves ${mode} configuration with only two reads`, async () => {
    let reads = 0;
    const values = docs(), settings = mode === "singleton" ? {
      billProviderManagement: { AIRTIME: values[0], ELECTRICITY: values[2] },
      dataProviderManagement: values[1],
    } : null;
    Settings.findOne = () => { reads++; return query(settings); };
    Config.findOne = ({ service: name }) => { reads++; return query(mode === "empty" ? null : values.find(d => d.service === name)); };
    Config.find = () => { reads++; return query(mode === "empty" ? [] : values); };
    const expected = (await Promise.all(names.map(n => service.getServiceConfig(n)))).map(service.serializeConfig);
    reads = 0;
    assert.deepEqual(await service.readProviderManagementMatrix(), expected);
    assert.equal(reads, 2);
  });
}
test("admin enablement changes are observed on the very next read, including disabled legacy states", async () => {
  const values = docs(); values[0].providerStates = [];
  Settings.findOne = () => query(null); Config.find = () => query(values);
  const first = await service.readProviderManagementMatrix();
  assert(first[0].providers.every(p => !p.enabled));
  values[0].providerStates = [{ provider: "CLUBKONNECT", enabled: true }];
  const second = await service.readProviderManagementMatrix();
  assert.equal(second[0].providers.find(p => p.provider === "CLUBKONNECT").enabled, true);
});
test("database errors fail explicitly rather than returning fabricated routing availability", async () => {
  Settings.findOne = () => ({ select() { return this; }, then(_r, reject) { return Promise.reject(new Error("fixture unavailable")).then(_r, reject); } });
  Config.find = () => query([]);
  await assert.rejects(service.readProviderManagementMatrix(), /fixture unavailable/);
});
test("financial authorization continues to use the supplied session, not the batch-read path", async () => {
  const session = {}, observed = [];
  Settings.findOne = () => ({ select() { return this; }, session(s) { observed.push(s); return this; },
    then(resolve, reject) { return Promise.resolve(null).then(resolve, reject); } });
  Config.findOne = () => ({ session(s) { observed.push(s); return this; },
    then(resolve, reject) { return Promise.resolve(docs()[0]).then(resolve, reject); } });
  Config.find = () => { throw Error("Batch reads must not authorize a payment"); };
  assert.equal((await service.getServiceConfig("AIRTIME", session)).service, "AIRTIME");
  assert.deepEqual(observed, [session, session]);
});
