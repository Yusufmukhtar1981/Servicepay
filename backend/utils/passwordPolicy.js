const validateStrongPassword = (password) => {
  const value = String(password || '');

  if (value.length < 8) {
    return {
      valid: false,
      message: 'Password must be at least 8 characters long.',
    };
  }

  if (!/[A-Z]/.test(value)) {
    return {
      valid: false,
      message: 'Password must contain at least one uppercase letter.',
    };
  }

  if (!/[a-z]/.test(value)) {
    return {
      valid: false,
      message: 'Password must contain at least one lowercase letter.',
    };
  }

  if (!/[0-9]/.test(value)) {
    return {
      valid: false,
      message: 'Password must contain at least one number.',
    };
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    return {
      valid: false,
      message: 'Password must contain at least one special character.',
    };
  }

  return { valid: true };
};

const validateTransactionPin = (pin) => {
  const value = String(pin || '').trim();

  if (!/^\d{4}$/.test(value)) {
    return {
      valid: false,
      message: 'Transaction PIN must contain exactly 4 digits.',
    };
  }

  if (/^(\d)\1{3}$/.test(value)) {
    return {
      valid: false,
      message: 'Transaction PIN cannot use the same digit four times.',
    };
  }

  const weakPins = new Set([
    '0123', '1234', '2345', '3456', '4567',
    '5678', '6789', '9876', '8765', '7654',
    '6543', '5432', '4321', '1111', '0000',
  ]);

  if (weakPins.has(value)) {
    return {
      valid: false,
      message: 'Please choose a less predictable transaction PIN.',
    };
  }

  return { valid: true };
};

module.exports = {
  validateStrongPassword,
  validateTransactionPin,
};
