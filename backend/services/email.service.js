const https = require("https");

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

const requiredEnvironmentVariables = [
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
];

const getMissingEnvironmentVariables = () =>
  requiredEnvironmentVariables.filter(
    (name) =>
      !process.env[name] ||
      String(process.env[name]).trim() === ""
  );

const sendBrevoRequest = (payload) =>
  new Promise((resolve, reject) => {
    const apiKey = String(
      process.env.BREVO_API_KEY || ""
    ).trim();

    const body = JSON.stringify(payload);

    const request = https.request(
      BREVO_API_URL,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": apiKey,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (response) => {
        let responseBody = "";

        response.on("data", (chunk) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          let parsedResponse = {};

          try {
            parsedResponse = responseBody
              ? JSON.parse(responseBody)
              : {};
          } catch (_) {
            parsedResponse = {
              message: responseBody,
            };
          }

          if (
            response.statusCode >= 200 &&
            response.statusCode < 300
          ) {
            return resolve(parsedResponse);
          }

          const error = new Error(
            parsedResponse.message ||
              `Brevo returned status ${response.statusCode}.`
          );

          error.statusCode = response.statusCode;
          error.response = parsedResponse;

          return reject(error);
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(
        new Error("Brevo email request timed out.")
      );
    });

    request.on("error", reject);

    request.write(body);
    request.end();
  });

const sendEmail = async ({
  to,
  subject,
  text,
  html,
}) => {
  const missingVariables =
    getMissingEnvironmentVariables();

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing Brevo configuration: ${missingVariables.join(
        ", "
      )}`
    );
  }

  const recipient = String(to || "")
    .trim()
    .toLowerCase();

  if (!recipient) {
    throw new Error("Email recipient is required.");
  }

  const senderEmail = String(
    process.env.BREVO_SENDER_EMAIL
  )
    .trim()
    .toLowerCase();

  const senderName = String(
    process.env.BREVO_SENDER_NAME || "ServicePay"
  ).trim();

  return sendBrevoRequest({
    sender: {
      name: senderName,
      email: senderEmail,
    },
    to: [
      {
        email: recipient,
      },
    ],
    subject,
    textContent: text,
    htmlContent: html,
  });
};

const verifyEmailConnection = async () => {
  const missingVariables =
    getMissingEnvironmentVariables();

  if (missingVariables.length > 0) {
    return {
      success: false,
      message: `Missing Brevo configuration: ${missingVariables.join(
        ", "
      )}`,
    };
  }

  return {
    success: true,
    message:
      "Brevo API configuration is available.",
  };
};

module.exports = {
  sendEmail,
  verifyEmailConnection,
};
