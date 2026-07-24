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

  final phoneController = TextEditingController();

  bool isLoading = false;

  String selectedNetwork = 'MTN';
  String selectedPlanCode = 'MTN_1GB';

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

  String formatAmount(dynamic amount) {
    final value = double.tryParse(amount.toString()) ?? 0;

    return value.toStringAsFixed(0);
  }

  bool isValidPhone(String phone) {
    return RegExp(r'^0\d{10}$').hasMatch(phone);
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
          backgroundColor: isError ? Colors.red : Colors.green,
        ),
      );
  }

  Future<void> buyData() async {
    if (isLoading) return;

    final phone = phoneController.text.trim();
    final plan = selectedPlan;

    if (!isValidPhone(phone)) {
      showMessage(
        'Ka saka ingantacciyar lambar waya mai lambobi 11.',
        isError: true,
      );
      return;
    }

    setState(() {
      isLoading = true;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token');

      if (token == null || token.isEmpty) {
        showMessage(
          'Ka sake login kafin sayen Data.',
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
              'network': selectedNetwork,
              'phone': phone,
              'planCode': plan['code'],
              'amount': plan['price'],
            }),
          )
          .timeout(const Duration(seconds: 45));

      final dynamic decoded = jsonDecode(response.body);

      final result = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};

      final success =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          result['success'] == true;

      if (!success) {
        showMessage(
          result['message']?.toString() ??
              result['error']?.toString() ??
              'Sayen Data bai yi nasara ba.',
          isError: true,
        );
        return;
      }

      showMessage(
        result['message']?.toString() ??
            'An sayi Data cikin nasara.',
      );

      phoneController.clear();
    } on TimeoutException {
      showMessage(
        'Server ya dauki lokaci mai tsawo.',
        isError: true,
      );
    } on FormatException {
      showMessage(
        'Server ya dawo da amsa marar inganci.',
        isError: true,
      );
    } catch (error) {
      debugPrint('DATA ERROR: $error');

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
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.sim_card_outlined),
                border: OutlineInputBorder(),
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
                        selectedPlanCode =
                            dataPlans[value]!.first['code'].toString();
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
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.data_usage_outlined),
                border: OutlineInputBorder(),
              ),
              items: plans.map((plan) {
                return DropdownMenuItem<String>(
                  value: plan['code'].toString(),
                  child: Text(
                    '${plan['name']} - ₦${formatAmount(plan['price'])}',
                  ),
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
              maxLength: 11,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                hintText: '08012345678',
                prefixIcon: Icon(Icons.phone_outlined),
                counterText: '',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              height: 52,
              child: ElevatedButton(
                onPressed: isLoading ? null : buyData,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
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
                    : Text(
                        'Buy ${selectedPlan['name']} - '
                        '₦${formatAmount(selectedPlan['price'])}',
                        style: const TextStyle(
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