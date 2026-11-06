// Support projections are an allowlist, never a redacted copy of provider JSON.
const maskPhone = (v) => v ? `••••${String(v).slice(-4)}` : "";
const maskEmail = (v) => {
  const [name, domain] = String(v || "").split("@");
  return domain ? `${name.slice(0, 1)}•••@${domain}` : "";
};
const safeCode = (v) => {
  const code = String(v || "").toUpperCase();
  return [
    "IP_NOT_WHITELISTED", "UNAUTHORIZED", "AUTHENTICATION_FAILED",
    "TIMEOUT", "ETIMEDOUT", "NOT_FOUND", "INSUFFICIENT_BALANCE",
    "PROVIDER_UNAVAILABLE", "UNKNOWN", "FAILED", "PENDING", "SUCCESS", "SUCCESSFUL",
  ].includes(code) ? code : "";
};
const diagnostic = (code, status) => {
  if (code === "IP_NOT_WHITELISTED") return "Provider rejected the hosting IP. Escalate to Operations.";
  if (["UNAUTHORIZED", "AUTHENTICATION_FAILED"].includes(code)) return "Provider authorization requires Operations review.";
  if (["TIMEOUT", "ETIMEDOUT", "UNKNOWN", "NOT_FOUND"].includes(code)) return "Provider outcome is not confirmed. Do not repeat the request.";
  if (status === "FAILED") return "Recorded failure. Operations must review the original provider evidence.";
  if (status === "PENDING") return "Outcome pending. Escalate for review; this does not authorize a retry.";
  return "Recorded status only. No provider request was made by this investigation.";
};
const account = (v = {}) => {
  const status = v.status || "NOT_CREATED";
  const errorCode = safeCode(v.failureReason);
  return {
    status, bankName: v.bankName || "",
    maskedAccountNumber: v.accountNumber ? `••••••${String(v.accountNumber).slice(-4)}` : "",
    updatedAt: v.updatedAt || v.createdAt || null,
    errorCode, message: diagnostic(errorCode, status),
  };
};
const isSupportAgent = (req) => !req.staffAccess?.isHeadOffice &&
  req.staffAccess?.roleName === "CUSTOMER_SUPPORT";
module.exports = { maskPhone, maskEmail, safeCode, diagnostic, account, isSupportAgent };
