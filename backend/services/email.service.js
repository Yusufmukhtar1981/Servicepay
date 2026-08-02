const nodemailer = require("nodemailer");

const requiredEnvironmentVariables = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
];

const getMissingEnvironmentVariables = () => {
  return requiredEnvironmentVariables.filter(
    (name) =>
      !process.env[name] ||
      String(process.env[name]).trim() === ""
  );
};

const smtpPort = Number(process.env.SMTP_PORT || 465);

const smtpSecure =
  String(
    process.env.SMTP_SECURE ??
      (smtpPort === 465 ? "true" : "false")
  ).toLowerCase() === "true";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,
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
      `Missing email configuration: ${missingVariables.join(
        ", "
      )}`
    );
  }

  if (!to || String(to).trim() === "") {
    throw new Error("Email recipient is required.");
  }

  const from =
    process.env.EMAIL_FROM ||
    `ServicePay <${process.env.SMTP_USER}>`;

  return transporter.sendMail({
    from,
    to: String(to).trim().toLowerCase(),
    subject,
    text,
    html,
  });
};

const verifyEmailConnection = async () => {
  const missingVariables =
    getMissingEnvironmentVariables();

  if (missingVariables.length > 0) {
    return {
      success: false,
      message: `Missing email configuration: ${missingVariables.join(
        ", "
      )}`,
    };
  }

  try {
    await transporter.verify();

    return {
      success: true,
      message: "SMTP connection verified successfully.",
    };
  } catch (error) {
    return {
      success: false,
      message:
        error?.message ||
        "Unable to connect to the SMTP server.",
    };
  }
};

module.exports = {
  sendEmail,
  verifyEmailConnection,
};
