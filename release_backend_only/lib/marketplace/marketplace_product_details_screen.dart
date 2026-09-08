import 'package:flutter/material.dart';

import 'marketplace_cart_screen.dart';
import 'marketplace_cart_store.dart';

class MarketplaceProductDetailsScreen extends StatelessWidget {
  const MarketplaceProductDetailsScreen({
    super.key,
    required this.product,
  });

  final Map<String, dynamic> product;

  static const Color primary = Color(0xFF08783E);
  static const Color softGreen = Color(0xFFEAF7F0);

  String money(dynamic value) {
    final double amount =
        value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

    return '₦${amount.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final String imageUrl = '${product['imageUrl'] ?? ''}';

    final String title = '${product['title'] ?? 'Product'}';

    final String description =
        '${product['description'] ?? 'No description available.'}';

    final String merchant =
        '${product['merchantName'] ?? 'ServicePay Merchant'}';

    final String category = '${product['category'] ?? 'Marketplace'}';

    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('Product Details'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF15201B),
        elevation: 0,
        actions: [
          ValueListenableBuilder<List<Map<String, dynamic>>>(
            valueListenable: MarketplaceCartStore.items,
            builder: (_, __, ___) {
              final int count = MarketplaceCartStore.count;

              return Stack(
                alignment: Alignment.center,
                children: [
                  IconButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => const MarketplaceCartScreen(),
                        ),
                      );
                    },
                    icon: const Icon(
                      Icons.shopping_cart_outlined,
                    ),
                  ),
                  if (count > 0)
                    Positioned(
                      right: 6,
                      top: 6,
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          color: Colors.red,
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          '$count',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 120),
        children: [
          AspectRatio(
            aspectRatio: 1.15,
            child: imageUrl.isNotEmpty
                ? Image.network(
                    imageUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const ColoredBox(
                      color: softGreen,
                      child: Icon(
                        Icons.shopping_bag_outlined,
                        size: 80,
                        color: primary,
                      ),
                    ),
                  )
                : const ColoredBox(
                    color: softGreen,
                    child: Icon(
                      Icons.shopping_bag_outlined,
                      size: 80,
                      color: primary,
                    ),
                  ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  category.toUpperCase(),
                  style: const TextStyle(
                    color: primary,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 24,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  money(product['price']),
                  style: const TextStyle(
                    color: primary,
                    fontWeight: FontWeight.w900,
                    fontSize: 24,
                  ),
                ),
                const SizedBox(height: 18),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    children: [
                      const CircleAvatar(
                        backgroundColor: softGreen,
                        child: Icon(
                          Icons.storefront_outlined,
                          color: primary,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Sold by',
                              style: TextStyle(
                                color: Color(0xFF718078),
                                fontSize: 12,
                              ),
                            ),
                            Text(
                              merchant,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                const Text(
                  'Description',
                  style: TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 17,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  description,
                  style: const TextStyle(
                    color: Color(0xFF56635C),
                    height: 1.55,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Container(
          padding: const EdgeInsets.fromLTRB(
            16,
            12,
            16,
            12,
          ),
          decoration: const BoxDecoration(
            color: Colors.white,
            boxShadow: [
              BoxShadow(
                blurRadius: 18,
                color: Color(0x14000000),
                offset: Offset(0, -4),
              ),
            ],
          ),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {
                    MarketplaceCartStore.add(product);

                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Product added to cart.',
                        ),
                      ),
                    );
                  },
                  icon: const Icon(
                    Icons.add_shopping_cart,
                  ),
                  label: const Text('Add to Cart'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: primary,
                  ),
                  onPressed: () {
                    MarketplaceCartStore.add(product);

                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const MarketplaceCartScreen(),
                      ),
                    );
                  },
                  child: const Text('Buy Now'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
