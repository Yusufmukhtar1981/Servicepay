"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const provider = require("../services/expenseManagement.documentProvider");
for (const [mime, bytes] of [
  ["application/pdf", Buffer.from("%PDF-1.4\noriginal evidence\n%%EOF")],
  ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
  ["image/jpeg", Buffer.from([255, 216, 255, 224, 0, 1])],
]) test(`${mime} evidence is private raw storage with exact unchanged original bytes`, async () => {
  let configurationCalled = false, options;
  const key = "servicepay/company-expenses/isolated-original";
  const result = await provider.uploadOne({ mimetype: mime, buffer: bytes }, "", { publicId: key }, {
    configure: () => { configurationCalled = true; },
    uploader: { upload_stream: (input, done) => {
      options = input;
      return { end: actual => { assert.deepEqual(actual, bytes); done(null, { public_id: key }); } };
    } },
  });
  assert.equal(configurationCalled, true);
  assert.deepEqual(options, { public_id: key, resource_type: "raw", type: "authenticated", overwrite: false });
  assert.equal(result.assetId, key);
});
