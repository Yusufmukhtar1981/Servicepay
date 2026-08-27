import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'services/biometric_auth_service.dart';

class ChangeTransactionPinScreen extends StatefulWidget {
  const ChangeTransactionPinScreen({super.key});

  @override
  State<ChangeTransactionPinScreen> createState() =>
      _ChangeTransactionPinScreenState();
}

class _ChangeTransactionPinScreenState
    extends State<ChangeTransactionPinScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  final TextEditingController currentPinController = TextEditingController();
  final TextEditingController newPinController = TextEditingController();
  final TextEditingController confirmPinController = TextEditingController();
  bool isSubmitting = false;

  @override
  void dispose() {
    currentPinController.dispose();
    newPinController.dispose();
    confirmPinController.dispose();
    super.dispose();
  }

  void showMessage(String message, {bool isError = true}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red : const Color(0xFF2E7D32),
      ),
    );
  }

  Future<void> submit() async {
    final String currentPin = currentPinController.text.trim();
    final String newPin = newPinController.text.trim();
    if (!RegExp(r'^\d{4}$').hasMatch(currentPin) ||
        !RegExp(r'^\d{4}$').hasMatch(newPin)) {
      showMessage('Enter valid 4-digit transaction PINs.');
      return;
    }
    if (newPin != confirmPinController.text.trim()) {
      showMessage('New transaction PINs do not match.');
      return;
    }

    setState(() => isSubmitting = true);
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = (prefs.getString('auth_token') ?? '').trim();
      if (token.isEmpty) throw StateError('Your login session has expired.');
      final http.Response response = await http
          .put(
            Uri.parse('$baseUrl/transaction-pin/change'),
            headers: <String, String>{
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(<String, String>{
              'currentPin': currentPin,
              'newPin': newPin,
              'confirmNewPin': confirmPinController.text.trim(),
            }),
          )
          .timeout(const Duration(seconds: 30));
      final dynamic decoded =
          response.body.trim().isEmpty ? null : jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final String message = decoded is Map
            ? decoded['message']?.toString() ?? 'Unable to change PIN.'
            : 'Unable to change PIN.';
        throw StateError(message);
      }
      await BiometricAuthService.instance.clearTransactionEnrollment();
      showMessage(
        'Transaction PIN changed. Re-enable transaction biometrics if desired.',
        isError: false,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      showMessage(
        error.toString().replaceFirst('Bad state: ', ''),
      );
    } finally {
      if (mounted) setState(() => isSubmitting = false);
    }
  }

  Widget pinField(String label, TextEditingController controller) {
    return TextField(
      controller: controller,
      obscureText: true,
      maxLength: 4,
      keyboardType: TextInputType.number,
      inputFormatters: <TextInputFormatter>[
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(4),
      ],
      decoration: InputDecoration(
        labelText: label,
        counterText: '',
        border: const OutlineInputBorder(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Change Transaction PIN')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: <Widget>[
          pinField('Current PIN', currentPinController),
          const SizedBox(height: 14),
          pinField('New PIN', newPinController),
          const SizedBox(height: 14),
          pinField('Confirm new PIN', confirmPinController),
          const SizedBox(height: 22),
          FilledButton(
            onPressed: isSubmitting ? null : submit,
            child: isSubmitting
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Change Transaction PIN'),
          ),
        ],
      ),
    );
  }
}
