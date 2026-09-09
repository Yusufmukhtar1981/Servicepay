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
  bool actionLoading = false;

  String selectedStatus = 'PENDING';
  String searchText = '';

  List<dynamic> products = [];
  String? errorMessage;

  final TextEditingController searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();

    return prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('admin_token');
  }

  Map<String, String> _headers(String? token) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  Future<void> _loadProducts() async {
    if (mounted) {
      setState(() {
        loading = true;
      });
    }

    try {
      final token = await _token();

      final query = <String, String>{
        'limit': '100',
        if (selectedStatus != 'ALL') 'status': selectedStatus,
        if (searchText.trim().isNotEmpty) 'q': searchText.trim(),
      };

      final uri = Uri.parse(
        '$baseUrl/admin/marketplace/products',
      ).replace(queryParameters: query);

      final response = await http.get(
        uri,
        headers: _headers(token),
      );

      dynamic body;

      try {
        body = jsonDecode(response.body);
      } catch (_) {
        body = null;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        List<dynamic> found = [];

        if (body is List) {
          found = body;
        } else if (body is Map) {
          final candidates = [
            body['products'],
            body['data'],
            body['items'],
            body['results'],
          ];

          for (final candidate in candidates) {
            if (candidate is List) {
              found = candidate;
              break;
            }

            if (candidate is Map) {
              final nested = candidate['products'] ??
                  candidate['items'] ??
                  candidate['results'];

              if (nested is List) {
                found = nested;
                break;
              }
            }
          }
        }

        if (mounted) {
          setState(() {
            products = found;
            errorMessage = null;
          });
        }
      } else {
        if (mounted) {
          setState(() {
            errorMessage = 'Marketplace products are temporarily unavailable.';
          });
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          errorMessage = 'Marketplace products are temporarily unavailable.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          loading = false;
        });
      }
    }
  }

  String? _extractMessage(dynamic body) {
    if (body is Map) {
      final value = body['message'] ?? body['error'] ?? body['detail'];

      if (value != null) {
        return value.toString();
      }
    }

    return null;
  }

  String _productId(Map<String, dynamic> product) {
    return (product['_id'] ?? product['id'] ?? '').toString();
  }

  String _title(Map<String, dynamic> product) {
    return (product['title'] ??
            product['name'] ??
            product['productName'] ??
            'Marketplace Product')
        .toString();
  }

  String _merchant(Map<String, dynamic> product) {
    final merchant = product['merchant'];

    if (merchant is Map) {
      return (merchant['storeName'] ??
              merchant['businessName'] ??
              merchant['merchantName'] ??
              merchant['name'] ??
              'Merchant')
          .toString();
    }

    return (product['merchantName'] ?? product['storeName'] ?? 'Merchant')
        .toString();
  }

  String _status(Map<String, dynamic> product) {
    return (product['status'] ?? 'PENDING').toString().toUpperCase();
  }

  String _price(Map<String, dynamic> product) {
    final raw =
        product['price'] ?? product['unitPrice'] ?? product['amount'] ?? 0;

    final parsed = double.tryParse(raw.toString()) ?? 0;

    return '₦${parsed.toStringAsFixed(2)}';
  }

  String _stock(Map<String, dynamic> product) {
    return (product['stock'] ??
            product['quantity'] ??
            product['availableStock'] ??
            0)
        .toString();
  }

  Future<void> _performAction(
    Map<String, dynamic> product,
    String action,
  ) async {
    final id = _productId(product);

    if (id.isEmpty) {
      _showMessage(
        'Marketplace product ID is missing.',
        isError: true,
      );
      return;
    }

    final confirmed = await _confirmAction(
      action,
      _title(product),
    );

    if (!confirmed) {
      return;
    }

    setState(() {
      actionLoading = true;
    });

    try {
      final token = await _token();

      final uri = Uri.parse(
        '$baseUrl/admin/marketplace/products/$id/$action',
      );

      final response = await http.patch(
        uri,
        headers: _headers(token),
      );

      dynamic body;

      try {
        body = jsonDecode(response.body);
      } catch (_) {
        body = null;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _showMessage(
          _extractMessage(body) ?? 'Marketplace product updated successfully.',
        );

        await _loadProducts();
      } else {
        _showMessage(
          _extractMessage(body) ?? 'Unable to update Marketplace product.',
          isError: true,
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to complete Marketplace action.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          actionLoading = false;
        });
      }
    }
  }

  Future<bool> _confirmAction(
    String action,
    String title,
  ) async {
    final label = switch (action) {
      'approve' => 'Approve',
      'reject' => 'Reject',
      'suspend' => 'Suspend',
      _ => 'Update',
    };

    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text('$label Product'),
          content: Text(
            'Are you sure you want to $label "$title"?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(label),
            ),
          ],
        );
      },
    );

    return result ?? false;
  }

  void _showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  List<Map<String, dynamic>> get _visibleProducts {
    final query = searchText.trim().toLowerCase();

    return products
        .whereType<Map>()
        .map(
          (item) => Map<String, dynamic>.from(item),
        )
        .where((product) {
      if (query.isEmpty) {
        return true;
      }

      final text = [
        _title(product),
        _merchant(product),
        _status(product),
        _productId(product),
      ].join(' ').toLowerCase();

      return text.contains(query);
    }).toList();
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'ACTIVE':
        return Colors.green;
      case 'REJECTED':
        return Colors.red;
      case 'SUSPENDED':
        return Colors.deepOrange;
      default:
        return Colors.amber.shade800;
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleProducts;

    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'Marketplace',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: loading ? null : _loadProducts,
            icon: const Icon(Icons.refresh_rounded),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          _buildHeader(),
          Expanded(
            child: loading
                ? const Center(
                    child: CircularProgressIndicator(),
                  )
                : errorMessage != null
                    ? _buildErrorState()
                    : visible.isEmpty
                        ? _buildEmptyState()
                        : RefreshIndicator(
                            onRefresh: _loadProducts,
                            child: ListView.builder(
                              padding: const EdgeInsets.fromLTRB(
                                18,
                                8,
                                18,
                                28,
                              ),
                              itemCount: visible.length,
                              itemBuilder: (
                                context,
                                index,
                              ) {
                                return _productCard(
                                  visible[index],
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        18,
        18,
        18,
        14,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Product Moderation',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: Color(0xFF12372A),
            ),
          ),
          const SizedBox(height: 5),
          const Text(
            'Review products submitted by ServicePay Marketplace merchants.',
            style: TextStyle(
              color: Color(0xFF667085),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: searchController,
            onChanged: (value) {
              setState(() {
                searchText = value;
              });
            },
            onSubmitted: (_) => _loadProducts(),
            decoration: InputDecoration(
              hintText: 'Search product or merchant',
              prefixIcon: const Icon(Icons.search_rounded),
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                'PENDING',
                'ACTIVE',
                'REJECTED',
                'SUSPENDED',
                'ALL',
              ].map((status) {
                final selected = selectedStatus == status;

                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(status),
                    selected: selected,
                    onSelected: (_) {
                      setState(() {
                        selectedStatus = status;
                      });

                      _loadProducts();
                    },
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _productCard(
    Map<String, dynamic> product,
  ) {
    final status = _status(product);
    final color = _statusColor(status);

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(
          color: Color(0xFFE9ECEB),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF6F0),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(
                    Icons.storefront_rounded,
                    color: Color(0xFF08783E),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _title(product),
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _merchant(product),
                        style: const TextStyle(
                          color: Color(0xFF667085),
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
                    color: color.withValues(
                      alpha: 0.12,
                    ),
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: Text(
                    status,
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Wrap(
              spacing: 24,
              runSpacing: 10,
              children: [
                _info(
                  Icons.payments_outlined,
                  'Price',
                  _price(product),
                ),
                _info(
                  Icons.inventory_2_outlined,
                  'Stock',
                  _stock(product),
                ),
                _info(
                  Icons.tag_rounded,
                  'Product ID',
                  _productId(product),
                ),
              ],
            ),
            const SizedBox(height: 18),
            const Divider(height: 1),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                if (status != 'ACTIVE')
                  FilledButton.icon(
                    onPressed: actionLoading
                        ? null
                        : () => _performAction(
                              product,
                              'approve',
                            ),
                    icon: const Icon(
                      Icons.check_circle_outline,
                    ),
                    label: const Text('Approve'),
                  ),
                if (status != 'REJECTED')
                  OutlinedButton.icon(
                    onPressed: actionLoading
                        ? null
                        : () => _performAction(
                              product,
                              'reject',
                            ),
                    icon: const Icon(
                      Icons.cancel_outlined,
                    ),
                    label: const Text('Reject'),
                  ),
                if (status != 'SUSPENDED')
                  OutlinedButton.icon(
                    onPressed: actionLoading
                        ? null
                        : () => _performAction(
                              product,
                              'suspend',
                            ),
                    icon: const Icon(
                      Icons.pause_circle_outline,
                    ),
                    label: const Text('Suspend'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _info(
    IconData icon,
    String label,
    String value,
  ) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          icon,
          size: 18,
          color: const Color(0xFF08783E),
        ),
        const SizedBox(width: 7),
        Text(
          '$label: ',
          style: const TextStyle(
            color: Color(0xFF667085),
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.storefront_outlined,
              size: 72,
              color: Color(0xFF98A2B3),
            ),
            const SizedBox(height: 16),
            const Text(
              'No Marketplace products',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              selectedStatus == 'ALL'
                  ? 'No Marketplace products are available yet.'
                  : 'No ${selectedStatus.toLowerCase()} products found.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF667085),
              ),
            ),
            const SizedBox(height: 18),
            OutlinedButton.icon(
              onPressed: _loadProducts,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off_rounded,
                size: 56, color: Color(0xFFB42318)),
            const SizedBox(height: 14),
            const Text(
              'Marketplace unavailable',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              errorMessage ?? 'Marketplace products could not be loaded.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF667085)),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: loading ? null : _loadProducts,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
