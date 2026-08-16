import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'marketplace_cart_store.dart';

class MarketplaceCheckoutScreen extends StatefulWidget {
  const MarketplaceCheckoutScreen({super.key});

  @override
  State<MarketplaceCheckoutScreen> createState() =>
      _MarketplaceCheckoutScreenState();
}

class _MarketplaceCheckoutScreenState extends State<MarketplaceCheckoutScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primary = Color(0xFF08783E);
  static const Color softGreen = Color(0xFFEAF7F0);

  final formKey = GlobalKey<FormState>();

  final nameController = TextEditingController();
  final phoneController = TextEditingController();
  final addressController = TextEditingController();
  final stateController = TextEditingController();
  final lgaController = TextEditingController();
  final noteController = TextEditingController();

  bool loadingProfile = true;
  bool placingOrder = false;

  String paymentMethod = 'WALLET';

  @override
  void initState() {
    super.initState();
    _loadSavedCustomerDetails();
  }

  @override
  void dispose() {
    nameController.dispose();
    phoneController.dispose();
    addressController.dispose();
    stateController.dispose();
    lgaController.dispose();
    noteController.dispose();
    super.dispose();
  }

  Future<void> _loadSavedCustomerDetails() async {
    try {
      final prefs = await SharedPreferences.getInstance();

      nameController.text =
          prefs.getString('user_name') ?? prefs.getString('full_name') ?? '';

      phoneController.text =
          prefs.getString('user_phone') ?? prefs.getString('phone') ?? '';

      addressController.text =
          prefs.getString('user_address') ?? prefs.getString('address') ?? '';

      stateController.text =
          prefs.getString('user_state') ?? prefs.getString('state') ?? '';

      lgaController.text =
          prefs.getString('user_lga') ?? prefs.getString('lga') ?? '';
    } catch (_) {
      // Customer can still enter all details manually.
    }

    if (!mounted) return;

    setState(() {
      loadingProfile = false;
    });
  }

  Future<String?> _getToken() async {
    final prefs = await SharedPreferences.getInstance();

    return prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('access_token');
  }

  String _money(num value) {
    final text = value.toStringAsFixed(2);
    final parts = text.split('.');

    final chars = parts.first.split('').reversed.toList();
    final chunks = <String>[];

    for (var i = 0; i < chars.length; i += 3) {
      chunks.add(
        chars.skip(i).take(3).toList().reversed.join(),
      );
    }

    final whole = chunks.reversed.join(',');

    return '₦$whole.${parts.last}';
  }

  String _productId(Map<String, dynamic> item) {
    final raw =
        item['_id'] ?? item['id'] ?? item['productId'] ?? item['product'];

    if (raw is Map) {
      return '${raw['_id'] ?? raw['id'] ?? ''}'.trim();
    }

    return '$raw'.trim();
  }

  int _quantity(Map<String, dynamic> item) {
    final raw = item['quantity'];

    if (raw is int) {
      return raw < 1 ? 1 : raw;
    }

    final parsed = int.tryParse('$raw') ?? 1;

    return parsed < 1 ? 1 : parsed;
  }

  double _price(Map<String, dynamic> item) {
    final raw = item['price'] ?? item['sellingPrice'] ?? item['amount'] ?? 0;

    if (raw is num) {
      return raw.toDouble();
    }

    return double.tryParse('$raw') ?? 0;
  }

  String _title(Map<String, dynamic> item) {
    return '${item['title'] ?? item['name'] ?? 'Marketplace Product'}';
  }

  Future<void> _placeOrder() async {
    if (placingOrder) return;

    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    final cart = MarketplaceCartStore.items.value;

    if (cart.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Your cart is empty.'),
        ),
      );
      return;
    }

    final orderItems = <Map<String, dynamic>>[];

    for (final raw in cart) {
      final item = Map<String, dynamic>.from(raw);
      final id = _productId(item);

      if (id.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'One of the products has an invalid product ID.',
            ),
          ),
        );
        return;
      }

      orderItems.add({
        'productId': id,
        'quantity': _quantity(item),
      });
    }

    final token = await _getToken();

    if (token == null || token.trim().isEmpty) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Your login session was not found. Please login again.',
          ),
        ),
      );
      return;
    }

    setState(() {
      placingOrder = true;
    });

    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/marketplace/orders'),
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': 'Bearer ${token.trim()}',
            },
            body: jsonEncode({
              'items': orderItems,
              'customerName': nameController.text.trim(),
              'customerPhone': phoneController.text.trim(),
              'deliveryAddress': addressController.text.trim(),
              'state': stateController.text.trim(),
              'lga': lgaController.text.trim(),
              'deliveryNote': noteController.text.trim(),
              'paymentMethod': paymentMethod,
            }),
          )
          .timeout(const Duration(seconds: 45));

      dynamic decoded;

      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }

      final success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (decoded is! Map ||
              decoded['success'] == null ||
              decoded['success'] == true);

      if (!mounted) return;

      if (!success) {
        String message = 'Unable to place Marketplace order.';

        if (decoded is Map &&
            decoded['message'] != null &&
            '${decoded['message']}'.trim().isNotEmpty) {
          message = '${decoded['message']}';
        }

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(message),
          ),
        );
        return;
      }

      MarketplaceCartStore.clear();

      String reference = '';

      if (decoded is Map) {
        final order = decoded['order'];

        if (order is Map) {
          reference =
              '${order['reference'] ?? order['orderReference'] ?? order['_id'] ?? ''}';
        } else {
          reference =
              '${decoded['reference'] ?? decoded['orderReference'] ?? ''}';
        }
      }

      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) {
          return AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(24),
            ),
            icon: const CircleAvatar(
              radius: 28,
              backgroundColor: softGreen,
              child: Icon(
                Icons.check_circle_rounded,
                color: primary,
                size: 38,
              ),
            ),
            title: const Text(
              'Order Placed Successfully',
              textAlign: TextAlign.center,
            ),
            content: Text(
              reference.trim().isEmpty
                  ? 'Your Marketplace order has been received successfully.'
                  : 'Your Marketplace order has been received successfully.\n\nReference: $reference',
              textAlign: TextAlign.center,
            ),
            actionsAlignment: MainAxisAlignment.center,
            actions: [
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: primary,
                ),
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                },
                child: const Text('Done'),
              ),
            ],
          );
        },
      );

      if (!mounted) return;

      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            error.toString().contains('TimeoutException')
                ? 'Request timed out. Please check your internet connection and try again.'
                : 'Could not place order. Please try again.',
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          placingOrder = false;
        });
      }
    }
  }

  InputDecoration _inputDecoration({
    required String label,
    required IconData icon,
    String? hint,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: Icon(icon),
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: Color(0xFFE2E8F0),
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: Color(0xFFE2E8F0),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: primary,
          width: 1.5,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('Checkout'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF15201B),
        elevation: 0,
      ),
      body: loadingProfile
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : ValueListenableBuilder<List<Map<String, dynamic>>>(
              valueListenable: MarketplaceCartStore.items,
              builder: (context, cart, _) {
                final subtotal = cart.fold<double>(
                  0,
                  (sum, item) => sum + (_price(item) * _quantity(item)),
                );

                return Form(
                  key: formKey,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          color: primary,
                          borderRadius: BorderRadius.circular(22),
                        ),
                        child: const Row(
                          children: [
                            CircleAvatar(
                              backgroundColor: Colors.white24,
                              child: Icon(
                                Icons.local_shipping_rounded,
                                color: Colors.white,
                              ),
                            ),
                            SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Delivery Information',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 17,
                                    ),
                                  ),
                                  SizedBox(height: 4),
                                  Text(
                                    'Enter the correct details for your order delivery.',
                                    style: TextStyle(
                                      color: Colors.white70,
                                      height: 1.3,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                      TextFormField(
                        controller: nameController,
                        textInputAction: TextInputAction.next,
                        decoration: _inputDecoration(
                          label: 'Customer Name',
                          icon: Icons.person_outline_rounded,
                        ),
                        validator: (value) {
                          if ((value ?? '').trim().isEmpty) {
                            return 'Customer name is required';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: phoneController,
                        keyboardType: TextInputType.phone,
                        textInputAction: TextInputAction.next,
                        decoration: _inputDecoration(
                          label: 'Phone Number',
                          icon: Icons.phone_outlined,
                        ),
                        validator: (value) {
                          if ((value ?? '').trim().isEmpty) {
                            return 'Phone number is required';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: addressController,
                        minLines: 2,
                        maxLines: 3,
                        decoration: _inputDecoration(
                          label: 'Delivery Address',
                          icon: Icons.location_on_outlined,
                          hint: 'Street, area, landmark...',
                        ),
                        validator: (value) {
                          if ((value ?? '').trim().isEmpty) {
                            return 'Delivery address is required';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: stateController,
                              textInputAction: TextInputAction.next,
                              decoration: _inputDecoration(
                                label: 'State',
                                icon: Icons.map_outlined,
                              ),
                              validator: (value) {
                                if ((value ?? '').trim().isEmpty) {
                                  return 'State required';
                                }
                                return null;
                              },
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextFormField(
                              controller: lgaController,
                              decoration: _inputDecoration(
                                label: 'LGA',
                                icon: Icons.place_outlined,
                              ),
                              validator: (value) {
                                if ((value ?? '').trim().isEmpty) {
                                  return 'LGA required';
                                }
                                return null;
                              },
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: noteController,
                        minLines: 2,
                        maxLines: 4,
                        decoration: _inputDecoration(
                          label: 'Delivery Note (Optional)',
                          icon: Icons.notes_rounded,
                          hint: 'Any special delivery instruction',
                        ),
                      ),
                      const SizedBox(height: 20),
                      const Text(
                        'Payment Method',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 10),
                      RadioGroup<String>(
                        groupValue: paymentMethod,
                        onChanged: (value) {
                          if (value == null) return;
                          setState(() {
                            paymentMethod = value;
                          });
                        },
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(
                              color: const Color(0xFFE2E8F0),
                            ),
                          ),
                          child: const RadioListTile<String>(
                            value: 'WALLET',
                            activeColor: primary,
                            title: Text(
                              'ServicePay Wallet',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            subtitle: Text(
                              'Pay securely using your ServicePay wallet.',
                            ),
                            secondary: Icon(
                              Icons.account_balance_wallet_outlined,
                              color: primary,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 22),
                      const Text(
                        'Order Summary',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: const Color(0xFFE2E8F0),
                          ),
                        ),
                        child: Column(
                          children: [
                            for (final item in cart) ...[
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Text(
                                      _title(item),
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Text(
                                    '${_quantity(item)} × ${_money(_price(item))}',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 10),
                            ],
                            const Divider(),
                            Row(
                              children: [
                                const Expanded(
                                  child: Text(
                                    'Subtotal',
                                    style: TextStyle(
                                      color: Colors.black54,
                                    ),
                                  ),
                                ),
                                Text(
                                  _money(subtotal),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                const Expanded(
                                  child: Text(
                                    'Total',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w800,
                                      fontSize: 17,
                                    ),
                                  ),
                                ),
                                Text(
                                  _money(subtotal),
                                  style: const TextStyle(
                                    color: primary,
                                    fontWeight: FontWeight.w900,
                                    fontSize: 19,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 22),
                      SizedBox(
                        height: 54,
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(
                            backgroundColor: primary,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          onPressed:
                              placingOrder || cart.isEmpty ? null : _placeOrder,
                          icon: placingOrder
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.3,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(
                                  Icons.lock_outline_rounded,
                                ),
                          label: Text(
                            placingOrder
                                ? 'Placing Order...'
                                : 'Place Order • ${_money(subtotal)}',
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 30),
                    ],
                  ),
                );
              },
            ),
    );
  }
}
