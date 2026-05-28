const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmailOTP(email, code) {
  const response = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Your JeezPay verification code",

    html: `
      <div style="
        max-width:480px;
        margin:auto;
        padding:32px;
        font-family:Arial,sans-serif;
        background:#ffffff;
        border:1px solid #e5e7eb;
        border-radius:18px;
      ">

        <h2 style="
          margin:0 0 12px 0;
          color:#111827;
        ">
          JeezPay Security
        </h2>

        <p style="
          color:#4b5563;
          font-size:15px;
          margin-bottom:24px;
        ">
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

        <p style="
          color:#6b7280;
          font-size:14px;
        ">
          This code expires in 5 minutes.
        </p>

        <p style="
          color:#9ca3af;
          font-size:12px;
          margin-top:30px;
        ">
          If you did not request this code, you can safely ignore this email.
        </p>

      </div>
    `,
  });

  console.log("Resend email result:", response);

  return response;
}

module.exports = {
  sendEmailOTP,
};