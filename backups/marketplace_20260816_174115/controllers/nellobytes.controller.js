const axios = require("axios");

exports.buyAirtime = async (req, res) => {
  try {
    const { mobileNetwork, amount, mobileNumber } = req.body;

    if (!mobileNetwork || !amount || !mobileNumber) {
      return res.status(400).json({
        success: false,
        message:
          "mobileNetwork, amount da mobileNumber duk suna da bukata.",
      });
    }

    const requestId = `SERVICEPAY-${Date.now()}`;

    const response = await axios.get(
      "https://www.nellobytesystems.com/APIAirtimeV1.asp",
      {
        params: {
          UserID: process.env.NELLOBYTES_USERID,
          APIKey: process.env.NELLOBYTES_APIKEY,
          MobileNetwork: mobileNetwork,
          Amount: amount,
          MobileNumber: mobileNumber,
          RequestID: requestId,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "An aika bukatar airtime.",
      requestId,
      data: response.data,
    });
  } catch (error) {
    console.error(
      "Nellobytes Airtime Error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      message: "An samu matsala wajen siyan airtime.",
      error: error.response?.data || error.message,
    });
  }
};