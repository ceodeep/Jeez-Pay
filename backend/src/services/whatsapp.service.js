const axios = require("axios");

async function sendWhatsAppOTP(phone, otp) {
  try {
    const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: phone.replace("+", ""), // Meta requires no +
      type: "template",
      template: {
        name: "otp_code", // MUST match your approved template
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: otp,
              },
            ],
          },
        ],
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    console.log("WhatsApp OTP sent:", response.data);
  } catch (err) {
    console.error("WhatsApp OTP error:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendWhatsAppOTP };