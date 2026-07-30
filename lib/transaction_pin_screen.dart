import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class TransactionPinScreen extends StatefulWidget {
  const TransactionPinScreen({
    super.key,
  });

  @override
  State<TransactionPinScreen> createState() => _TransactionPinScreenState();
}

class _TransactionPinScreenState extends State<TransactionPinScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final TextEditingController pinController = TextEditingController();

  final TextEditingController confirmPinController = TextEditingController();

  bool hidePin = true;
  bool hideConfirmPin = true;
  bool isLoading = false;

  @override
  void dispose() {
    pinController.dispose();
    confirmPinController.dispose();
    super.dispose();
  }

  void showMessage(
    String message, {
    bool isError = true,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).hideCurrentSnackBar();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red : Colors.green,
      ),
    );
  }

  Future<void> createTransactionPin() async {
    FocusScope.of(context).unfocus();

    final String pin = pinController.text.trim();

    final String confirmPin = confirmPinController.text.trim();

    if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
      showMessage(
        'Transaction PIN must contain exactly 4 digits.',
      );
      return;
    }

    if (pin != confirmPin) {
      showMessage(
        'Transaction PINs do not match.',
      );
      return;
    }

    try {
      setState(() {
        isLoading = true;
      });

      final SharedPreferences prefs = await SharedPreferences.getInstance();

      final String token = prefs.getString('auth_token') ?? '';

      if (token.isEmpty) {
        showMessage(
          'Your login session has expired. Please sign in again.',
        );
        return;
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/transaction-pin/create',
            ),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'pin': pin,
              'confirmPin': confirmPin,
            }),
          )
          .timeout(
            const Duration(
              seconds: 30,
            ),
          );

      Map<String, dynamic> data = {};

      if (response.body.isNotEmpty) {
        final dynamic decoded = jsonDecode(response.body);

        if (decoded is Map<String, dynamic>) {
          data = decoded;
        }
      }

      if (response.statusCode == 200 || response.statusCode == 201) {
        await prefs.setBool(
          'transaction_pin_set',
          true,
        );

        pinController.clear();
        confirmPinController.clear();

        showMessage(
          data['message']?.toString() ??
              'Transaction PIN created successfully.',
          isError: false,
        );

        if (!mounted) {
          return;
        }

        await Future.delayed(
          const Duration(
            milliseconds: 700,
          ),
        );

        if (mounted) {
          Navigator.of(context).pop(true);
        }

        return;
      }

      showMessage(
        data['message']?.toString() ?? 'Unable to create transaction PIN.',
      );
    } catch (error) {
      showMessage(
        'Unable to connect to the server. Please try again.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        title: const Text(
          'Transaction PIN',
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF1F2937),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(
            20,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(
                height: 20,
              ),
              Container(
                height: 84,
                width: 84,
                decoration: const BoxDecoration(
                  color: Color(0xFFE8F5E9),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.lock_outline_rounded,
                  size: 42,
                  color: Color(0xFF2E7D32),
                ),
              ),
              const SizedBox(
                height: 24,
              ),
              const Text(
                'Create Transaction PIN',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF1F2937),
                ),
              ),
              const SizedBox(
                height: 10,
              ),
              const Text(
                'Your 4-digit PIN will be used to confirm transfers and other wallet transactions.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 15,
                  height: 1.5,
                  color: Color(0xFF6B7280),
                ),
              ),
              const SizedBox(
                height: 32,
              ),
              TextField(
                controller: pinController,
                keyboardType: TextInputType.number,
                maxLength: 4,
                obscureText: hidePin,
                decoration: InputDecoration(
                  labelText: 'Enter 4-digit PIN',
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.pin_outlined,
                  ),
                  suffixIcon: IconButton(
                    onPressed: () {
                      setState(() {
                        hidePin = !hidePin;
                      });
                    },
                    icon: Icon(
                      hidePin
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                      14,
                    ),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
              const SizedBox(
                height: 18,
              ),
              TextField(
                controller: confirmPinController,
                keyboardType: TextInputType.number,
                maxLength: 4,
                obscureText: hideConfirmPin,
                decoration: InputDecoration(
                  labelText: 'Confirm 4-digit PIN',
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.lock_outline,
                  ),
                  suffixIcon: IconButton(
                    onPressed: () {
                      setState(() {
                        hideConfirmPin = !hideConfirmPin;
                      });
                    },
                    icon: Icon(
                      hideConfirmPin
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                      14,
                    ),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
              const SizedBox(
                height: 30,
              ),
              SizedBox(
                height: 56,
                child: ElevatedButton(
                  onPressed: isLoading ? null : createTransactionPin,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(
                      0xFF2E7D32,
                    ),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(
                        14,
                      ),
                    ),
                  ),
                  child: isLoading
                      ? const SizedBox(
                          height: 24,
                          width: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          'Create PIN',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                ),
              ),
              const SizedBox(
                height: 22,
              ),
              Container(
                padding: const EdgeInsets.all(
                  16,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF8E1),
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.info_outline_rounded,
                      color: Color(0xFFF59E0B),
                    ),
                    SizedBox(
                      width: 12,
                    ),
                    Expanded(
                      child: Text(
                        'Do not share your transaction PIN with anyone, including ServicePay staff.',
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
