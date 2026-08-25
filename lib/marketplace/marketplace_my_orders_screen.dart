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
                              ],
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}