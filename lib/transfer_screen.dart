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

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController phoneController = TextEditingController();

  final TextEditingController amountController = TextEditingController();

  bool isLoading = false;

  @override
  void dispose() {
    phoneController.dispose();
    amountController.dispose();
    super.dispose();
  }

  void showMessage(
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
          behavior: SnackBarBehavior.floating,
          backgroundColor:
              isError ? Colors.red.shade700 : Colors.green.shade700,
        ),
      );
  }

  String? validatePhone(
    String? value,
  ) {
    final String phone = value?.trim() ?? '';

    if (phone.isEmpty) {
      return "Enter recipient's phone number";
    }

    if (!RegExp(r'^\d+$').hasMatch(phone)) {
      return 'Phone number must contain numbers only';
    }

    if (phone.length != 11) {
      return 'Phone number must be exactly 11 digits';
    }

    return null;
  }

  String? validateAmount(
    String? value,
  ) {
    final String amountText = value?.trim() ?? '';

    if (amountText.isEmpty) {
      return 'Enter transfer amount';
    }

    final double? amount = double.tryParse(amountText);

    if (amount == null) {
      return 'Enter a valid amount';
    }

    if (amount <= 0) {
      return 'Amount must be greater than zero';
    }

    if (amount < 100) {
      return 'Minimum transfer amount is ₦100';
    }

    return null;
  }

  Map<String, dynamic> decodeResponse(
    String responseBody,
  ) {
    if (responseBody.trim().isEmpty) {
      return {};
    }

    try {
      final dynamic decoded = jsonDecode(responseBody);

      if (decoded is Map) {
        return Map<String, dynamic>.from(
          decoded,
        );
      }
    } catch (_) {
      return {};
    }

    return {};
  }

  double? extractWalletBalance(
    Map<String, dynamic> responseData,
  ) {
    final dynamic data = responseData['data'];

    if (data is Map) {
      final dynamic sender = data['sender'];

      if (sender is Map) {
        final dynamic senderBalance = sender['walletBalance'];

        if (senderBalance != null) {
          return double.tryParse(
            senderBalance.toString(),
          );
        }
      }

      final dynamic dataBalance = data['walletBalance'];

      if (dataBalance != null) {
        return double.tryParse(
          dataBalance.toString(),
        );
      }
    }

    final dynamic directBalance = responseData['walletBalance'] ??
        responseData['balance'] ??
        responseData['senderBalance'];

    if (directBalance != null) {
      return double.tryParse(
        directBalance.toString(),
      );
    }

    return null;
  }

  Future<void> transferMoney() async {
    FocusScope.of(context).unfocus();

    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    final String receiverPhone = phoneController.text.trim();

    final double amount = double.parse(
      amountController.text.trim(),
    );

    final bool? confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          title: const Text(
            'Confirm Transfer',
            style: TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          content: Text(
            'Transfer ₦${amount.toStringAsFixed(2)} to $receiverPhone?',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  false,
                );
              },
              child: const Text(
                'Cancel',
              ),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  true,
                );
              },
              child: const Text(
                'Confirm',
              ),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return;
    }

    if (!mounted) {
      return;
    }

    setState(() {
      isLoading = true;
    });

    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String token = preferences.getString(
            'auth_token',
          ) ??
          '';

      if (token.trim().isEmpty) {
        showMessage(
          'Your login session has expired. Please log in again.',
        );
        return;
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/transfer/servicepay',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },

            /*
                 * Backend expects receiverPhone,
                 * not recipientPhone.
                 */
            body: jsonEncode({
              'receiverPhone': receiverPhone,
              'amount': amount,
            }),
          )
          .timeout(
            const Duration(
              seconds: 45,
            ),
          );

      final Map<String, dynamic> responseData = decodeResponse(response.body);

      if (!mounted) {
        return;
      }

      final bool requestSuccessful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!requestSuccessful) {
        showMessage(
          responseData['message']?.toString() ??
              'Transfer failed. Please try again.',
        );
        return;
      }

      final double? newBalance = extractWalletBalance(
        responseData,
      );

      if (newBalance != null) {
        await preferences.setDouble(
          'wallet_balance',
          newBalance,
        );
      }

      final dynamic data = responseData['data'];

      String reference = '';

      String receiverName = '';

      if (data is Map) {
        reference = data['reference']?.toString() ?? '';

        final dynamic receiver = data['receiver'];

        if (receiver is Map) {
          receiverName = receiver['fullName']?.toString() ?? '';
        }
      }

      phoneController.clear();
      amountController.clear();

      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (
          BuildContext dialogContext,
        ) {
          return AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(22),
            ),
            icon: const Icon(
              Icons.check_circle_rounded,
              color: Colors.green,
              size: 64,
            ),
            title: const Text(
              'Transfer Successful',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '₦${amount.toStringAsFixed(2)} was transferred successfully${receiverName.isNotEmpty ? ' to $receiverName' : ''}.',
                  textAlign: TextAlign.center,
                ),
                if (reference.isNotEmpty) ...[
                  const SizedBox(
                    height: 14,
                  ),
                  Text(
                    'Reference: $reference',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Colors.grey,
                    ),
                  ),
                ],
              ],
            ),
            actions: [
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                    );
                  },
                  child: const Text(
                    'Done',
                  ),
                ),
              ),
            ],
          );
        },
      );

      if (mounted) {
        Navigator.pop(
          context,
          true,
        );
      }
    } catch (error) {
      if (!mounted) {
        return;
      }

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
  Widget build(
    BuildContext context,
  ) {
    final Color primaryColor = Theme.of(context).colorScheme.primary;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          'ServicePay Transfer',
        ),
      ),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Container(
                padding: const EdgeInsets.all(
                  20,
                ),
                decoration: BoxDecoration(
                  color: primaryColor,
                  borderRadius: BorderRadius.circular(
                    20,
                  ),
                ),
                child: const Row(
                  children: [
                    CircleAvatar(
                      radius: 29,
                      backgroundColor: Colors.white24,
                      child: Icon(
                        Icons.swap_horiz,
                        color: Colors.white,
                        size: 34,
                      ),
                    ),
                    SizedBox(
                      width: 15,
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Send Money',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 21,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          SizedBox(
                            height: 5,
                          ),
                          Text(
                            'Transfer money instantly to another ServicePay user.',
                            style: TextStyle(
                              color: Colors.white,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(
                height: 28,
              ),
              const Text(
                'Recipient Phone Number',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(
                height: 9,
              ),
              TextFormField(
                controller: phoneController,
                enabled: !isLoading,
                keyboardType: TextInputType.phone,
                maxLength: 11,
                validator: validatePhone,
                decoration: InputDecoration(
                  labelText: 'Phone Number',
                  hintText: "Enter recipient's phone number",
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.phone_outlined,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                      14,
                    ),
                  ),
                ),
              ),
              const SizedBox(
                height: 20,
              ),
              const Text(
                'Amount',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(
                height: 9,
              ),
              TextFormField(
                controller: amountController,
                enabled: !isLoading,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                validator: validateAmount,
                decoration: InputDecoration(
                  labelText: 'Transfer Amount',
                  hintText: 'Enter amount',
                  prefixText: '₦ ',
                  prefixIcon: const Icon(
                    Icons.payments_outlined,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                      14,
                    ),
                  ),
                ),
              ),
              const SizedBox(
                height: 18,
              ),
              Container(
                padding: const EdgeInsets.all(
                  15,
                ),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                  border: Border.all(
                    color: Colors.blue.shade100,
                  ),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.info_outline,
                      color: Colors.blue,
                    ),
                    SizedBox(
                      width: 10,
                    ),
                    Expanded(
                      child: Text(
                        'Confirm the recipient phone number before completing the transfer.',
                        style: TextStyle(
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(
                height: 25,
              ),
              SizedBox(
                height: 55,
                child: FilledButton.icon(
                  onPressed: isLoading ? null : transferMoney,
                  icon: isLoading
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.send_outlined,
                        ),
                  label: Text(
                    isLoading ? 'Processing...' : 'Transfer Money',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(
                height: 20,
              ),
              const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.lock_outline,
                    color: Colors.grey,
                    size: 20,
                  ),
                  SizedBox(
                    width: 8,
                  ),
                  Expanded(
                    child: Text(
                      'ServicePay-to-ServicePay transfers are protected and processed securely.',
                      style: TextStyle(
                        color: Colors.grey,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
