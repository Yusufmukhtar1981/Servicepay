import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class TransferScreen extends StatefulWidget {
  const TransferScreen({super.key});

  @override
  State<TransferScreen> createState() => _TransferScreenState();
}

class _TransferScreenState extends State<TransferScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final phoneController = TextEditingController();
  final amountController = TextEditingController();

  bool isLoading = false;

  @override
  void dispose() {
    phoneController.dispose();
    amountController.dispose();
    super.dispose();
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

  Future<void> transferMoney() async {
    final receiverPhone = phoneController.text.trim();
    final amountText = amountController.text.trim();
    final amount = double.tryParse(amountText);

    if (receiverPhone.isEmpty) {
      showMessage('Enter the receiver's phone number.');
      return;
    }

    if (amount == null || amount <= 0) {
      showMessage('Enter a valid amount.');
      return;
    }

    setState(() {
      isLoading = true;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token');

      if (token == null || token.isEmpty) {
        showMessage('Please login again.');
        return;
      }

      final response = await http.post(
        Uri.parse('$baseUrl/transfer/servicepay'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'receiverPhone': receiverPhone,
          'amount': amount,
        }),
      );

      final dynamic decoded = jsonDecode(response.body);

      if (decoded is! Map<String, dynamic>) {
        showMessage('The server returned an invalid response.');
        return;
      }

      final result = decoded;

      if (response.statusCode == 200 && result['success'] == true) {
        final transferData = result['data'];
        final senderData = transferData is Map<String, dynamic>
            ? transferData['sender']
            : null;
        final walletBalance = num.tryParse(
              senderData is Map<String, dynamic>
                  ? senderData['walletBalance']?.toString() ?? '0'
                  : result['walletBalance']?.toString() ?? '0',
            ) ??
            0;

        await prefs.setDouble(
          'wallet_balance',
          walletBalance.toDouble(),
        );

        phoneController.clear();
        amountController.clear();

        showMessage(
          result['message']?.toString() ?? 'Transfer completed successfully.',
        );
      } else {
        showMessage(
          result['message']?.toString() ?? 'Transfer failed.',
        );
      }
    } on FormatException {
      showMessage('The server returned an invalid response.');
    } on http.ClientException {
      showMessage('Unable to connect to Servicepay server.');
    } catch (error) {
      showMessage('An error occurred: $error');
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
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Servicepay Transfer',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.green,
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Column(
                children: [
                  Icon(
                    Icons.swap_horiz_rounded,
                    color: Colors.white,
                    size: 52,
                  ),
                  SizedBox(height: 10),
                  Text(
                    'Servicepay to Servicepay',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 21,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  SizedBox(height: 6),
                  Text(
                    'Send money instantly to another Servicepay user.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white70,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: phoneController,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: 'Receiver phone number',
                hintText: '08000000002',
                prefixIcon: const Icon(Icons.phone_outlined),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 18),
            TextField(
              controller: amountController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) {
                if (!isLoading) {
                  transferMoney();
                }
              },
              decoration: InputDecoration(
                labelText: 'Amount',
                hintText: '1000',
                prefixText: '₦ ',
                prefixIcon: const Icon(
                  Icons.account_balance_wallet_outlined,
                ),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 26),
            SizedBox(
              height: 54,
              child: ElevatedButton.icon(
                onPressed: isLoading ? null : transferMoney,
                icon: isLoading
                    ? const SizedBox.shrink()
                    : const Icon(Icons.send_rounded),
                label: isLoading
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'Transfer Money',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
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
