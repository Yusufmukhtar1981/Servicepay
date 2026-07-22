import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final amountController = TextEditingController();

  bool isLoading = false;
  double walletBalance = 0;

  @override
  void initState() {
    super.initState();
    loadWalletBalance();
  }

  @override
  void dispose() {
    amountController.dispose();
    super.dispose();
  }

  Future<void> loadWalletBalance() async {
    final prefs = await SharedPreferences.getInstance();
    final savedBalance = prefs.getDouble('wallet_balance') ?? 0;

    if (!mounted) return;

    setState(() {
      walletBalance = savedBalance;
    });
  }

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> fundWallet() async {
    final amount = double.tryParse(
      amountController.text.trim(),
    );

    if (amount == null || amount < 100) {
      showMessage('Minimum wallet funding is ₦100.');
      return;
    }

    setState(() {
      isLoading = true;
    });

    try {
      final prefs = await SharedPreferences.getInstance();

      final token = prefs.getString('auth_token');
      final email = prefs.getString('user_email');

      if (token == null || token.isEmpty) {
        showMessage('Please login again.');
        return;
      }

      if (email == null || email.isEmpty) {
        showMessage('User email was not found. Please login again.');
        return;
      }

      final response = await http.post(
        Uri.parse('$baseUrl/paystack/initialize'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'email': email,
          'amount': amount,
        }),
      );

      print('PAYSTACK STATUS CODE: ${response.statusCode}');
      print('PAYSTACK RESPONSE BODY: ${response.body}');

      Map<String, dynamic>? result;

      try {
        final decoded = jsonDecode(response.body);

        if (decoded is Map<String, dynamic>) {
          result = decoded;
        }
      } catch (_) {
        showMessage(
          'Server returned an invalid response. Status: ${response.statusCode}',
        );
        return;
      }

      final serverMessage =
          result?['message']?.toString() ?? 'Unable to initialize payment.';

      if (response.statusCode == 200 && result?['success'] == true) {
        final reference = result?['reference']?.toString() ?? '';

        final authorizationUrl = result?['authorizationUrl']?.toString() ?? '';

        print('PAYSTACK REFERENCE: $reference');
        print('PAYSTACK AUTHORIZATION URL: $authorizationUrl');

        showMessage(
          'Payment initialized successfully. Reference: $reference',
        );
        if (authorizationUrl.isNotEmpty) {
          await launchUrl(
            Uri.parse(authorizationUrl),
            mode: LaunchMode.platformDefault,
          );
        }
      } else {
        showMessage(
          '$serverMessage Status: ${response.statusCode}',
        );
      }
    } on http.ClientException catch (error) {
      print('HTTP CLIENT ERROR: $error');

      showMessage(
        'Unable to connect to Servicepay server.',
      );
    } catch (error) {
      print('WALLET FUNDING ERROR: $error');

      showMessage(
        error.toString().replaceFirst('Exception: ', ''),
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
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('Wallet'),
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.green,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                children: [
                  const Text(
                    'Wallet Balance',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '₦${walletBalance.toStringAsFixed(2)}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 32,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 30),
            TextField(
              controller: amountController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: 'Amount',
                prefixText: '₦ ',
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: isLoading ? null : fundWallet,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: isLoading
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'Fund Wallet',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
