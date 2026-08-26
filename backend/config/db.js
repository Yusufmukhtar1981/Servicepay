const fixCardRequestReferenceIndex = require('../scripts/fixCardRequestReferenceIndex');
const mongoose = require("mongoose");

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.error(
      "MongoDB unavailable: MONGODB_URI is not configured; keeping the HTTP server online."
    );
    return false;
  }

  try {
    const connection = await mongoose.connect(
      process.env.MONGODB_URI
    );

    await fixCardRequestReferenceIndex();

    console.log(
      `MongoDB connected: ${connection.connection.host}`
    );
  } catch (error) {
    const connectionError = new Error(
      `MongoDB connection failed: ${error.message}`
    );
    connectionError.cause = error;
    console.error(connectionError.message);
    throw connectionError;
  }

  return true;
};

module.exports = connectDB;