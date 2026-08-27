import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'biometric_auth_service.dart';

typedef TransactionPinFallback = Future<String?> Function();

class TransactionAuthorizationService {
  static bool _authorizing = false;

  static Future<String?> request({
    required BuildContext context,
    required TransactionPinFallback pinFallback,
    String biometricReason = 'Confirm this ServicePay transaction',
    BiometricAuthService? biometricService,
  }) async {
    if (_authorizing) return null;
    _authorizing = true;
    try {
      final BiometricAuthService service =
          biometricService ?? BiometricAuthService.instance;
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String userId = (prefs.getString('user_id') ?? '').trim();

      if (userId.isNotEmpty && await service.hasTransactionEnrollment(userId)) {
        final BiometricAvailability availability = await service.availability();
        if (!availability.supported) {
          await service.clearTransactionEnrollment();
        } else {
          final BiometricAuthenticationResult result =
              await service.authenticate(
            reason: biometricReason,
          );
          if (result == BiometricAuthenticationResult.success) {
            try {
              final String? pin = await service.transactionPin(userId);
              if (pin != null) return pin;
            } catch (_) {
              await service.clearTransactionEnrollment();
              if (!context.mounted) return null;
              return pinFallback();
            }
          } else if (result == BiometricAuthenticationResult.unavailable) {
            await service.clearTransactionEnrollment();
          }
        }
      }

      if (!context.mounted) return null;
      return pinFallback();
    } finally {
      _authorizing = false;
    }
  }
}
