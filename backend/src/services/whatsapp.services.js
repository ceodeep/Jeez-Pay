const axios = require("axios");

async function sendWhatsAppOTP(phone, otp) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: phone.replace("+", ""),
    type: "template",
    template: {
      name: "otp_code", // 🔥 MUST match your approved template
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: otp }],
        },
      ],
    },
  };

  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

module.exports = { sendWhatsAppOTP };