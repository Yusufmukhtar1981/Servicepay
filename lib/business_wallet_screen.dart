import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class BusinessWalletScreen extends StatefulWidget {
  const BusinessWalletScreen({super.key});

  @override
  State<BusinessWalletScreen> createState() => _BusinessWalletScreenState();
}

class _BusinessWalletScreenState extends State<BusinessWalletScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  bool isLoading = true;
  bool isSubmitting = false;

  double balance = 0;
  double lockedBalance = 0;
  double availableBalance = 0;
  double personalWalletBalance = 0;

  List<Map<String, dynamic>> transactions = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    loadWallet();
  }

  Future<String> getToken() async {
    final prefs = await SharedPreferences.getInstance();

    const keys = <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final key in keys) {
      final value = prefs.getString(key)?.trim() ?? '';

      if (value.isNotEmpty) {
        return value
            .replaceFirst(
              RegExp(
                r'^Bearer\s+',
                caseSensitive: false,
              ),
              '',
            )
            .trim();
      }
    }

    return '';
  }

  String money(dynamic value) {
    final amount = double.tryParse(value.toString()) ?? 0;

    return '₦${amount.toStringAsFixed(2)}';
  }

  Future<void> loadWallet() async {
    try {
      final token = await getToken();

      if (token.isEmpty) {
        throw Exception('Session expired.');
      }

      final response = await http.get(
        Uri.parse(
          '$baseUrl/business-wallet',
        ),
        headers: <String, String>{
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      ).timeout(
        const Duration(seconds: 40),
      );

      final decoded = jsonDecode(response.body);

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          decoded is! Map) {
        throw Exception(
          'Unable to load Business Wallet.',
        );
      }

      final data = Map<String, dynamic>.from(decoded);

      final wallet = Map<String, dynamic>.from(
        data['wallet'] is Map ? data['wallet'] : <String, dynamic>{},
      );

      final rawTransactions = data['transactions'];

      if (!mounted) {
        return;
      }

      setState(() {
        balance = double.tryParse(
              wallet['balance'].toString(),
            ) ??
            0;

        lockedBalance = double.tryParse(
              wallet['lockedBalance'].toString(),
            ) ??
            0;

        availableBalance = double.tryParse(
              wallet['availableBalance'].toString(),
            ) ??
            0;

        personalWalletBalance = double.tryParse(
              wallet['personalWalletBalance'].toString(),
            ) ??
            0;

        transactions = rawTransactions is List
            ? rawTransactions
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(
                    item,
                  ),
                )
                .toList()
            : <Map<String, dynamic>>[];

        isLoading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Unable to load Business Wallet.',
          ),
        ),
      );
    }
  }

  Future<void> showMoveMoneySheet({
    required bool toBusiness,
  }) async {
    final controller = TextEditingController();

    final amount = await showModalBottomSheet<double>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            6,
            20,
            MediaQuery.of(sheetContext).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                toBusiness ? 'Fund Business Wallet' : 'Move to Personal Wallet',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                toBusiness
                    ? 'Personal Wallet: ${money(personalWalletBalance)}'
                    : 'Available Business Balance: ${money(availableBalance)}',
                style: const TextStyle(
                  color: Color(0xFF718078),
                ),
              ),
              const SizedBox(height: 18),
              TextField(
                controller: controller,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Amount',
                  prefixText: '₦ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  onPressed: () {
                    final value = double.tryParse(
                      controller.text.trim(),
                    );

                    if (value == null || value < 100) {
                      ScaffoldMessenger.of(
                        sheetContext,
                      ).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Minimum amount is ₦100.',
                          ),
                        ),
                      );
                      return;
                    }

                    Navigator.pop(
                      sheetContext,
                      value,
                    );
                  },
                  child: const Text(
                    'Continue',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );

    controller.dispose();

    if (amount == null) {
      return;
    }

    await moveMoney(
      amount: amount,
      toBusiness: toBusiness,
    );
  }

  Future<void> moveMoney({
    required double amount,
    required bool toBusiness,
  }) async {
    if (isSubmitting) {
      return;
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      final token = await getToken();

      final endpoint =
          toBusiness ? '/business-wallet/fund' : '/business-wallet/to-personal';

      final response = await http
          .post(
            Uri.parse('$baseUrl$endpoint'),
            headers: <String, String>{
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({
              'amount': amount,
            }),
          )
          .timeout(
            const Duration(seconds: 40),
          );

      Map<String, dynamic> data = <String, dynamic>{};

      try {
        final decoded = jsonDecode(response.body);

        if (decoded is Map) {
          data = Map<String, dynamic>.from(
            decoded,
          );
        }
      } catch (_) {}

      final success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true;

      if (!success) {
        throw Exception(
          data['message']?.toString() ?? 'Transaction failed.',
        );
      }

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            data['message']?.toString() ?? 'Transaction successful.',
          ),
        ),
      );

      await loadWallet();
    } catch (error) {
      if (!mounted) {
        return;
      }

      final message = error.toString().replaceFirst(
            'Exception: ',
            '',
          );

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'Business Wallet',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        backgroundColor: const Color(0xFFF7F9F8),
        surfaceTintColor: Colors.transparent,
      ),
      body: RefreshIndicator(
        onRefresh: loadWallet,
        child: isLoading
            ? const Center(
                child: CircularProgressIndicator(),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(
                  18,
                  8,
                  18,
                  30,
                ),
                children: <Widget>[
                  Container(
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(
                        24,
                      ),
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: <Color>[
                          Color(0xFF075C3A),
                          Color(0xFF13A257),
                        ],
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text(
                          'Business Balance',
                          style: TextStyle(
                            color: Color(0xFFD9EFE5),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(
                          height: 9,
                        ),
                        Text(
                          money(balance),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 34,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(
                          height: 8,
                        ),
                        Text(
                          'Available ${money(availableBalance)}',
                          style: const TextStyle(
                            color: Color(0xFFD9EFE5),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: _ActionCard(
                          icon: Icons.add_rounded,
                          title: 'Fund',
                          onTap: isSubmitting
                              ? null
                              : () => showMoveMoneySheet(
                                    toBusiness: true,
                                  ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _ActionCard(
                          icon: Icons.account_balance_wallet_outlined,
                          title: 'To Personal',
                          onTap: isSubmitting
                              ? null
                              : () => showMoveMoneySheet(
                                    toBusiness: false,
                                  ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Recent Business Transactions',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 10),
                  if (transactions.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(
                        24,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(
                          18,
                        ),
                      ),
                      child: const Column(
                        children: <Widget>[
                          Icon(
                            Icons.receipt_long_outlined,
                            size: 34,
                            color: Color(0xFF7B8B83),
                          ),
                          SizedBox(height: 9),
                          Text(
                            'No Business Wallet transactions yet.',
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    )
                  else
                    ...transactions.map(
                      (item) {
                        final direction = item['direction']?.toString() ?? '';

                        final credit = direction == 'CREDIT';

                        return Container(
                          margin: const EdgeInsets.only(
                            bottom: 9,
                          ),
                          padding: const EdgeInsets.all(
                            14,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(
                              16,
                            ),
                          ),
                          child: Row(
                            children: <Widget>[
                              CircleAvatar(
                                backgroundColor: const Color(
                                  0xFFEAF7F0,
                                ),
                                child: Icon(
                                  credit
                                      ? Icons.south_west_rounded
                                      : Icons.north_east_rounded,
                                  color: primaryGreen,
                                ),
                              ),
                              const SizedBox(
                                width: 12,
                              ),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Text(
                                      item['narration']?.toString() ??
                                          item['type']?.toString() ??
                                          'Business transaction',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    const SizedBox(
                                      height: 3,
                                    ),
                                    Text(
                                      item['reference']?.toString() ?? '',
                                      style: const TextStyle(
                                        fontSize: 10.5,
                                        color: Color(
                                          0xFF7A8780,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                '${credit ? '+' : '-'}${money(item['amount'])}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                  color: Color(
                                    0xFF08783E,
                                  ),
                                ),
                              ),
                            ],
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

class _ActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback? onTap;

  const _ActionCard({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            vertical: 18,
          ),
          child: Column(
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF7F0),
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                ),
                child: Icon(
                  icon,
                  color: const Color(0xFF08783E),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
