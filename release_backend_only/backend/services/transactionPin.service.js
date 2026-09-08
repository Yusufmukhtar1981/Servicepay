const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const { validateTransactionPin } = require("../utils/passwordPolicy");

const bcryptHash = (value) =>
  typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);

const legacyPin = (value) =>
  typeof value === "string" && /^\d{4}$/.test(value);
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

const pinError = (message, code, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const loadTransactionPinUser = async (userId, session) => {
  let query = User.findById(userId).select(
    "+transactionPin +transactionPinFailedAttempts +transactionPinLockedUntil +transactionPinAttemptVersion transactionPinSet role fullName"
  );
  if (session) query = query.session(session);
  const user = await query;
  if (!user) {
    throw pinError("User account not found.", "USER_NOT_FOUND", 404);
  }
  return user;
};

const assertPinNotLocked = (user) => {
  if (user.transactionPinLockedUntil &&
      new Date(user.transactionPinLockedUntil).getTime() > Date.now()) {
    throw pinError(
      "Transaction PIN verification is temporarily locked. Please try again later.",
      "TRANSACTION_PIN_LOCKED",
      429
    );
  }
};

const reservePinAttempt = async (user) => {
  for (;;) {
    const now = new Date();
    const current = await User.findById(user._id).select(
      "+transactionPinFailedAttempts +transactionPinLockedUntil +transactionPinAttemptVersion"
    );
    assertPinNotLocked(current);
    const version = Number(current.transactionPinAttemptVersion || 0);
    const attempts = Number(current.transactionPinFailedAttempts || 0);
    const versionFilter = version === 0
      ? { $or: [
          { transactionPinAttemptVersion: 0 },
          { transactionPinAttemptVersion: { $exists: false } },
        ] }
      : { transactionPinAttemptVersion: version };

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const locked = await User.findOneAndUpdate(
        { _id: user._id, ...versionFilter },
        {
          $set: { transactionPinLockedUntil: new Date(now.getTime() + LOCK_DURATION_MS) },
          $inc: { transactionPinAttemptVersion: 1 },
        },
        { new: true }
      );
      if (!locked) continue;
      throw pinError(
        "Transaction PIN verification is temporarily locked. Please try again later.",
        "TRANSACTION_PIN_LOCKED",
        429
      );
    }

    const reservation = await User.findOneAndUpdate(
      {
        _id: user._id,
        $and: [
          versionFilter,
          { $or: [
            { transactionPinLockedUntil: null },
            { transactionPinLockedUntil: { $exists: false } },
            { transactionPinLockedUntil: { $lte: now } },
          ] },
        ],
      },
      { $inc: { transactionPinFailedAttempts: 1, transactionPinAttemptVersion: 1 } },
      { new: true }
    ).select("+transactionPinFailedAttempts +transactionPinLockedUntil +transactionPinAttemptVersion");
    if (reservation) return reservation;
  }
};

const clearReservedPinAttempt = async (user, reservationVersion, session) => {
  let query = User.updateOne(
    { _id: user._id, transactionPinAttemptVersion: reservationVersion },
    { $set: { transactionPinFailedAttempts: 0, transactionPinLockedUntil: null } }
  );
  if (session) query = query.session(session);
  const result = await query;
  if (result.modifiedCount !== 1) {
    // A later verification already owns the current reservation version.
    // Wait briefly for that verifier to either clear a correct attempt or
    // persist/lock a failed one. This permits concurrent correct requests
    // without weakening fail-closed behavior for parallel PIN guesses.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = await User.findById(user._id).select(
        "+transactionPinFailedAttempts +transactionPinLockedUntil"
      );
      assertPinNotLocked(current);
      if (Number(current.transactionPinFailedAttempts || 0) === 0) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw pinError(
      "Another transaction PIN verification is still being completed. Please try again.",
      "TRANSACTION_PIN_RETRY_REQUIRED",
      429
    );
  }
  return true;
};

const hasUsablePin = (user) =>
  bcryptHash(user.transactionPin) || legacyPin(user.transactionPin);

const repairPinStatus = async (user, session) => {
  const set = hasUsablePin(user);
  if (user.transactionPinSet !== set) {
    user.transactionPinSet = set;
    await user.save({ session, validateBeforeSave: false });
  }
  return set;
};

const inspectTransactionPinStatus = async (userId, { session } = {}) => {
  const user = await loadTransactionPinUser(userId, session);
  const transactionPinSet = await repairPinStatus(user, session);
  return { user, transactionPinSet };
};

const requireNewPin = (pin) => {
  const check = validateTransactionPin(pin);
  if (!check.valid) {
    throw pinError(check.message, "INVALID_TRANSACTION_PIN", 400);
  }
  return String(pin).trim();
};

const setTransactionPin = async (
  userId,
  newPin,
  { allowExisting = true, session } = {}
) => {
  const pin = requireNewPin(newPin);
  const user = await loadTransactionPinUser(userId, session);
  const exists = await repairPinStatus(user, session);
  if (exists && !allowExisting) {
    throw pinError(
      "Transaction PIN has already been created.",
      "TRANSACTION_PIN_ALREADY_SET",
      409
    );
  }
  user.setTransactionPin(pin);
  await user.save({ session });
  return { user, transactionPinSet: true };
};

const verifyTransactionPin = async (userId, enteredPin, { session } = {}) => {
  const pin = String(enteredPin || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    throw pinError(
      "Enter a valid 4-digit transaction PIN.",
      "INVALID_TRANSACTION_PIN",
      400
    );
  }
  const user = await loadTransactionPinUser(userId, session);
  assertPinNotLocked(user);
  if (!(await repairPinStatus(user, session))) {
    throw pinError(
      "Please create your transaction PIN first.",
      "TRANSACTION_PIN_NOT_SET",
      400
    );
  }

  const reservation = await reservePinAttempt(user);
  const storedPin = user.transactionPin;
  const correct = bcryptHash(storedPin)
    ? await bcrypt.compare(pin, storedPin)
    : pin === storedPin;
  if (!correct) {
    if (Number(reservation.transactionPinFailedAttempts || 0) >= MAX_FAILED_ATTEMPTS) {
      await User.updateOne(
        { _id: user._id, transactionPinAttemptVersion: reservation.transactionPinAttemptVersion },
        { $set: { transactionPinLockedUntil: new Date(Date.now() + LOCK_DURATION_MS) } }
      );
    }
    throw pinError(
      "Incorrect transaction PIN.",
      "INCORRECT_TRANSACTION_PIN",
      401
    );
  }

  // Security admission state is independent of a caller's business
  // transaction. In particular, a transaction snapshot cannot safely clear a
  // reservation that was deliberately persisted outside that transaction.
  await clearReservedPinAttempt(user, reservation.transactionPinAttemptVersion);

  // Legacy plaintext values are upgraded only after authenticating the PIN.
  if (!bcryptHash(storedPin)) {
    user.setTransactionPin(pin);
    // Assigning the same legacy value does not mark a Mongoose path dirty;
    // explicitly mark it so the schema pre-save hook replaces it with bcrypt.
    user.markModified("transactionPin");
    await user.save({ session });
  }
  return { user, transactionPinSet: true };
};

const changeTransactionPin = async (
  userId,
  currentPin,
  newPin,
  { session } = {}
) => {
  const nextPin = requireNewPin(newPin);
  if (String(currentPin || "").trim() === nextPin) {
    throw pinError(
      "New transaction PIN must be different from the current PIN.",
      "TRANSACTION_PIN_UNCHANGED",
      400
    );
  }
  await verifyTransactionPin(userId, currentPin, { session });
  return setTransactionPin(userId, nextPin, { session });
};

const resetTransactionPin = async (userId, newPin, options = {}) =>
  setTransactionPin(userId, newPin, { ...options, allowExisting: true });

module.exports = {
  inspectTransactionPinStatus,
  setTransactionPin,
  verifyTransactionPin,
  changeTransactionPin,
  resetTransactionPin,
  loadTransactionPinUser,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
};