import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

Future<String?> showTransactionPinDialog(
  BuildContext context,
) async {
  final TextEditingController controller = TextEditingController();

  bool obscurePin = true;

  final String? result = await showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (BuildContext dialogContext) {
      return StatefulBuilder(
        builder: (
          BuildContext context,
          StateSetter setDialogState,
        ) {
          return AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(22),
            ),
            title: const Text(
              'Enter Transaction PIN',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Enter your 4-digit ServicePay Transaction PIN to continue.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.black54,
                  ),
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: controller,
                  autofocus: true,
                  obscureText: obscurePin,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  maxLength: 4,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(4),
                  ],
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 10,
                  ),
                  decoration: InputDecoration(
                    counterText: '',
                    hintText: '••••',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                    suffixIcon: IconButton(
                      onPressed: () {
                        setDialogState(() {
                          obscurePin = !obscurePin;
                        });
                      },
                      icon: Icon(
                        obscurePin
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                },
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () {
                  final String pin = controller.text.trim();

                  if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Transaction PIN must be exactly 4 digits.',
                        ),
                      ),
                    );
                    return;
                  }

                  Navigator.of(dialogContext).pop(pin);
                },
                child: const Text('Confirm'),
              ),
            ],
          );
        },
      );
    },
  );

  controller.dispose();

  return result;
}
