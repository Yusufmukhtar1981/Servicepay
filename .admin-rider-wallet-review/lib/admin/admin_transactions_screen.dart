import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminTransactionsScreen extends StatefulWidget {
  const AdminTransactionsScreen({super.key});

  @override
  State<AdminTransactionsScreen> createState() =>
      _AdminTransactionsScreenState();
}

class _AdminTransactionsScreenState
    extends State<AdminTransactionsScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  final TextEditingController searchController =
      TextEditingController();

  bool isLoading = true;
  bool isRefreshing = false;
  bool hasError = false;

  String errorMessage = '';
  String selectedStatus = 'ALL';
  String selectedService = 'ALL';

  int currentPage = 1;
  int totalPages = 1;
  int totalTransactions = 0;

  List<dynamic> transactions = [];

  final List<String> statuses = const [
    'ALL',
    'SUCCESSFUL',
    'PENDING',
    'FAILED',
    'REVERSED',
  ];

  final List<String> services = const [
    'ALL',
    'AIRTIME',
    'DATA',
    'CABLE',
    'ELECTRICITY',
    'EXAM_PIN',
    'WALLET_FUNDING',
    'TRANSFER',
    'BANK_TRANSFER',
    'ID_VERIFICATION',
    'DELIVERY',
  ];

  Timer? searchTimer;

  @override
  void initState() {
    super.initState();
    loadTransactions();
  }

  @override
  void dispose() {
    searchTimer?.cancel();
    searchController.dispose();
    super.dispose();
  }

  Map<String, dynamic> toMap(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }

    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  int toInt(dynamic value) {
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

  double toDouble(dynamic value) {
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

  dynamic decodeResponse(String body) {
    if (body.trim().isEmpty) {
      return null;
    }

    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  String extractMessage(
    dynamic data, {
    required String fallback,
  }) {
    if (data is Map) {
      final dynamic message =
          data['message'] ??
          data['error'] ??
          data['detail'];

      if (message != null &&
          message.toString().trim().isNotEmpty) {
        return message.toString();
      }
    }

    return fallback;
  }

  Future<String?> getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    return prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('admin_token');
  }

  Future<void> loadTransactions({
    bool refresh = false,
    int? page,
  }) async {
    if (!mounted) return;

    final int requestedPage = page ?? currentPage;

    setState(() {
      if (refresh) {
        isRefreshing = true;
      } else {
        isLoading = true;
      }

      hasError = false;
      errorMessage = '';
    });

    try {
      final String? token = await getToken();

      if (token == null || token.trim().isEmpty) {
        throw Exception(
          'Admin login token was not found. Please log in again.',
        );
      }

      final Map<String, String> queryParameters = {
        'page': requestedPage.toString(),
        'limit': '20',
      };

      final String search =
          searchController.text.trim();

      if (search.isNotEmpty) {
        queryParameters['search'] = search;
      }

      if (selectedStatus != 'ALL') {
        queryParameters['status'] =
            selectedStatus;
      }

      if (selectedService != 'ALL') {
        queryParameters['serviceType'] =
            selectedService;
      }

      final Uri uri = Uri.parse(
        '$baseUrl/admin/transactions',
      ).replace(
        queryParameters: queryParameters,
      );

      final http.Response response =
          await http
              .get(
                uri,
                headers: {
                  'Accept': 'application/json',
                  'Authorization':
                      'Bearer ${token.trim()}',
                },
              )
              .timeout(
                const Duration(seconds: 30),
              );

      final dynamic decoded =
          decodeResponse(response.body);

      if (response.statusCode == 401) {
        throw Exception(
          extractMessage(
            decoded,
            fallback:
                'Your login session has expired.',
          ),
        );
      }

      if (response.statusCode == 403) {
        throw Exception(
          extractMessage(
            decoded,
            fallback:
                'You are not allowed to view transactions.',
          ),
        );
      }

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          extractMessage(
            decoded,
            fallback:
                'Unable to load transactions. Server error ${response.statusCode}.',
          ),
        );
      }

      final Map<String, dynamic> body =
          toMap(decoded);

      final Map<String, dynamic> data =
          toMap(body['data']);

      dynamic transactionList =
          data['transactions'] ??
          body['transactions'] ??
          data['items'] ??
          body['items'];

      if (transactionList is! List &&
          data['docs'] is List) {
        transactionList = data['docs'];
      }

      final Map<String, dynamic> pagination =
          toMap(
        data['pagination'] ??
            body['pagination'],
      );

      final int serverCurrentPage = toInt(
        pagination['currentPage'] ??
            pagination['page'] ??
            data['currentPage'] ??
            body['currentPage'] ??
            requestedPage,
      );

      final int serverTotalPages = toInt(
        pagination['totalPages'] ??
            pagination['pages'] ??
            data['totalPages'] ??
            body['totalPages'] ??
            1,
      );

      final int serverTotalTransactions =
          toInt(
        pagination['total'] ??
            pagination['totalItems'] ??
            data['total'] ??
            data['totalTransactions'] ??
            body['total'] ??
            body['totalTransactions'] ??
            (transactionList is List
                ? transactionList.length
                : 0),
      );

      if (!mounted) return;

      setState(() {
        transactions = transactionList is List
            ? List<dynamic>.from(
                transactionList,
              )
            : <dynamic>[];

        currentPage =
            serverCurrentPage <= 0
                ? requestedPage
                : serverCurrentPage;

        totalPages =
            serverTotalPages <= 0
                ? 1
                : serverTotalPages;

        totalTransactions =
            serverTotalTransactions;

        isLoading = false;
        isRefreshing = false;
        hasError = false;
      });
    } on TimeoutException {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        isRefreshing = false;
        hasError = true;
        errorMessage =
            'The request timed out. Check your internet connection and try again.';
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        isRefreshing = false;
        hasError = true;
        errorMessage = error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            )
            .trim();
      });
    }
  }

  void onSearchChanged(String value) {
    searchTimer?.cancel();

    searchTimer = Timer(
      const Duration(milliseconds: 700),
      () {
        currentPage = 1;
        loadTransactions(page: 1);
      },
    );
  }

  void clearFilters() {
    searchController.clear();

    setState(() {
      selectedStatus = 'ALL';
      selectedService = 'ALL';
      currentPage = 1;
    });

    loadTransactions(page: 1);
  }

  String formatMoney(double amount) {
    final String fixed =
        amount.toStringAsFixed(2);

    final List<String> parts =
        fixed.split('.');

    final String whole =
        parts.first.replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (_) => ',',
    );

    return '₦$whole.${parts.last}';
  }

  String formatDate(dynamic value) {
    final DateTime? date =
        DateTime.tryParse(
      value?.toString() ?? '',
    );

    if (date == null) {
      return 'Unknown date';
    }

    final DateTime localDate =
        date.toLocal();

    final String day =
        localDate.day
            .toString()
            .padLeft(2, '0');

    final String month =
        localDate.month
            .toString()
            .padLeft(2, '0');

    final String hour =
        localDate.hour
            .toString()
            .padLeft(2, '0');

    final String minute =
        localDate.minute
            .toString()
            .padLeft(2, '0');

    return '$day/$month/${localDate.year} '
        '$hour:$minute';
  }

  String formatText(dynamic value) {
    final String text =
        value?.toString().trim() ?? '';

    if (text.isEmpty) {
      return 'Not available';
    }

    return text
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .map(
          (String word) => word.isEmpty
              ? ''
              : '${word[0].toUpperCase()}'
                  '${word.substring(1)}',
        )
        .join(' ');
  }

  String transactionId(
    Map<String, dynamic> transaction,
  ) {
    return (
      transaction['_id'] ??
      transaction['id'] ??
      ''
    ).toString();
  }

  String transactionReference(
    Map<String, dynamic> transaction,
  ) {
    return (
      transaction['reference'] ??
      transaction['transactionReference'] ??
      transaction['paymentReference'] ??
      transaction['ref'] ??
      transactionId(transaction)
    ).toString();
  }

  Map<String, dynamic> transactionCustomer(
    Map<String, dynamic> transaction,
  ) {
    return toMap(
      transaction['customerId'] ??
          transaction['userId'] ??
          transaction['customer'] ??
          transaction['user'],
    );
  }

  String customerName(
    Map<String, dynamic> transaction,
  ) {
    final Map<String, dynamic> customer =
        transactionCustomer(transaction);

    final String name = (
      customer['fullName'] ??
      customer['name'] ??
      transaction['customerName'] ??
      transaction['userName'] ??
      'Unknown User'
    ).toString();

    return name.trim().isEmpty
        ? 'Unknown User'
        : name;
  }

  String customerPhone(
    Map<String, dynamic> transaction,
  ) {
    final Map<String, dynamic> customer =
        transactionCustomer(transaction);

    return (
      customer['phone'] ??
      transaction['phone'] ??
      transaction['customerPhone'] ??
      ''
    ).toString();
  }

  String customerEmail(
    Map<String, dynamic> transaction,
  ) {
    final Map<String, dynamic> customer =
        transactionCustomer(transaction);

    return (
      customer['email'] ??
      transaction['email'] ??
      transaction['customerEmail'] ??
      ''
    ).toString();
  }

  String transactionStatus(
    Map<String, dynamic> transaction,
  ) {
    return (
      transaction['status'] ??
      'PENDING'
    ).toString().toUpperCase();
  }

  String transactionService(
    Map<String, dynamic> transaction,
  ) {
    return (
      transaction['serviceType'] ??
      transaction['service'] ??
      transaction['type'] ??
      'TRANSACTION'
    ).toString().toUpperCase();
  }

  double transactionAmount(
    Map<String, dynamic> transaction,
  ) {
    return toDouble(
      transaction['amount'] ??
          transaction['value'] ??
          transaction['totalAmount'],
    );
  }

  Color statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'SUCCESS':
      case 'SUCCESSFUL':
      case 'COMPLETED':
      case 'APPROVED':
        return const Color(0xFF059669);

      case 'FAILED':
      case 'CANCELLED':
      case 'REJECTED':
        return const Color(0xFFDC2626);

      case 'REVERSED':
      case 'REFUNDED':
        return const Color(0xFF2563EB);

      default:
        return const Color(0xFFD97706);
    }
  }

  IconData serviceIcon(String service) {
    switch (service.toUpperCase()) {
      case 'AIRTIME':
        return Icons.phone_android_rounded;

      case 'DATA':
        return Icons.wifi_rounded;

      case 'CABLE':
        return Icons.tv_rounded;

      case 'ELECTRICITY':
        return Icons.electric_bolt_rounded;

      case 'EXAM_PIN':
        return Icons.school_rounded;

      case 'WALLET_FUNDING':
        return Icons
            .account_balance_wallet_rounded;

      case 'TRANSFER':
      case 'BANK_TRANSFER':
        return Icons.swap_horiz_rounded;

      case 'ID_VERIFICATION':
        return Icons.verified_user_rounded;

      case 'DELIVERY':
        return Icons.local_shipping_rounded;

      default:
        return Icons.receipt_long_rounded;
    }
  }

  Color serviceColor(String service) {
    switch (service.toUpperCase()) {
      case 'AIRTIME':
        return const Color(0xFF2563EB);

      case 'DATA':
        return const Color(0xFF7C3AED);

      case 'CABLE':
        return const Color(0xFFDB2777);

      case 'ELECTRICITY':
        return const Color(0xFFD97706);

      case 'WALLET_FUNDING':
        return const Color(0xFF059669);

      case 'TRANSFER':
      case 'BANK_TRANSFER':
        return const Color(0xFF0F766E);

      case 'ID_VERIFICATION':
        return const Color(0xFF4F46E5);

      case 'DELIVERY':
        return const Color(0xFFEA580C);

      default:
        return const Color(0xFF64748B);
    }
  }

  void showMessage(
    String message, {
    required bool isError,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError
              ? const Color(0xFFDC2626)
              : const Color(0xFF059669),
          behavior:
              SnackBarBehavior.floating,
        ),
      );
  }

  void showTransactionDetails(
    dynamic rawTransaction,
  ) {
    final Map<String, dynamic> transaction =
        toMap(rawTransaction);

    final String status =
        transactionStatus(transaction);

    final String service =
        transactionService(transaction);

    showDialog<void>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return Dialog(
          insetPadding:
              const EdgeInsets.all(20),
          shape: RoundedRectangleBorder(
            borderRadius:
                BorderRadius.circular(24),
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: 560,
            ),
            child: SingleChildScrollView(
              padding:
                  const EdgeInsets.all(22),
              child: Column(
                mainAxisSize:
                    MainAxisSize.min,
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(
                          color:
                              serviceColor(service)
                                  .withValues(
                            alpha: 0.12,
                          ),
                          borderRadius:
                              BorderRadius.circular(
                            16,
                          ),
                        ),
                        child: Icon(
                          serviceIcon(service),
                          color:
                              serviceColor(service),
                        ),
                      ),
                      const SizedBox(width: 13),
                      Expanded(
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment
                                  .start,
                          children: [
                            Text(
                              formatText(service),
                              style:
                                  const TextStyle(
                                fontSize: 18,
                                fontWeight:
                                    FontWeight
                                        .w900,
                              ),
                            ),
                            const SizedBox(
                              height: 4,
                            ),
                            Text(
                              customerName(
                                transaction,
                              ),
                              style:
                                  const TextStyle(
                                color: Color(
                                  0xFF64748B,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: () {
                          Navigator.pop(
                            dialogContext,
                          );
                        },
                        icon: const Icon(
                          Icons.close_rounded,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  Text(
                    formatMoney(
                      transactionAmount(
                        transaction,
                      ),
                    ),
                    style: const TextStyle(
                      color: Color(0xFF0F766E),
                      fontSize: 28,
                      fontWeight:
                          FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 18),
                  detailRow(
                    'Status',
                    formatText(status),
                    valueColor:
                        statusColor(status),
                  ),
                  detailRow(
                    'Reference',
                    transactionReference(
                      transaction,
                    ),
                  ),
                  detailRow(
                    'Customer',
                    customerName(transaction),
                  ),
                  detailRow(
                    'Phone',
                    customerPhone(transaction),
                  ),
                  detailRow(
                    'Email',
                    customerEmail(transaction),
                  ),
                  detailRow(
                    'Service',
                    formatText(service),
                  ),
                  detailRow(
                    'Description',
                    (
                      transaction['description'] ??
                      transaction['narration'] ??
                      ''
                    ).toString(),
                  ),
                  detailRow(
                    'Created',
                    formatDate(
                      transaction['createdAt'],
                    ),
                  ),
                  detailRow(
                    'Updated',
                    formatDate(
                      transaction['updatedAt'],
                    ),
                  ),
                  detailRow(
                    'Transaction ID',
                    transactionId(transaction),
                  ),
                  const SizedBox(height: 18),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () {
                        Navigator.pop(
                          dialogContext,
                        );
                      },
                      style:
                          FilledButton.styleFrom(
                        backgroundColor:
                            const Color(
                          0xFF0F766E,
                        ),
                        padding:
                            const EdgeInsets
                                .symmetric(
                          vertical: 14,
                        ),
                      ),
                      child:
                          const Text('Close'),
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

  Widget detailRow(
    String label,
    String value, {
    Color? valueColor,
  }) {
    if (value.trim().isEmpty ||
        value == 'Unknown date') {
      return const SizedBox.shrink();
    }

    return Padding(
      padding:
          const EdgeInsets.only(bottom: 13),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 115,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF94A3B8),
                fontSize: 12,
                fontWeight:
                    FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: TextStyle(
                color: valueColor ??
                    const Color(
                      0xFF334155,
                    ),
                fontSize: 13,
                fontWeight:
                    FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget buildFilters() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        children: [
          TextField(
            controller: searchController,
            onChanged: onSearchChanged,
            decoration: InputDecoration(
              hintText:
                  'Search customer, phone or reference',
              prefixIcon: const Icon(
                Icons.search_rounded,
              ),
              suffixIcon:
                  searchController.text.isEmpty
                      ? null
                      : IconButton(
                          onPressed: () {
                            searchController
                                .clear();

                            setState(() {});

                            loadTransactions(
                              page: 1,
                            );
                          },
                          icon: const Icon(
                            Icons.close_rounded,
                          ),
                        ),
              filled: true,
              fillColor:
                  const Color(0xFFF8FAFC),
              border: OutlineInputBorder(
                borderRadius:
                    BorderRadius.circular(15),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 14),
          LayoutBuilder(
            builder: (
              BuildContext context,
              BoxConstraints constraints,
            ) {
              final bool compact =
                  constraints.maxWidth < 600;

              final Widget statusDropdown =
                  DropdownButtonFormField<
                      String>(
                value: selectedStatus,
                decoration: InputDecoration(
                  labelText: 'Status',
                  border: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(
                      14,
                    ),
                  ),
                ),
                items: statuses
                    .map(
                      (String status) =>
                          DropdownMenuItem<
                              String>(
                        value: status,
                        child: Text(
                          formatText(status),
                        ),
                      ),
                    )
                    .toList(),
                onChanged: (String? value) {
                  if (value == null) return;

                  setState(() {
                    selectedStatus = value;
                    currentPage = 1;
                  });

                  loadTransactions(page: 1);
                },
              );

              final Widget serviceDropdown =
                  DropdownButtonFormField<
                      String>(
                value: selectedService,
                decoration: InputDecoration(
                  labelText: 'Service',
                  border: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(
                      14,
                    ),
                  ),
                ),
                items: services
                    .map(
                      (String service) =>
                          DropdownMenuItem<
                              String>(
                        value: service,
                        child: Text(
                          formatText(service),
                        ),
                      ),
                    )
                    .toList(),
                onChanged: (String? value) {
                  if (value == null) return;

                  setState(() {
                    selectedService = value;
                    currentPage = 1;
                  });

                  loadTransactions(page: 1);
                },
              );

              if (compact) {
                return Column(
                  children: [
                    statusDropdown,
                    const SizedBox(height: 12),
                    serviceDropdown,
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child:
                          OutlinedButton.icon(
                        onPressed: clearFilters,
                        icon: const Icon(
                          Icons
                              .filter_alt_off_rounded,
                        ),
                        label: const Text(
                          'Clear Filters',
                        ),
                      ),
                    ),
                  ],
                );
              }

              return Row(
                children: [
                  Expanded(
                    child: statusDropdown,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: serviceDropdown,
                  ),
                  const SizedBox(width: 12),
                  OutlinedButton.icon(
                    onPressed: clearFilters,
                    icon: const Icon(
                      Icons
                          .filter_alt_off_rounded,
                    ),
                    label: const Text(
                      'Clear',
                    ),
                    style:
                        OutlinedButton.styleFrom(
                      padding:
                          const EdgeInsets
                              .symmetric(
                        horizontal: 18,
                        vertical: 18,
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget buildTransactionCard(
    dynamic rawTransaction,
  ) {
    final Map<String, dynamic> transaction =
        toMap(rawTransaction);

    final String service =
        transactionService(transaction);

    final String status =
        transactionStatus(transaction);

    final Color currentServiceColor =
        serviceColor(service);

    return Material(
      color: Colors.white,
      borderRadius:
          BorderRadius.circular(20),
      child: InkWell(
        onTap: () =>
            showTransactionDetails(
          transaction,
        ),
        borderRadius:
            BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(17),
          decoration: BoxDecoration(
            borderRadius:
                BorderRadius.circular(20),
            border: Border.all(
              color:
                  const Color(0xFFE8EDF3),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black
                    .withValues(alpha: 0.025),
                blurRadius: 12,
                offset:
                    const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              Container(
                width: 49,
                height: 49,
                decoration: BoxDecoration(
                  color: currentServiceColor
                      .withValues(alpha: 0.11),
                  borderRadius:
                      BorderRadius.circular(15),
                ),
                child: Icon(
                  serviceIcon(service),
                  color: currentServiceColor,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            formatText(service),
                            maxLines: 1,
                            overflow:
                                TextOverflow
                                    .ellipsis,
                            style:
                                const TextStyle(
                              color: Color(
                                0xFF0F172A,
                              ),
                              fontSize: 15,
                              fontWeight:
                                  FontWeight
                                      .w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding:
                              const EdgeInsets
                                  .symmetric(
                            horizontal: 9,
                            vertical: 5,
                          ),
                          decoration:
                              BoxDecoration(
                            color:
                                statusColor(
                              status,
                            ).withValues(
                              alpha: 0.10,
                            ),
                            borderRadius:
                                BorderRadius
                                    .circular(
                              20,
                            ),
                          ),
                          child: Text(
                            status,
                            style:
                                TextStyle(
                              color:
                                  statusColor(
                                status,
                              ),
                              fontSize: 9,
                              fontWeight:
                                  FontWeight
                                      .w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      customerName(transaction),
                      maxLines: 1,
                      overflow:
                          TextOverflow.ellipsis,
                      style: const TextStyle(
                        color:
                            Color(0xFF475569),
                        fontSize: 13,
                        fontWeight:
                            FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      transactionReference(
                        transaction,
                      ),
                      maxLines: 1,
                      overflow:
                          TextOverflow.ellipsis,
                      style: const TextStyle(
                        color:
                            Color(0xFF94A3B8),
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            formatDate(
                              transaction[
                                  'createdAt'],
                            ),
                            style:
                                const TextStyle(
                              color: Color(
                                0xFF94A3B8,
                              ),
                              fontSize: 11,
                            ),
                          ),
                        ),
                        Text(
                          formatMoney(
                            transactionAmount(
                              transaction,
                            ),
                          ),
                          style:
                              const TextStyle(
                            color:
                                Color(
                              0xFF0F766E,
                            ),
                            fontSize: 15,
                            fontWeight:
                                FontWeight
                                    .w900,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget buildPagination() {
    if (totalPages <= 1) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Row(
        mainAxisAlignment:
            MainAxisAlignment.center,
        children: [
          IconButton(
            tooltip: 'Previous page',
            onPressed: currentPage > 1
                ? () {
                    loadTransactions(
                      page: currentPage - 1,
                    );
                  }
                : null,
            icon: const Icon(
              Icons.chevron_left_rounded,
            ),
          ),
          const SizedBox(width: 10),
          Text(
            'Page $currentPage of $totalPages',
            style: const TextStyle(
              color: Color(0xFF334155),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(width: 10),
          IconButton(
            tooltip: 'Next page',
            onPressed:
                currentPage < totalPages
                    ? () {
                        loadTransactions(
                          page:
                              currentPage +
                                  1,
                        );
                      }
                    : null,
            icon: const Icon(
              Icons.chevron_right_rounded,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildErrorState() {
    return ListView(
      physics:
          const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 80),
        Icon(
          Icons.cloud_off_rounded,
          size: 68,
          color: Colors.red.shade300,
        ),
        const SizedBox(height: 18),
        const Text(
          'Unable to load transactions',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 9),
        Text(
          errorMessage,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Color(0xFF64748B),
            height: 1.5,
          ),
        ),
        const SizedBox(height: 22),
        Center(
          child: FilledButton.icon(
            onPressed: () =>
                loadTransactions(page: 1),
            icon: const Icon(
              Icons.refresh_rounded,
            ),
            label:
                const Text('Try Again'),
            style: FilledButton.styleFrom(
              backgroundColor:
                  const Color(0xFF0F766E),
            ),
          ),
        ),
      ],
    );
  }

  Widget buildEmptyState() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 25,
        vertical: 45,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE8EDF3),
        ),
      ),
      child: const Column(
        children: [
          Icon(
            Icons.receipt_long_outlined,
            color: Color(0xFF94A3B8),
            size: 55,
          ),
          SizedBox(height: 15),
          Text(
            'No transactions found',
            style: TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
          SizedBox(height: 7),
          Text(
            'Try changing the search or filters.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF64748B),
            ),
          ),
        ],
      ),
    );
  }

  Widget buildTransactionsBody() {
    return LayoutBuilder(
      builder: (
        BuildContext context,
        BoxConstraints constraints,
      ) {
        final double horizontalPadding =
            constraints.maxWidth >= 800
                ? 28
                : 16;

        return RefreshIndicator(
          color: const Color(0xFF0F766E),
          onRefresh: () =>
              loadTransactions(
            refresh: true,
            page: currentPage,
          ),
          child: ListView(
            physics:
                const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.fromLTRB(
              horizontalPadding,
              16,
              horizontalPadding,
              30,
            ),
            children: [
              Center(
                child: ConstrainedBox(
                  constraints:
                      const BoxConstraints(
                    maxWidth: 950,
                  ),
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      buildFilters(),
                      const SizedBox(height: 22),
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'All Transactions',
                              style: TextStyle(
                                color: Color(
                                  0xFF0F172A,
                                ),
                                fontSize: 20,
                                fontWeight:
                                    FontWeight
                                        .w900,
                              ),
                            ),
                          ),
                          Text(
                            '$totalTransactions total',
                            style:
                                const TextStyle(
                              color: Color(
                                0xFF64748B,
                              ),
                              fontSize: 12,
                              fontWeight:
                                  FontWeight
                                      .w600,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 13),
                      if (transactions.isEmpty)
                        buildEmptyState()
                      else
                        ...transactions.map(
                          (dynamic transaction) =>
                              Padding(
                            padding:
                                const EdgeInsets
                                    .only(
                              bottom: 13,
                            ),
                            child:
                                buildTransactionCard(
                              transaction,
                            ),
                          ),
                        ),
                      const SizedBox(height: 8),
                      buildPagination(),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor:
            const Color(0xFF0F766E),
        foregroundColor: Colors.white,
        surfaceTintColor:
            Colors.transparent,
        elevation: 0,
        title: const Text(
          'Admin Transactions',
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
                      refresh: true,
                      page: currentPage,
                    );
                  },
            icon: isRefreshing
                ? const SizedBox(
                    width: 21,
                    height: 21,
                    child:
                        CircularProgressIndicator(
                      strokeWidth: 2.2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(
                    Icons.refresh_rounded,
                  ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: isLoading
          ? const Center(
              child:
                  CircularProgressIndicator(
                color: Color(0xFF0F766E),
              ),
            )
          : hasError
              ? RefreshIndicator(
                  onRefresh: () =>
                      loadTransactions(
                    refresh: true,
                    page: 1,
                  ),
                  child:
                      buildErrorState(),
                )
              : buildTransactionsBody(),
    );
  }
}