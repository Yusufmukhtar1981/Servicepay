import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ResetTransactionPinScreen extends StatefulWidget {
  const ResetTransactionPinScreen({super.key});

  @override
  State<ResetTransactionPinScreen> createState() =>
      _ResetTransactionPinScreenState();
}

class _ResetTransactionPinScreenState
    extends State<ResetTransactionPinScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color primaryGreen = Color(0xFF2E7D32);

  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _newPinController = TextEditingController();
  final TextEditingController _confirmPinController = TextEditingController();

  bool _hidePassword = true;
  bool _hideNewPin = true;
  bool _hideConfirmPin = true;
  bool _isSubmitting = false;

  @override
  void dispose() {
    _passwordController.dispose();
    _newPinController.dispose();
    _confirmPinController.dispose();
    super.dispose();
  }

  void _showMessage(
    String message, {
    bool isError = true,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError ? Colors.red : primaryGreen,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  String? _validateNewPin(String pin) {
    if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
      return 'Transaction PIN must contain exactly 4 digits.';
    }

    if (RegExp(r'^(\d)\1{3}$').hasMatch(pin)) {
      return 'Transaction PIN cannot use the same digit four times.';
    }

    const Set<String> weakPins = <String>{
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
      '1111',
      '0000',
    };

    if (weakPins.contains(pin)) {
      return 'Please choose a less predictable transaction PIN.';
    }

    return null;
  }

  Map<String, dynamic> _decodeResponse(String body) {
    if (body.trim().isEmpty) {
      return <String, dynamic>{};
    }

    try {
      final dynamic decoded = jsonDecode(body);
      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } catch (_) {
      // A generic network response message is shown below.
    }

    return <String, dynamic>{};
  }

  Future<void> _resetTransactionPin() async {
    FocusScope.of(context).unfocus();

    final String currentPassword = _passwordController.text;
    final String newPin = _newPinController.text.trim();
    final String confirmPin = _confirmPinController.text.trim();

    if (currentPassword.trim().isEmpty) {
      _showMessage('Enter your current password.');
      return;
    }

    final String? pinError = _validateNewPin(newPin);
    if (pinError != null) {
      _showMessage(pinError);
      return;
    }

    if (newPin != confirmPin) {
      _showMessage('Transaction PINs do not match.');
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = prefs.getString('auth_token') ?? '';

      if (token.trim().isEmpty) {
        _showMessage('Your login session has expired. Please sign in again.');
        return;
      }

      final http.Response response = await http
          .post(
            Uri.parse('$baseUrl/transaction-pin/reset'),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(<String, String>{
              'currentPassword': currentPassword,
              'newPin': newPin,
              'confirmPin': confirmPin,
            }),
          )
          .timeout(const Duration(seconds: 30));

      final Map<String, dynamic> data = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        await prefs.setBool('transaction_pin_set', true);

        _passwordController.clear();
        _newPinController.clear();
        _confirmPinController.clear();

        _showMessage(
          'Transaction PIN reset successfully.',
          isError: false,
        );

        await Future<void>.delayed(
          const Duration(milliseconds: 700),
        );

        if (mounted) {
          Navigator.of(context).pop(true);
        }
        return;
      }

      _showMessage(
        data['message']?.toString() ??
            'Unable to reset transaction PIN. Please try again.',
      );
    } catch (_) {
      _showMessage(
        'Unable to connect to the server. Please try again.',
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  Widget _buildPasswordField({
    required Key fieldKey,
    required TextEditingController controller,
    required String label,
    required bool obscureText,
    required VoidCallback onToggleVisibility,
    bool numeric = false,
  }) {
    return TextField(
      key: fieldKey,
      controller: controller,
      obscureText: obscureText,
      keyboardType:
          numeric ? TextInputType.number : TextInputType.visiblePassword,
      maxLength: numeric ? 4 : null,
      inputFormatters: numeric
          ? <TextInputFormatter>[
              FilteringTextInputFormatter.digitsOnly,
            ]
          : null,
      enableSuggestions: !numeric,
      autocorrect: false,
      decoration: InputDecoration(
        labelText: label,
        counterText: numeric ? '' : null,
        prefixIcon: Icon(
          numeric ? Icons.pin_outlined : Icons.lock_outline_rounded,
        ),
        suffixIcon: IconButton(
          tooltip: obscureText ? 'Show $label' : 'Hide $label',
          onPressed: onToggleVisibility,
          icon: Icon(
            obscureText
                ? Icons.visibility_outlined
                : Icons.visibility_off_outlined,
          ),
        ),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        title: const Text('Reset Transaction PIN'),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF1F2937),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const SizedBox(height: 20),
              Container(
                height: 84,
                width: 84,
                decoration: const BoxDecoration(
                  color: Color(0xFFE8F5E9),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.lock_reset_rounded,
                  size: 42,
                  color: primaryGreen,
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Forgot your transaction PIN?',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF1F2937),
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Confirm your account password, then choose a new 4-digit PIN for transactions.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 15,
                  height: 1.5,
                  color: Color(0xFF6B7280),
                ),
              ),
              const SizedBox(height: 32),
              _buildPasswordField(
                fieldKey: const Key('reset-pin-current-password'),
                controller: _passwordController,
                label: 'Current password',
                obscureText: _hidePassword,
                onToggleVisibility: () {
                  setState(() {
                    _hidePassword = !_hidePassword;
                  });
                },
              ),
              const SizedBox(height: 18),
              _buildPasswordField(
                fieldKey: const Key('reset-pin-new-pin'),
                controller: _newPinController,
                label: 'New 4-digit PIN',
                obscureText: _hideNewPin,
                numeric: true,
                onToggleVisibility: () {
                  setState(() {
                    _hideNewPin = !_hideNewPin;
                  });
                },
              ),
              const SizedBox(height: 18),
              _buildPasswordField(
                fieldKey: const Key('reset-pin-confirm-pin'),
                controller: _confirmPinController,
                label: 'Confirm new PIN',
                obscureText: _hideConfirmPin,
                numeric: true,
                onToggleVisibility: () {
                  setState(() {
                    _hideConfirmPin = !_hideConfirmPin;
                  });
                },
              ),
              const SizedBox(height: 30),
              SizedBox(
                height: 56,
                child: ElevatedButton(
                  key: const Key('reset-transaction-pin-submit'),
                  onPressed: _isSubmitting ? null : _resetTransactionPin,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: primaryGreen,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: _isSubmitting
                      ? const SizedBox(
                          height: 24,
                          width: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          'Reset Transaction PIN',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 22),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF8E1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Icon(
                      Icons.info_outline_rounded,
                      color: Color(0xFFF59E0B),
                    ),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Never share your password or transaction PIN with anyone, including ServicePay staff.',
                        style: TextStyle(
                          fontSize: 14,
                          height: 1.4,
                          color: Color(0xFF6B7280),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}