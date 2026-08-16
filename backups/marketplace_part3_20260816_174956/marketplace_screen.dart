import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class MarketplaceScreen extends StatefulWidget {
  const MarketplaceScreen({super.key});

  @override
  State<MarketplaceScreen> createState() => _MarketplaceScreenState();
}

class _MarketplaceScreenState extends State<MarketplaceScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  String errorMessage = '';
  String searchQuery = '';

  List<Map<String, dynamic>> products = [];

  @override
  void initState() {
    super.initState();
    loadProducts();
  }

  Future<void> loadProducts() async {
    setState(() {
      isLoading = true;
      errorMessage = '';
    });

    try {
      final uri = Uri.parse(
        '$baseUrl/marketplace?q=${Uri.encodeQueryComponent(searchQuery)}',
      );

      final response = await http.get(uri).timeout(const Duration(seconds: 30));

      final dynamic decoded = jsonDecode(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          decoded is Map ? decoded['message'] : 'Marketplace request failed.',
        );
      }

      final List<dynamic> rawProducts = decoded['products'] ?? [];

      if (!mounted) return;

      setState(() {
        products = rawProducts
            .whereType<Map>()
            .map(
              (item) => Map<String, dynamic>.from(item),
            )
            .toList();

        isLoading = false;
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = 'Unable to load Marketplace right now.';
      });
    }
  }

  String money(dynamic value) {
    final number = double.tryParse('$value') ?? 0;

    return '₦${number.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('Marketplace'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF15201B),
        elevation: 0,
        actions: [
          IconButton(
            onPressed: loadProducts,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadProducts,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFF08783E),
                borderRadius: BorderRadius.circular(24),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.storefront_rounded,
                    color: Colors.white,
                    size: 34,
                  ),
                  SizedBox(height: 16),
                  Text(
                    'ServicePay Marketplace',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Discover products and services from trusted ServicePay merchants.',
                    style: TextStyle(
                      color: Colors.white70,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            TextField(
              textInputAction: TextInputAction.search,
              onSubmitted: (value) {
                searchQuery = value.trim();
                loadProducts();
              },
              decoration: InputDecoration(
                hintText: 'Search Marketplace',
                prefixIcon: const Icon(Icons.search_rounded),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(18),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 22),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Discover',
                    style: TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Text(
                  '${products.length} items',
                  style: const TextStyle(
                    color: Colors.black54,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (isLoading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(
                  child: CircularProgressIndicator(),
                ),
              )
            else if (errorMessage.isNotEmpty)
              Padding(
                padding: const EdgeInsets.all(30),
                child: Column(
                  children: [
                    const Icon(
                      Icons.cloud_off_rounded,
                      size: 42,
                    ),
                    const SizedBox(height: 12),
                    Text(errorMessage),
                    const SizedBox(height: 14),
                    FilledButton(
                      onPressed: loadProducts,
                      child: const Text('Try again'),
                    ),
                  ],
                ),
              )
            else if (products.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(
                  vertical: 50,
                ),
                child: Center(
                  child: Column(
                    children: [
                      Icon(
                        Icons.storefront_outlined,
                        size: 50,
                        color: Colors.black38,
                      ),
                      SizedBox(height: 14),
                      Text(
                        'Marketplace products will appear here.',
                      ),
                    ],
                  ),
                ),
              )
            else
              GridView.builder(
                itemCount: products.length,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  childAspectRatio: 0.72,
                ),
                itemBuilder: (
                  context,
                  index,
                ) {
                  final product = products[index];

                  final imageUrl = '${product['imageUrl'] ?? ''}';

                  return Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: const Color(0xFFE8ECEA),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: const BorderRadius.vertical(
                              top: Radius.circular(20),
                            ),
                            child: imageUrl.isNotEmpty
                                ? Image.network(
                                    imageUrl,
                                    width: double.infinity,
                                    fit: BoxFit.cover,
                                    errorBuilder: (
                                      context,
                                      error,
                                      stackTrace,
                                    ) =>
                                        const _ProductPlaceholder(),
                                  )
                                : const _ProductPlaceholder(),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(
                            12,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${product['title'] ?? 'Product'}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 15,
                                ),
                              ),
                              const SizedBox(height: 5),
                              Text(
                                '${product['merchantName'] ?? 'ServicePay Merchant'}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.black54,
                                  fontSize: 12,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                money(
                                  product['price'],
                                ),
                                style: const TextStyle(
                                  color: Color(0xFF08783E),
                                  fontWeight: FontWeight.w800,
                                  fontSize: 16,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _ProductPlaceholder extends StatelessWidget {
  const _ProductPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFEAF7F0),
      alignment: Alignment.center,
      child: const Icon(
        Icons.shopping_bag_outlined,
        size: 44,
        color: Color(0xFF08783E),
      ),
    );
  }
}
