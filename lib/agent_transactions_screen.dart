import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AgentTransactionsScreen extends StatefulWidget {
  const AgentTransactionsScreen({super.key});

  @override
  State<AgentTransactionsScreen> createState() =>
      _AgentTransactionsScreenState();
}

class _AgentTransactionsScreenState extends State<AgentTransactionsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final TextEditingController searchController = TextEditingController();

  bool isLoading = true;
  bool isRefreshing = false;
  String errorMessage = '';

  List<Map<String, dynamic>> transactions = [];

  int totalTransactions = 0;
  int successfulTransactions = 0;
  int pendingTransactions = 0;
  int failedTransactions = 0;
  double totalAmount = 0;

  @override
  void initState() {
    super.initState();
    loadTransactions();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<String?> getSavedAuthToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'admin_token',
    ];

    for (final String key in tokenKeys) {
      final String? value = preferences.getString(key);

      if (value != null && value.trim().isNotEmpty) {
        return value.trim();
      }
    }

    return null;
  }

  Future<void> loadTransactions({
    bool refreshing = false,
  }) async {
    if (refreshing) {
      setState(() {
        isRefreshing = true;
      });
    } else {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final String? token = await getSavedAuthToken();

      if (token == null) {
        throw Exception(
          'Authentication token was not found. Please sign in again.',
        );
      }

      final String search = searchController.text.trim();

      final Uri uri = Uri.parse(
        '$baseUrl/management/aggregator-transactions',
      ).replace(
        queryParameters: {
          'page': '1',
          'limit': '100',
          if (search.isNotEmpty) 'search': search,
        },
      );

      final http.Response response = await http.get(
        uri,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(
          seconds: 30,
        ),
      );

      final dynamic decoded = jsonDecode(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        final String message = decoded is Map<String, dynamic>
            ? (decoded['message']?.toString() ?? 'Unable to load transactions.')
            : 'Unable to load transactions.';

        throw Exception(message);
      }

      final Map<String, dynamic> data =
          decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};

      final Map<String, dynamic> summary =
          data['summary'] is Map<String, dynamic>
              ? data['summary'] as Map<String, dynamic>
              : <String, dynamic>{};

      final List<dynamic> rawTransactions =
          data['transactions'] is List<dynamic>
              ? data['transactions'] as List<dynamic>
              : <dynamic>[];

      if (!mounted) {
        return;
      }

      setState(() {
        totalTransactions = _toInt(
          summary['totalTransactions'],
        );

        successfulTransactions = _toInt(
          summary['successfulTransactions'],
        );

        pendingTransactions = _toInt(
          summary['pendingTransactions'],
        );

        failedTransactions = _toInt(
          summary['failedTransactions'],
        );

        totalAmount = _toDouble(
          summary['totalAmount'],
        );

        transactions =
            rawTransactions.whereType<Map<String, dynamic>>().toList();

        errorMessage = '';
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        errorMessage = 'The server took too long to respond. Please try again.';
      });
    } on FormatException {
      if (!mounted) {
        return;
      }

      setState(() {
        errorMessage = 'The server returned an invalid response.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        errorMessage = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          isRefreshing = false;
        });
      }
    }
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
    if (value is double) {
      return value;
    }

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  String _customerName(
    Map<String, dynamic> transaction,
  ) {
    final dynamic customer = transaction['customerId'] ?? transaction['userId'];

    if (customer is Map<String, dynamic>) {
      final String name = customer['fullName']?.toString().trim() ?? '';

      if (name.isNotEmpty) {
        return name;
      }

      final String phone = customer['phone']?.toString().trim() ?? '';

      if (phone.isNotEmpty) {
        return phone;
      }
    }

    return 'Customer';
  }

  String _serviceName(
    Map<String, dynamic> transaction,
  ) {
    final String service = transaction['serviceType']?.toString().trim() ?? '';

    if (service.isNotEmpty) {
      return service.replaceAll(
        '_',
        ' ',
      );
    }

    return 'Transaction';
  }

  String _status(
    Map<String, dynamic> transaction,
  ) {
    final String status =
        transaction['status']?.toString().trim().toUpperCase() ?? 'PENDING';

    return status;
  }

  String _formatAmount(dynamic value) {
    final double amount = _toDouble(value);

    return '₦${amount.toStringAsFixed(2)}';
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'SUCCESSFUL':
        return const Color(
          0xFF138A4B,
        );
      case 'FAILED':
        return const Color(
          0xFFC62828,
        );
      case 'REFUNDED':
      case 'REVERSED':
        return const Color(
          0xFF6A1B9A,
        );
      default:
        return const Color(
          0xFFE58A00,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'Aggregator Transactions',
        ),
        backgroundColor: const Color(0xFFF7F9F8),
        surfaceTintColor: Colors.transparent,
        actions: [
          IconButton(
            onPressed: isRefreshing
                ? null
                : () => loadTransactions(
                      refreshing: true,
                    ),
            icon: isRefreshing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                : const Icon(
                    Icons.refresh_rounded,
                  ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => loadTransactions(
          refreshing: true,
        ),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            18,
            12,
            18,
            28,
          ),
          children: [
            _buildSearchBar(),
            const SizedBox(height: 16),
            _buildSummary(),
            const SizedBox(height: 18),
            if (isLoading)
              const Padding(
                padding: EdgeInsets.only(
                  top: 80,
                ),
                child: Center(
                  child: CircularProgressIndicator(),
                ),
              )
            else if (errorMessage.isNotEmpty)
              _buildErrorCard()
            else if (transactions.isEmpty)
              _buildEmptyCard()
            else
              ...transactions.map(
                _buildTransactionCard,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color: Color(0x10000000),
            blurRadius: 18,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: TextField(
        controller: searchController,
        textInputAction: TextInputAction.search,
        onSubmitted: (_) => loadTransactions(),
        decoration: InputDecoration(
          hintText: 'Search service or reference',
          prefixIcon: const Icon(
            Icons.search_rounded,
          ),
          suffixIcon: IconButton(
            onPressed: () => loadTransactions(),
            icon: const Icon(
              Icons.arrow_forward_rounded,
            ),
          ),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            vertical: 18,
          ),
        ),
      ),
    );
  }

  Widget _buildSummary() {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _summaryCard(
                title: 'Total',
                value: totalTransactions.toString(),
                icon: Icons.receipt_long_rounded,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _summaryCard(
                title: 'Successful',
                value: successfulTransactions.toString(),
                icon: Icons.check_circle_outline_rounded,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _summaryCard(
                title: 'Pending',
                value: pendingTransactions.toString(),
                icon: Icons.hourglass_top_rounded,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _summaryCard(
                title: 'Volume',
                value: _formatAmount(
                  totalAmount,
                ),
                icon: Icons.account_balance_wallet_outlined,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _summaryCard({
    required String title,
    required String value,
    required IconData icon,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(
            0xFFE6ECE8,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: const Color(
              0xFF158947,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            title,
            style: const TextStyle(
              color: Color(
                0xFF6E7772,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionCard(
    Map<String, dynamic> transaction,
  ) {
    final String status = _status(transaction);

    final String reference = transaction['reference']?.toString().trim() ?? '';

    return Container(
      margin: const EdgeInsets.only(
        bottom: 12,
      ),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(
            0xFFE6ECE8,
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: const Color(
                0xFFEAF6EF,
              ),
              borderRadius: BorderRadius.circular(
                14,
              ),
            ),
            child: const Icon(
              Icons.receipt_long_rounded,
              color: Color(
                0xFF158947,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _serviceName(
                          transaction,
                        ),
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    Text(
                      _formatAmount(
                        transaction['amount'],
                      ),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  _customerName(
                    transaction,
                  ),
                  style: const TextStyle(
                    color: Color(
                      0xFF5D6762,
                    ),
                  ),
                ),
                if (reference.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(
                      top: 4,
                    ),
                    child: Text(
                      reference,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(
                          0xFF8A938E,
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: _statusColor(
                        status,
                      ).withValues(
                        alpha: 0.12,
                      ),
                      borderRadius: BorderRadius.circular(
                        20,
                      ),
                    ),
                    child: Text(
                      status,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: _statusColor(
                          status,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorCard() {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.error_outline_rounded,
            size: 44,
            color: Colors.red,
          ),
          const SizedBox(height: 12),
          Text(
            errorMessage,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => loadTransactions(),
            child: const Text(
              'Try Again',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyCard() {
    return Container(
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Column(
        children: [
          Icon(
            Icons.receipt_long_outlined,
            size: 48,
            color: Color(
              0xFF7E8A84,
            ),
          ),
          SizedBox(height: 12),
          Text(
            'No customer transactions yet.',
            style: TextStyle(
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
