const axios = require("axios");

const DEFAULT_TIMEOUT_MS = 15000;

const getProviderConfig = () => ({
  provider: String(process.env.AI_PROVIDER || "")
    .trim()
    .toLowerCase(),
  apiKey: String(process.env.AI_API_KEY || "").trim(),
  model: String(process.env.AI_MODEL || "gpt-4o-mini").trim(),
  apiUrl: String(
    process.env.AI_API_URL ||
      "https://api.openai.com/v1/chat/completions"
  ).trim(),
});

const getProviderReply = async ({
  systemPrompt,
  message,
  history = [],
  requester = axios,
} = {}) => {
  const config = getProviderConfig();

  if (!config.provider || !config.apiKey) {
    return null;
  }

  if (
    !["openai", "openai-compatible", "openai_compatible"].includes(
      config.provider
    )
  ) {
    throw new Error(`Unsupported AI provider: ${config.provider}`);
  }

  const safeHistory = Array.isArray(history)
    ? history
        .filter(
          (item) =>
            (item?.role === "USER" || item?.role === "ASSISTANT") &&
            typeof item?.message === "string"
        )
        .slice(-10)
        .map((item) => ({
          role: item.role === "USER" ? "user" : "assistant",
          content: item.message,
        }))
    : [];

  const response = await requester.post(
    config.apiUrl,
    {
      model: config.model,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...safeHistory,
        {
          role: "user",
          content: message,
        },
      ],
    },
    {
      timeout: Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
    }
  );

  const reply = response?.data?.choices?.[0]?.message?.content;

  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("AI provider returned an invalid response.");
  }

  return reply;
};

module.exports = {
  DEFAULT_TIMEOUT_MS,
  getProviderConfig,
  getProviderReply,
};