#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");
const { config } = require("../config");
const { createModels, initializeModels } = require("../models");
const { hash } = require("../middleware/auth");
const { assertSafeCallback } = require("../services/webhookDelivery");
(async () => {
  const cfg = config(); // guard is deliberately before DB access or secret generation
  const outputFile = String(process.env.VULL_SANDBOX_CREDENTIAL_OUTPUT_FILE || "").trim();
  if (!outputFile || !path.isAbsolute(outputFile) || path.dirname(outputFile) === path.parse(outputFile).root) throw new Error("VULL_SANDBOX_CREDENTIAL_OUTPUT_FILE must be a safe absolute file path.");
  const callbackUrl = process.argv[2] || "";
  if (callbackUrl) await assertSafeCallback(callbackUrl, cfg.nodeEnv);
  const connection = mongoose.createConnection(cfg.mongoUri); await connection.asPromise();
  const models = await initializeModels(createModels(connection));
  const apiKey = `vull_sb_${crypto.randomBytes(18).toString("hex")}`, secret = crypto.randomBytes(32).toString("base64url");
  const credential = await models.Credential.create({ environment:"SANDBOX", apiKey, secretHash:hash(secret,cfg.authPepper), callbackUrl, status:"ACTIVE" });
  await models.Wallet.create({ environment:"SANDBOX", credentialId:credential._id, balanceMinor:cfg.initialBalanceMinor });
  await fs.writeFile(outputFile, `${JSON.stringify({ environment:"SANDBOX", apiKey, apiSecret:secret })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(`Sandbox credentials written to ${outputFile}`);
  await connection.close();
})().catch(error => { console.error(`VULL sandbox provisioning failed: ${error.message}`); process.exitCode=1; });