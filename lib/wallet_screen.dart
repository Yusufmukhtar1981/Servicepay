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
  static const String baseUrl =
      'https://silver-space-orbit-wxw9x9rjrqx2ggr4-3000.app.github.dev/api';

  final amountController = TextEditingController();

  bool isLoading = false;
  bool isRefreshing = true;

  double walletBalance = 0;
  List<Map<String, dynamic>> transactions = [];

  @override
  void initState() {
    super.initState();
    refreshWallet();
  }

  @override
  void dispose() {
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

  Future<void> refreshWallet() async {
    if (mounted) {
      setState(() => isRefreshing = true);
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token');

      if (token == null || token.isEmpty) {
        showMessage('Please login again.');
        return;
      }

      final responses = await Future.wait([
        http.get(
          Uri.parse('$baseUrl/wallet'),
          headers: {
            'Authorization': 'Bearer $token',
            'Accept': 'application/json',
          },
        ),
        http.get(
          Uri.parse('$baseUrl/wallet/history?limit=30'),
          headers: {
            'Authorization': 'Bearer $token',
            'Accept': 'application/json',
          },
        ),
      ]);

      final walletBody = responses[0].body.trim();
      final historyBody = responses[1].body.trim();

      if (walletBody.isEmpty || walletBody.startsWith('<')) {
        throw Exception('Wallet server returned an invalid response.');
      }

      if (historyBody.isEmpty || historyBody.startsWith('<')) {
        throw Exception('Wallet history returned an invalid response.');
      }

      final walletResult = jsonDecode(walletBody);
      final historyResult = jsonDecode(historyBody);

      if (responses[0].statusCode == 200 &&
          walletResult['success'] == true) {
        final data = walletResult['data'];

        final newBalance =
            num.tryParse(data?['walletBalance']?.toString() ?? '0') ?? 0;

        await prefs.setDouble(
          'wallet_balance',
          newBalance.toDouble(),
        );

        if (mounted) {
          setState(() {
            walletBalance = newBalance.toDouble();
          });
        }
      } else {
        throw Exception(
          walletResult['message']?.toString() ??
              'Unable to load wallet.',
        );
      }

      if (responses[1].statusCode == 200 &&
          historyResult['success'] == true) {
        final data = historyResult['data'];

        if (mounted) {
          setState(() {
            transactions = data is List
                ? data
                    .whereType<Map>()
                    .map(
                      (item) => Map<String, dynamic>.from(item),
                    )
                    .toList()
                : [];
          });
        }
      }
    } catch (error) {
      final prefs = await SharedPreferences.getInstance();
      final savedBalance =
          prefs.getDouble('wallet_balance') ?? 0;

      if (mounted) {
        setState(() {
          walletBalance = savedBalance;
        });
      }

      showMessage(
        error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() => isRefreshing = false);
      }
    }
  }

  Future<void> verifyPayment(String reference) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token');

      if (token == null || token.isEmpty) {
        showMessage('Please login again.');
        return;
      }

      final response = await http.get(
        Uri.parse('$baseUrl/paystack/verify/$reference'),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      );

      final responseBody = response.body.trim();

      if (responseBody.isEmpty || responseBody.startsWith('<')) {
        showMessage(
          'Payment verification returned an invalid response.',
        );
        return;
      }

      final result = jsonDecode(responseBody);

      if (response.statusCode == 200 &&
          result['success'] == true) {
        amountController.clear();

        showMessage(
          result['message']?.toString() ??
              'Wallet funded successfully.',
        );

        await refreshWallet();
      } else {
        showMessage(
          result['message']?.toString() ??
              'Payment verification failed.',
        );
      }
    } on FormatException {
      showMessage(
        'Server returned an invalid verification response.',
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to ServicePay server.',
      );
    } catch (error) {
      showMessage(
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> fundWallet() async {
    final amount =
        double.tryParse(amountController.text.trim());

    if (amount == null || amount < 100) {
      showMessage('Minimum wallet funding is ₦100.');
      return;
    }

    if (mounted) {
      setState(() => isLoading = true);
    }

    try {
      final prefs = await SharedPreferences.getInstance();

      final token = prefs.getString('auth_token');
      final email = prefs.getString('user_email');

      if (token == null ||
          token.isEmpty ||
          email == null ||
          email.isEmpty) {
        showMessage('Please login again.');
        return;
      }

      final response = await http.post(
        Uri.parse('$baseUrl/paystack/initialize'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
        body: jsonEncode({
          'email': email,
          'amount': amount,
        }),
      );

      final responseBody = response.body.trim();

      if (responseBody.isEmpty || responseBody.startsWith('<')) {
        showMessage(
          'Server returned an invalid payment response.',
        );
        return;
      }

      final result = jsonDecode(responseBody);

      final serverMessage =
          result['message']?.toString() ??
              'Unable to initialize payment.';

      if (response.statusCode == 200 &&
          result['success'] == true) {
        final authorizationUrl =
            result['authorizationUrl']?.toString() ??
                result['data']?['authorization_url']
                    ?.toString() ??
                '';

        final reference =
            result['reference']?.toString() ??
                result['data']?['reference']?.toString() ??
                '';

        if (authorizationUrl.isEmpty) {
          showMessage('Payment link was not returned.');
          return;
        }

        if (reference.isEmpty) {
          showMessage(
            'Payment reference was not returned.',
          );
          return;
        }

        final opened = await launchUrl(
          Uri.parse(authorizationUrl),
          mode: LaunchMode.platformDefault,
        );

        if (!opened) {
          showMessage(
            'Unable to open Paystack payment page.',
          );
          return;
        }

        if (!mounted) return;

        final shouldVerify = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) {
            return AlertDialog(
              title: const Text('Complete Payment'),
              content: const Text(
                'After Paystack shows Payment Successful, return to ServicePay and press Verify Payment.',
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(dialogContext, false);
                  },
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  onPressed: () {
                    Navigator.pop(dialogContext, true);
                  },
                  child: const Text('Verify Payment'),
                ),
              ],
            );
          },
        );

        if (shouldVerify == true) {
          await verifyPayment(reference);
        }
      } else {
        showMessage(serverMessage);
      }
    } on FormatException {
      showMessage(
        'Server returned an invalid response.',
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to ServicePay server.',
      );
    } catch (error) {
      showMessage(
        error.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() => isLoading = false);
      }
    }
  }

  String formatDate(dynamic value) {
    final date =
        DateTime.tryParse(value?.toString() ?? '')
            ?.toLocal();

    if (date == null) return '';

    String two(int number) {
      return number.toString().padLeft(2, '0');
    }

    return '${two(date.day)}/${two(date.month)}/${date.year} '
        '${two(date.hour)}:${two(date.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('Wallet'),
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            onPressed: refreshWallet,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: refreshWallet,
        child: ListView(
          physics:
              const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.green,
                borderRadius:
                    BorderRadius.circular(20),
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
                  isRefreshing
                      ? const Padding(
                          padding: EdgeInsets.all(8),
                          child:
                              CircularProgressIndicator(
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          '₦${walletBalance.toStringAsFixed(2)}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 32,
                            fontWeight:
                                FontWeight.bold,
                          ),
                        ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: amountController,
              keyboardType:
                  const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: 'Amount',
                prefixText: '₦ ',
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius:
                      BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 52,
              child: ElevatedButton(
                onPressed:
                    isLoading ? null : fundWallet,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(14),
                  ),
                ),
                child: isLoading
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child:
                            CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'Fund Wallet',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight:
                              FontWeight.bold,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 28),
            const Text(
              'Recent Transactions',
              style: TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            if (!isRefreshing &&
                transactions.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(
                    child:
                        Text('No transactions yet'),
                  ),
                ),
              ),
            ...transactions.map((item) {
              final isCredit =
                  item['direction'] == 'CREDIT';

              final amount = num.tryParse(
                    item['amount']?.toString() ?? '0',
                  ) ??
                  0;

              return Card(
                margin:
                    const EdgeInsets.only(bottom: 10),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: isCredit
                        ? Colors.green.shade50
                        : Colors.red.shade50,
                    child: Icon(
                      isCredit
                          ? Icons.south_west
                          : Icons.north_east,
                      color: isCredit
                          ? Colors.green
                          : Colors.red,
                    ),
                  ),
                  title: Text(
                    item['title']?.toString() ??
                        'Transaction',
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    '${item['description'] ?? ''}\n'
                    '${formatDate(item['createdAt'])}',
                  ),
                  isThreeLine: true,
                  trailing: Text(
                    '${isCredit ? '+' : '-'}'
                    '₦${amount.toStringAsFixed(2)}',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: isCredit
                          ? Colors.green
                          : Colors.red,
                    ),
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}