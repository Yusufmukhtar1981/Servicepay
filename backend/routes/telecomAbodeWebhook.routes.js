const express = require("express");

const router = express.Router();

const isFiniteNonNegativeNumber = (value) => {
  if (typeof value === "string" && value.trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
};

const isValidNotification = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  return (
    typeof payload.status === "string" &&
    payload.status.trim().length > 0 &&
    typeof payload["request-id"] === "string" &&
    payload["request-id"].trim().length > 0 &&
    typeof payload.api_response === "string" &&
    payload.api_response.trim().length > 0 &&
    isFiniteNonNegativeNumber(payload.amount) &&
    Number(payload.amount) > 0 &&
    isFiniteNonNegativeNumber(payload.old_wallet) &&
    isFiniteNonNegativeNumber(payload.new_wallet)
  );
};

router.post("/", (req, res) => {
  if (!isValidNotification(req.body)) {
    return res.status(400).json({ error: "INVALID_WEBHOOK_PAYLOAD" });
  }

  // The supplied provider contract documents no signature/authentication
  // mechanism. Never trust or apply an unsigned notification to transaction
  // or wallet state; fail closed until verification is documented.
  return res.status(503).json({
    error: "WEBHOOK_VERIFICATION_UNAVAILABLE",
  });
});

module.exports = router;