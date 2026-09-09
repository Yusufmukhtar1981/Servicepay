import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminControlCenterScreen extends StatefulWidget {
  const AdminControlCenterScreen({super.key});

  @override
  State<AdminControlCenterScreen> createState() =>
      _AdminControlCenterScreenState();
}

class _AdminControlCenterScreenState extends State<AdminControlCenterScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  bool loadingServices = true;
  bool savingServices = false;
  bool adjustingWallet = false;

  final Map<String, String> serviceLabels = <String, String>{
    'airtime': 'Airtime',
    'data': 'Data',
    'electricity': 'Electricity',
    'cableTv': 'Cable TV',
    'examPin': 'Exam PIN',
    'ninVerification': 'NIN Verification',
    'delivery': 'Delivery',
    'kekeNapep': 'Keke Napep',
    'amana': 'ServicePay Amana',
    'walletFunding': 'Wallet Funding',
    'servicepayTransfer': 'ServicePay Transfer',
    'bankTransfer': 'Bank Transfer',
    'flightBooking': 'Flight Booking',
    'notifications': 'Notifications',
  };

  late Map<String, bool> services;

  final TextEditingController customerController = TextEditingController();

  final TextEditingController amountController = TextEditingController();

  final TextEditingController reasonController = TextEditingController();

  String walletAction = 'CREDIT';

  @override
  void initState() {
    super.initState();

    services = <String, bool>{
      for (final String key in serviceLabels.keys) key: true,
    };

    loadServices();
  }

  @override
  void dispose() {
    customerController.dispose();
    amountController.dispose();
    reasonController.dispose();
    super.dispose();
  }

  Future<String?> getToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    const List<String> keys = <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in keys) {
      final String value = (prefs.getString(key) ?? '').trim();

      if (value.isNotEmpty) {
        return value.startsWith('Bearer ') ? value.substring(7) : value;
      }
    }

    return null;
  }

  dynamic decodeBody(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  String messageFrom(
    dynamic decoded, {
    required String fallback,
  }) {
    if (decoded is Map) {
      final dynamic value = decoded['message'] ?? decoded['error'];

      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }

    return fallback;
  }

  void showMessage(
    String message, {
    bool error = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  Future<void> loadServices() async {
    setState(() {
      loadingServices = true;
    });

    try {
      final String? token = await getToken();

      if (token == null) {
        showMessage(
          'Admin session not found.',
          error: true,
        );
        return;
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/settings/admin'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      final dynamic decoded = decodeBody(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        showMessage(
          messageFrom(
            decoded,
            fallback: 'Unable to load service settings.',
          ),
          error: true,
        );
        return;
      }

      dynamic settings;

      if (decoded is Map) {
        settings = decoded['settings'] ?? decoded['data'];

        if (settings is Map && settings['settings'] is Map) {
          settings = settings['settings'];
        }
      }

      if (settings is Map && settings['services'] is Map) {
        final Map raw = settings['services'] as Map;

        for (final String key in serviceLabels.keys) {
          if (raw[key] is bool) {
            services[key] = raw[key] == true;
          }
        }
      }
    } catch (error) {
      showMessage(
        'Unable to load service settings.',
        error: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          loadingServices = false;
        });
      }
    }
  }

  Future<void> saveServices() async {
    setState(() {
      savingServices = true;
    });

    try {
      final String? token = await getToken();

      if (token == null) {
        showMessage(
          'Admin session not found.',
          error: true,
        );
        return;
      }

      final http.Response response = await http.put(
        Uri.parse('$baseUrl/settings/admin'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(
          <String, dynamic>{
            'reason': 'Head Office service availability update',
            'services': services,
          },
        ),
      );

      final dynamic decoded = decodeBody(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        showMessage(
          'Service controls updated successfully.',
        );
      } else {
        showMessage(
          messageFrom(
            decoded,
            fallback: 'Unable to update services.',
          ),
          error: true,
        );
      }
    } catch (_) {
      showMessage(
        'Unable to update services.',
        error: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          savingServices = false;
        });
      }
    }
  }

  Future<void> adjustWallet() async {
    final String identifier = customerController.text.trim();

    final double? amount = double.tryParse(
      amountController.text.trim(),
    );

    final String reason = reasonController.text.trim();

    if (identifier.isEmpty) {
      showMessage(
        'Enter customer phone, email or user ID.',
        error: true,
      );
      return;
    }

    if (amount == null || amount <= 0) {
      showMessage(
        'Enter a valid amount.',
        error: true,
      );
      return;
    }

    if (reason.length < 5) {
      showMessage(
        'Please enter a clear reason.',
        error: true,
      );
      return;
    }

    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: Text(
            walletAction == 'CREDIT' ? 'Confirm Credit' : 'Confirm Debit',
          ),
          content: Text(
            '${walletAction == 'CREDIT' ? 'Credit' : 'Debit'} '
            '₦${amount.toStringAsFixed(2)} '
            '${walletAction == 'CREDIT' ? 'to' : 'from'} '
            '$identifier?',
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Confirm'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) return;

    setState(() {
      adjustingWallet = true;
    });

    try {
      final String? token = await getToken();

      if (token == null) {
        showMessage(
          'Admin session not found.',
          error: true,
        );
        return;
      }

      final http.Response response = await http.post(
        Uri.parse(
          '$baseUrl/admin/wallet-adjustment',
        ),
        headers: <String, String>{
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(
          <String, dynamic>{
            'identifier': identifier,
            'action': walletAction,
            'amount': amount,
            'reason': reason,
          },
        ),
      );

      final dynamic decoded = decodeBody(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        dynamic customer;

        if (decoded is Map) {
          customer = decoded['customer'];
        }

        final dynamic balance =
            customer is Map ? customer['walletBalance'] : null;

        showMessage(
          balance == null
              ? messageFrom(
                  decoded,
                  fallback: 'Wallet adjusted successfully.',
                )
              : 'Wallet adjusted successfully. '
                  'New balance: ₦$balance',
        );

        amountController.clear();
        reasonController.clear();
      } else {
        showMessage(
          messageFrom(
            decoded,
            fallback: 'Wallet adjustment failed.',
          ),
          error: true,
        );
      }
    } catch (_) {
      showMessage(
        'Wallet adjustment failed.',
        error: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          adjustingWallet = false;
        });
      }
    }
  }

  Widget sectionCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required Widget child,
  }) {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF7F0),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    icon,
                    color: primaryGreen,
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
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
                        style: TextStyle(
                          color: Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            child,
          ],
        ),
      ),
    );
  }

  Widget buildServiceControl() {
    if (loadingServices) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      );
    }

    return Column(
      children: <Widget>[
        ...serviceLabels.entries.map(
          (MapEntry<String, String> entry) {
            final bool enabled = services[entry.key] == true;

            return SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                entry.value,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                ),
              ),
              subtitle: Text(
                enabled ? 'Visible to customers' : 'Hidden from customers',
              ),
              value: enabled,
              activeThumbColor: primaryGreen,
              onChanged: (bool value) {
                setState(() {
                  services[entry.key] = value;
                });
              },
            );
          },
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: savingServices ? null : saveServices,
            icon: savingServices
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                : const Icon(
                    Icons.save_rounded,
                  ),
            label: Text(
              savingServices ? 'Saving...' : 'Save Service Controls',
            ),
          ),
        ),
      ],
    );
  }

  Widget buildWalletControl() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        TextField(
          controller: customerController,
          decoration: const InputDecoration(
            labelText: 'Customer phone, email or User ID',
            prefixIcon: Icon(Icons.person_search_rounded),
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: walletAction,
          decoration: const InputDecoration(
            labelText: 'Action',
            border: OutlineInputBorder(),
          ),
          items: const <DropdownMenuItem<String>>[
            DropdownMenuItem<String>(
              value: 'CREDIT',
              child: Text('Credit Customer'),
            ),
            DropdownMenuItem<String>(
              value: 'DEBIT',
              child: Text('Debit Customer'),
            ),
          ],
          onChanged: (String? value) {
            if (value == null) return;

            setState(() {
              walletAction = value;
            });
          },
        ),
        const SizedBox(height: 16),
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
        const SizedBox(height: 16),
        TextField(
          controller: reasonController,
          minLines: 2,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Reason for adjustment',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor:
                  walletAction == 'DEBIT' ? Colors.red.shade700 : primaryGreen,
            ),
            onPressed: adjustingWallet ? null : adjustWallet,
            icon: adjustingWallet
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                : Icon(
                    walletAction == 'CREDIT'
                        ? Icons.add_card_rounded
                        : Icons.remove_circle_outline_rounded,
                  ),
            label: Text(
              adjustingWallet
                  ? 'Processing...'
                  : walletAction == 'CREDIT'
                      ? 'Credit Wallet'
                      : 'Debit Wallet',
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9FC),
      appBar: AppBar(
        title: const Text(
          'Head Office Controls',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh Services',
            onPressed: loadServices,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          sectionCard(
            title: 'Service Control',
            subtitle: 'Turn customer dashboard services ON or OFF.',
            icon: Icons.tune_rounded,
            child: buildServiceControl(),
          ),
          const SizedBox(height: 18),
          sectionCard(
            title: 'Customer Wallet',
            subtitle: 'Head Office can credit or debit a customer wallet.',
            icon: Icons.account_balance_wallet_rounded,
            child: buildWalletControl(),
          ),
        ],
      ),
    );
  }
}
