const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

function baseEmailTemplate({ title, body, footer }) {
  return `
    <div style="
      max-width:480px;
      margin:auto;
      padding:32px;
      font-family:Arial,sans-serif;
      background:#ffffff;
      border:1px solid #e5e7eb;
      border-radius:18px;
    ">
      <h2 style="margin:0 0 12px 0;color:#111827;">
        ${title}
      </h2>

      ${body}

      <p style="color:#9ca3af;font-size:12px;margin-top:30px;">
        ${footer || "If you did not request this, please secure your JeezPay account immediately."}
      </p>
    </div>
  `;
}

async function sendEmailOTP(email, code) {
  return resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Your JeezPay verification code",
    html: baseEmailTemplate({
      title: "JeezPay Security",
      body: `
        <p style="color:#4b5563;font-size:15px;margin-bottom:24px;">
          Your verification code is:
        </p>

        <div style="
          font-size:34px;
          font-weight:bold;
          letter-spacing:6px;
          color:#2A82EE;
          margin-bottom:24px;
        ">
          ${code}
        </div>

        <p style="color:#6b7280;font-size:14px;">
          This code expires in 5 minutes.
        </p>
      `,
      footer: "If you did not request this code, you can safely ignore this email.",
    }),
  });
}

async function sendSecurityAlertEmail(email, title, message) {
  if (!email) return;

  return resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `JeezPay Security Alert: ${title}`,
    html: baseEmailTemplate({
      title: "Security Alert",
      body: `
        <p style="color:#4b5563;font-size:15px;line-height:1.6;">
          ${message}
        </p>

        <div style="
          margin-top:22px;
          padding:14px 16px;
          background:#F3F7FF;
          border-radius:12px;
          color:#1E3A8A;
          font-size:14px;
          line-height:1.5;
        ">
          If this was you, no action is needed. If this wasn't you, please change your password immediately.
        </div>
      `,
    }),
  });
}

async function sendPasswordResetAlert(email) {
  return sendSecurityAlertEmail(
    email,
    "Password Changed",
    "Your JeezPay account password was changed successfully."
  );
}

async function sendPinResetAlert(email) {
  return sendSecurityAlertEmail(
    email,
    "PIN Reset",
    "Your JeezPay account PIN was reset successfully."
  );
}

async function sendNewLoginAlert(email, deviceName, ipAddress) {
  return sendSecurityAlertEmail(
    email,
    "New Login",
    `
      A new login was detected on your JeezPay account.<br><br>
      <strong>Device:</strong> ${deviceName || "Unknown device"}<br>
      <strong>IP Address:</strong> ${ipAddress || "Unknown"}
    `
  );
}

module.exports = {
  sendEmailOTP,
  sendSecurityAlertEmail,
  sendPasswordResetAlert,
  sendPinResetAlert,
  sendNewLoginAlert,
};