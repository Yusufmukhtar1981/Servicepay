import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class RiderWithdrawalScreen extends StatefulWidget {
  const RiderWithdrawalScreen({
    super.key,
  });

  @override
  State<RiderWithdrawalScreen> createState() => _RiderWithdrawalScreenState();
}

class _RiderWithdrawalScreenState extends State<RiderWithdrawalScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF159447);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController amountController = TextEditingController();

  final TextEditingController accountNumberController = TextEditingController();

  final TextEditingController accountNameController = TextEditingController();

  final TextEditingController pinController = TextEditingController();

  bool isLoading = true;
  bool isSubmitting = false;
  bool hidePin = true;

  double totalCommissionEarned = 0;
  double availableCommission = 0;
  double pendingWithdrawal = 0;
  double totalWithdrawn = 0;

  double minimumWithdrawal = 1000;
  double maximumWithdrawal = 500000;
  double withdrawalFee = 0;

  String selectedBankCode = '';
  String selectedBankName = '';

  List<Map<String, String>> banks = <Map<String, String>>[];

  List<Map<String, dynamic>> withdrawals = <Map<String, dynamic>>[];

  final List<Map<String, String>> fallbackBanks = const [
    {
      'code': '044',
      'name': 'Access Bank',
    },
    {
      'code': '050',
      'name': 'Ecobank Nigeria',
    },
    {
      'code': '214',
      'name': 'First City Monument Bank',
    },
    {
      'code': '011',
      'name': 'First Bank of Nigeria',
    },
    {
      'code': '00103',
      'name': 'Globus Bank',
    },
    {
      'code': '058',
      'name': 'Guaranty Trust Bank',
    },
    {
      'code': '301',
      'name': 'Jaiz Bank',
    },
    {
      'code': '082',
      'name': 'Keystone Bank',
    },
    {
      'code': '000029',
      'name': 'Lotus Bank',
    },
    {
      'code': '090405',
      'name': 'Moniepoint MFB',
    },
    {
      'code': '999991',
      'name': 'PalmPay',
    },
    {
      'code': '999992',
      'name': 'OPay',
    },
    {
      'code': '076',
      'name': 'Polaris Bank',
    },
    {
      'code': '101',
      'name': 'Providus Bank',
    },
    {
      'code': '221',
      'name': 'Stanbic IBTC Bank',
    },
    {
      'code': '068',
      'name': 'Standard Chartered Bank',
    },
    {
      'code': '232',
      'name': 'Sterling Bank',
    },
    {
      'code': '100',
      'name': 'SunTrust Bank',
    },
    {
      'code': '302',
      'name': 'TAJ Bank',
    },
    {
      'code': '032',
      'name': 'Union Bank of Nigeria',
    },
    {
      'code': '033',
      'name': 'United Bank for Africa',
    },
    {
      'code': '215',
      'name': 'Unity Bank',
    },
    {
      'code': '035',
      'name': 'Wema Bank',
    },
    {
      'code': '057',
      'name': 'Zenith Bank',
    },
  ];

  @override
  void initState() {
    super.initState();
    loadPage();
  }

  @override
  void dispose() {
    amountController.dispose();
    accountNumberController.dispose();
    accountNameController.dispose();
    pinController.dispose();
    super.dispose();
  }

  Map<String, dynamic> mapFromDynamic(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  List<Map<String, dynamic>> listFromDynamic(
    dynamic value,
  ) {
    if (value is! List) {
      return <Map<String, dynamic>>[];
    }

    return value
        .whereType<Map>()
        .map(
          (Map item) => Map<String, dynamic>.from(item),
        )
        .toList();
  }

  double number(
    dynamic value,
  ) {
    return double.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  String text(
    dynamic value, {
    String fallback = '',
  }) {
    final String result = value?.toString().trim() ?? '';

    return result.isEmpty ? fallback : result;
  }

  Future<String> getToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      String token = preferences.getString(key)?.trim() ?? '';

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
        token = token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return '';
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{};
    }

    final dynamic decoded = jsonDecode(body);

    return mapFromDynamic(decoded);
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
          backgroundColor: isError ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  Future<void> loadPage() async {
    if (mounted) {
      setState(() {
        isLoading = true;
      });
    }

    try {
      await Future.wait<void>([
        loadCommissionSummary(),
        loadWithdrawalHistory(),
        loadBanks(),
      ]);
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
      );
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<void> loadCommissionSummary() async {
    final String token = await getToken();

    if (token.isEmpty) {
      throw Exception(
        'Rider login token was not found.',
      );
    }

    final http.Response response = await http.get(
      Uri.parse(
        '$baseUrl/rider/commission-summary',
      ),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    ).timeout(
      const Duration(seconds: 35),
    );

    final Map<String, dynamic> root = decodeResponse(response);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        text(
          root['message'],
          fallback: 'Unable to load commission summary.',
        ),
      );
    }

    final Map<String, dynamic> data = mapFromDynamic(root['data']);

    final Map<String, dynamic> summary = mapFromDynamic(
      data['summary'] ?? root['summary'],
    );

    if (!mounted) {
      return;
    }

    setState(() {
      totalCommissionEarned = number(
        summary['totalCommissionEarned'],
      );

      availableCommission = number(
        summary['availableCommission'],
      );

      pendingWithdrawal = number(
        summary['pendingWithdrawal'],
      );

      totalWithdrawn = number(
        summary['totalWithdrawn'],
      );

      minimumWithdrawal = number(
        summary['minimumWithdrawal'],
      );

      maximumWithdrawal = number(
        summary['maximumWithdrawal'],
      );

      withdrawalFee = number(
        summary['withdrawalFee'],
      );
    });
  }

  Future<void> loadWithdrawalHistory() async {
    final String token = await getToken();

    if (token.isEmpty) {
      throw Exception(
        'Rider login token was not found.',
      );
    }

    final http.Response response = await http.get(
      Uri.parse(
        '$baseUrl/rider/withdrawals?limit=30',
      ),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    ).timeout(
      const Duration(seconds: 35),
    );

    final Map<String, dynamic> root = decodeResponse(response);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        text(
          root['message'],
          fallback: 'Unable to load withdrawal history.',
        ),
      );
    }

    final Map<String, dynamic> data = mapFromDynamic(root['data']);

    final List<Map<String, dynamic>> loaded = listFromDynamic(
      data['withdrawals'] ?? root['withdrawals'],
    );

    if (!mounted) {
      return;
    }

    setState(() {
      withdrawals = loaded;
    });
  }

  Future<void> loadBanks() async {
    try {
      final String token = await getToken();

      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/transfer/banks',
        ),
        headers: {
          'Accept': 'application/json',
          if (token.isNotEmpty) 'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 25),
      );

      final Map<String, dynamic> root = decodeResponse(response);

      final Map<String, dynamic> data = mapFromDynamic(root['data']);

      final dynamic rawBanks = root['banks'] ?? data['banks'];

      final List<Map<String, dynamic>> loaded = listFromDynamic(rawBanks);

      final List<Map<String, String>> normalized = loaded
          .map(
            (Map<String, dynamic> bank) {
              return <String, String>{
                'code': text(
                  bank['code'] ?? bank['bankCode'] ?? bank['bank_code'],
                ),
                'name': text(
                  bank['name'] ?? bank['bankName'] ?? bank['bank_name'],
                ),
              };
            },
          )
          .where(
            (Map<String, String> bank) =>
                bank['code']!.isNotEmpty && bank['name']!.isNotEmpty,
          )
          .toList();

      if (!mounted) {
        return;
      }

      setState(() {
        banks = normalized.isEmpty
            ? List<Map<String, String>>.from(
                fallbackBanks,
              )
            : normalized;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        banks = List<Map<String, String>>.from(
          fallbackBanks,
        );
      });
    }
  }

  String? validateAmount(
    String? value,
  ) {
    final double amount = double.tryParse(
          value?.replaceAll(',', '').trim() ?? '',
        ) ??
        0;

    if (amount <= 0) {
      return 'Enter a valid withdrawal amount.';
    }

    if (amount < minimumWithdrawal) {
      return 'Minimum withdrawal is ${formatMoney(minimumWithdrawal)}.';
    }

    if (amount > maximumWithdrawal) {
      return 'Maximum withdrawal is ${formatMoney(maximumWithdrawal)}.';
    }

    final double totalDebit = amount + withdrawalFee;

    if (totalDebit > availableCommission) {
      return 'Insufficient available commission.';
    }

    return null;
  }

  String? validateAccountNumber(
    String? value,
  ) {
    final String accountNumber = value?.replaceAll(
          RegExp(r'\D'),
          '',
        ) ??
        '';

    if (accountNumber.length != 10) {
      return 'Account number must contain 10 digits.';
    }

    return null;
  }

  String? validateAccountName(
    String? value,
  ) {
    if ((value?.trim().length ?? 0) < 3) {
      return 'Enter the verified account name.';
    }

    return null;
  }

  String? validatePin(
    String? value,
  ) {
    final String pin = value?.replaceAll(
          RegExp(r'\D'),
          '',
        ) ??
        '';

    if (pin.length != 4) {
      return 'Transaction PIN must contain 4 digits.';
    }

    return null;
  }

  Future<void> submitWithdrawal() async {
    FocusScope.of(context).unfocus();

    final bool valid = formKey.currentState?.validate() ?? false;

    if (!valid || isSubmitting) {
      return;
    }

    if (selectedBankCode.isEmpty || selectedBankName.isEmpty) {
      showMessage(
        'Please select your bank.',
      );
      return;
    }

    final double amount = double.tryParse(
          amountController.text.replaceAll(',', '').trim(),
        ) ??
        0;

    final bool confirmed = await showDialog<bool>(
          context: context,
          builder: (
            BuildContext dialogContext,
          ) {
            return AlertDialog(
              title: const Text(
                'Confirm Withdrawal',
              ),
              content: Text(
                'Withdraw ${formatMoney(amount)} '
                'to ${accountNameController.text.trim()} '
                '— ${accountNumberController.text.trim()} '
                'at $selectedBankName?',
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
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  child: const Text(
                    'Confirm',
                  ),
                ),
              ],
            );
          },
        ) ??
        false;

    if (!confirmed) {
      return;
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Rider login token was not found.',
        );
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/rider/withdrawals',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'amount': amount,
              'bankCode': selectedBankCode,
              'bankName': selectedBankName,
              'accountNumber': accountNumberController.text.trim(),
              'accountName': accountNameController.text.trim(),
              'transactionPin': pinController.text.trim(),
              'narration': 'ServicePay Rider commission withdrawal',
            }),
          )
          .timeout(
            const Duration(seconds: 45),
          );

      final Map<String, dynamic> root = decodeResponse(response);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(
            root['message'],
            fallback: 'Unable to submit withdrawal request.',
          ),
        );
      }

      amountController.clear();
      accountNumberController.clear();
      accountNameController.clear();
      pinController.clear();

      if (!mounted) {
        return;
      }

      showMessage(
        text(
          root['message'],
          fallback: 'Withdrawal request submitted successfully.',
        ),
        isError: false,
      );

      await loadPage();
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
      );
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
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

  String formatMoney(
    double value,
  ) {
    return '₦${value.toStringAsFixed(2)}';
  }

  String formatStatus(
    String status,
  ) {
    return status
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (String word) => word.isEmpty
              ? word
              : '${word[0].toUpperCase()}'
                  '${word.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  String formatDate(
    dynamic value,
  ) {
    final DateTime? parsed = DateTime.tryParse(
      value?.toString() ?? '',
    );

    if (parsed == null) {
      return 'Not available';
    }

    final DateTime local = parsed.toLocal();

    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/'
        '${local.year} '
        '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }

  Color statusColor(
    String status,
  ) {
    switch (status.toUpperCase()) {
      case 'PAID':
        return Colors.green;

      case 'APPROVED':
        return Colors.blue;

      case 'PROCESSING':
        return Colors.deepPurple;

      case 'REJECTED':
      case 'FAILED':
      case 'CANCELLED':
        return Colors.red;

      default:
        return Colors.orange;
    }
  }

  Widget summaryCard({
    required String title,
    required double amount,
    required IconData icon,
  }) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: primaryGreen,
          ),
          const SizedBox(height: 9),
          Text(
            title,
            style: const TextStyle(
              color: Colors.black54,
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              formatMoney(amount),
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget buildWithdrawalCard(
    Map<String, dynamic> withdrawal,
  ) {
    final String status = text(
      withdrawal['status'],
      fallback: 'PENDING',
    ).toUpperCase();

    final Map<String, dynamic> bank = mapFromDynamic(
      withdrawal['bank'],
    );

    final String bankName = text(
      bank['bankName'] ?? withdrawal['bankName'],
      fallback: 'Bank',
    );

    final String accountNumber = text(
      bank['accountNumber'] ?? withdrawal['accountNumber'],
    );

    final String reference = text(
      withdrawal['reference'],
    );

    final String reason = text(
      withdrawal['rejectionReason'] ?? withdrawal['failureReason'],
    );

    return Container(
      margin: const EdgeInsets.only(
        bottom: 12,
      ),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                backgroundColor: statusColor(status).withValues(
                  alpha: 0.12,
                ),
                child: Icon(
                  Icons.payments_outlined,
                  color: statusColor(status),
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      formatMoney(
                        number(
                          withdrawal['amount'],
                        ),
                      ),
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    Text(
                      '$bankName • $accountNumber',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.black54,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 9,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: statusColor(status).withValues(
                    alpha: 0.12,
                  ),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  formatStatus(status),
                  style: TextStyle(
                    color: statusColor(status),
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 11),
          Text(
            formatDate(
              withdrawal['requestedAt'] ?? withdrawal['createdAt'],
            ),
            style: const TextStyle(
              color: Colors.black54,
              fontSize: 11,
            ),
          ),
          if (reference.isNotEmpty) ...[
            const SizedBox(height: 5),
            SelectableText(
              'Reference: $reference',
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          if (reason.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.red.withValues(
                  alpha: 0.07,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                reason,
                style: const TextStyle(
                  color: Colors.red,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text(
          'Withdraw Commission',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isLoading ? null : loadPage,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadPage,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFF159447),
                          Color(0xFF0F766E),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(
                        21,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Available Commission',
                          style: TextStyle(
                            color: Colors.white70,
                          ),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          formatMoney(
                            availableCommission,
                          ),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 29,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Minimum: ${formatMoney(minimumWithdrawal)}',
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 9,
                    mainAxisSpacing: 9,
                    childAspectRatio: 0.87,
                    children: [
                      summaryCard(
                        title: 'Total Earned',
                        amount: totalCommissionEarned,
                        icon: Icons.trending_up_rounded,
                      ),
                      summaryCard(
                        title: 'Pending Withdrawal',
                        amount: pendingWithdrawal,
                        icon: Icons.hourglass_top_rounded,
                      ),
                      summaryCard(
                        title: 'Total Withdrawn',
                        amount: totalWithdrawn,
                        icon: Icons.check_circle_outline,
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'New Withdrawal Request',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Form(
                    key: formKey,
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(
                          18,
                        ),
                        border: Border.all(
                          color: const Color(0xFFE2E8F0),
                        ),
                      ),
                      child: Column(
                        children: [
                          TextFormField(
                            controller: amountController,
                            enabled: !isSubmitting,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                RegExp(
                                  r'^\d*\.?\d{0,2}',
                                ),
                              ),
                            ],
                            validator: validateAmount,
                            decoration: const InputDecoration(
                              labelText: 'Amount',
                              prefixText: '₦ ',
                              prefixIcon: Icon(
                                Icons.payments_outlined,
                              ),
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 14),
                          DropdownButtonFormField<String>(
                            initialValue: selectedBankCode.isEmpty
                                ? null
                                : selectedBankCode,
                            decoration: const InputDecoration(
                              labelText: 'Bank',
                              prefixIcon: Icon(
                                Icons.account_balance_outlined,
                              ),
                              border: OutlineInputBorder(),
                            ),
                            items: banks.map(
                              (
                                Map<String, String> bank,
                              ) {
                                return DropdownMenuItem<String>(
                                  value: bank['code'],
                                  child: Text(
                                    bank['name']!,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                );
                              },
                            ).toList(),
                            onChanged: isSubmitting
                                ? null
                                : (String? code) {
                                    final Map<String, String> selected =
                                        banks.firstWhere(
                                      (
                                        Map<String, String> bank,
                                      ) =>
                                          bank['code'] == code,
                                      orElse: () => <String, String>{},
                                    );

                                    setState(() {
                                      selectedBankCode = code ?? '';

                                      selectedBankName = selected['name'] ?? '';
                                    });
                                  },
                            validator: (
                              String? value,
                            ) {
                              if (value == null || value.isEmpty) {
                                return 'Select your bank.';
                              }

                              return null;
                            },
                          ),
                          const SizedBox(height: 14),
                          TextFormField(
                            controller: accountNumberController,
                            enabled: !isSubmitting,
                            keyboardType: TextInputType.number,
                            maxLength: 10,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              LengthLimitingTextInputFormatter(
                                10,
                              ),
                            ],
                            validator: validateAccountNumber,
                            decoration: const InputDecoration(
                              labelText: 'Account number',
                              counterText: '',
                              prefixIcon: Icon(
                                Icons.pin_outlined,
                              ),
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 14),
                          TextFormField(
                            controller: accountNameController,
                            enabled: !isSubmitting,
                            textCapitalization: TextCapitalization.words,
                            validator: validateAccountName,
                            decoration: const InputDecoration(
                              labelText: 'Verified account name',
                              prefixIcon: Icon(
                                Icons.person_outline,
                              ),
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 14),
                          TextFormField(
                            controller: pinController,
                            enabled: !isSubmitting,
                            obscureText: hidePin,
                            keyboardType: TextInputType.number,
                            maxLength: 4,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              LengthLimitingTextInputFormatter(
                                4,
                              ),
                            ],
                            validator: validatePin,
                            decoration: InputDecoration(
                              labelText: 'Transaction PIN',
                              counterText: '',
                              prefixIcon: const Icon(
                                Icons.lock_outline,
                              ),
                              suffixIcon: IconButton(
                                onPressed: () {
                                  setState(() {
                                    hidePin = !hidePin;
                                  });
                                },
                                icon: Icon(
                                  hidePin
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                ),
                              ),
                              border: const OutlineInputBorder(),
                            ),
                          ),
                          if (withdrawalFee > 0) ...[
                            const SizedBox(height: 12),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(
                                11,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(
                                  0xFFFFF7ED,
                                ),
                                borderRadius: BorderRadius.circular(
                                  11,
                                ),
                              ),
                              child: Text(
                                'Withdrawal fee: '
                                '${formatMoney(withdrawalFee)}',
                                style: const TextStyle(
                                  color: Color(0xFF9A3412),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                          const SizedBox(height: 18),
                          SizedBox(
                            width: double.infinity,
                            height: 54,
                            child: FilledButton.icon(
                              onPressed: isSubmitting ? null : submitWithdrawal,
                              style: FilledButton.styleFrom(
                                backgroundColor: primaryGreen,
                              ),
                              icon: isSubmitting
                                  ? const SizedBox(
                                      width: 21,
                                      height: 21,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.3,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.send_rounded,
                                    ),
                              label: Text(
                                isSubmitting
                                    ? 'Submitting...'
                                    : 'Request Withdrawal',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 22),
                  const Text(
                    'Withdrawal History',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (withdrawals.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(25),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(
                          17,
                        ),
                      ),
                      child: const Column(
                        children: [
                          Icon(
                            Icons.history_rounded,
                            size: 45,
                            color: Colors.grey,
                          ),
                          SizedBox(height: 9),
                          Text(
                            'No withdrawal request yet.',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    ...withdrawals.map(
                      buildWithdrawalCard,
                    ),
                  const SizedBox(height: 30),
                ],
              ),
            ),
    );
  }
}
