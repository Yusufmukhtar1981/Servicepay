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

  final nameController = TextEditingController();

  final phoneController = TextEditingController();

  final categoryController = TextEditingController();

  final descriptionController = TextEditingController();

  bool isSaving = false;
  bool isLoading = true;

  @override
  void initState() {
    super.initState();
    loadBusiness();
  }

  @override
  void dispose() {
    nameController.dispose();
    phoneController.dispose();
    categoryController.dispose();
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

  Future<void> loadBusiness() async {
    try {
      final token = await getToken();

      final response = await http.get(
        Uri.parse(
          '$baseUrl/servicepay-features/business-wallet',
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

      if (data['business'] is Map) {
        final business = Map<String, dynamic>.from(
          data['business'],
        );

        nameController.text = business['businessName']?.toString() ?? '';

        phoneController.text = business['businessPhone']?.toString() ?? '';

        categoryController.text = business['category']?.toString() ?? '';

        descriptionController.text = business['description']?.toString() ?? '';
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

  Future<void> saveBusiness() async {
    if (nameController.text.trim().isEmpty ||
        phoneController.text.trim().isEmpty ||
        categoryController.text.trim().isEmpty) {
      showMessage(
        'Business name, phone and category are required.',
      );
      return;
    }

    setState(() {
      isSaving = true;
    });

    try {
      final token = await getToken();

      final response = await http.post(
        Uri.parse(
          '$baseUrl/servicepay-features/business-wallet',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'businessName': nameController.text.trim(),
          'businessPhone': phoneController.text.trim(),
          'category': categoryController.text.trim(),
          'description': descriptionController.text.trim(),
        }),
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      showMessage(
        data['message']?.toString() ?? 'Business profile saved.',
      );
    } catch (_) {
      showMessage(
        'Unable to connect to ServicePay.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isSaving = false;
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
          'Business Wallet SME',
        ),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : ListView(
              padding: const EdgeInsets.all(18),
              children: [
                Container(
                  padding: const EdgeInsets.all(
                    20,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(
                      0xFFEAF7F0,
                    ),
                    borderRadius: BorderRadius.circular(
                      20,
                    ),
                  ),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.storefront_rounded,
                        color: primaryGreen,
                        size: 42,
                      ),
                      SizedBox(height: 12),
                      Text(
                        'Create Your ServicePay Business Profile',
                        style: TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 8),
                      Text(
                        'Manage your SME identity and prepare for merchant collections, payment links and business tools.',
                        style: TextStyle(
                          color: Colors.black54,
                          height: 1.5,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(
                    labelText: 'Business Name',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'Business Phone',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: categoryController,
                  decoration: const InputDecoration(
                    labelText: 'Business Category',
                    hintText: 'Retail, Logistics, School...',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: descriptionController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Business Description',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 18),
                FilledButton.icon(
                  onPressed: isSaving ? null : saveBusiness,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                    padding: const EdgeInsets.symmetric(
                      vertical: 16,
                    ),
                  ),
                  icon: const Icon(
                    Icons.save_rounded,
                  ),
                  label: Text(
                    isSaving ? 'Saving...' : 'Save Business Profile',
                  ),
                ),
              ],
            ),
    );
  }
}
