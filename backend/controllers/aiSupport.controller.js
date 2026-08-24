const AppSettings = require("../models/appSettings.model");
const AISupportConversation = require(
  "../models/aiSupportConversation.model"
);
const {
  SECURITY_WARNING,
  containsSensitiveCredential,
  createSupportReply,
  redactSensitiveText,
  sanitizeText,
} = require("../services/aiSupport.service");

const MAX_INPUT_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 100;
const AI_DISABLED_MESSAGE =
  "AI Support is temporarily unavailable. Please contact ServicePay Support.";

const getUserId = (req) => req.user?._id || req.user?.id || null;

const getSupportSettings = async () => {
  const settings = await AppSettings.getGlobalSettings();
  return settings.support || {};
};

const getConversationMessages = (conversation) =>
  Array.isArray(conversation?.messages)
    ? conversation.messages
        .filter(
          (message) =>
            !containsSensitiveCredential(message?.message)
        )
        .slice(-20)
        .map((message) => ({
          role: message.role,
          message: redactSensitiveText(message.message),
          createdAt: message.createdAt,
        }))
    : [];

const getSafeHistoryMessages = (conversation) =>
  Array.isArray(conversation?.messages)
    ? conversation.messages
        .filter(
          (message) =>
            !containsSensitiveCredential(message?.message)
        )
        .map((message) => ({
          role: message.role,
          message: redactSensitiveText(message.message),
          createdAt: message.createdAt,
        }))
    : [];

const appendMessages = async (userId, messages) =>
  AISupportConversation.findOneAndUpdate(
    { userId },
    {
      $push: {
        messages: {
          $each: messages,
          $slice: -MAX_HISTORY_MESSAGES,
        },
      },
      $set: {
        updatedAt: new Date(),
      },
      $setOnInsert: {
        userId,
      },
    },
    {
      returnDocument: "after",
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

const disabledResponse = (res) =>
  res.status(503).json({
    success: false,
    code: "AI_SUPPORT_DISABLED",
    message: AI_DISABLED_MESSAGE,
  });

exports.chat = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const settings = await getSupportSettings();

    if (settings.aiSupportEnabled === false) {
      return disabledResponse(res);
    }

    const rawMessage = req.body?.message;

    if (typeof rawMessage !== "string") {
      return res.status(400).json({
        success: false,
        message: "Enter a message for AI Support.",
      });
    }

    const message = sanitizeText(rawMessage, MAX_INPUT_LENGTH);

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Enter a message for AI Support.",
      });
    }

    if (rawMessage.length > MAX_INPUT_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message cannot exceed ${MAX_INPUT_LENGTH} characters.`,
      });
    }

    const existingConversation = await AISupportConversation.findOne({
      userId,
    }).lean();

    if (containsSensitiveCredential(message)) {
      const conversation = await appendMessages(userId, [
        {
          role: "ASSISTANT",
          message: SECURITY_WARNING,
          createdAt: new Date(),
        },
      ]);

      return res.status(200).json({
        success: true,
        reply: SECURITY_WARNING,
        conversationId: String(conversation._id),
        escalationRecommended: true,
      });
    }

    const result = await createSupportReply({
      message,
      history: getConversationMessages(existingConversation),
    });

    const conversation = await appendMessages(userId, [
      {
        role: "USER",
        message,
        createdAt: new Date(),
      },
      {
        role: "ASSISTANT",
        message: result.reply,
        createdAt: new Date(),
      },
    ]);

    return res.status(200).json({
      success: true,
      reply: result.reply,
      conversationId: String(conversation._id),
      escalationRecommended: result.escalationRecommended,
    });
  } catch (error) {
    console.error("AI Support chat error:", error);

    return res.status(503).json({
      success: false,
      message:
        "AI Support is temporarily unavailable. Please contact ServicePay Support.",
    });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const settings = await getSupportSettings();
    const conversation = await AISupportConversation.findOne({
      userId,
    }).lean();

    return res.status(200).json({
      success: true,
      aiSupportEnabled: settings.aiSupportEnabled !== false,
      humanEscalationEnabled: settings.humanEscalationEnabled !== false,
      conversationId: conversation ? String(conversation._id) : null,
      messages: getSafeHistoryMessages(conversation),
    });
  } catch (error) {
    console.error("AI Support history error:", error);

    return res.status(503).json({
      success: false,
      message: "Unable to load AI Support history right now.",
    });
  }
};

exports.deleteHistory = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    await AISupportConversation.deleteOne({ userId });

    return res.status(200).json({
      success: true,
      message: "AI Support chat history cleared.",
    });
  } catch (error) {
    console.error("AI Support history deletion error:", error);

    return res.status(503).json({
      success: false,
      message: "Unable to clear AI Support history right now.",
    });
  }
};

module.exports.AI_DISABLED_MESSAGE = AI_DISABLED_MESSAGE;