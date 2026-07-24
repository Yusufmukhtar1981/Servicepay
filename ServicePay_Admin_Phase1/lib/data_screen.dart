import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class DataScreen extends StatefulWidget {
  const DataScreen({super.key});

  @override
  State<DataScreen> createState() => _DataScreenState();
}

class _DataScreenState extends State<DataScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final TextEditingController phoneController = TextEditingController();

  bool isLoading = false;
  bool saveBeneficiary = false;

  String selectedNetwork = 'MTN';
  String selectedPlanCode = 'MTN_500MB';

  final Map<String, List<Map<String, dynamic>>> dataPlans = {
    'MTN': [
      {
        'code': 'MTN_500MB',
        'name': '500MB',
        'price': 250.0,
      },
      {
        'code': 'MTN_1GB',
        'name': '1GB',
        'price': 500.0,
      },
      {
        'code': 'MTN_2GB',
        'name': '2GB',
        'price': 1000.0,
      },
      {
        'code': 'MTN_5GB',
        'name': '5GB',
        'price': 2500.0,
      },
    ],
    'Airtel': [
      {
        'code': 'AIRTEL_500MB',
        'name': '500MB',
        'price': 300.0,
      },
      {
        'code': 'AIRTEL_1GB',
        'name': '1GB',
        'price': 600.0,
      },
      {
        'code': 'AIRTEL_2GB',
        'name': '2GB',
        'price': 1200.0,
      },
      {
        'code': 'AIRTEL_5GB',
        'name': '5GB',
        'price': 2800.0,
      },
    ],
    'Glo': [
      {
        'code': 'GLO_1GB',
        'name': '1GB',
        'price': 450.0,
      },
      {
        'code': 'GLO_2GB',
        'name': '2GB',
        'price': 900.0,
      },
      {
        'code': 'GLO_5GB',
        'name': '5GB',
        'price': 2200.0,
      },
    ],
    '9mobile': [
      {
        'code': '9MOBILE_500MB',
        'name': '500MB',
        'price': 300.0,
      },
      {
        'code': '9MOBILE_1GB',
        'name': '1GB',
        'price': 600.0,
      },
      {
        'code': '9MOBILE_2GB',
        'name': '2GB',
        'price': 1150.0,
      },
    ],
  };

  @override
  void dispose() {
    phoneController.dispose();
    super.dispose();
  }

  Map<String, dynamic> get selectedPlan {
    final plans = dataPlans[selectedNetwork] ?? [];

    return plans.firstWhere(
      (plan) => plan['code'] == selectedPlanCode,
      orElse: () => plans.first,
    );
  }

  String normalizePhone(String phone) {
    return phone.replaceAll(RegExp(r'\s+'), '').trim();
  }

  bool isValidPhone(String phone) {
    return RegExp(r'^0\d{10}$').hasMatch(phone);
  }

  String formatAmount(dynamic value) {
    final amount = double.tryParse(value.toString()) ?? 0;

    return amount.toStringAsFixed(2);
  }

  void showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor:
              isError ? Colors.red.shade700 : Colors.green.shade700,
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 4),
        ),
      );
  }

  Future<bool> confirmPurchase() async {
    final plan = selectedPlan;
    final phone = normalizePhone(phoneController.text);

    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Confirm Data Purchase'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _confirmationRow('Network', selectedNetwork),
              const SizedBox(height: 10),
              _confirmationRow(
                'Data plan',
                plan['name']?.toString() ?? '',
              ),
              const SizedBox(height: 10),
              _confirmationRow('Phone', phone),
              const SizedBox(height: 10),
              _confirmationRow(
                'Amount',
                '₦${formatAmount(plan['price'])}',
              ),
            ],
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
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.green,
                foregroundColor: Colors.white,
              ),
              child: const Text('Confirm'),
            ),
          ],
        );
      },
    );

    return confirmed ?? false;
  }

  Widget _confirmationRow(String title, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 90,
          child: Text(
            title,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Expanded(
          child: Text(value),
        ),
      ],
    );
  }

  Future<void> buyData() async {
    if (isLoading) return;

    final phone = normalizePhone(phoneController.text);
    final plan = selectedPlan;
    final amount =
        double.tryParse(plan['price']?.toString() ?? '0') ?? 0;

    if (!isValidPhone(phone)) {
      showMessage(
        'Ka saka ingantacciyar lambar waya mai lambobi 11.',
        isError: true,
      );
      return;
    }

    if (amount <= 0) {
      showMessage(
        'Data plan ɗin da aka zaɓa ba shi da ingantaccen farashi.',
        isError: true,
      );
      return;
    }

    final confirmed = await confirmPurchase();

    if (!confirmed || !mounted) return;

    FocusScope.of(context).unfocus();

    setState(() {
      isLoading = true;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token');

      if (token == null || token.trim().isEmpty) {
        showMessage(
          'Login session ɗinka ya ƙare. Ka sake shiga account.',
          isError: true,
        );
        return;
      }

      final response = await http
          .post(
            Uri.parse('$baseUrl/clubkonnect/data'),
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'network': selectedNetwork.toUpperCase(),
              'phone': phone,
              'planCode': plan['code'],
              'plan': plan['code'],
              'dataPlan': plan['code'],
              'amount': amount,
              'saveBeneficiary': saveBeneficiary,
            }),
          )
          .timeout(const Duration(seconds: 45));

      if (response.body.trim().isEmpty) {
        showMessage(
          'Server bai dawo da amsa ba. Status: ${response.statusCode}',
          isError: true,
        );
        return;
      }

      final dynamic decoded = jsonDecode(response.body);

      if (decoded is! Map) {
        showMessage(
          'Server ya dawo da amsa marar inganci.',
          isError: true,
        );
        return;
      }

      final result = Map<String, dynamic>.from(decoded);

      final success =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          result['success'] == true;

      if (!success) {
        showMessage(
          result['message']?.toString() ??
              'Sayen Data bai yi nasara ba.',
          isError: true,
        );
        return;
      }

      final newBalance = extractWalletBalance(result);

      if (newBalance != null) {
        await prefs.setDouble('wallet_balance', newBalance);
      }

      phoneController.clear();

      if (!mounted) return;

      showMessage(
        result['message']?.toString() ??
            'An sayi Data cikin nasara.',
      );

      Navigator.pop(context, true);
    } on TimeoutException {
      showMessage(
        'Server ya ɗauki lokaci mai tsawo. Ka sake gwadawa.',
        isError: true,
      );
    } on FormatException {
      showMessage(
        'Server ya dawo da amsa marar inganci.',
        isError: true,
      );
    } on http.ClientException {
      showMessage(
        'Ba a iya haɗuwa da Servicepay server ba.',
        isError: true,
      );
    } catch (error) {
      debugPrint('DATA PURCHASE ERROR: $error');

      showMessage(
        'An samu matsala wajen sayen Data.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  double? extractWalletBalance(Map<String, dynamic> result) {
    final data = result['data'];
    final user = result['user'];

    final possibleValues = <dynamic>[
      result['walletBalance'],
      result['balance'],
      data is Map ? data['walletBalance'] : null,
      data is Map ? data['balance'] : null,
      data is Map && data['user'] is Map
          ? (data['user'] as Map)['walletBalance']
          : null,
      user is Map ? user['walletBalance'] : null,
    ];

    for (final value in possibleValues) {
      if (value is num) {
        return value.toDouble();
      }

      final parsed = double.tryParse(
        value?.toString().replaceAll(',', '') ?? '',
      );

      if (parsed != null) {
        return parsed;
      }
    }

    return null;
  }

  @override
  Widget build(BuildContext context) {
    final plans = dataPlans[selectedNetwork] ?? [];

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Buy Data',
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
                gradient: const LinearGradient(
                  colors: [
                    Color(0xFF087F5B),
                    Color(0xFF2F9E44),
                  ],
                ),
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Column(
                children: [
                  Icon(
                    Icons.signal_cellular_alt_rounded,
                    size: 52,
                    color: Colors.white,
                  ),
                  SizedBox(height: 10),
                  Text(
                    'Instant Data Purchase',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 21,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  SizedBox(height: 6),
                  Text(
                    'Buy data directly from your Servicepay wallet.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white70,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Select Network',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: selectedNetwork,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.sim_card_outlined),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              items: dataPlans.keys.map((network) {
                return DropdownMenuItem<String>(
                  value: network,
                  child: Text(network),
                );
              }).toList(),
              onChanged: isLoading
                  ? null
                  : (value) {
                      if (value == null) return;

                      setState(() {
                        selectedNetwork = value;

                        final networkPlans =
                            dataPlans[selectedNetwork] ?? [];

                        if (networkPlans.isNotEmpty) {
                          selectedPlanCode =
                              networkPlans.first['code'].toString();
                        }
                      });
                    },
            ),
            const SizedBox(height: 22),
            const Text(
              'Select Data Plan',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: selectedPlanCode,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.data_usage_outlined),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              items: plans.map((plan) {
                final code = plan['code'].toString();
                final name = plan['name'].toString();
                final price = formatAmount(plan['price']);

                return DropdownMenuItem<String>(
                  value: code,
                  child: Text('$name — ₦$price'),
                );
              }).toList(),
              onChanged: isLoading
                  ? null
                  : (value) {
                      if (value == null) return;

                      setState(() {
                        selectedPlanCode = value;
                      });
                    },
            ),
            const SizedBox(height: 22),
            const Text(
              'Phone Number',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: phoneController,
              enabled: !isLoading,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.done,
              maxLength: 11,
              onSubmitted: (_) {
                if (!isLoading) {
                  buyData();
                }
              },
              decoration: InputDecoration(
                hintText: '08012345678',
                prefixIcon: const Icon(Icons.phone_outlined),
                filled: true,
                fillColor: Colors.white,
                counterText: '',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 10),
            SwitchListTile(
              value: saveBeneficiary,
              contentPadding: EdgeInsets.zero,
              activeThumbColor: Colors.green,
              title: const Text(
                'Save as beneficiary',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                ),
              ),
              subtitle: const Text(
                'Save this number for future Data purchases.',
              ),
              onChanged: isLoading
                  ? null
                  : (value) {
                      setState(() {
                        saveBeneficiary = value;
                      });
                    },
            ),
            const SizedBox(height: 18),
            SizedBox(
              height: 54,
              child: ElevatedButton.icon(
                onPressed: isLoading ? null : buyData,
                icon: isLoading
                    ? const SizedBox.shrink()
                    : const Icon(Icons.shopping_cart_checkout_rounded),
                label: isLoading
                    ? const SizedBox(
                        width: 25,
                        height: 25,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : Text(
                        'Buy ${selectedPlan['name']} — '
                        '₦${formatAmount(selectedPlan['price'])}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: Colors.green.shade200,
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