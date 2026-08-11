import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'feature_transaction_pin_dialog.dart';

class WithdrawalScreen extends StatefulWidget {
  const WithdrawalScreen({super.key});

  @override
  State<WithdrawalScreen> createState() => _WithdrawalScreenState();
}

class _WithdrawalScreenState extends State<WithdrawalScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final bankController = TextEditingController();
  final accountNumberController = TextEditingController();
  final accountNameController = TextEditingController();
  final amountController = TextEditingController();

  bool isSubmitting = false;
  bool isLoadingHistory = true;

  List<Map<String, dynamic>> withdrawals = [];

  @override
  void initState() {
    super.initState();
    loadWithdrawals();
  }

  @override
  void dispose() {
    bankController.dispose();
    accountNumberController.dispose();
    accountNameController.dispose();
    amountController.dispose();
    super.dispose();
  }

  Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();

    for (final key in [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final value = prefs.getString(key)?.trim();

      if (value != null && value.isNotEmpty) {
        return value.replaceFirst(
          'Bearer ',
          '',
        );
      }
    }

    return null;
  }

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  Future<void> loadWithdrawals() async {
    setState(() {
      isLoadingHistory = true;
    });

    try {
      final token = await getToken();

      final response = await http.get(
        Uri.parse(
          '$baseUrl/withdrawals/my',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      final raw = data['withdrawals'];

      withdrawals = raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => Map<String, dynamic>.from(
                  item,
                ),
              )
              .toList()
          : [];
    } catch (_) {
      showMessage(
        'Unable to load withdrawals.',
      );
    }

    if (!mounted) return;

    setState(() {
      isLoadingHistory = false;
    });
  }

  Future<void> submitWithdrawal() async {
    final bank = bankController.text.trim();
    final accountNumber = accountNumberController.text.trim();
    final accountName = accountNameController.text.trim();

    final amount = double.tryParse(
      amountController.text.replaceAll(',', '').trim(),
    );

    if (bank.isEmpty ||
        accountName.isEmpty ||
        accountNumber.length != 10 ||
        amount == null ||
        amount < 100) {
      showMessage(
        'Complete all fields correctly. Minimum withdrawal is ₦100.',
      );
      return;
    }

    final pin = await showFeatureTransactionPinDialog(
      context,
      title: 'Confirm Withdrawal',
      message:
          'Request withdrawal of ₦${amount.toStringAsFixed(0)} to $bank • $accountNumber.',
    );

    if (pin == null) return;

    setState(() {
      isSubmitting = true;
    });

    try {
      final token = await getToken();

      final response = await http.post(
        Uri.parse(
          '$baseUrl/withdrawals/request',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'bankName': bank,
          'accountNumber': accountNumber,
          'accountName': accountName,
          'amount': amount,
          'transactionPin': pin,
        }),
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      showMessage(
        data['message']?.toString() ?? 'Withdrawal request submitted.',
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        bankController.clear();
        accountNumberController.clear();
        accountNameController.clear();
        amountController.clear();

        await loadWithdrawals();
      }
    } catch (_) {
      showMessage(
        'Unable to submit withdrawal.',
      );
    }

    if (!mounted) return;

    setState(() {
      isSubmitting = false;
    });
  }

  Color statusColor(String status) {
    switch (status) {
      case 'APPROVED':
        return Colors.green;
      case 'REJECTED':
        return Colors.red;
      default:
        return Colors.orange;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Withdrawal'),
      ),
      body: RefreshIndicator(
        onRefresh: loadWithdrawals,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: const Color(
                  0xFFEAF7F0,
                ),
                borderRadius: BorderRadius.circular(
                  18,
                ),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.account_balance_wallet_rounded,
                    color: primaryGreen,
                    size: 32,
                  ),
                  SizedBox(height: 10),
                  Text(
                    'Request a Withdrawal',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(height: 6),
                  Text(
                    'Your requested amount will be reserved while Head Office reviews and processes your bank payment.',
                    style: TextStyle(
                      color: Colors.black54,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            TextField(
              controller: bankController,
              decoration: const InputDecoration(
                labelText: 'Bank Name',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: accountNumberController,
              keyboardType: TextInputType.number,
              maxLength: 10,
              decoration: const InputDecoration(
                labelText: 'Account Number',
                border: OutlineInputBorder(),
                counterText: '',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: accountNameController,
              decoration: const InputDecoration(
                labelText: 'Account Name',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: amountController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Withdrawal Amount',
                prefixText: '₦ ',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: isSubmitting ? null : submitWithdrawal,
              style: FilledButton.styleFrom(
                backgroundColor: primaryGreen,
                padding: const EdgeInsets.symmetric(
                  vertical: 16,
                ),
              ),
              icon: isSubmitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(
                      Icons.arrow_circle_down_rounded,
                    ),
              label: Text(
                isSubmitting ? 'Submitting...' : 'Request Withdrawal',
              ),
            ),
            const SizedBox(height: 26),
            const Text(
              'Withdrawal History',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 12),
            if (isLoadingHistory)
              const Center(
                child: CircularProgressIndicator(),
              )
            else if (withdrawals.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(
                  vertical: 24,
                ),
                child: Center(
                  child: Text(
                    'No withdrawal requests yet.',
                  ),
                ),
              )
            else
              ...withdrawals.map(
                (item) {
                  final status = item['status']?.toString() ?? 'PENDING';

                  return Card(
                    margin: const EdgeInsets.only(
                      bottom: 10,
                    ),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: statusColor(
                          status,
                        ).withValues(
                          alpha: 0.12,
                        ),
                        child: Icon(
                          Icons.payments_rounded,
                          color: statusColor(
                            status,
                          ),
                        ),
                      ),
                      title: Text(
                        '₦${item['amount'] ?? 0}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: Text(
                        '${item['bankName'] ?? '-'} • '
                        '${item['accountNumber'] ?? '-'}\n'
                        '${item['reference'] ?? ''}',
                      ),
                      isThreeLine: true,
                      trailing: Text(
                        status,
                        style: TextStyle(
                          color: statusColor(
                            status,
                          ),
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}
