import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminMarketplaceScreen extends StatefulWidget {
  const AdminMarketplaceScreen({super.key});

  @override
  State<AdminMarketplaceScreen> createState() => _AdminMarketplaceScreenState();
}

class _AdminMarketplaceScreenState extends State<AdminMarketplaceScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool loading = true;
  String? error;
  List<Map<String, dynamic>> products = [];

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token');
  }

  Future<void> _loadProducts() async {
    if (mounted) {
      setState(() {
        loading = true;
        error = null;
      });
    }

    try {
      final token = await _token();

      final response = await http.get(
        Uri.parse('$baseUrl/admin/marketplace/products?status=PENDING'),
        headers: {
          'Accept': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 30));

      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        String message = 'Unable to load Marketplace products.';
        if (decoded is Map && decoded['message'] != null) {
          message = decoded['message'].toString();
        }
        throw Exception(message);
      }

      final dynamic rawProducts =
          decoded is Map ? (decoded['products'] ?? decoded['data']) : decoded;

      final list = rawProducts is List
          ? rawProducts
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];

      if (!mounted) return;

      setState(() {
        products = list;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        error = e.toString().replaceFirst('Exception: ', '');
        loading = false;
      });
    }
  }

  Future<void> _updateStatus(
    Map<String, dynamic> product,
    String status,
  ) async {
    final id = product['_id']?.toString() ?? product['id']?.toString();

    if (id == null || id.isEmpty) return;

    try {
      final token = await _token();

      final response = await http
          .patch(
            Uri.parse('$baseUrl/admin/marketplace/products/$id/status'),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              if (token != null) 'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'status': status,
            }),
          )
          .timeout(const Duration(seconds: 30));

      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }

      if (!mounted) return;

      if (response.statusCode >= 200 && response.statusCode < 300) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              status == 'ACTIVE'
                  ? 'Product approved successfully.'
                  : status == 'REJECTED'
                      ? 'Product rejected.'
                      : 'Product suspended.',
            ),
          ),
        );

        await _loadProducts();
        return;
      }

      String message = 'Unable to update product.';
      if (decoded is Map && decoded['message'] != null) {
        message = decoded['message'].toString();
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().replaceFirst('Exception: ', ''),
          ),
        ),
      );
    }
  }

  String _text(
    Map<String, dynamic> item,
    List<String> keys, {
    String fallback = '-',
  }) {
    for (final key in keys) {
      final value = item[key];
      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }
    return fallback;
  }

  @override
  Widget build(BuildContext context) {
    const primary = Color(0xFF0F766E);

    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('Marketplace Approval'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF15201B),
        elevation: 0,
        actions: [
          IconButton(
            onPressed: _loadProducts,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: loading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.error_outline_rounded,
                          size: 48,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          error!,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _loadProducts,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : products.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.inventory_2_outlined,
                            size: 52,
                            color: Colors.grey,
                          ),
                          SizedBox(height: 12),
                          Text(
                            'No pending Marketplace products.',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadProducts,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: products.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final product = products[index];

                          final name = _text(
                            product,
                            ['title', 'name', 'productName'],
                          );

                          final merchant = _text(
                            product,
                            ['merchantName', 'storeName'],
                            fallback: 'Marketplace Seller',
                          );

                          final price = _text(
                            product,
                            ['price'],
                            fallback: '0',
                          );

                          final stock = _text(
                            product,
                            ['stock'],
                            fallback: '0',
                          );

                          final category = _text(
                            product,
                            ['category'],
                            fallback: 'General',
                          );
                          final imageUrl = _text(
                            product,
                            ['imageUrl'],
                            fallback: '',
                          );

                          return Card(
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(18),
                              side: const BorderSide(
                                color: Color(0xFFE2E8F0),
                              ),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Container(
                                        width: 44,
                                        height: 44,
                                        decoration: BoxDecoration(
                                          color:
                                              primary.withValues(alpha: 0.10),
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                        ),
                                        clipBehavior: Clip.antiAlias,
                                        child: imageUrl.isNotEmpty
                                            ? Image.network(
                                                imageUrl,
                                                fit: BoxFit.cover,
                                                errorBuilder: (_, __, ___) =>
                                                    const Icon(
                                                  Icons.storefront_rounded,
                                                  color: primary,
                                                ),
                                              )
                                            : const Icon(
                                                Icons.storefront_rounded,
                                                color: primary,
                                              ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              name,
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w800,
                                              ),
                                            ),
                                            const SizedBox(
                                              height: 4,
                                            ),
                                            Text(
                                              merchant,
                                              style: const TextStyle(
                                                color: Colors.grey,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 10,
                                          vertical: 6,
                                        ),
                                        decoration: BoxDecoration(
                                          color: Colors.orange
                                              .withValues(alpha: 0.10),
                                          borderRadius: BorderRadius.circular(
                                            100,
                                          ),
                                        ),
                                        child: const Text(
                                          'PENDING',
                                          style: TextStyle(
                                            color: Colors.orange,
                                            fontWeight: FontWeight.w800,
                                            fontSize: 11,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 14),
                                  Wrap(
                                    spacing: 18,
                                    runSpacing: 8,
                                    children: [
                                      Text(
                                        '₦$price',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                      Text(
                                        'Stock: $stock',
                                      ),
                                      Text(
                                        'Category: $category',
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 16),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: OutlinedButton.icon(
                                          onPressed: () => _updateStatus(
                                            product,
                                            'REJECTED',
                                          ),
                                          icon: const Icon(
                                            Icons.close_rounded,
                                          ),
                                          label: const Text(
                                            'Reject',
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: FilledButton.icon(
                                          style: FilledButton.styleFrom(
                                            backgroundColor: primary,
                                          ),
                                          onPressed: () => _updateStatus(
                                            product,
                                            'ACTIVE',
                                          ),
                                          icon: const Icon(
                                            Icons.check_rounded,
                                          ),
                                          label: const Text(
                                            'Approve',
                                          ),
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
                    ),
    );
  }
}
