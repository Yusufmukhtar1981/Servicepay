const fixCardRequestReferenceIndex = require('../scripts/fixCardRequestReferenceIndex');
const mongoose = require("mongoose");

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (typeof mongoUri !== "string" || !mongoUri.trim()) {
    throw new Error("Required MongoDB environment variable is missing: MONGODB_URI");
  }

  try {
    const connection = await mongoose.connect(
      mongoUri
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
};

module.exports = connectDB;