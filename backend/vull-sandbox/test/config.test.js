const test = require("node:test");
const assert = require("node:assert/strict");
const { config, fingerprint } = require("../config");
const identity = { host: "sandbox.example", database: "vull_sandbox" };
const base = { VULL_ENV:"sandbox", VULL_SANDBOX_MONGODB_URI:"mongodb://sandbox.example/vull_sandbox", VULL_SANDBOX_MONGO_ALLOWED_HOSTS:"sandbox.example", VULL_SANDBOX_MONGO_DATABASE:"vull_sandbox", VULL_PRODUCTION_MONGO_FINGERPRINTS:"not-a-match", VULL_SANDBOX_AUTH_PEPPER:"pepper", VULL_SANDBOX_WEBHOOK_SIGNING_SECRET:"secret" };
test("strict sandbox config accepts explicit isolated boundary and safe balance default", () => {
  assert.equal(config(base).port, 3003);
  assert.equal(config(base).initialBalanceMinor, 10_000_000);
});
test("uses Replit PORT and bounds the initial simulated balance", () => {
  assert.equal(config({...base,PORT:"8080"}).port, 8080);
  assert.equal(config({...base,VULL_SANDBOX_INITIAL_BALANCE_MINOR:"0"}).initialBalanceMinor, 0);
  assert.throws(() => config({...base,VULL_SANDBOX_INITIAL_BALANCE_MINOR:"100000001"}), /VULL_SANDBOX_INITIAL_BALANCE_MINOR/);
});
for (const key of ["MONGODB_URI", "DATABASE_URL", "MONGO_URL", "PRODUCTION_MONGODB_URI"]) test(`rejects inherited ${key}`, () => assert.throws(() => config({...base,[key]:"mongodb://live/live"}), /must not inherit/));
for (const key of ["VULL_SANDBOX_MONGO_ALLOWED_HOSTS","VULL_SANDBOX_MONGO_DATABASE","VULL_PRODUCTION_MONGO_FINGERPRINTS"]) test(`requires ${key}`, () => assert.throws(() => config({...base,[key]:""}), /required/));
test("rejects host, database and production fingerprint mismatch", () => {
  assert.throws(() => config({...base,VULL_SANDBOX_MONGO_ALLOWED_HOSTS:"other.example"}), /allowlisted/);
  assert.throws(() => config({...base,VULL_SANDBOX_MONGO_DATABASE:"other_sandbox"}), /does not match/);
  assert.throws(() => config({...base,VULL_PRODUCTION_MONGO_FINGERPRINTS:fingerprint(identity)}), /fingerprint/);
});