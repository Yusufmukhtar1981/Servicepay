const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexSource = fs.readFileSync(
  path.join(__dirname, "../index.js"),
  "utf8"
);

test("customer Keke ride router is mounted", () => {
  assert.match(
    indexSource,
    /app\.use\("\/api\/keke-rides", kekeRideRoutes\)/
  );
});