const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const money = (value) => {
  const amount = Number(value || 0);
  return `₦${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const baseTemplate = ({
  title,
  greeting = 'Hello',
  message = '',
  details = [],
  buttonText = '',
  buttonUrl = '',
  footerMessage = '',
}) => {
  const rows = details
    .filter((item) => item && item.label && item.value !== undefined)
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 0;color:#64748b;font-size:14px;">
            ${escapeHtml(item.label)}
          </td>
          <td style="padding:10px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">
            ${escapeHtml(item.value)}
          </td>
        </tr>
      `
    )
    .join('');

  const button =
    buttonText && buttonUrl
      ? `
        <div style="margin:28px 0;text-align:center;">
          <a href="${escapeHtml(buttonUrl)}"
             style="background:#08783E;color:#ffffff;text-decoration:none;
             padding:13px 24px;border-radius:10px;font-weight:700;
             display:inline-block;">
             ${escapeHtml(buttonText)}
          </a>
        </div>
      `
      : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>

<body style="margin:0;padding:0;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0"
       style="background:#f4f7f6;padding:30px 12px;">
<tr>
<td align="center">

<table width="100%" cellpadding="0" cellspacing="0"
       style="max-width:600px;background:#ffffff;border-radius:18px;
       overflow:hidden;box-shadow:0 6px 30px rgba(15,23,42,.08);">

<tr>
<td style="background:#08783E;padding:28px 30px;text-align:center;">
  <img
    src="https://api.servicepay.ng/api/public/servicepay-logo.png"
    alt="ServicePay"
    width="170"
    style="display:block;margin:0 auto 12px auto;max-width:170px;height:auto;border:0;"
  />
  <div style="font-size:13px;color:#d9f5e5;margin-top:6px;">
    One Platform, Many Solutions.
  </div>
</td>
</tr>

<tr>
<td style="padding:34px 30px;">

<h2 style="margin:0 0 18px;color:#0f172a;font-size:23px;">
  ${escapeHtml(title)}
</h2>

<p style="font-size:15px;line-height:1.7;color:#334155;margin:0 0 12px;">
  ${escapeHtml(greeting)},
</p>

<p style="font-size:15px;line-height:1.7;color:#475569;margin:0 0 22px;">
  ${escapeHtml(message)}
</p>

${
  rows
    ? `
<table width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8fafc;border-radius:12px;padding:8px 16px;margin:20px 0;">
  ${rows}
</table>
`
    : ''
}

${button}

${
  footerMessage
    ? `
<p style="font-size:14px;line-height:1.6;color:#64748b;margin-top:24px;">
  ${escapeHtml(footerMessage)}
</p>
`
    : ''
}

<div style="border-top:1px solid #e2e8f0;margin-top:30px;padding-top:20px;">
<p style="font-size:12px;line-height:1.6;color:#94a3b8;margin:0;">
For your security, ServicePay will never ask you to send your password,
transaction PIN or OTP by email.
</p>
</div>

</td>
</tr>

<tr>
<td style="background:#f8fafc;padding:20px;text-align:center;">
<p style="font-size:12px;color:#94a3b8;margin:0;">
© ${new Date().getFullYear()} ServicePay. All rights reserved.
</p>
</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
};

const welcomeEmail = ({ name }) => ({
  subject: 'Welcome to ServicePay',
  html: baseTemplate({
    title: 'Welcome to ServicePay',
    greeting: `Hello ${name || 'Customer'}`,
    message:
      'Your ServicePay account has been created successfully. You can now access our services from one secure platform.',
    buttonText: 'Open ServicePay',
    buttonUrl: process.env.FRONTEND_URL || 'https://servicepay.ng',
    footerMessage:
      'Thank you for choosing ServicePay. We are committed to making everyday services simple, secure and reliable.',
  }),
});

const transactionEmail = ({
  name,
  type,
  direction,
  amount,
  reference,
  status,
  date,
  balance,
  counterparty,
  provider,
  serviceDetails,
  message,
}) => ({
  subject: (() => {
    const transactionType = String(type || 'Transaction')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const finalStatus = String(status || 'Update').toUpperCase();
    const statusLabel =
      finalStatus === 'SUCCESSFUL'
        ? 'Successful'
        : finalStatus === 'PENDING'
        ? 'Received'
        : finalStatus === 'REFUNDED'
        ? 'Refunded'
        : finalStatus.charAt(0) +
          finalStatus.slice(1).toLowerCase();

    if (
      transactionType.toUpperCase().includes('WITHDRAWAL') &&
      finalStatus === 'PENDING'
    ) {
      return 'ServicePay Withdrawal Request Received';
    }

    if (direction === 'CREDIT') {
      return `ServicePay Wallet Credit – ${money(amount)}`;
    }

    return `ServicePay ${transactionType} ${statusLabel} – ${money(amount)}`;
  })(),
  html: baseTemplate({
    title:
      direction === 'CREDIT'
        ? 'Wallet Credit Notification'
        : direction === 'DEBIT'
        ? 'Transaction Receipt'
        : 'Transaction Notification',
    greeting: `Hello ${name || 'Customer'}`,
    message:
      message ||
      (direction === 'CREDIT'
        ? 'Your ServicePay wallet has been credited.'
        : direction === 'DEBIT'
        ? 'A debit transaction was recorded on your ServicePay account.'
        : 'There has been an update on your ServicePay transaction.'),
    details: [
      { label: 'Service', value: type || 'Transaction' },
      ...(direction
        ? [{ label: 'Type', value: direction }]
        : []),
      { label: 'Amount', value: money(amount) },
      { label: 'Reference', value: reference || 'N/A' },
      { label: 'Status', value: status || 'N/A' },
      ...(counterparty
        ? [{ label: 'Sender / Recipient', value: counterparty }]
        : []),
      ...(provider
        ? [{ label: 'Provider', value: provider }]
        : []),
      ...(serviceDetails
        ? [{ label: 'Details', value: serviceDetails }]
        : []),
      ...(balance !== null &&
      balance !== undefined
        ? [{ label: 'Wallet Balance', value: money(balance) }]
        : []),
      {
        label: 'Date',
        value: new Date(
          date || Date.now()
        ).toLocaleString('en-NG', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Africa/Lagos',
        }),
      },
    ],
    buttonText: 'View ServicePay',
    buttonUrl: process.env.FRONTEND_URL || 'https://servicepay.ng',
    footerMessage:
      'Need help with this transaction? Contact ServicePay support at support@servicepay.ng.',
  }),
});

const walletEmail = ({
  name,
  type,
  amount,
  balance,
  reference,
  status = 'SUCCESSFUL',
}) => ({
  subject: `ServicePay Wallet ${type || 'Notification'}`,
  html: baseTemplate({
    title: `Wallet ${type || 'Notification'}`,
    greeting: `Hello ${name || 'Customer'}`,
    message: 'Your ServicePay wallet has been updated.',
    details: [
      { label: 'Type', value: type || 'Wallet Transaction' },
      { label: 'Amount', value: money(amount) },
      { label: 'Wallet Balance', value: money(balance) },
      { label: 'Reference', value: reference || 'N/A' },
      { label: 'Status', value: status },
    ],
  }),
});

const kycEmail = ({
  name,
  tier,
  status,
  reason,
}) => ({
  subject: `ServicePay KYC ${status || 'Update'}`,
  html: baseTemplate({
    title: 'KYC Verification Update',
    greeting: `Hello ${name || 'Customer'}`,
    message:
      status === 'APPROVED'
        ? 'Your ServicePay KYC verification has been approved successfully.'
        : status === 'REJECTED'
        ? 'Your ServicePay KYC verification requires your attention.'
        : 'We have received your ServicePay KYC verification request.',
    details: [
      { label: 'KYC Level', value: tier || 'N/A' },
      { label: 'Status', value: status || 'PENDING' },
      ...(reason ? [{ label: 'Reason', value: reason }] : []),
    ],
    buttonText: 'Open ServicePay',
    buttonUrl: process.env.FRONTEND_URL || 'https://servicepay.ng',
  }),
});

const withdrawalEmail = ({
  name,
  amount,
  reference,
  status,
  reason,
}) => ({
  subject: `ServicePay Withdrawal ${status || 'Update'}`,
  html: baseTemplate({
    title: 'Withdrawal Notification',
    greeting: `Hello ${name || 'Customer'}`,
    message: 'There has been an update on your withdrawal request.',
    details: [
      { label: 'Amount', value: money(amount) },
      { label: 'Reference', value: reference || 'N/A' },
      { label: 'Status', value: status || 'PENDING' },
      ...(reason ? [{ label: 'Message', value: reason }] : []),
    ],
  }),
});

const empowermentEmail = ({
  name,
  programName,
  amount,
  reference,
  status,
  message,
}) => ({
  subject: `ServicePay Empowerment ${status || 'Update'}`,
  html: baseTemplate({
    title: 'ServicePay Empowerment',
    greeting: `Hello ${name || 'Beneficiary'}`,
    message:
      message ||
      'There has been an update regarding your ServicePay Empowerment application.',
    details: [
      { label: 'Programme', value: programName || 'N/A' },
      ...(amount !== undefined
        ? [{ label: 'Amount', value: money(amount) }]
        : []),
      ...(reference
        ? [{ label: 'Reference', value: reference }]
        : []),
      { label: 'Status', value: status || 'PENDING' },
    ],
    buttonText: 'Open ServicePay',
    buttonUrl: process.env.FRONTEND_URL || 'https://servicepay.ng',
  }),
});

const securityEmail = ({
  name,
  action,
  date,
}) => ({
  subject: 'ServicePay Security Alert',
  html: baseTemplate({
    title: 'Security Alert',
    greeting: `Hello ${name || 'Customer'}`,
    message:
      'A security-related action was detected on your ServicePay account.',
    details: [
      { label: 'Action', value: action || 'Account activity' },
      {
        label: 'Date',
        value: date || new Date().toLocaleString('en-NG'),
      },
    ],
    footerMessage:
      'If you did not perform this action, please contact ServicePay support immediately.',
  }),
});

module.exports = {
  baseTemplate,
  welcomeEmail,
  transactionEmail,
  walletEmail,
  kycEmail,
  withdrawalEmail,
  empowermentEmail,
  securityEmail,
};
