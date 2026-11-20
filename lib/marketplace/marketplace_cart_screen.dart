import 'package:flutter/material.dart';

import 'marketplace_cart_store.dart';
import 'marketplace_checkout_screen.dart';
import '../servicepay_theme.dart';

class MarketplaceCartScreen extends StatelessWidget {
  const MarketplaceCartScreen({super.key});

  static const Color primary = ServicePayColors.brand;
  static const Color softGreen = ServicePayColors.brandSoft;

  String money(dynamic value) {
    final double amount =
        value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

    return '₦${amount.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ServicePayColors.canvas,
      appBar: AppBar(
        title: const Text('My Cart'),
        backgroundColor: ServicePayColors.canvas,
        foregroundColor: ServicePayColors.accent,
        elevation: 0,
      ),
      body: ValueListenableBuilder<List<Map<String, dynamic>>>(
        valueListenable: MarketplaceCartStore.items,
        builder: (context, items, _) {
          if (items.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.shopping_cart_outlined,
                    size: 72,
                    color: Color(0xFF9AA7A0),
                  ),
                  SizedBox(height: 16),
                  Text(
                    'Your cart is empty',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 18,
                    ),
                  ),
                  SizedBox(height: 6),
                  Text(
                    'Add products from Marketplace.',
                    style: TextStyle(
                      color: ServicePayColors.muted,
                    ),
                  ),
                ],
              ),
            );
          }

          return Column(
            children: [
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final item = items[index];

                    final String imageUrl = '${item['imageUrl'] ?? ''}';

                    final String title = '${item['title'] ?? 'Product'}';

                    final String merchant =
                        '${item['merchantName'] ?? 'ServicePay Merchant'}';

                    final int quantity = (item['quantity'] as int?) ?? 1;

                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: ServicePayColors.surface,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: ServicePayColors.border,
                        ),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(14),
                            child: SizedBox(
                              width: 82,
                              height: 82,
                              child: imageUrl.isNotEmpty
                                  ? Image.network(
                                      imageUrl,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) =>
                                          const ColoredBox(
                                        color: softGreen,
                                        child: Icon(
                                          Icons.shopping_bag_outlined,
                                          color: ServicePayColors.accent,
                                        ),
                                      ),
                                    )
                                  : const ColoredBox(
                                      color: softGreen,
                                      child: Icon(
                                        Icons.shopping_bag_outlined,
                                        color: ServicePayColors.accent,
                                      ),
                                    ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  merchant,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: ServicePayColors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  money(item['price']),
                                  style: const TextStyle(
                                    color: ServicePayColors.accent,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 16,
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Row(
                                  children: [
                                    IconButton(
                                      visualDensity: VisualDensity.compact,
                                      onPressed: () {
                                        MarketplaceCartStore.decrease(index);
                                      },
                                      icon: const Icon(
                                        Icons.remove_circle_outline,
                                      ),
                                    ),
                                    Text(
                                      '$quantity',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    IconButton(
                                      visualDensity: VisualDensity.compact,
                                      onPressed: () {
                                        MarketplaceCartStore.increase(index);
                                      },
                                      icon: const Icon(
                                        Icons.add_circle_outline,
                                        color: ServicePayColors.accent,
                                      ),
                                    ),
                                    const Spacer(),
                                    IconButton(
                                      onPressed: () {
                                        MarketplaceCartStore.remove(index);
                                      },
                                      icon: const Icon(
                                        Icons.delete_outline,
                                        color: Colors.redAccent,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
              Container(
                padding: const EdgeInsets.fromLTRB(
                  20,
                  16,
                  20,
                  20,
                ),
                decoration: const BoxDecoration(
                  color: ServicePayColors.surface,
                  boxShadow: [
                    BoxShadow(
                      blurRadius: 20,
                      color: Color(0x14000000),
                      offset: Offset(0, -4),
                    ),
                  ],
                ),
                child: SafeArea(
                  top: false,
                  child: Column(
                    children: [
                      Row(
                        children: [
                          const Text(
                            'Subtotal',
                            style: TextStyle(
                              fontSize: 15,
                              color: ServicePayColors.muted,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            money(
                              MarketplaceCartStore.subtotal,
                            ),
                            style: const TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: 20,
                              color: ServicePayColors.accent,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: FilledButton(
                          style: FilledButton.styleFrom(
                            backgroundColor: ServicePayColors.accent, foregroundColor: ServicePayColors.onAccent,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                          onPressed: () {
                            if (MarketplaceCartStore.items.value.isEmpty) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Your cart is empty.'),
                                ),
                              );
                              return;
                            }

                            Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) =>
                                    const MarketplaceCheckoutScreen(),
                              ),
                            );
                          },
                          child: const Text(
                            'Proceed to Checkout',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
