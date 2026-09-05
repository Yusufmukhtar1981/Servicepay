class SandboxMockProvider {
  constructor() { this.outboundCalls = 0; }
  checkout(scenario) {
    if (!["success", "declined", "pending", "provider_error"].includes(scenario)) throw Object.assign(new Error("Unknown sandbox scenario."), { statusCode: 400 });
    if (scenario === "provider_error") throw Object.assign(new Error("Mock provider error."), { statusCode: 502 });
    return { status: scenario === "success" ? "SUCCEEDED" : scenario === "declined" ? "DECLINED" : "PENDING" };
  }
  networkOperation() { throw new Error("Production-operation tripwire: sandbox provider cannot perform network/live operations."); }
}
module.exports = { SandboxMockProvider };