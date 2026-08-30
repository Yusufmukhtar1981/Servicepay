import 'package:flutter/material.dart';

bool transactionDateMatchesRange({
  required DateTime? date,
  required String range,
  required DateTime now,
  DateTimeRange? customRange,
}) {
  if (range == 'ALL_TIME') return true;
  if (date == null) return false;
  final DateTime today = DateTime(now.year, now.month, now.day);
  if (range == 'CUSTOM') {
    if (customRange == null) return true;
    final DateTime start = DateTime(
      customRange.start.year,
      customRange.start.month,
      customRange.start.day,
    );
    final DateTime end = DateTime(
      customRange.end.year,
      customRange.end.month,
      customRange.end.day,
      23,
      59,
      59,
      999,
      999,
    );
    return !date.isBefore(start) && !date.isAfter(end);
  }
  if (range == 'TODAY') return !date.isBefore(today);
  final int days = range == 'LAST_7_DAYS' ? 7 : 30;
  return !date.isBefore(today.subtract(Duration(days: days - 1)));
}

/// Converts the varied transaction payloads returned by the existing history
/// endpoint into one safe, display-only representation.
class TransactionPresentation {
  final Map<String, dynamic> raw;

  const TransactionPresentation(this.raw);

  static const statuses = <String>[
    'PROCESSING',
    'PENDING',
    'SUCCESSFUL',
    'FAILED',
    'REVERSED',
  ];

  static const _statusAliases = <String, String>{
    'PROCESSING': 'PROCESSING',
    'IN_PROGRESS': 'PROCESSING',
    'IN PROGRESS': 'PROCESSING',
    'PENDING': 'PENDING',
    'SUCCESSFUL': 'SUCCESSFUL',
    'SUCCESS': 'SUCCESSFUL',
    'COMPLETED': 'SUCCESSFUL',
    'PAID': 'SUCCESSFUL',
    'FAILED': 'FAILED',
    'FAIL': 'FAILED',
    'DECLINED': 'FAILED',
    'CANCELLED': 'FAILED',
    'REJECTED': 'FAILED',
    'REVERSED': 'REVERSED',
    'REFUNDED': 'REVERSED',
    'REVERSAL': 'REVERSED',
  };

  /// Unknown provider values are deliberately processing, never successful.
  String get status {
    final value = _first(raw, const ['status', 'paymentStatus']);
    return _statusAliases[value.toString().trim().toUpperCase()] ??
        'PROCESSING';
  }

  String get title => _title(
        _first(raw, const [
          'serviceType',
          'type',
          'transactionType',
          'category'
        ]).toString(),
      );

  String get reference => _first(raw, const [
        'reference',
        'transactionReference',
        'transactionId',
        '_id'
      ]).toString().trim();

  String get id => _first(raw, const ['id', '_id', 'reference']).toString();

  String get lookupId => _first(raw, const ['id', '_id']).toString().trim();

  String get source =>
      _first(raw, const ['source']).toString().trim().toUpperCase();

  String get sourceId =>
      _first(raw, const ['sourceId', '_id']).toString().trim();

  String get provider => _firstDeep(const ['provider']).toString().trim();

  String get recipient => _firstDeep(const [
        'recipientName',
        'recipient',
        'counterparty',
        'accountName',
        'recipientPhone',
        'phone',
      ]).toString().trim();

  String get description => _first(raw, const [
        'description',
        'narration',
        'message',
        'counterparty',
        'recipientName',
        'recipientPhone',
        'phone',
      ]).toString().trim();

  double get amount {
    final value = _first(raw, const ['amount', 'totalAmount', 'value']);
    if (value is num) return value.toDouble();
    return double.tryParse(
            value.toString().replaceAll(RegExp(r'[₦,\s]'), '')) ??
        0;
  }

  double? get fee => _number(_first(raw, const ['fee']));

  double? get total =>
      _number(_first(raw, const ['totalAmount', 'total', 'amountCharged']));

  DateTime? get date => _date(_first(raw, const [
        'createdAt',
        'date',
        'transactionDate',
        'updatedAt',
      ]));

  String get direction {
    final value = _first(raw, const ['direction']).toString().toUpperCase();
    if (value == 'CREDIT' || value == 'DEBIT') return value;
    final upperTitle = title.toUpperCase();
    return upperTitle.contains('FUNDING') ||
            upperTitle.contains('REFUND') ||
            upperTitle.contains('REVERSAL') ||
            upperTitle.contains('BONUS')
        ? 'CREDIT'
        : 'DEBIT';
  }

  bool get isBankTransfer =>
      _first(raw, const ['serviceType', 'type']).toString().toUpperCase() ==
      'BANK_TRANSFER';

  bool get canRequery =>
      isBankTransfer &&
      (status == 'PENDING' || status == 'PROCESSING') &&
      reference.isNotEmpty;

  Iterable<MapEntry<String, String>> get details sync* {
    for (final entry in const <String, List<String>>{
      'Recipient': [
        'recipientName',
        'recipient',
        'counterparty',
        'accountName'
      ],
      'Phone number': ['recipientPhone', 'phone'],
      'Bank': ['bankName'],
      'Account number': ['accountNumber'],
      'Narration': ['narration', 'description'],
      'Provider': ['provider'],
      'Provider reference': ['providerReference', 'nipTransactionReference'],
    }.entries) {
      final value = _firstDeep(entry.value).toString().trim();
      if (value.isNotEmpty) yield MapEntry(entry.key, value);
    }
    if (fee != null) {
      yield MapEntry('Fee', '₦${fee!.toStringAsFixed(2)}');
    }
    if (total != null) {
      yield MapEntry('Total', '₦${total!.toStringAsFixed(2)}');
    }
  }

  bool matchesSearch(String query) {
    final needle = query.trim().toLowerCase();
    if (needle.isEmpty) return true;
    return _searchValues().join(' ').toLowerCase().contains(needle);
  }

  Iterable<String> _searchValues() sync* {
    yield title;
    yield reference;
    yield description;
    yield status;
    if (fee != null) yield fee.toString();
    if (total != null) yield total.toString();
    for (final key in const [
      'recipient',
      'recipientName',
      'recipientPhone',
      'phone',
      'accountNumber',
      'accountName',
      'bankName',
      'serviceType',
      'type',
    ]) {
      yield _firstDeep([key]).toString();
    }
  }

  dynamic _firstDeep(List<String> keys) {
    final direct = _first(raw, keys);
    if (direct != null && direct.toString().trim().isNotEmpty) return direct;
    final provider = raw['providerResponse'];
    if (provider is Map) {
      final dynamic value = _first(Map<String, dynamic>.from(provider), keys);
      if (value != null && value.toString().trim().isNotEmpty) return value;
    }
    final dynamic metadata = raw['metadata'];
    if (metadata is Map) {
      final Map<String, dynamic> metadataMap =
          Map<String, dynamic>.from(metadata);
      final dynamic direct = _first(metadataMap, keys);
      if (direct != null && direct.toString().trim().isNotEmpty) return direct;
      final dynamic nestedProvider = metadataMap['providerResponse'];
      if (nestedProvider is Map) {
        return _first(Map<String, dynamic>.from(nestedProvider), keys);
      }
    }
    return null;
  }

  static double? _number(dynamic value) {
    if (value == null || value.toString().trim().isEmpty) return null;
    if (value is num) return value.toDouble();
    return double.tryParse(
      value.toString().replaceAll(RegExp(r'[₦,\s]'), ''),
    );
  }

  static dynamic _first(Map<String, dynamic> values, List<String> keys) {
    for (final key in keys) {
      final value = values[key];
      if (value != null) return value;
    }
    return '';
  }

  static DateTime? _date(dynamic value) =>
      value == null ? null : DateTime.tryParse(value.toString())?.toLocal();

  static String _title(String value) {
    final words =
        value.replaceAll(RegExp('[_-]'), ' ').trim().toLowerCase().split(' ');
    final cleaned = words.where((word) => word.isNotEmpty).toList();
    if (cleaned.isEmpty) return 'Transaction';
    return cleaned
        .map((word) => '${word[0].toUpperCase()}${word.substring(1)}')
        .join(' ');
  }

  static Color statusColor(String status) {
    switch (status) {
      case 'SUCCESSFUL':
        return const Color(0xFF15803D);
      case 'FAILED':
      case 'REVERSED':
        return const Color(0xFFB91C1C);
      case 'PROCESSING':
        return const Color(0xFF2563EB);
      default:
        return const Color(0xFFD97706);
    }
  }
}
