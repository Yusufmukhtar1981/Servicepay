import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class TransactionsScreen extends StatefulWidget {
  const TransactionsScreen({super.key});

  @override
  State<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends State<TransactionsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF2E7D32);

  final TextEditingController searchController = TextEditingController();

  bool isLoading = true;
  bool isRefreshing = false;

  String searchQuery = '';
  String selectedFilter = 'ALL';
  String errorMessage = '';

  List<Map<String, dynamic>> transactions = [];

  final List<String> filters = const [
    'ALL',
    'SUCCESSFUL',
    'PENDING',
    'FAILED',
  ];

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

  Future<void> loadTransactions({
    bool showRefreshLoader = false,
  }) async {
    if (!mounted) return;

    setState(() {
      if (showRefreshLoader) {
        isRefreshing = true;
      } else {
        isLoading = true;
      }

      errorMessage = '';
    });

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      final String token = prefs.getString('auth_token') ?? '';

      if (token.trim().isEmpty) {
        throw Exception(
          'Your login session has expired. Please log in again.',
        );
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/transactions'),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final List<Map<String, dynamic>> loaded = _extractTransactions(decoded);

        if (!mounted) return;

        setState(() {
          transactions = loaded;
        });
      } else {
        throw Exception(
          _extractMessage(
            decoded,
            fallback: 'Unable to load transactions.',
          ),
        );
      }
    } catch (error) {
      if (!mounted) return;

      setState(() {
        errorMessage = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        isRefreshing = false;
      });
    }
  }

  dynamic _decodeResponse(String body) {
    if (body.trim().isEmpty) return null;

    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  List<Map<String, dynamic>> _extractTransactions(
    dynamic data,
  ) {
    dynamic list;

    if (data is List) {
      list = data;
    } else if (data is Map) {
      list = data['transactions'] ??
          (data['data'] is Map ? data['data']['transactions'] : null) ??
          (data['wallet'] is Map ? data['wallet']['transactions'] : null);

      if (list == null && data['data'] is List) {
        list = data['data'];
      }
    }

    if (list is! List) {
      return [];
    }

    return list
        .whereType<Map>()
        .map(
          (item) => Map<String, dynamic>.from(
            item,
          ),
        )
        .toList();
  }

  String _extractMessage(
    dynamic data, {
    required String fallback,
  }) {
    if (data is Map) {
      final dynamic message =
          data['message'] ?? data['error'] ?? data['detail'];

      if (message != null && message.toString().trim().isNotEmpty) {
        return message.toString();
      }
    }

    return fallback;
  }

  List<Map<String, dynamic>> get filteredTransactions {
    final String query = searchQuery.trim().toLowerCase();

    return transactions.where((transaction) {
      final String status = _transactionStatus(transaction);

      final bool matchesFilter =
          selectedFilter == 'ALL' || status == selectedFilter;

      final String searchableText = [
        _transactionTitle(transaction),
        _transactionReference(transaction),
        _transactionDescription(transaction),
        _transactionStatus(transaction),
        _transactionAmount(transaction).toString(),
      ].join(' ').toLowerCase();

      final bool matchesSearch =
          query.isEmpty || searchableText.contains(query);

      return matchesFilter && matchesSearch;
    }).toList();
  }

  String _transactionTitle(
    Map<String, dynamic> transaction,
  ) {
    final dynamic value = transaction['serviceType'] ??
        transaction['type'] ??
        transaction['transactionType'] ??
        transaction['category'] ??
        'Transaction';

    return _formatTitle(value.toString());
  }

  String _transactionDescription(
    Map<String, dynamic> transaction,
  ) {
    final dynamic value = transaction['description'] ??
        transaction['narration'] ??
        transaction['message'] ??
        transaction['recipientPhone'] ??
        transaction['phone'] ??
        '';

    return value.toString().trim();
  }

  String _transactionReference(
    Map<String, dynamic> transaction,
  ) {
    final dynamic value = transaction['reference'] ??
        transaction['transactionReference'] ??
        transaction['transactionId'] ??
        transaction['_id'] ??
        '';

    return value.toString();
  }

  String _transactionStatus(
    Map<String, dynamic> transaction,
  ) {
    final dynamic value =
        transaction['status'] ?? transaction['paymentStatus'] ?? 'PENDING';

    final String status = value.toString().trim().toUpperCase();

    if (status == 'SUCCESS' || status == 'COMPLETED' || status == 'PAID') {
      return 'SUCCESSFUL';
    }

    if (status == 'FAIL' ||
        status == 'FAILED' ||
        status == 'DECLINED' ||
        status == 'CANCELLED') {
      return 'FAILED';
    }

    return status.isEmpty ? 'PENDING' : status;
  }

  double _transactionAmount(
    Map<String, dynamic> transaction,
  ) {
    final dynamic value = transaction['amount'] ??
        transaction['totalAmount'] ??
        transaction['value'] ??
        0;

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value.toString().replaceAll(',', '').trim(),
        ) ??
        0;
  }

  DateTime? _transactionDate(
    Map<String, dynamic> transaction,
  ) {
    final dynamic value = transaction['createdAt'] ??
        transaction['date'] ??
        transaction['transactionDate'] ??
        transaction['updatedAt'];

    if (value == null) return null;

    return DateTime.tryParse(
      value.toString(),
    )?.toLocal();
  }

  String _formatDate(DateTime? date) {
    if (date == null) {
      return 'Date unavailable';
    }

    final String day = date.day.toString().padLeft(2, '0');

    final String month = date.month.toString().padLeft(2, '0');

    final String hour = date.hour.toString().padLeft(2, '0');

    final String minute = date.minute.toString().padLeft(2, '0');

    return '$day/$month/${date.year} • $hour:$minute';
  }

  String _formatTitle(String value) {
    final String cleaned =
        value.replaceAll('_', ' ').replaceAll('-', ' ').trim().toLowerCase();

    if (cleaned.isEmpty) {
      return 'Transaction';
    }

    return cleaned
        .split(' ')
        .where((word) => word.isNotEmpty)
        .map(
          (word) => '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }

  IconData _transactionIcon(String title) {
    final String value = title.toLowerCase();

    if (value.contains('airtime')) {
      return Icons.phone_android_rounded;
    }

    if (value.contains('data')) {
      return Icons.wifi_rounded;
    }

    if (value.contains('transfer')) {
      return Icons.send_rounded;
    }

    if (value.contains('fund') || value.contains('wallet')) {
      return Icons.account_balance_wallet_rounded;
    }

    if (value.contains('delivery') || value.contains('logistic')) {
      return Icons.local_shipping_rounded;
    }

    if (value.contains('electric')) {
      return Icons.lightbulb_rounded;
    }

    if (value.contains('cable')) {
      return Icons.live_tv_rounded;
    }

    if (value.contains('verification') || value.contains('identity')) {
      return Icons.verified_user_rounded;
    }

    return Icons.receipt_long_rounded;
  }

  Color _statusColor(String status) {
    if (status == 'SUCCESSFUL') {
      return primaryGreen;
    }

    if (status == 'FAILED') {
      return const Color(0xFFDC2626);
    }

    return const Color(0xFFF59E0B);
  }

  void _showTransactionDetails(
    Map<String, dynamic> transaction,
  ) {
    final String title = _transactionTitle(transaction);

    final String status = _transactionStatus(transaction);

    final String description = _transactionDescription(transaction);

    final String reference = _transactionReference(transaction);

    final double amount = _transactionAmount(transaction);

    final DateTime? date = _transactionDate(transaction);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.fromLTRB(
            20,
            20,
            20,
            28,
          ),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(26),
            ),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 46,
                  height: 5,
                  decoration: BoxDecoration(
                    color: Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(20),
                  ),
                ),
                const SizedBox(height: 20),
                CircleAvatar(
                  radius: 31,
                  backgroundColor: const Color(0xFFE8F5E9),
                  child: Icon(
                    _transactionIcon(title),
                    color: primaryGreen,
                    size: 31,
                  ),
                ),
                const SizedBox(height: 13),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  '₦${amount.toStringAsFixed(2)}',
                  style: const TextStyle(
                    fontSize: 27,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: _statusColor(status).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    status,
                    style: TextStyle(
                      color: _statusColor(status),
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                    ),
                  ),
                ),
                const SizedBox(height: 22),
                _DetailRow(
                  label: 'Date',
                  value: _formatDate(date),
                ),
                if (description.isNotEmpty)
                  _DetailRow(
                    label: 'Description',
                    value: description,
                  ),
                if (reference.isNotEmpty)
                  _DetailRow(
                    label: 'Reference',
                    value: reference,
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final List<Map<String, dynamic>> visible = filteredTransactions;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Transactions',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isRefreshing
                ? null
                : () {
                    loadTransactions(
                      showRefreshLoader: true,
                    );
                  },
            icon: isRefreshing
                ? const SizedBox(
                    width: 21,
                    height: 21,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2.3,
                    ),
                  )
                : const Icon(
                    Icons.refresh_rounded,
                  ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(
                color: primaryGreen,
              ),
            )
          : RefreshIndicator(
              color: primaryGreen,
              onRefresh: () {
                return loadTransactions(
                  showRefreshLoader: true,
                );
              },
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(
                  14,
                  14,
                  14,
                  30,
                ),
                children: [
                  TextField(
                    controller: searchController,
                    onChanged: (value) {
                      setState(() {
                        searchQuery = value;
                      });
                    },
                    decoration: InputDecoration(
                      hintText: 'Search transactions...',
                      prefixIcon: const Icon(
                        Icons.search_rounded,
                        color: primaryGreen,
                      ),
                      suffixIcon: searchQuery.isEmpty
                          ? null
                          : IconButton(
                              onPressed: () {
                                searchController.clear();

                                setState(() {
                                  searchQuery = '';
                                });
                              },
                              icon: const Icon(
                                Icons.close_rounded,
                              ),
                            ),
                      filled: true,
                      fillColor: Colors.white,
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: BorderSide(
                          color: Colors.grey.shade200,
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: const BorderSide(
                          color: primaryGreen,
                          width: 1.4,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 40,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: filters.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (context, index) {
                        final String filter = filters[index];

                        final bool selected = selectedFilter == filter;

                        return ChoiceChip(
                          label: Text(
                            _formatTitle(filter),
                          ),
                          selected: selected,
                          selectedColor: const Color(0xFFE8F5E9),
                          labelStyle: TextStyle(
                            color:
                                selected ? primaryGreen : Colors.grey.shade700,
                            fontWeight: FontWeight.w700,
                          ),
                          side: BorderSide(
                            color:
                                selected ? primaryGreen : Colors.grey.shade300,
                          ),
                          onSelected: (_) {
                            setState(() {
                              selectedFilter = filter;
                            });
                          },
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (errorMessage.isNotEmpty)
                    _ErrorState(
                      message: errorMessage,
                      onRetry: loadTransactions,
                    )
                  else if (visible.isEmpty)
                    const _EmptyState()
                  else ...[
                    Text(
                      '${visible.length} transaction${visible.length == 1 ? '' : 's'}',
                      style: const TextStyle(
                        color: Color(0xFF6B7280),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 10),
                    for (final transaction in visible)
                      Padding(
                        padding: const EdgeInsets.only(
                          bottom: 10,
                        ),
                        child: _TransactionCard(
                          title: _transactionTitle(
                            transaction,
                          ),
                          description: _transactionDescription(
                            transaction,
                          ),
                          amount: _transactionAmount(
                            transaction,
                          ),
                          status: _transactionStatus(
                            transaction,
                          ),
                          date: _formatDate(
                            _transactionDate(
                              transaction,
                            ),
                          ),
                          icon: _transactionIcon(
                            _transactionTitle(
                              transaction,
                            ),
                          ),
                          statusColor: _statusColor(
                            _transactionStatus(
                              transaction,
                            ),
                          ),
                          onTap: () {
                            _showTransactionDetails(
                              transaction,
                            );
                          },
                        ),
                      ),
                  ],
                ],
              ),
            ),
    );
  }
}

class _TransactionCard extends StatelessWidget {
  final String title;
  final String description;
  final double amount;
  final String status;
  final String date;
  final IconData icon;
  final Color statusColor;
  final VoidCallback onTap;

  const _TransactionCard({
    required this.title,
    required this.description,
    required this.amount,
    required this.status,
    required this.date,
    required this.icon,
    required this.statusColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(17),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(17),
            border: Border.all(
              color: const Color(0xFFE8ECE8),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: const Color(0xFFE8F5E9),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(
                  icon,
                  color: const Color(0xFF2E7D32),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF171A18),
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (description.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        description,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF777D78),
                          fontSize: 12,
                        ),
                      ),
                    ],
                    const SizedBox(height: 5),
                    Text(
                      date,
                      style: const TextStyle(
                        color: Color(0xFF9CA3AF),
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '₦${amount.toStringAsFixed(2)}',
                    style: const TextStyle(
                      color: Color(0xFF171A18),
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    status,
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorState({
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFFECACA),
        ),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: Color(0xFFDC2626),
            size: 48,
          ),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF6B7280),
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: onRetry,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
            label: const Text('Try Again'),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        vertical: 42,
        horizontal: 22,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE8ECE8),
        ),
      ),
      child: const Column(
        children: [
          Icon(
            Icons.receipt_long_outlined,
            size: 58,
            color: Color(0xFF9CA3AF),
          ),
          SizedBox(height: 13),
          Text(
            'No transactions found',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          SizedBox(height: 6),
          Text(
            'Your completed transactions will appear here.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF777D78),
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        vertical: 12,
      ),
      decoration: const BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: Color(0xFFE8ECE8),
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 95,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF777D78),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: Color(0xFF171A18),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
