import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  String businessName = '';
  String businessWalletId = '';

  List<Map<String, dynamic>> transactions = <Map<String, dynamic>>[];

  List<Map<String, dynamic>> withdrawals = <Map<String, dynamic>>[];

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

      if (value.isEmpty) {
        continue;
      }

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

    return '';
  }

  double toDouble(dynamic value) {
    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  String money(dynamic value) {
    return '₦${toDouble(value).toStringAsFixed(2)}';
  }

  void showMessage(
    String message, {
    bool error = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? Colors.red.shade700 : null,
      ),
    );
  }

  Future<void> loadWallet() async {
    try {
      final token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Session expired. Please log in again.',
        );
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

      Map<String, dynamic> data = <String, dynamic>{};

      try {
        final decoded = jsonDecode(response.body);

        if (decoded is Map) {
          data = Map<String, dynamic>.from(
            decoded,
          );
        }
      } catch (_) {}

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw Exception(
          data['message']?.toString() ?? 'Unable to load Business Wallet.',
        );
      }

      final wallet = Map<String, dynamic>.from(
        data['wallet'] is Map ? data['wallet'] : <String, dynamic>{},
      );

      final businessProfile = Map<String, dynamic>.from(
        data['businessProfile'] is Map
            ? data['businessProfile']
            : <String, dynamic>{},
      );

      final rawTransactions = data['transactions'];

      final rawWithdrawals = data['withdrawals'];

      if (!mounted) return;

      setState(() {
        balance = toDouble(wallet['balance']);

        lockedBalance = toDouble(
          wallet['lockedBalance'],
        );

        availableBalance = toDouble(
          wallet['availableBalance'],
        );

        personalWalletBalance = toDouble(
          wallet['personalWalletBalance'],
        );

        businessName = businessProfile['businessName']?.toString().trim() ?? '';

        businessWalletId = businessProfile['businessWalletId']
                ?.toString()
                .trim()
                .toUpperCase() ??
            '';

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

        withdrawals = rawWithdrawals is List
            ? rawWithdrawals
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
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
      });

      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
        error: true,
      );
    }
  }

  Future<void> setupBusinessProfile() async {
    final controller = TextEditingController(
      text: businessName,
    );

    final name = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              8,
              20,
              MediaQuery.of(sheetContext).viewInsets.bottom + 24,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  'Business Profile',
                  style: TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFF17231D),
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Your Business ID will be used to receive transfers from other ServicePay businesses.',
                  style: TextStyle(
                    color: Color(0xFF718078),
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: controller,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Business Name',
                    hintText: 'e.g. Danlaushi Stores',
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
                      final value = controller.text.trim();

                      if (value.length < 2) {
                        ScaffoldMessenger.of(
                          sheetContext,
                        ).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Please enter a valid business name.',
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
                      'Save Business Profile',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );

    controller.dispose();

    if (name == null) {
      return;
    }

    try {
      final token = await getToken();

      final response = await http
          .post(
            Uri.parse(
              '$baseUrl/business-wallet/profile',
            ),
            headers: <String, String>{
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({
              'businessName': name,
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

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw Exception(
          data['message']?.toString() ?? 'Unable to save business profile.',
        );
      }

      showMessage(
        data['message']?.toString() ?? 'Business profile saved successfully.',
      );

      await loadWallet();
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
        error: true,
      );
    }
  }

  Future<void> copyBusinessId() async {
    if (businessWalletId.isEmpty) {
      await setupBusinessProfile();
      return;
    }

    await Clipboard.setData(
      ClipboardData(
        text: businessWalletId,
      ),
    );

    showMessage(
      'Business ID copied.',
    );
  }

  Future<void> showMoveMoneySheet({
    required bool toBusiness,
  }) async {
    final controller = TextEditingController();

    final amount = await showModalBottomSheet<double>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              8,
              20,
              MediaQuery.of(sheetContext).viewInsets.bottom + 24,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  toBusiness
                      ? 'Fund Business Wallet'
                      : 'Move to Personal Wallet',
                  style: const TextStyle(
                    fontSize: 21,
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
                  autofocus: true,
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
            Uri.parse(
              '$baseUrl$endpoint',
            ),
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

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw Exception(
          data['message']?.toString() ?? 'Transaction failed.',
        );
      }

      showMessage(
        data['message']?.toString() ?? 'Transaction successful.',
      );

      await loadWallet();
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
        error: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }

  Future<Map<String, dynamic>> resolveBusiness(
    String businessId,
  ) async {
    final token = await getToken();

    final response = await http
        .post(
          Uri.parse(
            '$baseUrl/business-wallet/resolve',
          ),
          headers: <String, String>{
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: jsonEncode({
            'businessWalletId': businessId,
          }),
        )
        .timeout(
          const Duration(seconds: 30),
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

    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        data['success'] != true) {
      throw Exception(
        data['message']?.toString() ?? 'Business Wallet not found.',
      );
    }

    return Map<String, dynamic>.from(
      data['business'] is Map ? data['business'] : <String, dynamic>{},
    );
  }

  Future<void> showBusinessTransferSheet() async {
    if (businessWalletId.isEmpty) {
      await setupBusinessProfile();
      return;
    }

    final idController = TextEditingController();

    final amountController = TextEditingController();

    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              8,
              20,
              MediaQuery.of(sheetContext).viewInsets.bottom + 24,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  'Business Transfer',
                  style: TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Available: ${money(availableBalance)}',
                  style: const TextStyle(
                    color: Color(0xFF718078),
                  ),
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: idController,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: 'Beneficiary Business ID',
                    hintText: 'SPB-XXXXX-XXXXXX',
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
                      final id = idController.text.trim().toUpperCase();

                      final amount = double.tryParse(
                        amountController.text.trim(),
                      );

                      if (id.isEmpty || amount == null || amount < 100) {
                        ScaffoldMessenger.of(
                          sheetContext,
                        ).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Enter a valid Business ID and minimum ₦100.',
                            ),
                          ),
                        );
                        return;
                      }

                      Navigator.pop(
                        sheetContext,
                        <String, dynamic>{
                          'businessWalletId': id,
                          'amount': amount,
                        },
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
          ),
        );
      },
    );

    idController.dispose();
    amountController.dispose();

    if (result == null) {
      return;
    }

    await transferBusinessToBusiness(
      businessWalletId: result['businessWalletId'].toString(),
      amount: toDouble(
        result['amount'],
      ),
    );
  }

  Future<void> transferBusinessToBusiness({
    required String businessWalletId,
    required double amount,
  }) async {
    if (isSubmitting) {
      return;
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      final business = await resolveBusiness(
        businessWalletId,
      );

      if (!mounted) {
        return;
      }

      final businessDisplayName =
          business['businessName']?.toString().trim() ?? 'ServicePay Business';

      final resolvedId =
          business['businessWalletId']?.toString().trim() ?? businessWalletId;

      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text(
              'Confirm Business Transfer',
            ),
            content: Text(
              'Send ${money(amount)} to '
              '$businessDisplayName\n\n'
              'Business ID: $resolvedId',
            ),
            actions: <Widget>[
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
                style: FilledButton.styleFrom(
                  backgroundColor: primaryGreen,
                ),
                onPressed: () {
                  Navigator.pop(
                    dialogContext,
                    true,
                  );
                },
                child: const Text(
                  'Send',
                ),
              ),
            ],
          );
        },
      );

      if (confirmed != true) {
        return;
      }

      final token = await getToken();

      final response = await http
          .post(
            Uri.parse(
              '$baseUrl/business-wallet/transfer',
            ),
            headers: <String, String>{
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({
              'businessWalletId': resolvedId,
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

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw Exception(
          data['message']?.toString() ?? 'Business transfer failed.',
        );
      }

      showMessage(
        data['message']?.toString() ?? 'Business transfer successful.',
      );

      await loadWallet();
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
        error: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }

  Future<void> showWithdrawalRequestSheet() async {
    if (availableBalance < 100) {
      showMessage(
        'Minimum available Business Wallet balance is ₦100.',
        error: true,
      );
      return;
    }

    final amountController = TextEditingController();
    final bankController = TextEditingController();
    final accountNumberController = TextEditingController();
    final accountNameController = TextEditingController();

    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              8,
              20,
              MediaQuery.of(sheetContext).viewInsets.bottom + 24,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    'Withdrawal Request',
                    style: TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Available: ${money(availableBalance)}',
                    style: const TextStyle(
                      color: Color(0xFF718078),
                    ),
                  ),
                  const SizedBox(height: 18),
                  TextField(
                    controller: amountController,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Amount',
                      prefixText: '₦ ',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: bankController,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Bank Name',
                      hintText: 'e.g. Access Bank',
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
                      counterText: '',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: accountNameController,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Account Name',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF8E7),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Text(
                      'The requested amount will be locked until Head Office approves, rejects, or completes the payout.',
                      style: TextStyle(
                        fontSize: 11.5,
                        height: 1.4,
                        color: Color(0xFF725F27),
                      ),
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
                        final amount = double.tryParse(
                          amountController.text.trim(),
                        );

                        final bank = bankController.text.trim();

                        final accountNumber =
                            accountNumberController.text.trim();

                        final accountName = accountNameController.text.trim();

                        if (amount == null || amount < 100) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Minimum withdrawal amount is ₦100.',
                              ),
                            ),
                          );
                          return;
                        }

                        if (amount > availableBalance) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Amount exceeds available Business Wallet balance.',
                              ),
                            ),
                          );
                          return;
                        }

                        if (bank.isEmpty ||
                            !RegExp(r'^\d{10}$').hasMatch(accountNumber) ||
                            accountName.length < 2) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Please enter valid bank account details.',
                              ),
                            ),
                          );
                          return;
                        }

                        Navigator.pop(
                          sheetContext,
                          <String, dynamic>{
                            'amount': amount,
                            'bankName': bank,
                            'accountNumber': accountNumber,
                            'accountName': accountName,
                          },
                        );
                      },
                      child: const Text(
                        'Submit Withdrawal Request',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );

    amountController.dispose();
    bankController.dispose();
    accountNumberController.dispose();
    accountNameController.dispose();

    if (result == null) return;

    await requestBusinessWithdrawal(result);
  }

  Future<void> requestBusinessWithdrawal(
    Map<String, dynamic> request,
  ) async {
    if (isSubmitting) return;

    setState(() {
      isSubmitting = true;
    });

    try {
      final token = await getToken();

      final response = await http
          .post(
            Uri.parse(
              '$baseUrl/business-wallet/withdrawals',
            ),
            headers: <String, String>{
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode(request),
          )
          .timeout(
            const Duration(seconds: 40),
          );

      Map<String, dynamic> data = <String, dynamic>{};

      try {
        final decoded = jsonDecode(response.body);

        if (decoded is Map) {
          data = Map<String, dynamic>.from(decoded);
        }
      } catch (_) {}

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw Exception(
          data['message']?.toString() ?? 'Unable to submit withdrawal request.',
        );
      }

      showMessage(
        data['message']?.toString() ??
            'Withdrawal request submitted successfully.',
      );

      await loadWallet();
    } catch (error) {
      showMessage(
        error.toString().replaceFirst('Exception: ', ''),
        error: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }

  Widget buildWithdrawalCard(
    Map<String, dynamic> item,
  ) {
    final status = item['status']?.toString().toUpperCase() ?? 'PENDING';

    final bank = item['bankName']?.toString() ?? '';

    final number = item['accountNumber']?.toString() ?? '';

    final reference = item['reference']?.toString() ?? '';

    Color statusColor;
    IconData statusIcon;

    switch (status) {
      case 'PAID':
        statusColor = primaryGreen;
        statusIcon = Icons.check_circle_rounded;
        break;

      case 'APPROVED':
        statusColor = const Color(0xFFB7791F);
        statusIcon = Icons.verified_rounded;
        break;

      case 'REJECTED':
        statusColor = Colors.red.shade700;
        statusIcon = Icons.cancel_rounded;
        break;

      default:
        statusColor = const Color(0xFF64746C);
        statusIcon = Icons.schedule_rounded;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: const Color(0xFFEDF1EF),
        ),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            statusIcon,
            color: statusColor,
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '$bank • $number',
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '$status${reference.isNotEmpty ? ' • $reference' : ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: Color(0xFF7A8780),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            money(item['amount']),
            style: const TextStyle(
              fontWeight: FontWeight.w900,
              color: Color(0xFF26362E),
            ),
          ),
        ],
      ),
    );
  }

  Widget buildBusinessProfileCard() {
    final configured = businessWalletId.isNotEmpty;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(19),
        border: Border.all(
          color: const Color(0xFFE7ECE9),
        ),
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: const Color(0xFFEAF7F0),
              borderRadius: BorderRadius.circular(
                14,
              ),
            ),
            child: const Icon(
              Icons.storefront_rounded,
              color: primaryGreen,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  configured
                      ? (businessName.isEmpty
                          ? 'ServicePay Business'
                          : businessName)
                      : 'Set up Business Profile',
                  style: const TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFF17231D),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  configured
                      ? businessWalletId
                      : 'Create your unique Business ID',
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: Color(0xFF718078),
                  ),
                ),
              ],
            ),
          ),
          if (configured)
            IconButton(
              tooltip: 'Copy Business ID',
              onPressed: copyBusinessId,
              icon: const Icon(
                Icons.copy_rounded,
                color: primaryGreen,
                size: 20,
              ),
            ),
          IconButton(
            tooltip: configured ? 'Edit Business' : 'Create Business',
            onPressed: setupBusinessProfile,
            icon: Icon(
              configured ? Icons.edit_rounded : Icons.arrow_forward_ios_rounded,
              color: primaryGreen,
              size: 20,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildTransactionCard(
    Map<String, dynamic> item,
  ) {
    final direction = item['direction']?.toString().toUpperCase() ?? '';

    final credit = direction == 'CREDIT';

    final narration = item['narration']?.toString().trim() ?? '';

    final reference = item['reference']?.toString().trim() ?? '';

    return Container(
      margin: const EdgeInsets.only(
        bottom: 10,
      ),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: const Color(0xFFEDF1EF),
        ),
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: const Color(0xFFEAF7F0),
              shape: BoxShape.circle,
            ),
            child: Icon(
              credit ? Icons.south_west_rounded : Icons.north_east_rounded,
              color: primaryGreen,
              size: 21,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  narration.isNotEmpty ? narration : 'Business transaction',
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF26362E),
                  ),
                ),
                if (reference.isNotEmpty) ...[
                  const SizedBox(
                    height: 4,
                  ),
                  Text(
                    reference,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 10.5,
                      color: Color(
                        0xFF7A8780,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${credit ? '+' : '-'}${money(item['amount'])}',
            style: TextStyle(
              fontWeight: FontWeight.w900,
              color: credit
                  ? primaryGreen
                  : const Color(
                      0xFF4C5A53,
                    ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
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
                  32,
                ),
                children: <Widget>[
                  buildBusinessProfileCard(),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(
                      21,
                    ),
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
                      boxShadow: const <BoxShadow>[
                        BoxShadow(
                          color: Color(
                            0x1C08783E,
                          ),
                          blurRadius: 18,
                          offset: Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text(
                          'Business Balance',
                          style: TextStyle(
                            color: Color(
                              0xFFD9EFE5,
                            ),
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
                            color: Color(
                              0xFFD9EFE5,
                            ),
                          ),
                        ),
                        if (lockedBalance > 0) ...[
                          const SizedBox(
                            height: 4,
                          ),
                          Text(
                            'Locked ${money(lockedBalance)}',
                            style: const TextStyle(
                              color: Color(
                                0xFFCAE7D8,
                              ),
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
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
                      const SizedBox(width: 9),
                      Expanded(
                        child: _ActionCard(
                          icon: Icons.swap_horiz_rounded,
                          title: 'Transfer',
                          onTap:
                              isSubmitting ? null : showBusinessTransferSheet,
                        ),
                      ),
                      const SizedBox(width: 9),
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
                  const SizedBox(height: 10),
                  _WideActionCard(
                    icon: Icons.account_balance_rounded,
                    title: 'Withdraw',
                    subtitle: 'Request payout to your bank account',
                    onTap: isSubmitting ? null : showWithdrawalRequestSheet,
                  ),
                  const SizedBox(height: 24),
                  if (withdrawals.isNotEmpty) ...[
                    const Text(
                      'Withdrawal Requests',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF17231D),
                      ),
                    ),
                    const SizedBox(height: 11),
                    ...withdrawals.map(
                      buildWithdrawalCard,
                    ),
                    const SizedBox(height: 16),
                  ],
                  const Text(
                    'Recent Business Transactions',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF17231D),
                    ),
                  ),
                  const SizedBox(height: 11),
                  if (transactions.isEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        vertical: 30,
                        horizontal: 20,
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
                            color: Color(
                              0xFF7B8B83,
                            ),
                          ),
                          SizedBox(
                            height: 9,
                          ),
                          Text(
                            'No Business Wallet transactions yet.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: Color(
                                0xFF68766F,
                              ),
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    ...transactions.map(
                      buildTransactionCard,
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
  Widget build(
    BuildContext context,
  ) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            vertical: 17,
            horizontal: 4,
          ),
          child: Column(
            children: <Widget>[
              Container(
                width: 43,
                height: 43,
                decoration: BoxDecoration(
                  color: const Color(
                    0xFFEAF7F0,
                  ),
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                ),
                child: Icon(
                  icon,
                  color: const Color(
                    0xFF08783E,
                  ),
                  size: 22,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                title,
                maxLines: 1,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11.5,
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

class _WideActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _WideActionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
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
            horizontal: 15,
            vertical: 13,
          ),
          child: Row(
            children: <Widget>[
              Container(
                width: 43,
                height: 43,
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF7F0),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  icon,
                  color: const Color(0xFF08783E),
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontSize: 10.8,
                        color: Color(0xFF718078),
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.arrow_forward_ios_rounded,
                size: 16,
                color: Color(0xFF08783E),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
