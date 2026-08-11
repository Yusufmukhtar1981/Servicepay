import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class GroupWalletScreen extends StatefulWidget {
  const GroupWalletScreen({super.key});

  @override
  State<GroupWalletScreen> createState() => _GroupWalletScreenState();
}

class _GroupWalletScreenState extends State<GroupWalletScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final nameController = TextEditingController();

  final amountController = TextEditingController();

  final descriptionController = TextEditingController();

  String frequency = 'MONTHLY';

  bool isSubmitting = false;
  bool isLoading = true;

  List<Map<String, dynamic>> groups = [];

  @override
  void initState() {
    super.initState();
    loadGroups();
  }

  @override
  void dispose() {
    nameController.dispose();
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

  Future<void> loadGroups() async {
    try {
      final token = await getToken();

      final response = await http.get(
        Uri.parse(
          '$baseUrl/servicepay-features/groups',
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

      final raw = data['groups'];

      groups = raw is List
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

  Future<void> createGroup() async {
    final amount = double.tryParse(
          amountController.text.trim(),
        ) ??
        0;

    if (nameController.text.trim().isEmpty || amount <= 0) {
      showMessage(
        'Enter group name and contribution amount.',
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
          '$baseUrl/servicepay-features/groups',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'name': nameController.text.trim(),
          'description': descriptionController.text.trim(),
          'contributionAmount': amount,
          'frequency': frequency,
        }),
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      showMessage(
        data['message']?.toString() ?? 'Group created.',
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        nameController.clear();
        amountController.clear();
        descriptionController.clear();

        await loadGroups();
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
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF8),
      appBar: AppBar(
        title: const Text(
          'Group Wallet / Ajo',
        ),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Text(
            'Create an Ajo / Contribution Group',
            style: TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Organize contribution groups without investment returns or interest.',
            style: TextStyle(
              color: Colors.black54,
            ),
          ),
          const SizedBox(height: 18),
          TextField(
            controller: nameController,
            decoration: const InputDecoration(
              labelText: 'Group Name',
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
              labelText: 'Contribution Amount',
              prefixText: '₦ ',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: frequency,
            decoration: const InputDecoration(
              labelText: 'Frequency',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(
                value: 'DAILY',
                child: Text('Daily'),
              ),
              DropdownMenuItem(
                value: 'WEEKLY',
                child: Text('Weekly'),
              ),
              DropdownMenuItem(
                value: 'MONTHLY',
                child: Text('Monthly'),
              ),
            ],
            onChanged: (value) {
              if (value == null) return;

              setState(() {
                frequency = value;
              });
            },
          ),
          const SizedBox(height: 14),
          TextField(
            controller: descriptionController,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'Description (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: isSubmitting ? null : createGroup,
            style: FilledButton.styleFrom(
              backgroundColor: primaryGreen,
              padding: const EdgeInsets.symmetric(
                vertical: 16,
              ),
            ),
            icon: const Icon(
              Icons.groups_rounded,
            ),
            label: Text(
              isSubmitting ? 'Creating...' : 'Create Group',
            ),
          ),
          const SizedBox(height: 28),
          const Text(
            'Your Groups',
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
          else if (groups.isEmpty)
            const Text(
              'No groups created yet.',
            )
          else
            ...groups.map(
              (group) => Card(
                child: ListTile(
                  leading: const Icon(
                    Icons.groups_rounded,
                    color: primaryGreen,
                  ),
                  title: Text(
                    group['name']?.toString() ?? 'Ajo Group',
                  ),
                  subtitle: Text(
                    '₦${group['contributionAmount'] ?? 0} • '
                    '${group['frequency'] ?? 'MONTHLY'}',
                  ),
                  trailing: Text(
                    group['status']?.toString() ?? 'ACTIVE',
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
