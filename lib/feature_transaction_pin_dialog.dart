import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'services/biometric_auth_service.dart';
import 'services/transaction_authorization_service.dart';

/// Operation names accepted by the transaction authorization backend.
const requestMoneyPaymentOperation = 'REQUEST_MONEY_PAYMENT';
const payLinkPaymentOperation = 'PAY_LINK_PAYMENT';
const groupWalletContributionOperation = 'GROUP_WALLET_CONTRIBUTION';
const organizationPaymentOperation = 'ORGANIZATION_PAYMENT';
const organizationTreasuryWithdrawalOperation =
    'ORGANIZATION_TREASURY_WITHDRAWAL';

/// Offers the same authorization choices for feature payments. The returned
/// map can be merged directly into the payment request body.
Future<Map<String, dynamic>?> authorizeFeatureTransaction(
  BuildContext context, {
  required String token,
  required String operation,
  required Map<String, dynamic> requestBody,
  required String idempotencyKey,
  bool? transactionBiometricsEnabled,
  String title = 'Confirm transaction',
  String message = 'Choose how to authorize this transaction.',
  TransactionAuthorizationService? authorizationService,
  BiometricAuthService? biometricService,
}) async {
  // Do not probe native capabilities or call the network on the legacy path.
  // The settings screen is the sole authority that enables this chooser.
  if (!(transactionBiometricsEnabled ??
      TransactionAuthorizationService.transactionBiometricsEnabled)) {
    final pin = await showFeatureTransactionPinDialog(
      context,
      title: title,
      message: message,
    );
    return pin == null ? null : {'transactionPin': pin};
  }
  final biometrics = biometricService ?? BiometricAuthService();
  final authorization = authorizationService ?? TransactionAuthorizationService();
  final enrolled = await biometrics.isEnrolled();
  final choice = await showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        if (enrolled)
          TextButton.icon(
            onPressed: () => Navigator.pop(dialogContext, 'biometric'),
            icon: const Icon(Icons.fingerprint),
            label: const Text('Confirm with Fingerprint'),
          ),
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, 'pin'),
          child: const Text('Use Transaction PIN Instead'),
        ),
      ],
    ),
  );
  if (choice == 'pin') {
    final pin = await showFeatureTransactionPinDialog(
      context,
      title: title,
      message: message,
    );
    return pin == null ? null : {'transactionPin': pin};
  }
  if (choice != 'biometric') return null;
  String? grant;
  String? deviceId;
  try {
    grant = await authorization.authorizeTransaction(
      token: token,
      operation: operation,
      requestBody: requestBody,
      idempotencyKey: idempotencyKey,
    );
    if (grant != null) {
      deviceId = await biometrics.deviceId();
    }
  } catch (_) {
    grant = null;
  }
  if (grant == null || deviceId == null) {
    final pin = await showFeatureTransactionPinDialog(
      context,
      title: title,
      message: message,
    );
    return pin == null ? null : {'transactionPin': pin};
  }
  return {'biometricGrant': grant, 'deviceId': deviceId};
}

Future<String?> showFeatureTransactionPinDialog(
  BuildContext context, {
  String title = 'Transaction PIN',
  String message = 'Enter your 4-digit transaction PIN to continue.',
}) async {
  final controller = TextEditingController();

  final result = await showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) {
      return AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(message),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autofocus: true,
              obscureText: true,
              maxLength: 4,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(4),
              ],
              decoration: const InputDecoration(
                labelText: 'Transaction PIN',
                border: OutlineInputBorder(),
                counterText: '',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(dialogContext);
            },
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final pin = controller.text.trim();

              if (pin.length != 4) {
                ScaffoldMessenger.of(dialogContext).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Enter your 4-digit transaction PIN.',
                    ),
                  ),
                );
                return;
              }

              Navigator.pop(
                dialogContext,
                pin,
              );
            },
            child: const Text('Continue'),
          ),
        ],
      );
    },
  );

  WidgetsBinding.instance.addPostFrameCallback((_) {
    controller.dispose();
  });
  return result;
}
