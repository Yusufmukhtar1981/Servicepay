const axios = require("axios");

exports.buyAirtime = async (req, res) => {
  try {
    const { mobileNetwork, amount, mobileNumber } = req.body;

    if (!mobileNetwork || !amount || !mobileNumber) {
      return res.status(400).json({
        success: false,
        message:
          "Mobile network, amount, and mobile number are required.",
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
      message: "Airtime request submitted successfully.",
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
      message: "Unable to purchase airtime.",
      error: error.response?.data || error.message,
    });
  }
};