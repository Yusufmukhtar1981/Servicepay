const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getProviderCapabilities,
  serializeConfig,
} = require("../services/providerManagement.service");

const withEnvironment = async (values, run) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("Telecom Abode DATA capability is scoped; other Telecom Abode purchases stay unavailable", async () => {
  await withEnvironment({
    TELECOM_ABODE_API_KEY: "test-only-key",
  }, async () => {
    for (const service of ["AIRTIME", "DATA", "ELECTRICITY", "CABLE"]) {
      const capability = getProviderCapabilities(service, "TELECOM_ABODE");
      assert.equal(capability.credentialsConfigured, true);
      assert.equal(capability.adapterImplemented, ["DATA", "ELECTRICITY", "CABLE"].includes(service));
      assert.equal(capability.purchaseSupported, service === "DATA");
      assert.equal(capability.catalogAvailable, service === "DATA");
      assert.equal(capability.routingControlSupported, service === "DATA");
      assert.equal(capability.querySupported, false);
      assert.equal(capability.webhookSupported, false);
      assert.equal(capability.webhookVerified, false);
      assert.equal(capability.financialSafetyVerified, service === "DATA");
      assert.equal(capability.productionReady, service === "DATA");
      assert.ok(Array.isArray(capability.readinessReasons));
      assert.ok(capability.readinessReasons.length > 0);
    }
  });
});

test("Provider Management returns capabilities and keeps Telecom Abode unavailable", async () => {
  await withEnvironment({
    TELECOM_ABODE_API_KEY: "test-only-key",
    CLUBKONNECT_USER_ID: "test-club-id",
    CLUBKONNECT_API_KEY: "test-club-key",
    NELLOBYTES_USERID: "test-nello-id",
    NELLOBYTES_APIKEY: "test-nello-key",
  }, async () => {
    const config = {
      service: "ELECTRICITY",
      primaryProvider: "NELLOBYTES",
      fallbackProvider: null,
      providerStates: [
        { provider: "NELLOBYTES", enabled: true },
        { provider: "TELECOM_ABODE", enabled: false },
      ],
      updatedAt: null,
      updatedBy: null,
    };
    const serialized = serializeConfig(config);
    const legacy = serialized.providers.find((item) => item.provider === "NELLOBYTES");
    const telecomAbode = serialized.providers.find((item) => item.provider === "TELECOM_ABODE");
    assert.equal(legacy.available, true);
    assert.equal(legacy.capabilities.adapterImplemented, true);
    assert.equal(legacy.capabilities.credentialsConfigured, true);
    assert.equal(telecomAbode.available, false);
    assert.equal(telecomAbode.enabled, false);
    assert.equal(telecomAbode.capabilities.credentialsConfigured, true);
    assert.equal(telecomAbode.capabilities.productionReady, false);
    assert.ok(telecomAbode.readinessReasons.some((reason) => /query contract is undocumented/i.test(reason)));
    assert.doesNotMatch(JSON.stringify(serialized), /test-only-key|test-nello-key|test-club-key/);
  });
});