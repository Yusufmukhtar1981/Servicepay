import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class PayByLinkScreen extends StatefulWidget {
  const PayByLinkScreen({super.key});

  @override
  State<PayByLinkScreen> createState() => _PayByLinkScreenState();
}

class _PayByLinkScreenState extends State<PayByLinkScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final titleController = TextEditingController();

  final amountController = TextEditingController();

  final descriptionController = TextEditingController();

  bool isLoading = true;
  bool isSubmitting = false;

  List<Map<String, dynamic>> links = [];

  @override
  void initState() {
    super.initState();
    loadLinks();
  }

  @override
  void dispose() {
    titleController.dispose();
    amountController.dispose();
    descriptionController.dispose();
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

  Future<void> loadLinks() async {
    try {
      final token = await getToken();

      final response = await http.get(
        Uri.parse(
          '$baseUrl/servicepay-features/payment-links',
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

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        final raw = data['paymentLinks'];

        links = raw is List
            ? raw
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(
                    item,
                  ),
                )
                .toList()
            : [];
      }
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

  Future<void> createLink() async {
    final title = titleController.text.trim();

    final amount = double.tryParse(
          amountController.text.trim(),
        ) ??
        0;

    if (title.isEmpty || amount <= 0) {
      showMessage(
        'Enter title and valid amount.',
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
          '$baseUrl/servicepay-features/payment-links',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'title': title,
          'amount': amount,
          'description': descriptionController.text.trim(),
        }),
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        final url = data['url']?.toString() ?? '';

        if (!mounted) return;

        await showDialog<void>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              title: const Text(
                'Payment Link Created',
              ),
              content: SelectableText(url),
              actions: [
                TextButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(
                      ClipboardData(
                        text: url,
                      ),
                    );

                    if (dialogContext.mounted) {
                      Navigator.pop(
                        dialogContext,
                      );
                    }

                    showMessage(
                      'Payment link copied.',
                    );
                  },
                  icon: const Icon(
                    Icons.copy_rounded,
                  ),
                  label: const Text('Copy'),
                ),
              ],
            );
          },
        );

        titleController.clear();
        amountController.clear();
        descriptionController.clear();

        await loadLinks();
      } else {
        showMessage(
          data['message']?.toString() ?? 'Unable to create payment link.',
        );
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

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF8),
      appBar: AppBar(
        title: const Text(
          'Pay-by-Link Merchant',
        ),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Text(
            'Create a Payment Link',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Create a simple ServicePay payment link for your customer.',
            style: TextStyle(
              color: Colors.black54,
            ),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: titleController,
            decoration: const InputDecoration(
              labelText: 'Payment title',
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
            controller: descriptionController,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'Description',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: isSubmitting ? null : createLink,
            style: FilledButton.styleFrom(
              backgroundColor: primaryGreen,
              padding: const EdgeInsets.symmetric(
                vertical: 16,
              ),
            ),
            icon: const Icon(Icons.link_rounded),
            label: Text(
              isSubmitting ? 'Creating...' : 'Create Payment Link',
            ),
          ),
          const SizedBox(height: 30),
          const Text(
            'Your Payment Links',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          if (isLoading)
            const Center(
              child: CircularProgressIndicator(),
            )
          else if (links.isEmpty)
            const Text(
              'No payment links yet.',
            )
          else
            ...links.map(
              (item) => Card(
                child: ListTile(
                  leading: const Icon(
                    Icons.link_rounded,
                    color: primaryGreen,
                  ),
                  title: Text(
                    item['title']?.toString() ?? 'Payment',
                  ),
                  subtitle: Text(
                    '₦${item['amount'] ?? 0} • ${item['status'] ?? 'ACTIVE'}',
                  ),
                  trailing: IconButton(
                    onPressed: () async {
                      final code = item['code']?.toString() ?? '';

                      await Clipboard.setData(
                        ClipboardData(
                          text: 'https://servicepay.ng/pay/$code',
                        ),
                      );

                      showMessage(
                        'Link copied.',
                      );
                    },
                    icon: const Icon(
                      Icons.copy_rounded,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
