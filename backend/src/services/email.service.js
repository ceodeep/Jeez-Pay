const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_APP_PASSWORD,
  },
});

async function sendEmailOTP(email, code) {
  await transporter.sendMail({
    from: `"JeezPay" <${process.env.SMTP_EMAIL}>`,
    to: email,
    subject: "Your JeezPay verification code",
    html: `
      <div style="font-family:sans-serif;padding:20px">
        <h2>JeezPay Verification</h2>
        <p>Your verification code is:</p>
        <h1 style="letter-spacing:4px">${code}</h1>
        <p>This code expires in 5 minutes.</p>
      </div>
    `,
  });
}

module.exports = {
  sendEmailOTP,
};