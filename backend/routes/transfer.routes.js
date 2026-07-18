const express = require("express");
const router = express.Router();

router.post("/servicepay", async (req, res) => {
  try {
    const { sender, receiver, amount } = req.body;

    if (!sender || !receiver || !amount) {
      return res.status(400).json({
        success: false,
        message: "Sender, receiver da amount suna da bukata.",
      });
    }

    // A nan daga baya za mu haɗa da database
    return res.json({
      success: true,
      message: `₦${amount} transferred successfully to ${receiver}`,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;