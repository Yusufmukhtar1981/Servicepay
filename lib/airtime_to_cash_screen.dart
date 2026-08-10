import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AirtimeToCashScreen extends StatefulWidget {
  const AirtimeToCashScreen({super.key});

  @override
  State<AirtimeToCashScreen> createState() => _AirtimeToCashScreenState();
}

class _AirtimeToCashScreenState extends State<AirtimeToCashScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final TextEditingController phoneController = TextEditingController();

  final TextEditingController amountController = TextEditingController();

  String selectedNetwork = 'MTN';

  bool isSubmitting = false;
  bool isLoadingSettings = true;

  Map<String, dynamic> settings = {};

  double get amount =>
      double.tryParse(
        amountController.text.trim(),
      ) ??
      0;

  double get rate {
    final dynamic network = settings[selectedNetwork];

    if (network is Map) {
      return double.tryParse(
            network['ratePercent'].toString(),
          ) ??
          0;
    }

    return 0;
  }

  double get cashAmount => amount * rate / 100;

  Future<String> getToken() async {
    final prefs = await SharedPreferences.getInstance();

    for (final key in [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final value = prefs.getString(key);

      if (value != null && value.trim().isNotEmpty) {
        return value.replaceFirst('Bearer ', '').trim();
      }
    }

    return '';
  }

  @override
  void initState() {
    super.initState();
    loadSettings();
  }

  @override
  void dispose() {
    phoneController.dispose();
    amountController.dispose();
    super.dispose();
  }

  Future<void> loadSettings() async {
    try {
      final token = await getToken();

      final response = await http.get(
        Uri.parse(
          '$baseUrl/airtime-to-cash/settings',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      );

      final data = jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data is Map &&
          data['success'] == true) {
        settings = Map<String, dynamic>.from(
          data['networks'] ?? {},
        );
      }
    } catch (_) {
      // Settings remain empty until backend is live.
    } finally {
      if (mounted) {
        setState(() {
          isLoadingSettings = false;
        });
      }
    }
  }

  Future<void> submitRequest() async {
    final phone = phoneController.text.trim();
    final enteredAmount = amount;

    if (!RegExp(r'^\d{10,14}$').hasMatch(phone)) {
      showMessage(
        'Enter a valid phone number.',
        true,
      );
      return;
    }

    if (enteredAmount <= 0) {
      showMessage(
        'Enter a valid airtime amount.',
        true,
      );
      return;
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      final token = await getToken();

      final response = await http.post(
        Uri.parse(
          '$baseUrl/airtime-to-cash/request',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'network': selectedNetwork,
          'senderPhone': phone,
          'airtimeAmount': enteredAmount,
        }),
      );

      final dynamic decoded = jsonDecode(response.body);

      final Map<String, dynamic> data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : {};

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        final request = data['request'] is Map
            ? Map<String, dynamic>.from(
                data['request'],
              )
            : <String, dynamic>{};

        if (!mounted) return;

        await showDialog<void>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              title: const Text(
                'Request Submitted',
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    data['instruction']?.toString() ??
                        'Transfer the airtime as instructed.',
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'Reference: ${request['reference'] ?? ''}',
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Expected Wallet Credit: ₦${request['cashAmount'] ?? cashAmount.toStringAsFixed(2)}',
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Status: PENDING',
                  ),
                ],
              ),
              actions: [
                FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                    );
                  },
                  child: const Text('Done'),
                ),
              ],
            );
          },
        );

        phoneController.clear();
        amountController.clear();

        if (mounted) {
          setState(() {});
        }
      } else {
        showMessage(
          data['message']?.toString() ?? 'Unable to submit request.',
          true,
        );
      }
    } catch (_) {
      showMessage(
        'Unable to connect to ServicePay.',
        true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }

  void showMessage(
    String message,
    bool isError,
  ) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final networkSetting = settings[selectedNetwork];

    final minAmount =
        networkSetting is Map ? networkSetting['minAmount'] : null;

    final maxAmount =
        networkSetting is Map ? networkSetting['maxAmount'] : null;

    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF8),
      appBar: AppBar(
        title: const Text(
          'Airtime to Cash',
        ),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: const Color(0xFFEAF7F0),
              borderRadius: BorderRadius.circular(22),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.currency_exchange_rounded,
                  color: primaryGreen,
                  size: 42,
                ),
                SizedBox(height: 14),
                Text(
                  'Convert Airtime to Wallet Balance',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 8),
                Text(
                  'Send supported airtime to ServicePay and receive the approved cash value in your ServicePay wallet after verification.',
                  style: TextStyle(
                    color: Colors.black54,
                    height: 1.5,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),
          const Text(
            'Select Network',
            style: TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: selectedNetwork,
            decoration: InputDecoration(
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            items: const [
              DropdownMenuItem(
                value: 'MTN',
                child: Text('MTN'),
              ),
              DropdownMenuItem(
                value: 'AIRTEL',
                child: Text('Airtel'),
              ),
              DropdownMenuItem(
                value: 'GLO',
                child: Text('Glo'),
              ),
              DropdownMenuItem(
                value: '9MOBILE',
                child: Text('9mobile'),
              ),
            ],
            onChanged: (value) {
              if (value == null) return;

              setState(() {
                selectedNetwork = value;
              });
            },
          ),
          const SizedBox(height: 18),
          TextField(
            controller: phoneController,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(
              labelText: 'Airtime Sender Phone Number',
              hintText: '08012345678',
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
            onChanged: (_) {
              setState(() {});
            },
            decoration: InputDecoration(
              labelText: 'Airtime Amount',
              prefixText: '₦ ',
              helperText: minAmount != null && maxAmount != null
                  ? 'Minimum ₦$minAmount • Maximum ₦$maxAmount'
                  : null,
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
          const SizedBox(height: 22),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: const Color(0xFFE3ECE7),
              ),
            ),
            child: Column(
              children: [
                _row(
                  'Conversion Rate',
                  isLoadingSettings
                      ? 'Loading...'
                      : '${rate.toStringAsFixed(0)}%',
                ),
                const Divider(height: 28),
                _row(
                  'Airtime Value',
                  '₦${amount.toStringAsFixed(2)}',
                ),
                const Divider(height: 28),
                _row(
                  'You Will Receive',
                  '₦${cashAmount.toStringAsFixed(2)}',
                  bold: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: 54,
            child: FilledButton.icon(
              onPressed: isSubmitting ? null : submitRequest,
              style: FilledButton.styleFrom(
                backgroundColor: primaryGreen,
              ),
              icon: isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(
                      Icons.arrow_forward_rounded,
                    ),
              label: Text(
                isSubmitting ? 'Submitting...' : 'Continue',
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(height: 18),
          const Text(
            'Important: Your wallet will only be credited after ServicePay confirms that the airtime was received successfully.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.black54,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(
    String label,
    String value, {
    bool bold = false,
  }) {
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              color: Colors.black54,
            ),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            color: bold ? primaryGreen : Colors.black87,
            fontSize: bold ? 19 : 15,
            fontWeight: bold ? FontWeight.w900 : FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
