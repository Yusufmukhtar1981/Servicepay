import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminAmanaScreen extends StatefulWidget {
  const AdminAmanaScreen({
    super.key,
  });

  @override
  State<AdminAmanaScreen> createState() => _AdminAmanaScreenState();
}

class _AdminAmanaScreenState extends State<AdminAmanaScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryColor = Color(0xFF0F766E);

  static const Color backgroundColor = Color(0xFFF7F9FB);

  final TextEditingController _searchController = TextEditingController();

  bool _isLoading = true;
  bool _isRefreshing = false;

  String _searchQuery = '';
  String _selectedStatus = 'ALL';
  String _selectedCategory = 'ALL';

  int _currentPage = 1;
  int _totalPages = 1;
  int _totalOrders = 0;

  double _totalAmount = 0;
  int _paidOrders = 0;
  int _processingOrders = 0;
  int _completedOrders = 0;

  List<Map<String, dynamic>> _orders = [];

  final List<Map<String, String>> _statusOptions = [
    {
      'value': 'ALL',
      'label': 'All Statuses',
    },
    {
      'value': 'PENDING_PAYMENT',
      'label': 'Pending Payment',
    },
    {
      'value': 'PAID',
      'label': 'Paid',
    },
    {
      'value': 'PROCESSING',
      'label': 'Processing',
    },
    {
      'value': 'ASSIGNED',
      'label': 'Assigned',
    },
    {
      'value': 'FULFILLED',
      'label': 'Fulfilled',
    },
    {
      'value': 'COMPLETED',
      'label': 'Completed',
    },
    {
      'value': 'CANCELLED',
      'label': 'Cancelled',
    },
    {
      'value': 'REFUNDED',
      'label': 'Refunded',
    },
  ];

  final List<Map<String, String>> _categoryOptions = [
    {
      'value': 'ALL',
      'label': 'All Categories',
    },
    {
      'value': 'FOOD_PACKAGE',
      'label': 'Food Package',
    },
    {
      'value': 'SCHOOL_FEES',
      'label': 'School Fees',
    },
    {
      'value': 'MEDICAL_SUPPORT',
      'label': 'Medical Support',
    },
    {
      'value': 'BUILDING_SUPPORT',
      'label': 'Building Support',
    },
    {
      'value': 'LIVESTOCK_SUPPORT',
      'label': 'Livestock Support',
    },
    {
      'value': 'RENT_SUPPORT',
      'label': 'Rent Support',
    },
    {
      'value': 'SOLAR_AND_UTILITIES',
      'label': 'Solar & Utilities',
    },
    {
      'value': 'CUSTOM_REQUEST',
      'label': 'Custom Request',
    },
  ];

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<String?> _getToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      final String? value = prefs.getString(key);

      if (value == null || value.trim().isEmpty) {
        continue;
      }

      String token = value.trim();

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
        token = token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        if (key != 'auth_token') {
          await prefs.setString(
            'auth_token',
            token,
          );
        }

        return token;
      }
    }

    return null;
  }

  Map<String, String> _headers(
    String token,
  ) {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  dynamic _decodeResponse(
    String body,
  ) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  String _extractMessage(
    dynamic decoded, {
    String fallback = 'Something went wrong. Please try again.',
  }) {
    if (decoded is Map) {
      final dynamic message = decoded['message'];

      if (message != null && message.toString().trim().isNotEmpty) {
        return message.toString().trim();
      }

      final dynamic error = decoded['error'];

      if (error != null && error.toString().trim().isNotEmpty) {
        return error.toString().trim();
      }
    }

    return fallback;
  }

  List<Map<String, dynamic>> _extractOrders(
    dynamic decoded,
  ) {
    dynamic rawOrders;

    if (decoded is Map) {
      final dynamic data = decoded['data'];

      if (data is Map) {
        rawOrders = data['orders'];
      }

      rawOrders ??= decoded['orders'];
    }

    if (rawOrders is! List) {
      return [];
    }

    return rawOrders
        .whereType<Map>()
        .map(
          (Map item) => Map<String, dynamic>.from(
            item,
          ),
        )
        .toList();
  }

  Map<String, dynamic> _extractSummary(
    dynamic decoded,
  ) {
    if (decoded is Map) {
      final dynamic data = decoded['data'];

      if (data is Map && data['summary'] is Map) {
        return Map<String, dynamic>.from(
          data['summary'] as Map,
        );
      }

      if (decoded['summary'] is Map) {
        return Map<String, dynamic>.from(
          decoded['summary'] as Map,
        );
      }
    }

    return <String, dynamic>{};
  }

  Map<String, dynamic> _extractPagination(
    dynamic decoded,
  ) {
    if (decoded is Map) {
      final dynamic data = decoded['data'];

      if (data is Map && data['pagination'] is Map) {
        return Map<String, dynamic>.from(
          data['pagination'] as Map,
        );
      }

      if (decoded['pagination'] is Map) {
        return Map<String, dynamic>.from(
          decoded['pagination'] as Map,
        );
      }
    }

    return <String, dynamic>{};
  }

  int _toInt(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  double _toDouble(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  Future<void> _loadOrders({
    bool refreshing = false,
    int? page,
  }) async {
    if (mounted) {
      setState(() {
        if (refreshing) {
          _isRefreshing = true;
        } else {
          _isLoading = true;
        }

        if (page != null) {
          _currentPage = page;
        }
      });
    }

    try {
      final String? token = await _getToken();

      if (token == null) {
        if (!mounted) {
          return;
        }

        _showMessage(
          'Your admin session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      final Map<String, String> queryParameters = {
        'page': '$_currentPage',
        'limit': '20',
      };

      final String search = _searchQuery.trim();

      if (search.isNotEmpty) {
        queryParameters['search'] = search;
      }

      if (_selectedStatus != 'ALL') {
        queryParameters['status'] = _selectedStatus;
      }

      if (_selectedCategory != 'ALL') {
        queryParameters['category'] = _selectedCategory;
      }

      final Uri uri = Uri.parse(
        '$baseUrl/admin/amana',
      ).replace(
        queryParameters: queryParameters,
      );

      final http.Response response = await http
          .get(
            uri,
            headers: _headers(token),
          )
          .timeout(
            const Duration(
              seconds: 45,
            ),
          );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode == 401 || response.statusCode == 403) {
        if (!mounted) {
          return;
        }

        _showMessage(
          _extractMessage(
            decoded,
            fallback: 'You are not authorized to access Amana administration.',
          ),
          isError: true,
        );

        return;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final List<Map<String, dynamic>> loadedOrders = _extractOrders(decoded);

        final Map<String, dynamic> summary = _extractSummary(decoded);

        final Map<String, dynamic> pagination = _extractPagination(decoded);

        if (!mounted) {
          return;
        }

        setState(() {
          _orders = loadedOrders;

          _totalOrders = _toInt(
            summary['totalOrders'] ?? pagination['total'],
          );

          _totalAmount = _toDouble(
            summary['totalAmount'],
          );

          _paidOrders = _toInt(
            summary['paidOrders'],
          );

          _processingOrders = _toInt(
            summary['processingOrders'],
          );

          _completedOrders = _toInt(
            summary['completedOrders'],
          );

          _currentPage = _toInt(
                    pagination['page'],
                  ) >
                  0
              ? _toInt(
                  pagination['page'],
                )
              : 1;

          _totalPages = _toInt(
                    pagination['totalPages'],
                  ) >
                  0
              ? _toInt(
                  pagination['totalPages'],
                )
              : 1;
        });

        return;
      }

      if (!mounted) {
        return;
      }

      _showMessage(
        _extractMessage(
          decoded,
          fallback: 'Unable to load ServicePay Amana orders.',
        ),
        isError: true,
      );
    } catch (_) {
      if (!mounted) {
        return;
      }

      _showMessage(
        'Unable to connect to ServicePay. Please check your internet connection.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _isRefreshing = false;
        });
      }
    }
  }

  void _applySearch() {
    FocusScope.of(context).unfocus();

    setState(() {
      _searchQuery = _searchController.text.trim();
      _currentPage = 1;
    });

    _loadOrders();
  }

  void _clearSearch() {
    _searchController.clear();

    setState(() {
      _searchQuery = '';
      _currentPage = 1;
    });

    _loadOrders();
  }

  void _changeStatusFilter(
    String? value,
  ) {
    if (value == null) {
      return;
    }

    setState(() {
      _selectedStatus = value;
      _currentPage = 1;
    });

    _loadOrders();
  }

  void _changeCategoryFilter(
    String? value,
  ) {
    if (value == null) {
      return;
    }

    setState(() {
      _selectedCategory = value;
      _currentPage = 1;
    });

    _loadOrders();
  }

  void _showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError ? Colors.red.shade700 : primaryColor,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  String _formatCurrency(
    double amount,
  ) {
    final String value = amount.toStringAsFixed(2);

    final List<String> parts = value.split('.');

    final String whole = parts.first;

    final String formattedWhole = whole.replaceAllMapped(
      RegExp(
        r'\B(?=(\d{3})+(?!\d))',
      ),
      (Match match) => ',',
    );

    return '₦$formattedWhole.${parts.last}';
  }

  String _formatDate(dynamic value) {
    if (value == null) {
      return 'Not available';
    }

    final DateTime? date = DateTime.tryParse(
      value.toString(),
    )?.toLocal();

    if (date == null) {
      return 'Not available';
    }

    const List<String> months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    final String hour = date.hour.toString().padLeft(
          2,
          '0',
        );

    final String minute = date.minute.toString().padLeft(
          2,
          '0',
        );

    return '${date.day} '
        '${months[date.month - 1]} '
        '${date.year}, $hour:$minute';
  }

  String _readableText(
    String value,
  ) {
    return value.replaceAll('_', ' ').toLowerCase().split(' ').map(
      (String word) {
        if (word.isEmpty) {
          return word;
        }

        return '${word[0].toUpperCase()}'
            '${word.substring(1)}';
      },
    ).join(' ');
  }

  Color _statusColor(
    String status,
  ) {
    switch (status.toUpperCase()) {
      case 'PAID':
        return Colors.teal.shade700;

      case 'PROCESSING':
      case 'ASSIGNED':
        return Colors.blue.shade700;

      case 'FULFILLED':
      case 'COMPLETED':
        return Colors.green.shade700;

      case 'CANCELLED':
      case 'REFUNDED':
        return Colors.red.shade700;

      case 'PENDING_PAYMENT':
      default:
        return Colors.orange.shade800;
    }
  }

  IconData _categoryIcon(
    String category,
  ) {
    switch (category.toUpperCase()) {
      case 'FOOD_PACKAGE':
        return Icons.shopping_basket_rounded;

      case 'SCHOOL_FEES':
        return Icons.school_rounded;

      case 'MEDICAL_SUPPORT':
        return Icons.local_hospital_rounded;

      case 'BUILDING_SUPPORT':
        return Icons.construction_rounded;

      case 'LIVESTOCK_SUPPORT':
        return Icons.agriculture_rounded;

      case 'RENT_SUPPORT':
        return Icons.home_work_rounded;

      case 'SOLAR_AND_UTILITIES':
        return Icons.solar_power_rounded;

      case 'CUSTOM_REQUEST':
      default:
        return Icons.volunteer_activism_rounded;
    }
  }

  Future<Map<String, dynamic>?> _loadOrderDetails(
    String orderId,
  ) async {
    try {
      final String? token = await _getToken();

      if (token == null) {
        _showMessage(
          'Your admin session has expired. Please log in again.',
          isError: true,
        );

        return null;
      }

      final http.Response response = await http
          .get(
            Uri.parse(
              '$baseUrl/admin/amana/$orderId',
            ),
            headers: _headers(token),
          )
          .timeout(
            const Duration(
              seconds: 45,
            ),
          );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (decoded is Map) {
          final dynamic data = decoded['data'];

          if (data is Map && data['order'] is Map) {
            return Map<String, dynamic>.from(
              data['order'] as Map,
            );
          }
        }

        return null;
      }

      _showMessage(
        _extractMessage(
          decoded,
          fallback: 'Unable to load the Amana order details.',
        ),
        isError: true,
      );

      return null;
    } catch (_) {
      _showMessage(
        'Unable to connect to ServicePay. Please check your internet connection.',
        isError: true,
      );

      return null;
    }
  }

  Future<bool> _sendPatch({
    required String endpoint,
    required Map<String, dynamic> body,
    required String successMessage,
  }) async {
    try {
      final String? token = await _getToken();

      if (token == null) {
        _showMessage(
          'Your admin session has expired. Please log in again.',
          isError: true,
        );

        return false;
      }

      final http.Response response = await http
          .patch(
            Uri.parse(
              '$baseUrl$endpoint',
            ),
            headers: _headers(token),
            body: jsonEncode(body),
          )
          .timeout(
            const Duration(
              seconds: 60,
            ),
          );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _showMessage(
          _extractMessage(
            decoded,
            fallback: successMessage,
          ),
        );

        await _loadOrders(
          refreshing: true,
        );

        return true;
      }

      _showMessage(
        _extractMessage(
          decoded,
          fallback: 'Unable to update the Amana order.',
        ),
        isError: true,
      );

      return false;
    } catch (_) {
      _showMessage(
        'Unable to connect to ServicePay. Please check your internet connection.',
        isError: true,
      );

      return false;
    }
  }

  Future<void> _showOrderDetails(
    Map<String, dynamic> summaryOrder,
  ) async {
    final String orderId = summaryOrder['_id']?.toString() ?? '';

    if (orderId.isEmpty) {
      return;
    }

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return const Center(
          child: CircularProgressIndicator(
            color: primaryColor,
          ),
        );
      },
    );

    final Map<String, dynamic>? order = await _loadOrderDetails(orderId);

    if (!mounted) {
      return;
    }

    Navigator.of(context).pop();

    if (order == null) {
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (
        BuildContext sheetContext,
      ) {
        return DraggableScrollableSheet(
          initialChildSize: 0.92,
          minChildSize: 0.65,
          maxChildSize: 0.98,
          expand: false,
          builder: (
            BuildContext context,
            ScrollController scrollController,
          ) {
            return Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(26),
                ),
              ),
              child: ListView(
                controller: scrollController,
                padding: const EdgeInsets.fromLTRB(
                  18,
                  10,
                  18,
                  32,
                ),
                children: [
                  Center(
                    child: Container(
                      width: 46,
                      height: 5,
                      margin: const EdgeInsets.only(
                        bottom: 18,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade300,
                        borderRadius: BorderRadius.circular(
                          20,
                        ),
                      ),
                    ),
                  ),
                  _buildOrderDetailsHeader(order),
                  const SizedBox(height: 20),
                  _buildDetailsSection(
                    title: 'Customer',
                    children: [
                      _buildDetailRow(
                        'Name',
                        _nestedValue(
                          order,
                          'customer',
                          'fullName',
                        ),
                      ),
                      _buildDetailRow(
                        'Phone',
                        _nestedValue(
                          order,
                          'customer',
                          'phone',
                        ),
                      ),
                      _buildDetailRow(
                        'Email',
                        _nestedValue(
                          order,
                          'customer',
                          'email',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  _buildDetailsSection(
                    title: 'Beneficiary',
                    children: [
                      _buildDetailRow(
                        'Name',
                        _nestedValue(
                          order,
                          'beneficiary',
                          'fullName',
                        ),
                      ),
                      _buildDetailRow(
                        'Phone',
                        _nestedValue(
                          order,
                          'beneficiary',
                          'phone',
                        ),
                      ),
                      _buildDetailRow(
                        'Relationship',
                        _nestedValue(
                          order,
                          'beneficiary',
                          'relationship',
                        ),
                      ),
                      _buildDetailRow(
                        'State',
                        _nestedValue(
                          order,
                          'beneficiary',
                          'state',
                        ),
                      ),
                      _buildDetailRow(
                        'LGA',
                        _nestedValue(
                          order,
                          'beneficiary',
                          'lga',
                        ),
                      ),
                      _buildDetailRow(
                        'Address',
                        _nestedValue(
                          order,
                          'beneficiary',
                          'address',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  _buildDetailsSection(
                    title: 'Request',
                    children: [
                      _buildDetailRow(
                        'Category',
                        _readableText(
                          order['category']?.toString() ?? '',
                        ),
                      ),
                      _buildDetailRow(
                        'Description',
                        order['description']?.toString() ?? 'Not available',
                      ),
                      _buildDetailRow(
                        'Amount',
                        _formatCurrency(
                          _toDouble(
                            order['amount'],
                          ),
                        ),
                      ),
                      _buildDetailRow(
                        'Service Fee',
                        _formatCurrency(
                          _toDouble(
                            order['serviceFee'],
                          ),
                        ),
                      ),
                      _buildDetailRow(
                        'Delivery Fee',
                        _formatCurrency(
                          _toDouble(
                            order['deliveryFee'],
                          ),
                        ),
                      ),
                      _buildDetailRow(
                        'Total Amount',
                        _formatCurrency(
                          _toDouble(
                            order['totalAmount'],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  _buildDetailsSection(
                    title: 'Provider',
                    children: [
                      _buildDetailRow(
                        'Name',
                        _nestedValue(
                          order,
                          'providerDetails',
                          'name',
                        ),
                      ),
                      _buildDetailRow(
                        'Phone',
                        _nestedValue(
                          order,
                          'providerDetails',
                          'phone',
                        ),
                      ),
                      _buildDetailRow(
                        'Additional Info',
                        _nestedValue(
                          order,
                          'providerDetails',
                          'additionalInformation',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  _buildDetailsSection(
                    title: 'Assigned To',
                    children: [
                      _buildDetailRow(
                        'Name',
                        _nestedValue(
                          order,
                          'assignedTo',
                          'fullName',
                        ),
                      ),
                      _buildDetailRow(
                        'Role',
                        _readableText(
                          _nestedValue(
                            order,
                            'assignedTo',
                            'role',
                          ),
                        ),
                      ),
                      _buildDetailRow(
                        'Phone',
                        _nestedValue(
                          order,
                          'assignedTo',
                          'phone',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  _buildActionButtons(order),
                ],
              ),
            );
          },
        );
      },
    );
  }

  String _nestedValue(
    Map<String, dynamic> source,
    String parent,
    String child,
  ) {
    final dynamic rawParent = source[parent];

    if (rawParent is Map) {
      final dynamic value = rawParent[child];

      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }

    return 'Not available';
  }

  Widget _buildOrderDetailsHeader(
    Map<String, dynamic> order,
  ) {
    final String status =
        order['status']?.toString().toUpperCase() ?? 'PENDING_PAYMENT';

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 54,
          height: 54,
          decoration: BoxDecoration(
            color: primaryColor.withValues(
              alpha: 0.10,
            ),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Icon(
            _categoryIcon(
              order['category']?.toString() ?? '',
            ),
            color: primaryColor,
            size: 28,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                order['title']?.toString() ?? 'Amana Request',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                order['reference']?.toString() ?? '',
                style: TextStyle(
                  color: Colors.grey.shade600,
                ),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 7,
          ),
          decoration: BoxDecoration(
            color: _statusColor(status).withValues(
              alpha: 0.12,
            ),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            _readableText(status),
            style: TextStyle(
              color: _statusColor(status),
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDetailsSection({
    required String title,
    required List<Widget> children,
  }) {
    return Container(
      padding: const EdgeInsets.all(
        16,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w900,
              color: Color(0xFF1E293B),
            ),
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }

  Widget _buildDetailRow(
    String label,
    String value,
  ) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 10,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 115,
            child: Text(
              label,
              style: TextStyle(
                color: Colors.grey.shade600,
                fontSize: 12,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons(
    Map<String, dynamic> order,
  ) {
    final String status = order['status']?.toString().toUpperCase() ?? '';

    final String orderId = order['_id']?.toString() ?? '';

    if (orderId.isEmpty) {
      return const SizedBox.shrink();
    }

    final bool isFinal = [
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ].contains(status);

    if (isFinal) {
      return const SizedBox.shrink();
    }

    return Column(
      children: [
        if (status == 'PAID' || status == 'PROCESSING' || status == 'ASSIGNED')
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () {
                _showVendorDialog(
                  orderId,
                );
              },
              icon: const Icon(
                Icons.store_rounded,
              ),
              label: const Text(
                'Add or Update Vendor',
              ),
              style: FilledButton.styleFrom(
                backgroundColor: primaryColor,
              ),
            ),
          ),
        const SizedBox(height: 10),
        if (status == 'PAID')
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () {
                _updateStatus(
                  orderId,
                  'PROCESSING',
                );
              },
              icon: const Icon(
                Icons.sync_rounded,
              ),
              label: const Text(
                'Mark as Processing',
              ),
            ),
          ),
        if (status == 'PROCESSING' || status == 'ASSIGNED')
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () {
                _showProofDialog(
                  orderId,
                );
              },
              icon: const Icon(
                Icons.verified_rounded,
              ),
              label: const Text(
                'Add Fulfilment Proof',
              ),
            ),
          ),
        if (status == 'FULFILLED')
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () {
                _updateStatus(
                  orderId,
                  'COMPLETED',
                );
              },
              icon: const Icon(
                Icons.check_circle_rounded,
              ),
              label: const Text(
                'Mark as Completed',
              ),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.green.shade700,
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _updateStatus(
    String orderId,
    String status,
  ) async {
    final bool updated = await _sendPatch(
      endpoint: '/admin/amana/$orderId/status',
      body: {
        'status': status,
      },
      successMessage: 'Amana order status updated successfully.',
    );

    if (updated && mounted) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _showVendorDialog(
    String orderId,
  ) async {
    final TextEditingController nameController = TextEditingController();

    final TextEditingController phoneController = TextEditingController();

    final TextEditingController addressController = TextEditingController();

    final TextEditingController accountNameController = TextEditingController();

    final TextEditingController accountNumberController =
        TextEditingController();

    final TextEditingController bankNameController = TextEditingController();

    bool isSaving = false;

    await showDialog<void>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext context,
            StateSetter setDialogState,
          ) {
            return AlertDialog(
              title: const Text(
                'Vendor Information',
              ),
              content: SizedBox(
                width: 480,
                child: SingleChildScrollView(
                  child: Column(
                    children: [
                      TextField(
                        controller: nameController,
                        decoration: const InputDecoration(
                          labelText: 'Vendor Name',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: phoneController,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                          labelText: 'Vendor Phone',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: addressController,
                        maxLines: 2,
                        decoration: const InputDecoration(
                          labelText: 'Vendor Address',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: accountNameController,
                        decoration: const InputDecoration(
                          labelText: 'Account Name',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: accountNumberController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Account Number',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: bankNameController,
                        decoration: const InputDecoration(
                          labelText: 'Bank Name',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: isSaving
                      ? null
                      : () {
                          Navigator.of(
                            dialogContext,
                          ).pop();
                        },
                  child: const Text(
                    'Cancel',
                  ),
                ),
                FilledButton(
                  onPressed: isSaving
                      ? null
                      : () async {
                          if (nameController.text.trim().length < 2) {
                            _showMessage(
                              'Please enter the vendor name.',
                              isError: true,
                            );

                            return;
                          }

                          setDialogState(() {
                            isSaving = true;
                          });

                          final bool saved = await _sendPatch(
                            endpoint: '/admin/amana/$orderId/vendor',
                            body: {
                              'name': nameController.text.trim(),
                              'phone': phoneController.text.trim(),
                              'address': addressController.text.trim(),
                              'accountName': accountNameController.text.trim(),
                              'accountNumber':
                                  accountNumberController.text.trim(),
                              'bankName': bankNameController.text.trim(),
                            },
                            successMessage:
                                'Vendor information updated successfully.',
                          );

                          if (!dialogContext.mounted) {
                            return;
                          }

                          if (saved) {
                            Navigator.of(
                              dialogContext,
                            ).pop();
                          } else {
                            setDialogState(() {
                              isSaving = false;
                            });
                          }
                        },
                  child: isSaving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                      : const Text(
                          'Save Vendor',
                        ),
                ),
              ],
            );
          },
        );
      },
    );

    nameController.dispose();
    phoneController.dispose();
    addressController.dispose();
    accountNameController.dispose();
    accountNumberController.dispose();
    bankNameController.dispose();
  }

  Future<void> _showProofDialog(
    String orderId,
  ) async {
    final TextEditingController receiptController = TextEditingController();

    final TextEditingController imageController = TextEditingController();

    final TextEditingController notesController = TextEditingController();

    bool isSaving = false;

    await showDialog<void>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext context,
            StateSetter setDialogState,
          ) {
            return AlertDialog(
              title: const Text(
                'Fulfilment Proof',
              ),
              content: SizedBox(
                width: 480,
                child: SingleChildScrollView(
                  child: Column(
                    children: [
                      TextField(
                        controller: receiptController,
                        decoration: const InputDecoration(
                          labelText: 'Receipt URL (Optional)',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: imageController,
                        decoration: const InputDecoration(
                          labelText: 'Image URL (Optional)',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: notesController,
                        minLines: 3,
                        maxLines: 6,
                        decoration: const InputDecoration(
                          labelText: 'Fulfilment Notes',
                          hintText: 'Describe what was delivered or paid.',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: isSaving
                      ? null
                      : () {
                          Navigator.of(
                            dialogContext,
                          ).pop();
                        },
                  child: const Text(
                    'Cancel',
                  ),
                ),
                FilledButton(
                  onPressed: isSaving
                      ? null
                      : () async {
                          final String receipt = receiptController.text.trim();

                          final String image = imageController.text.trim();

                          final String notes = notesController.text.trim();

                          if (receipt.isEmpty &&
                              image.isEmpty &&
                              notes.length < 3) {
                            _showMessage(
                              'Please provide a receipt, image or fulfilment note.',
                              isError: true,
                            );

                            return;
                          }

                          setDialogState(() {
                            isSaving = true;
                          });

                          final bool saved = await _sendPatch(
                            endpoint: '/admin/amana/$orderId/proof',
                            body: {
                              'receiptUrl': receipt,
                              'imageUrls': image.isEmpty
                                  ? <String>[]
                                  : <String>[
                                      image,
                                    ],
                              'notes': notes,
                            },
                            successMessage:
                                'Fulfilment proof added successfully.',
                          );

                          if (!dialogContext.mounted) {
                            return;
                          }

                          if (saved) {
                            Navigator.of(
                              dialogContext,
                            ).pop();
                          } else {
                            setDialogState(() {
                              isSaving = false;
                            });
                          }
                        },
                  child: isSaving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                      : const Text(
                          'Save Proof',
                        ),
                ),
              ],
            );
          },
        );
      },
    );

    receiptController.dispose();
    imageController.dispose();
    notesController.dispose();
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: backgroundColor,
      body: RefreshIndicator(
        color: primaryColor,
        onRefresh: () {
          return _loadOrders(
            refreshing: true,
          );
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            16,
            16,
            16,
            32,
          ),
          children: [
            _buildHeader(),
            const SizedBox(height: 18),
            _buildSummarySection(),
            const SizedBox(height: 20),
            _buildFiltersSection(),
            const SizedBox(height: 20),
            _buildOrdersHeader(),
            const SizedBox(height: 12),
            _buildOrdersSection(),
            if (!_isLoading && _orders.isNotEmpty) ...[
              const SizedBox(height: 18),
              _buildPagination(),
            ],
            if (_isRefreshing)
              const Padding(
                padding: EdgeInsets.only(
                  top: 20,
                ),
                child: Center(
                  child: Text(
                    'Refreshing Amana orders...',
                    style: TextStyle(
                      color: Color(
                        0xFF64748B,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(
        20,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF115E59),
            primaryColor,
            Color(0xFF14B8A6),
          ],
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33115E59),
            blurRadius: 22,
            offset: Offset(
              0,
              10,
            ),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: Colors.white.withValues(
                alpha: 0.16,
              ),
              borderRadius: BorderRadius.circular(18),
            ),
            child: const Icon(
              Icons.volunteer_activism_rounded,
              color: Colors.white,
              size: 32,
            ),
          ),
          const SizedBox(width: 15),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'ServicePay Amana',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 5),
                Text(
                  'Manage family support requests, payments and fulfilment.',
                  style: TextStyle(
                    color: Color(
                      0xFFD5F5F1,
                    ),
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _isLoading
                ? null
                : () {
                    _loadOrders(
                      refreshing: true,
                    );
                  },
            style: IconButton.styleFrom(
              backgroundColor: Colors.white.withValues(
                alpha: 0.15,
              ),
              foregroundColor: Colors.white,
            ),
            tooltip: 'Refresh',
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummarySection() {
    return LayoutBuilder(
      builder: (
        BuildContext context,
        BoxConstraints constraints,
      ) {
        final bool wide = constraints.maxWidth >= 760;

        final List<Widget> cards = [
          _buildSummaryCard(
            title: 'Total Orders',
            value: '$_totalOrders',
            icon: Icons.receipt_long_rounded,
            accentColor: const Color(0xFF0F766E),
          ),
          _buildSummaryCard(
            title: 'Total Value',
            value: _formatCurrency(
              _totalAmount,
            ),
            icon: Icons.payments_rounded,
            accentColor: const Color(0xFF7C3AED),
          ),
          _buildSummaryCard(
            title: 'Paid',
            value: '$_paidOrders',
            icon: Icons.wallet_rounded,
            accentColor: const Color(0xFF0891B2),
          ),
          _buildSummaryCard(
            title: 'Processing',
            value: '$_processingOrders',
            icon: Icons.sync_rounded,
            accentColor: const Color(0xFF2563EB),
          ),
          _buildSummaryCard(
            title: 'Completed',
            value: '$_completedOrders',
            icon: Icons.check_circle_rounded,
            accentColor: const Color(0xFF16A34A),
          ),
        ];

        if (wide) {
          return GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 5,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio: 1.35,
            children: cards,
          );
        }

        return SizedBox(
          height: 122,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: cards.length,
            separatorBuilder: (
              BuildContext context,
              int index,
            ) {
              return const SizedBox(
                width: 12,
              );
            },
            itemBuilder: (
              BuildContext context,
              int index,
            ) {
              return SizedBox(
                width: 165,
                child: cards[index],
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildSummaryCard({
    required String title,
    required String value,
    required IconData icon,
    required Color accentColor,
  }) {
    return Container(
      padding: const EdgeInsets.all(
        16,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F0F172A),
            blurRadius: 14,
            offset: Offset(
              0,
              5,
            ),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: accentColor.withValues(
                    alpha: 0.10,
                  ),
                  borderRadius: BorderRadius.circular(
                    12,
                  ),
                ),
                child: Icon(
                  icon,
                  color: accentColor,
                  size: 21,
                ),
              ),
              const Spacer(),
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: accentColor,
                  shape: BoxShape.circle,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(
                0xFF0F172A,
              ),
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(
                0xFF64748B,
              ),
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFiltersSection() {
    return Container(
      padding: const EdgeInsets.all(
        16,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: LayoutBuilder(
        builder: (
          BuildContext context,
          BoxConstraints constraints,
        ) {
          final bool wide = constraints.maxWidth >= 720;

          final Widget searchField = TextField(
            controller: _searchController,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) {
              _applySearch();
            },
            decoration: InputDecoration(
              labelText: 'Search Amana orders',
              hintText: 'Reference, customer, beneficiary or phone',
              prefixIcon: const Icon(
                Icons.search_rounded,
                color: primaryColor,
              ),
              suffixIcon: _searchController.text.isEmpty
                  ? null
                  : IconButton(
                      onPressed: _clearSearch,
                      icon: const Icon(
                        Icons.close_rounded,
                      ),
                    ),
              filled: true,
              fillColor: const Color(
                0xFFF8FAFC,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(
                  14,
                ),
              ),
            ),
          );

          final Widget statusField = DropdownButtonFormField<String>(
            value: _selectedStatus,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Status',
              prefixIcon: const Icon(
                Icons.tune_rounded,
                color: primaryColor,
              ),
              filled: true,
              fillColor: const Color(
                0xFFF8FAFC,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(
                  14,
                ),
              ),
            ),
            items: _statusOptions.map(
              (
                Map<String, String> option,
              ) {
                return DropdownMenuItem<String>(
                  value: option['value'],
                  child: Text(
                    option['label']!,
                  ),
                );
              },
            ).toList(),
            onChanged: _changeStatusFilter,
          );

          final Widget categoryField = DropdownButtonFormField<String>(
            value: _selectedCategory,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Category',
              prefixIcon: const Icon(
                Icons.category_rounded,
                color: primaryColor,
              ),
              filled: true,
              fillColor: const Color(
                0xFFF8FAFC,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(
                  14,
                ),
              ),
            ),
            items: _categoryOptions.map(
              (
                Map<String, String> option,
              ) {
                return DropdownMenuItem<String>(
                  value: option['value'],
                  child: Text(
                    option['label']!,
                  ),
                );
              },
            ).toList(),
            onChanged: _changeCategoryFilter,
          );

          if (wide) {
            return Row(
              children: [
                Expanded(
                  flex: 2,
                  child: searchField,
                ),
                const SizedBox(
                  width: 12,
                ),
                Expanded(
                  child: statusField,
                ),
                const SizedBox(
                  width: 12,
                ),
                Expanded(
                  child: categoryField,
                ),
                const SizedBox(
                  width: 12,
                ),
                SizedBox(
                  height: 56,
                  child: FilledButton.icon(
                    onPressed: _applySearch,
                    icon: const Icon(
                      Icons.search_rounded,
                    ),
                    label: const Text(
                      'Search',
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: primaryColor,
                    ),
                  ),
                ),
              ],
            );
          }

          return Column(
            children: [
              searchField,
              const SizedBox(height: 12),
              statusField,
              const SizedBox(height: 12),
              categoryField,
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton.icon(
                  onPressed: _applySearch,
                  icon: const Icon(
                    Icons.search_rounded,
                  ),
                  label: const Text(
                    'Search Orders',
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryColor,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildOrdersHeader() {
    return Row(
      children: [
        const Expanded(
          child: Text(
            'Amana Orders',
            style: TextStyle(
              color: Color(
                0xFF0F172A,
              ),
              fontSize: 19,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 11,
            vertical: 7,
          ),
          decoration: BoxDecoration(
            color: primaryColor.withValues(
              alpha: 0.10,
            ),
            borderRadius: BorderRadius.circular(
              20,
            ),
          ),
          child: Text(
            '$_totalOrders orders',
            style: const TextStyle(
              color: primaryColor,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildOrdersSection() {
    if (_isLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(
          vertical: 60,
        ),
        child: Center(
          child: CircularProgressIndicator(
            color: primaryColor,
          ),
        ),
      );
    }

    if (_orders.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(
          34,
        ),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: const Color(0xFFE2E8F0),
          ),
        ),
        child: Column(
          children: [
            Container(
              width: 70,
              height: 70,
              decoration: BoxDecoration(
                color: primaryColor.withValues(
                  alpha: 0.09,
                ),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.inbox_rounded,
                color: primaryColor,
                size: 35,
              ),
            ),
            const SizedBox(height: 15),
            const Text(
              'No Amana orders found',
              style: TextStyle(
                color: Color(
                  0xFF1E293B,
                ),
                fontSize: 17,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Try changing the search term or filters.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Color(
                  0xFF64748B,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: _orders.map(
        (
          Map<String, dynamic> order,
        ) {
          return Padding(
            padding: const EdgeInsets.only(
              bottom: 12,
            ),
            child: _buildOrderCard(order),
          );
        },
      ).toList(),
    );
  }

  Widget _buildOrderCard(
    Map<String, dynamic> order,
  ) {
    final String status =
        order['status']?.toString().toUpperCase() ?? 'PENDING_PAYMENT';

    final String category =
        order['category']?.toString().toUpperCase() ?? 'CUSTOM_REQUEST';

    final dynamic customerRaw = order['customer'];

    final Map<String, dynamic> customer = customerRaw is Map
        ? Map<String, dynamic>.from(
            customerRaw,
          )
        : <String, dynamic>{};

    final dynamic beneficiaryRaw = order['beneficiary'];

    final Map<String, dynamic> beneficiary = beneficiaryRaw is Map
        ? Map<String, dynamic>.from(
            beneficiaryRaw,
          )
        : <String, dynamic>{};

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(19),
      child: InkWell(
        onTap: () {
          _showOrderDetails(order);
        },
        borderRadius: BorderRadius.circular(19),
        child: Container(
          padding: const EdgeInsets.all(
            16,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(
              19,
            ),
            border: Border.all(
              color: const Color(
                0xFFE2E8F0,
              ),
            ),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0D0F172A),
                blurRadius: 13,
                offset: Offset(
                  0,
                  5,
                ),
              ),
            ],
          ),
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
                      color: primaryColor.withValues(
                        alpha: 0.10,
                      ),
                      borderRadius: BorderRadius.circular(
                        14,
                      ),
                    ),
                    child: Icon(
                      _categoryIcon(
                        category,
                      ),
                      color: primaryColor,
                      size: 25,
                    ),
                  ),
                  const SizedBox(
                    width: 12,
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          order['title']?.toString() ??
                              _readableText(
                                category,
                              ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(
                              0xFF0F172A,
                            ),
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(
                          height: 4,
                        ),
                        Text(
                          order['reference']?.toString() ?? '',
                          style: const TextStyle(
                            color: Color(
                              0xFF64748B,
                            ),
                            fontSize: 12,
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
                      color: _statusColor(
                        status,
                      ).withValues(
                        alpha: 0.11,
                      ),
                      borderRadius: BorderRadius.circular(
                        20,
                      ),
                    ),
                    child: Text(
                      _readableText(
                        status,
                      ),
                      style: TextStyle(
                        color: _statusColor(
                          status,
                        ),
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(
                height: 15,
              ),
              LayoutBuilder(
                builder: (
                  BuildContext context,
                  BoxConstraints constraints,
                ) {
                  final bool wide = constraints.maxWidth >= 650;

                  final List<Widget> details = [
                    _buildOrderSummaryItem(
                      icon: Icons.person_rounded,
                      label: 'Customer',
                      value:
                          customer['fullName']?.toString() ?? 'Not available',
                    ),
                    _buildOrderSummaryItem(
                      icon: Icons.volunteer_activism_rounded,
                      label: 'Beneficiary',
                      value: beneficiary['fullName']?.toString() ??
                          'Not available',
                    ),
                    _buildOrderSummaryItem(
                      icon: Icons.payments_rounded,
                      label: 'Amount',
                      value: _formatCurrency(
                        _toDouble(
                          order['totalAmount'] ?? order['amount'],
                        ),
                      ),
                    ),
                    _buildOrderSummaryItem(
                      icon: Icons.calendar_month_rounded,
                      label: 'Created',
                      value: _formatDate(
                        order['createdAt'],
                      ),
                    ),
                  ];

                  if (wide) {
                    return Row(
                      children: details.map(
                        (
                          Widget item,
                        ) {
                          return Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(
                                right: 12,
                              ),
                              child: item,
                            ),
                          );
                        },
                      ).toList(),
                    );
                  }

                  return Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: details[0],
                          ),
                          const SizedBox(
                            width: 12,
                          ),
                          Expanded(
                            child: details[1],
                          ),
                        ],
                      ),
                      const SizedBox(
                        height: 12,
                      ),
                      Row(
                        children: [
                          Expanded(
                            child: details[2],
                          ),
                          const SizedBox(
                            width: 12,
                          ),
                          Expanded(
                            child: details[3],
                          ),
                        ],
                      ),
                    ],
                  );
                },
              ),
              const SizedBox(
                height: 13,
              ),
              Row(
                children: [
                  Icon(
                    Icons.category_outlined,
                    color: Colors.grey.shade600,
                    size: 17,
                  ),
                  const SizedBox(
                    width: 6,
                  ),
                  Expanded(
                    child: Text(
                      _readableText(
                        category,
                      ),
                      style: const TextStyle(
                        color: Color(
                          0xFF475569,
                        ),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const Text(
                    'View Details',
                    style: TextStyle(
                      color: primaryColor,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(
                    width: 3,
                  ),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: primaryColor,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOrderSummaryItem({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon,
          color: primaryColor,
          size: 18,
        ),
        const SizedBox(width: 7),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 11,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF334155),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPagination() {
    final bool canGoBack = _currentPage > 1;

    final bool canGoForward = _currentPage < _totalPages;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 14,
        vertical: 12,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Row(
        children: [
          OutlinedButton.icon(
            onPressed: canGoBack
                ? () {
                    _loadOrders(
                      page: _currentPage - 1,
                    );
                  }
                : null,
            icon: const Icon(
              Icons.chevron_left_rounded,
            ),
            label: const Text(
              'Previous',
            ),
          ),
          Expanded(
            child: Text(
              'Page $_currentPage of $_totalPages',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF475569),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          OutlinedButton.icon(
            onPressed: canGoForward
                ? () {
                    _loadOrders(
                      page: _currentPage + 1,
                    );
                  }
                : null,
            iconAlignment: IconAlignment.end,
            icon: const Icon(
              Icons.chevron_right_rounded,
            ),
            label: const Text(
              'Next',
            ),
          ),
        ],
      ),
    );
  }
}
