const express = require("express");
const router = express.Router();

const {
  DEFAULT_COUNTRY_CODE,
  getCountryProductConfiguration,
} = require("../services/capability.service");

// Public launch/product configuration used by clients to decide which wallet
// products and actions to display. Enforcement still happens server-side.
router.get("/capabilities", async (req, res) => {
  try {
    const countryCode = String(
      req.query.country || DEFAULT_COUNTRY_CODE
    )
      .trim()
      .toUpperCase();

    const config = await getCountryProductConfiguration(countryCode);

    return res.json(config);
  } catch (error) {
    console.error("[products/capabilities] error:", error);
    return res.status(500).json({
      message: "Failed to load product capabilities",
    });
  }
});

module.exports = router;
