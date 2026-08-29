import 'package:shared_preferences/shared_preferences.dart';

String? transactionPinError(String pin) {
  if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
    return 'Transaction PIN must contain exactly 4 digits.';
  }
  if (RegExp(r'^(\d)\1{3}$').hasMatch(pin)) {
    return 'Transaction PIN cannot use the same digit four times.';
  }
  const weakPins = <String>{
    '0123',
    '1234',
    '2345',
    '3456',
    '4567',
    '5678',
    '6789',
    '9876',
    '8765',
    '7654',
    '6543',
    '5432',
    '4321',
  };
  return weakPins.contains(pin)
      ? 'Please choose a less predictable transaction PIN.'
      : null;
}

Future<String?> readAuthToken() async {
  final prefs = await SharedPreferences.getInstance();
  for (final key in <String>[
    'auth_token',
    'token',
    'access_token',
    'accessToken',
    'jwt_token',
    'jwt',
  ]) {
    final value = prefs.getString(key)?.trim();
    if (value != null && value.isNotEmpty) {
      return value.replaceFirst(
          RegExp(r'^Bearer\s+', caseSensitive: false), '');
    }
  }
  return null;
}

bool isStrongPassword(String password) =>
    password.length >= 8 &&
    RegExp(r'[A-Z]').hasMatch(password) &&
    RegExp(r'[a-z]').hasMatch(password) &&
    RegExp(r'[0-9]').hasMatch(password) &&
    RegExp(r'[^A-Za-z0-9]').hasMatch(password);
