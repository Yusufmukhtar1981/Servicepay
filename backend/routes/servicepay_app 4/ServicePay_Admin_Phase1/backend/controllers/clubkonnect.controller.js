const axios = require("axios");

exports.buyAirtime = async (req, res) => {
  try {
    const { network, phone, amount } = req.body;

    const response = await axios.get(
      "https://www.nellobytesystems.com/APIAirtimeV1.asp",
      {
        params: {
          UserID: process.env.CLUBKONNECT_USER_ID,
          APIKey: process.env.CLUBKONNECT_API_KEY,
          MobileNetwork: network,
          Amount: amount,
          MobileNumber: phone,
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.log(error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
};