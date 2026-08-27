import 'package:shared_preferences/shared_preferences.dart';

class AuthSessionService {
  static const List<String> _tokenKeys = <String>[
    'auth_token',
    'token',
    'access_token',
    'accessToken',
    'jwt_token',
    'jwt',
  ];

  static Future<void> save({
    required String token,
    required Map<String, dynamic> user,
  }) async {
    final String cleanToken = token.trim();
    if (cleanToken.isEmpty) {
      throw Exception('Login token was not received.');
    }

    final SharedPreferences prefs = await SharedPreferences.getInstance();
    for (final String key in _tokenKeys) {
      await prefs.remove(key);
    }

    if (!await prefs.setString('auth_token', cleanToken)) {
      throw Exception('Unable to save the login session.');
    }

    await prefs.setString(
      'user_id',
      user['_id']?.toString() ?? user['id']?.toString() ?? '',
    );
    await prefs.setString(
      'user_name',
      user['fullName']?.toString() ??
          user['full_name']?.toString() ??
          user['name']?.toString() ??
          '',
    );
    await prefs.setString(
      'full_name',
      user['fullName']?.toString() ??
          user['full_name']?.toString() ??
          user['name']?.toString() ??
          '',
    );
    await prefs.setString(
      'user_phone',
      user['phone']?.toString() ?? user['phoneNumber']?.toString() ?? '',
    );
    await prefs.setString('user_email', user['email']?.toString() ?? '');
    await prefs.setString('user_role', user['role']?.toString() ?? 'CUSTOMER');
    await prefs.setString(
        'user_status', user['status']?.toString() ?? 'ACTIVE');
    await prefs.setString(
      'rider_id',
      user['riderId']?.toString() ?? user['rider_id']?.toString() ?? '',
    );
    await prefs.setString(
      'rider_verification_status',
      user['riderVerificationStatus']?.toString().trim().toUpperCase() ??
          'PENDING',
    );
    final String riderAvailability =
        user['availabilityStatus']?.toString().trim().toUpperCase() ??
            'OFFLINE';
    await prefs.setString('rider_availability_status', riderAvailability);
    await prefs.setString(
      'rider_vehicle_type',
      user['vehicleType']?.toString() ?? '',
    );
    await prefs.setString(
      'rider_plate_number',
      user['plateNumber']?.toString() ?? '',
    );
    await prefs.setString(
      'rider_state',
      user['riderState']?.toString() ?? user['state']?.toString() ?? '',
    );
    await prefs.setString(
      'rider_lga',
      user['riderLga']?.toString() ?? user['lga']?.toString() ?? '',
    );
    await prefs.setBool('rider_is_online', riderAvailability == 'ONLINE');

    final dynamic balanceValue =
        user['walletBalance'] ?? user['wallet_balance'] ?? user['balance'];
    await prefs.setDouble(
      'wallet_balance',
      double.tryParse(balanceValue?.toString() ?? '0') ?? 0,
    );
    await prefs.setBool(
      'transaction_pin_set',
      user['transactionPinSet'] == true,
    );

    if ((prefs.getString('auth_token') ?? '').trim().isEmpty) {
      throw Exception('The login session could not be saved.');
    }
  }

  static Future<void> clear() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    for (final String key in <String>[
      ..._tokenKeys,
      'user_id',
      'user_name',
      'full_name',
      'user_phone',
      'user_email',
      'user_role',
      'user_status',
      'wallet_balance',
      'transaction_pin_set',
      'rider_id',
      'rider_verification_status',
      'rider_availability_status',
      'rider_vehicle_type',
      'rider_plate_number',
      'rider_state',
      'rider_lga',
      'rider_is_online',
    ]) {
      await prefs.remove(key);
    }
  }
}
