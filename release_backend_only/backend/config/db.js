const fixCardRequestReferenceIndex = require('../scripts/fixCardRequestReferenceIndex');
const mongoose = require("mongoose");

const connectDB = async () => {
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
};

module.exports = connectDB;