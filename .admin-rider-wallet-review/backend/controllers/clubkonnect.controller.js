const axios = require("axios");

exports.buyAirtime = async (req, res) => {
  try {
    const { network, phone, amount } = req.body;

    if (!network || !phone || !amount) {
      return res.status(400).json({
        success: false,
        message: "Network, phone da amount suna da bukata.",
      });
    }

    const response = await axios.get(
      "https://www.nellobytesystems.com/APIAirtimeV1.asp",
      {
        params: {
          UserID: process.env.CLUBKONNECT_USER_ID,
          APIKey: process.env.CLUBKONNECT_API_KEY,
          MobileNetwork: network,
          
          MobileNumber: phone,
        },
        timeout: 45000,
        validateStatus: () => true,
      }
    );

    console.log("CLUBKONNECT AIRTIME RESPONSE:", {
      status: response.status,
      data: response.data,
    });

    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({
        success: false,
        message: `ClubKonnect Airtime endpoint returned ${response.status}.`,
        providerResponse: response.data,
      });
    }

    return res.json({
      success: true,
      message: "Airtime request sent successfully.",
      data: response.data,
    });
  } catch (error) {
    console.log("CLUBKONNECT AIRTIME ERROR:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
    });

    return res.status(500).json({
      success: false,
      message: "Airtime purchase failed",
      error: error.response?.data || error.message,
    });
  }
};

exports.buyData = async (req, res) => {
  try {
    const { network, phone, planCode, amount } = req.body;

    if (!network || !phone || !planCode) {
      return res.status(400).json({
        success: false,
        message: "Network, phone da planCode suna da bukata.",
      });
    }

    const response = await axios.get(
      "https://www.nellobytesystems.com/APIDatabundleV1.asp",
      {
        params: {
          UserID: process.env.CLUBKONNECT_USER_ID,
          APIKey: process.env.CLUBKONNECT_API_KEY,
          MobileNetwork: network,
          DataPlan: planCode,
          MobileNumber: phone,
        
        },
        timeout: 45000,
        validateStatus: () => true,
      }
    );

    console.log("CLUBKONNECT DATA RESPONSE:", {
      status: response.status,
      data: response.data,
    });

    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({
        success: false,
        message: `ClubKonnect Data endpoint returned ${response.status}.`,
        providerResponse: response.data,
      });
    }

    return res.json({
      success: true,
      message: "Data request sent successfully.",
      data: response.data,
    });
  } catch (error) {
    console.log("CLUBKONNECT DATA ERROR:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
    });

    return res.status(500).json({
      success: false,
      message: "Data purchase failed",
      error: error.response?.data || error.message,
    });
  }
};