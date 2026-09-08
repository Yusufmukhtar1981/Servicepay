import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'feature_transaction_pin_dialog.dart';

class RequestMoneyScreen extends StatefulWidget {
  const RequestMoneyScreen({super.key});

  @override
  State<RequestMoneyScreen> createState() => _RequestMoneyScreenState();
}

class _RequestMoneyScreenState extends State<RequestMoneyScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final phoneController = TextEditingController();

  final amountController = TextEditingController();

  final noteController = TextEditingController();

  bool isSubmitting = false;
  bool isLoading = true;

  List<Map<String, dynamic>> requests = [];

  @override
  void initState() {
    super.initState();
    loadRequests();
  }

  @override
  void dispose() {
    phoneController.dispose();
    amountController.dispose();
    noteController.dispose();
    super.dispose();
  }

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

  Future<void> loadRequests() async {
    try {
      final token = await getToken();

      final response = await http.get(
        Uri.parse(
          '$baseUrl/servicepay-features/money-requests',
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

      final raw = data['requests'];

      requests = raw is List
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
      //
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<void> sendRequest() async {
    final phone = phoneController.text.trim();

    final amount = double.tryParse(
          amountController.text.trim(),
        ) ??
        0;

    if (phone.isEmpty || amount <= 0) {
      showMessage(
        'Enter phone number and amount.',
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
          '$baseUrl/servicepay-features/money-requests',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'phone': phone,
          'amount': amount,
          'note': noteController.text.trim(),
        }),
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      showMessage(
        data['message']?.toString() ?? 'Request sent.',
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        phoneController.clear();
        amountController.clear();
        noteController.clear();

        await loadRequests();
      }
    } catch (_) {
      showMessage(
        'Unable to connect to ServicePay.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }

  Future<void> payRequest(
    Map<String, dynamic> item,
  ) async {
    final id = item['_id']?.toString() ?? '';

    if (id.isEmpty) return;

    final pin = await showFeatureTransactionPinDialog(
      context,
      title: 'Pay Money Request',
      message:
          'You are about to pay ₦${item['amount'] ?? 0}. Enter your transaction PIN.',
    );

    if (pin == null) return;

    try {
      final token = await getToken();

      final response = await http.post(
        Uri.parse(
          '$baseUrl/servicepay-features/money-requests/$id/pay',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'transactionPin': pin,
        }),
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};

      showMessage(
        data['message']?.toString() ?? 'Payment completed.',
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        await loadRequests();
      }
    } catch (_) {
      showMessage(
        'Unable to complete payment.',
      );
    }
  }

  Future<void> declineRequest(
    Map<String, dynamic> item,
  ) async {
    final id = item['_id']?.toString() ?? '';

    if (id.isEmpty) return;

    try {
      final token = await getToken();

      final response = await http.post(
        Uri.parse(
          '$baseUrl/servicepay-features/money-requests/$id/decline',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({}),
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};

      showMessage(
        data['message']?.toString() ?? 'Request declined.',
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        await loadRequests();
      }
    } catch (_) {
      showMessage(
        'Unable to decline request.',
      );
    }
  }

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF8),
      appBar: AppBar(
        title: const Text('Request Money'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Text(
            'Request Money from a ServicePay User',
            style: TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 18),
          TextField(
            controller: phoneController,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'ServicePay phone number',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
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
          const SizedBox(height: 14),
          TextField(
            controller: noteController,
            decoration: const InputDecoration(
              labelText: 'Reason / Note (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: isSubmitting ? null : sendRequest,
            style: FilledButton.styleFrom(
              backgroundColor: primaryGreen,
              padding: const EdgeInsets.symmetric(
                vertical: 16,
              ),
            ),
            icon: const Icon(
              Icons.send_rounded,
            ),
            label: Text(
              isSubmitting ? 'Sending...' : 'Send Request',
            ),
          ),
          const SizedBox(height: 30),
          const Text(
            'Money Requests',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 18,
            ),
          ),
          const SizedBox(height: 12),
          if (isLoading)
            const Center(
              child: CircularProgressIndicator(),
            )
          else if (requests.isEmpty)
            const Text('No requests yet.')
          else
            ...requests.map(
              (item) {
                final status = item['status']?.toString() ?? 'PENDING';

                final requestedFrom = item['requestedFrom'] is Map
                    ? Map<String, dynamic>.from(
                        item['requestedFrom'],
                      )
                    : <String, dynamic>{};

                final requester = item['requester'] is Map
                    ? Map<String, dynamic>.from(
                        item['requester'],
                      )
                    : <String, dynamic>{};

                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(
                            Icons.request_page_rounded,
                            color: primaryGreen,
                          ),
                          title: Text(
                            '₦${item['amount'] ?? 0}',
                          ),
                          subtitle: Text(
                            '${item['note'] ?? ''}\n'
                            'From: ${requester['fullName'] ?? '-'}\n'
                            'To: ${requestedFrom['fullName'] ?? '-'}\n'
                            'Status: $status',
                          ),
                          isThreeLine: true,
                        ),
                        if (status == 'PENDING')
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: () => declineRequest(item),
                                  child: const Text('Decline'),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: FilledButton(
                                  onPressed: () => payRequest(item),
                                  style: FilledButton.styleFrom(
                                    backgroundColor: primaryGreen,
                                  ),
                                  child: const Text('Pay'),
                                ),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}
