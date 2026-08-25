import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class MarketplaceSellerOrdersScreen extends StatefulWidget {
  const MarketplaceSellerOrdersScreen({super.key});

  @override
  State<MarketplaceSellerOrdersScreen> createState() =>
      _MarketplaceSellerOrdersScreenState();
}

class _MarketplaceSellerOrdersScreenState
    extends State<MarketplaceSellerOrdersScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  String errorMessage = '';
  List<dynamic> orders = [];

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token');
  }

  Future<void> _loadOrders() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final token = await _token();

      if (token == null || token.isEmpty) {
        throw Exception('Please login again.');
      }

      final response = await http.get(
        Uri.parse('$baseUrl/marketplace/seller/orders'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      final decoded = response.body.isNotEmpty
          ? jsonDecode(response.body)
          : <String, dynamic>{};

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          decoded is Map && decoded['message'] != null
              ? decoded['message'].toString()
              : 'Unable to load store orders.',
        );
      }

      final dynamic rawOrders = decoded is Map
          ? (decoded['orders'] ??
              decoded['data'] ??
              decoded['results'] ??
              <dynamic>[])
          : decoded;

      if (mounted) {
        setState(() {
          orders = rawOrders is List ? rawOrders : <dynamic>[];
          isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          errorMessage = e.toString().replaceFirst('Exception: ', '');
          isLoading = false;
        });
      }
    }
  }

  Future<void> _updateStatus(
    String orderId,
    String status,
  ) async {
    final token = await _token();

    if (token == null || token.isEmpty) {
      _showMessage('Please login again.');
      return;
    }

    try {
      final response = await http.patch(
        Uri.parse('$baseUrl/marketplace/seller/orders/$orderId/status'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'status': status,
        }),
      );

      final decoded = response.body.isNotEmpty
          ? jsonDecode(response.body)
          : <String, dynamic>{};

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          decoded is Map && decoded['message'] != null
              ? decoded['message'].toString()
              : 'Unable to update order.',
        );
      }

      _showMessage(
        'Order updated to $status.',
      );

      await _loadOrders();
    } catch (e) {
      _showMessage(
        e.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  String _money(dynamic value) {
    final number = double.tryParse('${value ?? 0}') ?? 0;
    return '₦${number.toStringAsFixed(2)}';
  }

  String _status(dynamic raw) {
    final value = '${raw ?? 'PENDING'}'.trim().toUpperCase();
    return value.isEmpty ? 'PENDING' : value;
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'DELIVERED':
      case 'COMPLETED':
        return Colors.green;
      case 'SHIPPED':
        return Colors.blue;
      case 'PROCESSING':
        return Colors.orange;
      case 'CANCELLED':
      case 'FAILED':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  Widget _buildOrderCard(dynamic rawOrder) {
    final order =
        rawOrder is Map<String, dynamic> ? rawOrder : <String, dynamic>{};

    final id = '${order['_id'] ?? order['id'] ?? ''}';
    final reference = '${order['reference'] ?? order['orderReference'] ?? id}';

    final status = _status(
      order['orderStatus'] ?? order['status'],
    );

    final customer = order['customer'];
    final customerMap = customer is Map
        ? Map<String, dynamic>.from(customer)
        : <String, dynamic>{};

    final customerName =
        '${customerMap['fullName'] ?? customerMap['name'] ?? order['customerName'] ?? 'Customer'}';

    final customerPhone =
        '${customerMap['phone'] ?? order['customerPhone'] ?? ''}';

    final deliveryAddress =
        '${order['deliveryAddress'] ?? order['address'] ?? ''}';

    final totalAmount =
        order['totalAmount'] ?? order['amount'] ?? order['grandTotal'] ?? 0;

    final itemsRaw = order['items'];
    final items = itemsRaw is List ? itemsRaw : <dynamic>[];

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    reference.isNotEmpty
                        ? 'Order $reference'
                        : 'Marketplace Order',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: _statusColor(status).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: Text(
                    status,
                    style: TextStyle(
                      color: _statusColor(status),
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              customerName,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
              ),
            ),
            if (customerPhone.isNotEmpty) ...[
              const SizedBox(height: 3),
              Text(customerPhone),
            ],
            if (deliveryAddress.isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.location_on_outlined,
                    size: 18,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(deliveryAddress),
                  ),
                ],
              ),
            ],
            if (items.isNotEmpty) ...[
              const Divider(height: 28),
              const Text(
                'Items',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              ...items.map((rawItem) {
                final item = rawItem is Map
                    ? Map<String, dynamic>.from(rawItem)
                    : <String, dynamic>{};

                final product = item['product'];
                final productMap = product is Map
                    ? Map<String, dynamic>.from(product)
                    : <String, dynamic>{};

                final title =
                    '${item['title'] ?? productMap['title'] ?? productMap['name'] ?? 'Product'}';

                final qty = int.tryParse('${item['quantity'] ?? 1}') ?? 1;

                final price =
                    item['unitPrice'] ?? item['price'] ?? productMap['price'];

                return Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text('$qty × $title'),
                      ),
                      Text(
                        _money(price),
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
            const Divider(height: 28),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Total',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Text(
                  _money(totalAmount),
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (status == 'PAID' ||
                status == 'PLACED' ||
                status == 'CONFIRMED')
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: id.isEmpty
                      ? null
                      : () => _updateStatus(
                            id,
                            'ACCEPTED',
                          ),
                  icon: const Icon(Icons.task_alt_outlined),
                  label: const Text('Accept Order'),
                ),
              ),
            if (status == 'ACCEPTED')
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: id.isEmpty
                      ? null
                      : () => _updateStatus(
                            id,
                            'PROCESSING',
                          ),
                  icon: const Icon(Icons.inventory_2_outlined),
                  label: const Text('Start Processing'),
                ),
              ),
            if (status == 'PROCESSING')
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: id.isEmpty
                      ? null
                      : () => _updateStatus(
                            id,
                            'READY',
                          ),
                  icon: const Icon(Icons.inventory_2_outlined),
                  label: const Text('Mark as Ready'),
                ),
              ),
            if (status == 'READY' || status == 'READY_FOR_DELIVERY')
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: id.isEmpty
                      ? null
                      : () => _updateStatus(
                            id,
                            'SHIPPED',
                          ),
                  icon: const Icon(Icons.local_shipping_outlined),
                  label: const Text('Mark as Shipped'),
                ),
              ),
            if (status == 'SHIPPED')
              const Row(
                children: [
                  Icon(
                    Icons.local_shipping_outlined,
                    color: Colors.blue,
                  ),
                  SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      'Shipped — delivery confirmation is managed outside the seller dashboard.',
                      style: TextStyle(
                        color: Colors.blue,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            if (status == 'DELIVERED' || status == 'COMPLETED')
              Row(
                children: [
                  const Icon(
                    Icons.verified_rounded,
                    color: Colors.green,
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      '${order['fundsStatus'] ?? 'HELD'}'.toUpperCase() == 'SETTLED'
                          ? 'Delivered — payment was released after the buyer confirmed delivery.'
                          : 'Delivered — payment remains held until an authorized settlement is completed.',
                      style: const TextStyle(
                        color: Colors.green,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        title: const Text(
          'My Store Orders',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            onPressed: _loadOrders,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadOrders,
        child: isLoading
            ? const Center(
                child: CircularProgressIndicator(),
              )
            : errorMessage.isNotEmpty
                ? ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      const SizedBox(height: 120),
                      const Icon(
                        Icons.error_outline,
                        size: 52,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        errorMessage,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _loadOrders,
                        child: const Text('Try Again'),
                      ),
                    ],
                  )
                : orders.isEmpty
                    ? ListView(
                        padding: const EdgeInsets.all(24),
                        children: const [
                          SizedBox(height: 120),
                          Icon(
                            Icons.receipt_long_outlined,
                            size: 58,
                          ),
                          SizedBox(height: 16),
                          Text(
                            'No store orders yet.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          SizedBox(height: 7),
                          Text(
                            'Customer Marketplace orders for your store will appear here.',
                            textAlign: TextAlign.center,
                          ),
                        ],
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: orders.length,
                        itemBuilder: (context, index) {
                          return _buildOrderCard(
                            orders[index],
                          );
                        },
                      ),
      ),
    );
  }
}
