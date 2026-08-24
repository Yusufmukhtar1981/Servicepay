const UNAVAILABLE_MESSAGE =
  "I can’t verify that from the information currently available. Please contact ServicePay Support for assistance.";

const SUPPORT_WHATSAPP = "+2348026114645";
const SERVICEPAY_WEBSITE = "servicepay.ng";

const knowledgeEntries = [
  {
    keywords: [
      "transaction pending",
      "pending transaction",
      "pending transfer",
      "transfer pending",
      "pending",
    ],
    reply:
      "I can’t verify a transaction status from this chat. Please open your transaction history and check the reference and current status. If it remains pending, contact ServicePay Support on WhatsApp at +2348026114645 with the reference. Never share your password, OTP or transaction PIN.",
  },
  {
    keywords: [
      "successful but not received",
      "success but not received",
      "data successful",
      "data not received",
      "airtime not received",
      "not received",
    ],
    reply:
      "If a service shows successful but has not been received, first confirm the phone number or account details and allow a short time for the provider to update. Do not retry if you may be charged twice. If it is still missing, contact ServicePay Support on WhatsApp at +2348026114645 with the transaction reference so the team can investigate.",
  },
  {
    keywords: [
      "reset transaction pin",
      "forgot transaction pin",
      "change transaction pin",
      "transaction pin",
    ],
    reply:
      "You can manage your transaction PIN from the security or profile area in the ServicePay app. ServicePay AI Support will never ask you to share the PIN. If you cannot reset it there, contact human support without sending the PIN, OTP or password.",
  },
  {
    keywords: [
      "withdrawal",
      "withdraw",
      "cash out",
    ],
    reply:
      "Withdrawal is a request flow and may require approval or processing before it is completed. Submit the request in the ServicePay app and monitor its status in withdrawal history. I cannot approve a withdrawal or confirm one has succeeded from this chat.",
  },
  {
    keywords: [
      "empowerment",
      "benefit program",
      "grant program",
      "how does servicepay empowerment work",
    ],
    reply:
      "ServicePay Empowerment lets customers discover available programs, apply where eligible, and track applications and benefits. Program Sponsor is a separate area for organizations managing programs; it is not required for ordinary customer Empowerment access.",
  },
  {
    keywords: [
      "contact human",
      "human support",
      "customer support",
      "whatsapp",
      "speak to someone",
      "agent",
    ],
    reply:
      `You can contact ServicePay human support on WhatsApp at ${SUPPORT_WHATSAPP}. Please use the message “Hello ServicePay Support, I need assistance with my ServicePay account.” Never include your password, OTP, transaction PIN, card PIN, CVV, BVN or NIN.`,
  },
  {
    keywords: ["wallet funding", "fund wallet", "top up", "wallet"],
    reply:
      "Wallet Funding is available in ServicePay for adding money to your wallet through the supported funding flow. Review the amount and funding status in the app. If money was deducted without the wallet updating, do not retry immediately; keep the reference and contact human support.",
  },
  {
    keywords: ["airtime", "recharge"],
    reply:
      "ServicePay supports Airtime purchases. Confirm the network, phone number and amount before submitting. A completed purchase should be checked in transaction history; I cannot invent or confirm a status that the backend has not verified.",
  },
  {
    keywords: ["data", "internet bundle", "data bundle"],
    reply:
      "ServicePay supports Data purchases. Confirm the network, phone number and plan before submitting. If a purchase is marked successful but the data is missing, do not retry immediately; contact support with the transaction reference.",
  },
  {
    keywords: ["electricity", "power bill", "meter"],
    reply:
      "ServicePay supports Electricity payments. Confirm the provider, meter details and amount before submitting. Keep the transaction reference if the provider does not update your account.",
  },
  {
    keywords: ["cable", "dstv", "gotv", "startimes", "cable tv"],
    reply:
      "ServicePay supports Cable TV payments. Confirm the provider, smart-card or decoder number and plan before submitting. Keep the transaction reference if the subscription does not update.",
  },
  {
    keywords: ["exam pin", "waec", "neco", "jamb"],
    reply:
      "ServicePay supports Exam PIN purchases. Review the examination body, quantity and amount before confirming, then keep the purchase details in your transaction history.",
  },
  {
    keywords: ["nin", "bvn", "kyc", "verification", "identity"],
    reply:
      "ServicePay provides KYC and identity-verification flows. I cannot approve KYC or verify an identity from chat. Follow the in-app verification instructions and contact support if your submission needs attention. Never send a full BVN, NIN, OTP or other secret credential here.",
  },
  {
    keywords: ["delivery", "logistics", "rider", "courier"],
    reply:
      "ServicePay supports Delivery and logistics services. Review the delivery details and status in the relevant app flow. Contact support with the order reference if you need an update that is not shown.",
  },
  {
    keywords: ["transfer", "send money", "servicepay transfer"],
    reply:
      "ServicePay supports ServicePay-to-ServicePay transfers. Confirm the recipient and amount before submitting, and review the result in transaction history. I cannot execute a transfer or claim one succeeded from chat.",
  },
  {
    keywords: ["qr pay", "scan to pay", "qr"],
    reply:
      "QR Pay lets you use the ServicePay QR payment flow. Confirm the recipient and amount on the confirmation screen before completing the payment. I cannot execute or confirm a QR payment from chat.",
  },
  {
    keywords: ["register", "registration", "login", "sign in", "account"],
    reply:
      "Use the ServicePay app registration or sign-in flow with your own account details. If you cannot access your account, use the available recovery path or contact support. ServicePay will never ask you to disclose your password or OTP in chat.",
  },
];

const normalizeForSearch = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const getFallbackReply = (message) => {
  const normalized = normalizeForSearch(message);
  const match = knowledgeEntries.find((entry) =>
    entry.keywords.some((keyword) => normalized.includes(keyword))
  );

  if (match) {
    return match.reply;
  }

  return `${UNAVAILABLE_MESSAGE} You can also learn more about ServicePay services at ${SERVICEPAY_WEBSITE}.`;
};

module.exports = {
  SERVICEPAY_WEBSITE,
  SUPPORT_WHATSAPP,
  UNAVAILABLE_MESSAGE,
  getFallbackReply,
  knowledgeEntries,
};