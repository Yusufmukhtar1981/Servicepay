// Response-only projection. Never mutate stored records or staff responses.
const privateKey = /^(provider.*|api.*|routing.*|internal.*|upstream.*|raw(response|request|payload|data)?|requestpayload|requestheaders|responseheaders|financialaccounting|accountingstatus|actualcost|costsource|netprofit|profit|margin|invoice.*|orderid|requestid|transaction_id|niptransactionreference|dispatch.*|telecomabode.*|fingerprint)$/i;
const providerNames = /\b(telecom[\s_-]*abode|club[\s_-]*konnect|vtpass|paystack|flutterwave|monnify)\b/gi;
const fulfillmentKeys = new Set([
  "customerName", "meterNumber", "electricityCompany", "meterType", "meterToken",
  "units", "networkName", "planName", "phone", "phoneNumber", "recipientPhone",
  "bankName", "accountName", "accountNumber", "smartcardNumber", "smartCardNumber",
  "cableCompany", "packageName", "activationCode", "rechargeCode", "voucherCode",
  "serialNumber", "duration", "quantity",
]);
function fulfillmentFrom(value, depth = 0, output = {}) {
  if (!value || typeof value !== "object" || depth > 5) return output;
  for (const [key, item] of Object.entries(value)) {
    if (key === "network" && typeof item === "string" &&
        /^(MTN|GLO|AIRTEL|9MOBILE|ETISALAT)$/i.test(item)) output.networkName = item;
    if (fulfillmentKeys.has(key) && ["string", "number"].includes(typeof item) &&
        String(item).trim() !== "" && output[key] === undefined) output[key] = item;
    else if (["electricity", "cable", "fulfillment", "data"].includes(key) &&
        item && typeof item === "object") fulfillmentFrom(item, depth + 1, output);
  }
  return output;
}
function customerText(value) {
  if (/https?:\/\/\S*(?:telecomabode|clubkonnect|vtpass|paystack|flutterwave|monnify|\/api\/)\S*/i.test(String(value))) {
    return "Contact ServicePay support with your transaction reference if you need help.";
  }
  const text = String(value).replace(providerNames, "ServicePay");
  if (/\b(provider cost|accounting reconciliation|profit and commission|api key|api credential)\b/i.test(text)) {
    return "Your transaction status is shown above. Contact ServicePay support with your transaction reference if you need help.";
  }
  return text;
}
function customerResponse(value, depth = 0) {
  if (value === null || typeof value !== "object") return value;
  if (depth > 30) return null;
  if (typeof value.toJSON === "function") return customerResponse(value.toJSON(), depth + 1);
  if (Array.isArray(value)) return value.map(item => customerResponse(item, depth + 1));
  const output = {};
  if (String(value.accountingStatus || "").toUpperCase() === "COMPLETE" &&
      ["SUCCESS", "SUCCESSFUL", "COMPLETED"].includes(String(value.status || "").toUpperCase()) &&
      value.reference) output.deliveryStatus = "SUCCEEDED";
  for (const [key, item] of Object.entries(value)) {
    if (key === "providerResponse") {
      const fulfillment = fulfillmentFrom(item);
      if (Object.keys(fulfillment).length) output.fulfillment = customerResponse(fulfillment, depth + 1);
      continue;
    }
    if (key === "providerId" && value.displayName) {
      output.networkId = item; // Public carrier/DISCO selector, not an upstream transaction ID.
      continue;
    }
    if (key === "dispatchStatus") {
      output.deliveryStatus = ({ SUCCEEDED: "SUCCEEDED", FAILED: "FAILED",
        UNKNOWN: "UNKNOWN", RESPONDED: "COMPLETED" })[item] || "PROCESSING";
      continue;
    }
    if (privateKey.test(key.replace(/^_+/, "")) || /^(password|secret|authorization|accessToken|authToken|transactionPin)$/i.test(key)) continue;
    output[key] = typeof item === "string" && /^(message|description|narration|title|code)$/i.test(key)
      ? customerText(item) : customerResponse(item, depth + 1);
  }
  return output;
}
function customerResponsePrivacy(req, res, next) {
  const json = res.json;
  res.json = function (body) {
    // Authentication happens later; inspect the final authenticated role here.
    return json.call(this, String(req.user?.role || "").toUpperCase() === "CUSTOMER"
      ? customerResponse(body) : body);
  };
  next();
}
module.exports = { customerResponsePrivacy, customerResponse, fulfillmentFrom, customerText };