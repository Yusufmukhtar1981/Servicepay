import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'services/transaction_authorization_service.dart';

Future<String?> showFeatureTransactionPinDialog(
  BuildContext context, {
  String title = 'Transaction PIN',
  String message = 'Enter your 4-digit transaction PIN to continue.',
}) {
  return TransactionAuthorizationService.request(
    context: context,
    biometricReason: title,
    pinFallback: () => _showFeatureTransactionPinDialog(
      context,
      title: title,
      message: message,
    ),
  );
}

Future<String?> _showFeatureTransactionPinDialog(
  BuildContext context, {
  required String title,
  required String message,
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

  controller.dispose();
  return result;
}
