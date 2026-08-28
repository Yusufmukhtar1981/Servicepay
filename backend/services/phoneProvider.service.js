/*
 * Deliberately non-enforcing provider boundary. Live provider credentials and
 * explicit approval are required before any adapter can issue a lock command.
 */
const requestProviderAction = async ({ action, provider = "NONE", device }) => ({
  provider: ["NONE", "SAMSUNG_KNOX_GUARD", "EXTERNAL_FINANCING_PROVIDER"].includes(provider)
    ? provider : "NONE",
  outcome: "DISABLED",
  response: {
    message: "Provider enforcement is disabled; no device lock or restore was performed.",
    action,
    deviceReference: device?.reference || null,
  },
});

module.exports = { requestProviderAction };