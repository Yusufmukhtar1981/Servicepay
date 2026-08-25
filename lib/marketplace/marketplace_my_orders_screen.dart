import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class MarketplaceMyOrdersScreen extends StatefulWidget {
  const MarketplaceMyOrdersScreen({super.key});

  @override
  State<MarketplaceMyOrdersScreen> createState() =>
      _MarketplaceMyOrdersScreenState();
}

class _MarketplaceMyOrdersScreenState extends State<MarketplaceMyOrdersScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color primary = Color(0xFF08783E);

  bool loading = true;
  String errorMessage = '';
  String? actingOrderId;
  List<Map<String, dynamic>> orders = [];

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('access_token');
  }

  Future<void> _loadOrders() async {
    setState(() {
      loading = true;
      errorMessage = '';
    });

    try {
      final token = await _token();
      if (token == null || token.trim().isEmpty) {
        throw Exception('Your login session was not found.');
      }

      final response = await http
          .get(
            Uri.parse('$baseUrl/marketplace/orders/mine'),
            headers: {
              'Accept': 'application/json',
              'Authorization': 'Bearer ${token.trim()}',
            },
          )
          .timeout(const Duration(seconds: 30));
      final decoded = jsonDecode(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          decoded is Map ? decoded['message'] : 'Unable to load orders.',
        );
      }

      if (!mounted) return;
      setState(() {
        orders = (decoded is Map ? decoded['orders'] : const <dynamic>[])
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList();
        loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        loading = false;
        errorMessage = 'Unable to load your Marketplace orders.';
      });
    }
  }

  String _money(dynamic raw) {
    final value =
        raw is num ? raw.toDouble() : double.tryParse('$raw') ?? 0;
    return '₦${value.toStringAsFixed(2)}';
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'DELIVERED':
        return const Color(0xFF08783E);
      case 'CANCELLED':
      case 'REFUNDED':
        return Colors.red.shade700;
      case 'SHIPPED':
        return Colors.blue.shade700;
      default:
        return const Color(0xFFC87800);
    }
  }

  String _statusLabel(Map<String, dynamic> order) {
    final status = '${order['orderStatus'] ?? 'PAID'}'.trim();
    return status.isEmpty ? 'PAID' : status.replaceAll('_', ' ');
  }

  Future<void> _actOnOrder(
    Map<String, dynamic> order,
    String action,
  ) async {
    final orderId = '${order['_id'] ?? order['id'] ?? ''}'.trim();
    if (orderId.isEmpty) return;

    final isDeliveryConfirmation = action == 'confirm-delivery';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          isDeliveryConfirmation ? 'Confirm delivery?' : 'Cancel this order?',
        ),
        content: Text(
          isDeliveryConfirmation
              ? 'Confirm only after you have received the complete order. This will release the held payment to the seller.'
              : 'This is available only before the seller accepts the order. Your wallet payment will be returned immediately.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Go back'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(
              isDeliveryConfirmation ? 'Confirm delivery' : 'Cancel and refund',
            ),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => actingOrderId = orderId);

    try {
      final token = await _token();
      if (token == null || token.trim().isEmpty) {
        throw Exception('Your login session was not found.');
      }

      final endpoint = isDeliveryConfirmation
          ? 'confirm-delivery'
          : 'cancel';
      final response = await http
          .post(
            Uri.parse('$baseUrl/marketplace/orders/$orderId/$endpoint'),
            headers: {
              'Accept': 'application/json',
              'Authorization': 'Bearer ${token.trim()}',
            },
          )
          .timeout(const Duration(seconds: 30));
      final decoded = response.body.isNotEmpty ? jsonDecode(response.body) : {};

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          decoded is Map
              ? '${decoded['message'] ?? 'Unable to update the order.'}'
              : 'Unable to update the order.',
        );
      }

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            decoded is Map
                ? '${decoded['message'] ?? 'Marketplace order updated.'}'
                : 'Marketplace order updated.',
          ),
        ),
      );
      await _loadOrders();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error.toString().replaceFirst('Exception: ', ''),
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => actingOrderId = null);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('My Marketplace Orders'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF15201B),
        elevation: 0,
      ),
      body: RefreshIndicator(
        onRefresh: _loadOrders,
        child: loading
            ? const Center(child: CircularProgressIndicator())
            : errorMessage.isNotEmpty
                ? ListView(
                    children: [
                      const SizedBox(height: 150),
                      const Icon(Icons.cloud_off_rounded, size: 44),
                      const SizedBox(height: 12),
                      Center(child: Text(errorMessage)),
                      const SizedBox(height: 14),
                      Center(
                        child: FilledButton(
                          onPressed: _loadOrders,
                          child: const Text('Try again'),
                        ),
                      ),
                    ],
                  )
                : orders.isEmpty
                    ? ListView(
                        children: const [
                          SizedBox(height: 150),
                          Icon(
                            Icons.receipt_long_outlined,
                            size: 56,
                            color: Color(0xFF9AA7A0),
                          ),
                          SizedBox(height: 14),
                          Center(
                            child: Text(
                              'Your Marketplace orders will appear here.',
                              style: TextStyle(color: Color(0xFF637069)),
                            ),
                          ),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: orders.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final order = orders[index];
                          final status = _statusLabel(order);
                          final fundsStatus =
                              '${order['fundsStatus'] ?? 'HELD'}'.trim().toUpperCase();
                          final orderId =
                              '${order['_id'] ?? order['id'] ?? ''}'.trim();
                          final isActing = actingOrderId == orderId;
                          final items = (order['items'] is List)
                              ? (order['items'] as List)
                                  .whereType<Map>()
                                  .toList()
                              : const <Map>[];
                          final itemCount = items.fold<int>(
                            0,
                            (sum, item) =>
                                sum +
                                (int.tryParse('${item['quantity']}') ?? 0),
                          );

                          return Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(
                                color: const Color(0xFFE3EAE6),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        '${order['orderReference'] ?? 'Marketplace order'}',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
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
                                        color: _statusColor(status)
                                            .withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(20),
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
                                  '$itemCount item${itemCount == 1 ? '' : 's'} · ${_money(order['totalAmount'])}',
                                  style: const TextStyle(
                                    color: Color(0xFF56635C),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                 const SizedBox(height: 6),
                                 Text(
                                   fundsStatus == 'SETTLED'
                                       ? 'Payment released to seller after your delivery confirmation.'
                                       : fundsStatus == 'REFUNDED'
                                           ? 'Wallet payment refunded.'
                                           : 'Payment held safely until delivery is confirmed.',
                                   style: const TextStyle(
                                     color: Color(0xFF718078),
                                     fontSize: 12,
                                   ),
                                 ),
                                if ('${order['deliveryAddress']}'.trim().isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 6),
                                    child: Text(
                                      '${order['deliveryAddress']}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: Color(0xFF718078),
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                 if (status == 'PAID') ...[
                                   const SizedBox(height: 14),
                                   SizedBox(
                                     width: double.infinity,
                                     child: OutlinedButton.icon(
                                       onPressed: isActing
                                           ? null
                                           : () => _actOnOrder(order, 'cancel'),
                                       icon: const Icon(Icons.cancel_outlined),
                                       label: Text(
                                         isActing
                                             ? 'Updating order...'
                                             : 'Cancel and refund',
                                       ),
                                     ),
                                   ),
                                 ],
                                 if (status == 'SHIPPED' ||
                                     status == 'OUT FOR DELIVERY') ...[
                                   const SizedBox(height: 14),
                                   SizedBox(
                                     width: double.infinity,
                                     child: FilledButton.icon(
                                       onPressed: isActing
                                           ? null
                                           : () => _actOnOrder(
                                                 order,
                                                 'confirm-delivery',
                                               ),
                                       icon: const Icon(Icons.verified_rounded),
                                       label: Text(
                                         isActing
                                             ? 'Confirming delivery...'
                                             : 'Confirm delivery and release payment',
                                       ),
                                     ),
                                   ),
                                 ],
                              ],
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}