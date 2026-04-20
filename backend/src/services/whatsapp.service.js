const axios = require("axios");

const USE_MOCK_OTP = process.env.USE_MOCK_OTP === "true";
const MOCK_OTP = process.env.MOCK_OTP || "123456";

async function sendWhatsAppOTP(phone, otp) {
  try {
    if (USE_MOCK_OTP) {
      console.log("🧪 MOCK OTP MODE ENABLED");
      console.log(`📲 Mock OTP for ${phone}: ${MOCK_OTP}`);
      return {
        success: true,
        mock: true,
        phone,
        otp: MOCK_OTP,
      };
    }

    if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_TOKEN) {
      throw new Error(
        "Missing WhatsApp env vars: WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN"
      );
    }

    const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: phone.replace("+", ""),
      type: "template",
      template: {
        name: "otp_code",
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

    return {
      success: true,
      mock: false,
      data: response.data,
    };
  } catch (err) {
    console.error("WhatsApp OTP error:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendWhatsAppOTP, USE_MOCK_OTP, MOCK_OTP };