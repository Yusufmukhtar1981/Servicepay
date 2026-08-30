import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'account_statement_screen.dart';
import 'receipt_screen.dart';
import 'services/support_api_service.dart';
import 'transaction_presentation.dart';

class TransactionsScreen extends StatefulWidget {
  const TransactionsScreen({super.key});

  @override
  State<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends State<TransactionsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF2E7D32);
  static const int pageSize = 20;

  final TextEditingController searchController = TextEditingController();
  final ScrollController scrollController = ScrollController();
  final TransactionIssueSubmissionKeys issueSubmissionKeys =
      TransactionIssueSubmissionKeys();

  bool isLoading = true;
  bool isRefreshing = false;
  bool isLoadingMore = false;
  bool isPreparingStatement = false;
  bool hasMore = false;

  String searchQuery = '';
  String selectedFilter = 'ALL';
  String selectedType = 'ALL';
  String selectedDateRange = 'ALL_TIME';
  DateTimeRange? customDateRange;
  String errorMessage = '';
  String? nextCursor;

  List<Map<String, dynamic>> transactions = [];

  final List<String> filters = const [
    'ALL',
    'PROCESSING',
    'SUCCESSFUL',
    'PENDING',
    'FAILED',
    'REVERSED',
  ];

  @override
  void initState() {
    super.initState();
    loadTransactions();
    scrollController.addListener(_loadMoreWhenNeeded);
  }

  @override
  void dispose() {
    searchController.dispose();
    scrollController.dispose();
    super.dispose();
  }

  void _loadMoreWhenNeeded() {
    if (!scrollController.hasClients ||
        scrollController.position.extentAfter > 320) {
      return;
    }

    loadMoreTransactions();
  }

  Future<void> loadTransactions({
    bool showRefreshLoader = false,
    bool reset = true,
  }) async {
    if (!mounted) return;

    if ((!reset && isLoadingMore) || (reset && isRefreshing)) {
      return;
    }

    setState(() {
      if (!reset) {
        isLoadingMore = true;
      } else if (showRefreshLoader) {
        isRefreshing = true;
      } else {
        isLoading = true;
      }

      if (reset) {
        errorMessage = '';
      }
    });

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      final String token = prefs.getString('auth_token') ?? '';

      if (token.trim().isEmpty) {
        throw Exception(
          'Your login session has expired. Please log in again.',
        );
      }

      final Map<String, String> queryParameters = {
        'limit': '$pageSize',
      };

      if (!reset && nextCursor != null && nextCursor!.isNotEmpty) {
        queryParameters['before'] = nextCursor!;
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/transactions').replace(
          queryParameters: queryParameters,
        ),
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
        final Map<String, dynamic> pagination = _extractPagination(decoded);

        if (!mounted) return;

        setState(() {
          final Map<String, Map<String, dynamic>> combined = {
            for (final transaction
                in reset ? <Map<String, dynamic>>[] : transactions)
              _transactionId(transaction): transaction,
          };

          for (final transaction in loaded) {
            combined[_transactionId(transaction)] = transaction;
          }

          transactions = combined.values.toList()
            ..sort((left, right) {
              final DateTime? rightDate = _transactionDate(right);
              final DateTime? leftDate = _transactionDate(left);

              return (rightDate?.millisecondsSinceEpoch ?? 0).compareTo(
                leftDate?.millisecondsSinceEpoch ?? 0,
              );
            });

          hasMore = pagination['hasMore'] == true;
          nextCursor = pagination['nextCursor']?.toString();
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
        if (transactions.isEmpty) {
          errorMessage = error.toString().replaceFirst('Exception: ', '');
        }
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          isRefreshing = false;
          isLoadingMore = false;
        });
      }
    }
  }

  Future<void> loadMoreTransactions() async {
    if (!hasMore || nextCursor == null || nextCursor!.isEmpty) {
      return;
    }

    await loadTransactions(
      reset: false,
    );
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

  Map<String, dynamic> _extractPagination(dynamic data) {
    if (data is! Map) {
      return const {};
    }

    final dynamic nestedData = data['data'];

    if (nestedData is Map && nestedData['pagination'] is Map) {
      return Map<String, dynamic>.from(nestedData['pagination'] as Map);
    }

    if (data['pagination'] is Map) {
      return Map<String, dynamic>.from(data['pagination'] as Map);
    }

    return const {};
  }

  String _transactionId(Map<String, dynamic> transaction) {
    final dynamic value =
        transaction['id'] ?? transaction['_id'] ?? transaction['reference'];

    return value?.toString() ?? '';
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
    return transactions.where((transaction) {
      final presentation = TransactionPresentation(transaction);
      final bool matchesFilter =
          selectedFilter == 'ALL' || presentation.status == selectedFilter;
      final bool matchesType = selectedType == 'ALL' ||
          presentation.title.toUpperCase() == selectedType;
      return matchesFilter &&
          matchesType &&
          _matchesDateRange(presentation.date) &&
          presentation.matchesSearch(searchQuery);
    }).toList();
  }

  bool _matchesDateRange(DateTime? date) {
    return transactionDateMatchesRange(
      date: date,
      range: selectedDateRange,
      now: DateTime.now(),
      customRange: customDateRange,
    );
  }

  Future<void> _selectHistoryDateRange(String value) async {
    if (value != 'CUSTOM') {
      setState(() => selectedDateRange = value);
      return;
    }
    final DateTime now = DateTime.now();
    final DateTimeRange? selected = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: now,
      initialDateRange: customDateRange ??
          DateTimeRange(
            start: now.subtract(const Duration(days: 29)),
            end: now,
          ),
      helpText: 'Filter transaction dates',
    );
    if (selected != null && mounted) {
      setState(() {
        customDateRange = selected;
        selectedDateRange = 'CUSTOM';
      });
    }
  }

  List<String> get _types => [
        'ALL',
        ...transactions
            .map((item) => TransactionPresentation(item).title.toUpperCase())
            .toSet()
            .toList()
          ..sort(),
      ];

  String _transactionTitle(
    Map<String, dynamic> transaction,
  ) {
    return TransactionPresentation(transaction).title;
  }

  String _transactionDescription(
    Map<String, dynamic> transaction,
  ) {
    return TransactionPresentation(transaction).description;
  }

  String _transactionReference(
    Map<String, dynamic> transaction,
  ) {
    return TransactionPresentation(transaction).reference;
  }

  String _transactionStatus(
    Map<String, dynamic> transaction,
  ) {
    return TransactionPresentation(transaction).status;
  }

  double _transactionAmount(
    Map<String, dynamic> transaction,
  ) {
    return TransactionPresentation(transaction).amount;
  }

  String _transactionDirection(
    Map<String, dynamic> transaction,
  ) {
    return TransactionPresentation(transaction).direction;
  }

  Color _directionColor(String direction) {
    return direction == 'CREDIT'
        ? const Color(0xFF15803D)
        : const Color(0xFFB91C1C);
  }

  String _formattedAmount(
    double amount,
    String direction,
  ) {
    final String sign = direction == 'CREDIT' ? '+' : '-';
    return '$sign₦${amount.toStringAsFixed(2)}';
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
    return TransactionPresentation.statusColor(status);
  }

  void _openReceipt(Map<String, dynamic> transaction) {
    final presentation = TransactionPresentation(transaction);
    final Map<String, String> details = <String, String>{
      for (final MapEntry<String, String> detail in presentation.details)
        detail.key: detail.value,
    };

    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ReceiptScreen(
          serviceName: presentation.title,
          amount: presentation.amount.toStringAsFixed(2),
          status: presentation.status,
          reference: presentation.reference,
          date: _formatDate(presentation.date),
          details: details,
        ),
      ),
    );
  }

  Future<void> _refreshTransactionStatus(
    Map<String, dynamic> transaction,
  ) async {
    final TransactionPresentation presentation =
        TransactionPresentation(transaction);
    if (presentation.lookupId.isEmpty) return;

    var progressOpen = false;
    try {
      if (mounted) {
        progressOpen = true;
        showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (_) => const AlertDialog(
            content: Row(
              children: [
                SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: 16),
                Expanded(child: Text('Checking transaction status...')),
              ],
            ),
          ),
        );
      }
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = prefs.getString('auth_token') ?? '';
      if (token.trim().isEmpty) {
        throw Exception('Your login session has expired.');
      }
      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/transactions/${Uri.encodeComponent(presentation.lookupId)}',
        ),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 30));
      final dynamic decoded = _decodeResponse(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          _extractMessage(
            decoded,
            fallback: 'Unable to refresh this transaction.',
          ),
        );
      }
      final dynamic raw =
          decoded is Map ? decoded['transaction'] ?? decoded['data'] : null;
      if (raw is! Map) {
        throw Exception('Transaction status returned an invalid response.');
      }
      final Map<String, dynamic> refreshed = Map<String, dynamic>.from(raw);
      if (!mounted) return;
      setState(() {
        final int index = transactions.indexWhere(
          (Map<String, dynamic> item) =>
              TransactionPresentation(item).lookupId == presentation.lookupId,
        );
        if (index >= 0) transactions[index] = refreshed;
      });
      if (progressOpen && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
        progressOpen = false;
      }
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
      _showTransactionDetails(refreshed);
      final TransactionPresentation updated =
          TransactionPresentation(refreshed);
      final dynamic statusCheck =
          decoded is Map ? decoded['statusCheck'] : null;
      final String explanation = statusCheck is Map
          ? (statusCheck['message'] ?? '').toString().trim()
          : '';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            explanation.isEmpty
                ? 'Status: ${updated.status}.'
                : 'Status: ${updated.status}. $explanation',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      if (progressOpen && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
        progressOpen = false;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  Future<void> _reportTransactionIssue(
    Map<String, dynamic> transaction,
  ) async {
    final TransactionPresentation presentation =
        TransactionPresentation(transaction);
    if (presentation.lookupId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('This transaction cannot be reported right now.'),
        ),
      );
      return;
    }

    final _TransactionIssueInput? input =
        await showDialog<_TransactionIssueInput>(
      context: context,
      builder: (_) => _TransactionIssueDialog(
        transactionTitle: presentation.title,
        reference: presentation.reference,
      ),
    );
    if (input == null || !mounted) return;
    final String idempotencyKey =
        await issueSubmissionKeys.forTransaction(presentation.lookupId);
    if (!mounted) return;

    var progressOpen = true;
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const AlertDialog(
        content: Row(
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 16),
            Expanded(child: Text('Submitting issue...')),
          ],
        ),
      ),
    );

    final SupportApiService support = SupportApiService();
    try {
      final SupportTicket ticket = await support.createTicket(
        subject: 'Issue with ${presentation.title}',
        description: input.description,
        priority: input.priority,
        idempotencyKey: idempotencyKey,
        transactionLookupId: presentation.lookupId,
      );
      await issueSubmissionKeys.complete(presentation.lookupId);
      if (!mounted) return;
      if (progressOpen && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
        progressOpen = false;
      }
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Issue reported'),
          content: Text(
            'Support case ${ticket.reference} was created successfully.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Done'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (!mounted) return;
      if (progressOpen && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
        progressOpen = false;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            error is SupportApiException
                ? error.message
                : 'Unable to report this issue. Please try again.',
          ),
        ),
      );
    } finally {
      support.close();
    }
  }

  Future<void> _openStatement() async {
    if (isPreparingStatement) return;
    setState(() => isPreparingStatement = true);

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = prefs.getString('auth_token') ?? '';
      if (token.trim().isEmpty) {
        throw Exception('Your login session has expired.');
      }

      final Map<String, Map<String, dynamic>> complete = {};
      String? cursor;
      bool more = true;
      int pages = 0;

      while (more && pages < 100) {
        final Map<String, String> query = <String, String>{'limit': '100'};
        if (cursor != null && cursor.isNotEmpty) {
          query['before'] = cursor;
        }
        final http.Response response = await http.get(
          Uri.parse('$baseUrl/transactions').replace(
            queryParameters: query,
          ),
          headers: <String, String>{
            'Accept': 'application/json',
            'Authorization': 'Bearer $token',
          },
        ).timeout(const Duration(seconds: 30));
        final dynamic decoded = _decodeResponse(response.body);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw Exception(
            _extractMessage(
              decoded,
              fallback: 'Unable to prepare your complete statement.',
            ),
          );
        }
        for (final Map<String, dynamic> item in _extractTransactions(decoded)) {
          complete[_transactionId(item)] = item;
        }
        final Map<String, dynamic> pagination = _extractPagination(decoded);
        more = pagination['hasMore'] == true;
        cursor = pagination['nextCursor']?.toString();
        pages += 1;
        if (more && (cursor == null || cursor.isEmpty)) {
          throw Exception('Transaction pagination could not be completed.');
        }
      }
      if (more) {
        throw Exception(
          'Your history is too large to export safely right now.',
        );
      }

      final List<AccountStatementTransaction> statementTransactions =
          complete.values.map((Map<String, dynamic> transaction) {
        final TransactionPresentation presentation =
            TransactionPresentation(transaction);
        return AccountStatementTransaction(
          reference: presentation.reference,
          description: presentation.description.isEmpty
              ? presentation.title
              : presentation.description,
          amount: presentation.amount.toStringAsFixed(2),
          occurredAt:
              presentation.date ?? DateTime.fromMillisecondsSinceEpoch(0),
          status: presentation.status,
          direction: presentation.direction == 'CREDIT'
              ? StatementDirection.credit
              : StatementDirection.debit,
        );
      }).where((AccountStatementTransaction item) {
        return item.occurredAt.millisecondsSinceEpoch > 0;
      }).toList();

      if (!mounted) return;
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => AccountStatementScreen(
            transactions: statementTransactions,
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => isPreparingStatement = false);
      }
    }
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
    final String direction = _transactionDirection(transaction);
    final presentation = TransactionPresentation(transaction);

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
            child: SingleChildScrollView(
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
                    _formattedAmount(amount, direction),
                    style: TextStyle(
                      color: _directionColor(direction),
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
                  _DetailRow(
                    label: 'Direction',
                    value: direction,
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
                  for (final detail in presentation.details)
                    _DetailRow(label: detail.key, value: detail.value),
                  const SizedBox(height: 16),
                  _TransactionTimeline(
                    transaction: transaction,
                    status: status,
                  ),
                  const SizedBox(height: 16),
                  if (presentation.lookupId.isNotEmpty)
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => _refreshTransactionStatus(transaction),
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Check transaction status'),
                      ),
                    ),
                  if (status == 'SUCCESSFUL')
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: () => _openReceipt(transaction),
                        icon: const Icon(Icons.receipt_long_rounded),
                        label: const Text('View receipt'),
                      ),
                    ),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton.icon(
                      onPressed: () => _reportTransactionIssue(transaction),
                      icon: const Icon(Icons.support_agent_rounded),
                      label: const Text('Report an issue'),
                    ),
                  ),
                ],
              ),
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
            tooltip: 'Account statement',
            onPressed: isPreparingStatement ? null : _openStatement,
            icon: isPreparingStatement
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2,
                    ),
                  )
                : const Icon(Icons.description_outlined),
          ),
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
                controller: scrollController,
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
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: _FilterMenu(
                          label: 'Type',
                          value: selectedType,
                          items: _types,
                          format: _formatTitle,
                          onChanged: (value) {
                            setState(() => selectedType = value);
                          },
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _FilterMenu(
                          label: 'Date',
                          value: selectedDateRange,
                          items: const [
                            'ALL_TIME',
                            'TODAY',
                            'LAST_7_DAYS',
                            'LAST_30_DAYS',
                            'CUSTOM',
                          ],
                          format: (value) {
                            switch (value) {
                              case 'ALL_TIME':
                                return 'All time';
                              case 'LAST_7_DAYS':
                                return 'Last 7 days';
                              case 'LAST_30_DAYS':
                                return 'Last 30 days';
                              case 'CUSTOM':
                                return customDateRange == null
                                    ? 'Custom range'
                                    : '${customDateRange!.start.day}/'
                                        '${customDateRange!.start.month} – '
                                        '${customDateRange!.end.day}/'
                                        '${customDateRange!.end.month}';
                              default:
                                return 'Today';
                            }
                          },
                          onChanged: (value) {
                            _selectHistoryDateRange(value);
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  if (errorMessage.isNotEmpty)
                    _ErrorState(
                      message: errorMessage,
                      onRetry: () {
                        loadTransactions(
                          reset: true,
                        );
                      },
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
                          direction: _transactionDirection(
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
                          directionColor: _directionColor(
                            _transactionDirection(
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
                    if (hasMore)
                      Padding(
                        padding: const EdgeInsets.only(
                          top: 6,
                          bottom: 8,
                        ),
                        child: Center(
                          child: isLoadingMore
                              ? const SizedBox(
                                  width: 26,
                                  height: 26,
                                  child: CircularProgressIndicator(
                                    color: primaryGreen,
                                    strokeWidth: 2.4,
                                  ),
                                )
                              : TextButton.icon(
                                  onPressed: loadMoreTransactions,
                                  icon: const Icon(
                                    Icons.expand_more_rounded,
                                  ),
                                  label: const Text(
                                    'Load more transactions',
                                  ),
                                ),
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
  final String direction;
  final String status;
  final String date;
  final IconData icon;
  final Color statusColor;
  final Color directionColor;
  final VoidCallback onTap;

  const _TransactionCard({
    required this.title,
    required this.description,
    required this.amount,
    required this.direction,
    required this.status,
    required this.date,
    required this.icon,
    required this.statusColor,
    required this.directionColor,
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
                    '${direction == 'CREDIT' ? '+' : '-'}₦${amount.toStringAsFixed(2)}',
                    style: TextStyle(
                      color: directionColor,
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        direction,
                        style: TextStyle(
                          color: directionColor,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(width: 6),
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
            ],
          ),
        ),
      ),
    );
  }
}

class _FilterMenu extends StatelessWidget {
  final String label;
  final String value;
  final List<String> items;
  final String Function(String) format;
  final ValueChanged<String> onChanged;

  const _FilterMenu({
    required this.label,
    required this.value,
    required this.items,
    required this.format,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      value: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE8ECE8)),
        ),
      ),
      items: items
          .map((item) =>
              DropdownMenuItem(value: item, child: Text(format(item))))
          .toList(),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
    );
  }
}

class _TransactionIssueInput {
  const _TransactionIssueInput({
    required this.description,
    required this.priority,
  });

  final String description;
  final String priority;
}

class _TransactionIssueDialog extends StatefulWidget {
  const _TransactionIssueDialog({
    required this.transactionTitle,
    required this.reference,
  });

  final String transactionTitle;
  final String reference;

  @override
  State<_TransactionIssueDialog> createState() =>
      _TransactionIssueDialogState();
}

class _TransactionIssueDialogState extends State<_TransactionIssueDialog> {
  static const Map<String, String> _reasons = {
    'SERVICE_NOT_RECEIVED': 'Paid but service was not received',
    'RECIPIENT_NOT_CREDITED': 'Recipient was not credited',
    'PENDING_TOO_LONG': 'Transaction has been pending too long',
    'WRONG_STATUS': 'The displayed status is incorrect',
    'OTHER': 'Other issue',
  };

  final TextEditingController _detailsController = TextEditingController();
  String _reason = 'SERVICE_NOT_RECEIVED';

  @override
  void dispose() {
    _detailsController.dispose();
    super.dispose();
  }

  void _submit() {
    final String details = _detailsController.text.trim();
    if (_reason == 'OTHER' && details.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please describe the issue.')),
      );
      return;
    }
    final String reason = _reasons[_reason]!;
    Navigator.of(context).pop(
      _TransactionIssueInput(
        description: details.isEmpty ? reason : '$reason\n\n$details',
        priority: _reason == 'PENDING_TOO_LONG' ? 'HIGH' : 'NORMAL',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final String reference =
        widget.reference.isEmpty ? 'Reference unavailable' : widget.reference;
    return AlertDialog(
      title: const Text('Report an issue'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${widget.transactionTitle}\n$reference',
              style: const TextStyle(
                color: Color(0xFF6B7280),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _reason,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'What went wrong?',
                border: OutlineInputBorder(),
              ),
              items: _reasons.entries
                  .map(
                    (entry) => DropdownMenuItem<String>(
                      value: entry.key,
                      child: Text(
                        entry.value,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null) setState(() => _reason = value);
              },
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _detailsController,
              minLines: 3,
              maxLines: 5,
              maxLength: 1000,
              decoration: InputDecoration(
                labelText: _reason == 'OTHER'
                    ? 'Describe the issue'
                    : 'Additional details (optional)',
                alignLabelWithHint: true,
                border: const OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _submit,
          child: const Text('Submit'),
        ),
      ],
    );
  }
}

class _TransactionTimeline extends StatelessWidget {
  final Map<String, dynamic> transaction;
  final String status;

  const _TransactionTimeline({
    required this.transaction,
    required this.status,
  });

  DateTime? _readDate(String key) {
    final value = transaction[key];
    return value == null
        ? null
        : DateTime.tryParse(value.toString())?.toLocal();
  }

  String _format(DateTime date) {
    final day = date.day.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');
    final hour = date.hour.toString().padLeft(2, '0');
    final minute = date.minute.toString().padLeft(2, '0');
    return '$day/$month/${date.year} • $hour:$minute';
  }

  @override
  Widget build(BuildContext context) {
    final created = _readDate('createdAt');
    final updated = _readDate('updatedAt');
    final completed = _readDate('completedAt');
    final failed = _readDate('failedAt');
    final reversed = _readDate('refundedAt');
    final events = <MapEntry<String, DateTime>>[
      if (created != null) MapEntry('Initiated', created),
      if (completed != null) MapEntry('Completed', completed),
      if (failed != null) MapEntry('Failed', failed),
      if (reversed != null) MapEntry('Reversed', reversed),
      if (updated != null &&
          updated != created &&
          completed == null &&
          failed == null &&
          reversed == null)
        MapEntry('Last updated', updated),
    ];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Status timeline',
              style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          if (events.isEmpty)
            Text(
              'Current status: $status. No event timestamps were provided.',
              style: const TextStyle(color: Color(0xFF6B7280)),
            )
          else
            for (final event in events)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Text(
                  '${event.key} • ${_format(event.value)}',
                  style: const TextStyle(color: Color(0xFF4B5563)),
                ),
              ),
        ],
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
            'Transactions matching your filters will appear here.',
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
