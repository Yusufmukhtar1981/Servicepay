import 'dart:convert';
import 'package:http/http.dart' as http;
import '../customer_transaction_insights.dart';
import '../transaction_presentation.dart';
import 'api_service.dart';
import 'session_store.dart';

/// Uses the existing authenticated history endpoint, never a provider endpoint.
/// No persisted or cross-customer analytics cache and no write methods.
class CustomerInsightsService {
  CustomerInsightsService({
    http.Client? client,
    Future<String?> Function()? readToken,
    DateTime Function()? clock,
    this.maxPages = 100,
    this.loadBudget = const Duration(seconds: 25),
  })  : _client = client,
        _readToken = readToken ?? SessionStore.readToken,
        _clock = clock ?? DateTime.now;

  final http.Client? _client;
  final Future<String?> Function() _readToken;
  final DateTime Function() _clock;
  final int maxPages;
  final Duration loadBudget;

  Future<CustomerTransactionInsights> load(
      CustomerInsightsPeriod period) async {
    final token = (await _readToken())?.trim() ?? '';
    if (token.isEmpty) {
      throw StateError('Sign in to view your transaction insights.');
    }
    final window = InsightsWindow.at(period, _clock());
    final rows = <Map<String, dynamic>>[];
    final cursors = <String>{};
    String? cursor;
    DateTime? lastDate;
    final client = _client ?? http.Client();
    final elapsed = Stopwatch()..start();
    try {
      for (var page = 0; page < maxPages; page++) {
        final remaining = loadBudget - elapsed.elapsed;
        if (remaining <= Duration.zero) {
          throw StateError('The complete history could not be loaded in time. '
              'No partial totals are shown. Please retry.');
        }
        if ((await _readToken())?.trim() != token) {
          throw StateError(
              'Your session changed. Please refresh your insights.');
        }
        final uri = Uri.parse('${ApiService.baseUrl}/transactions').replace(
            queryParameters: {
              'limit': '50',
              if (cursor != null) 'before': cursor
            });
        final response = await client.get(uri, headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        }).timeout(remaining < const Duration(seconds: 20)
            ? remaining
            : const Duration(seconds: 20));
        if ((await _readToken())?.trim() != token) {
          throw StateError(
              'Your session changed. Please refresh your insights.');
        }
        if (response.statusCode == 401 || response.statusCode == 403) {
          throw StateError(
              'Your login session has expired. Please sign in again.');
        }
        if (response.statusCode != 200) {
          throw StateError(
              'Transaction insights could not be loaded. Please retry.');
        }
        final decoded = jsonDecode(response.body);
        if (decoded is! Map || decoded['success'] != true) {
          throw const FormatException('Invalid transaction history response.');
        }
        final data = decoded['data'] is Map ? decoded['data'] as Map : decoded;
        final rawRows = data['transactions'];
        final pagination = data['pagination'];
        if (rawRows is! List ||
            pagination is! Map ||
            pagination['hasMore'] is! bool) {
          throw const FormatException(
              'Incomplete transaction history response.');
        }
        for (final raw in rawRows) {
          if (raw is! Map) {
            throw const FormatException('Invalid transaction history record.');
          }
          final row = Map<String, dynamic>.from(raw);
          final date = TransactionPresentation(row).date;
          if (date == null || (lastDate != null && date.isAfter(lastDate))) {
            throw const FormatException('Transaction history is not ordered.');
          }
          lastDate = date;
          // Do not retain raw provider payloads while collecting many pages.
          // The projection needs only customer history identifiers and facts.
          final metadata = row['metadata'];
          final provider =
              metadata is Map ? metadata['providerResponse'] : null;
          rows.add({
            for (final key in const [
              'id',
              '_id',
              'source',
              'sourceId',
              'reference',
              'transactionReference',
              'transactionId',
              'serviceType',
              'type',
              'transactionType',
              'category',
              'status',
              'paymentStatus',
              'amount',
              'totalAmount',
              'value',
              'createdAt',
              'date',
              'transactionDate',
              'updatedAt',
              'customerReasonCode',
              'failureCode',
              'errorCode',
              'reversalOf',
              'direction',
            ])
              if (row.containsKey(key)) key: row[key],
            if (metadata is Map)
              'metadata': {
                if (metadata['manualRefund'] == true) 'manualRefund': true,
                if (provider is Map)
                  'providerResponse': {
                    for (final key in const [
                      'customerReasonCode',
                      'failureCode',
                      'errorCode',
                      'code',
                    ])
                      if (provider.containsKey(key)) key: provider[key],
                  },
              },
          });
        }
        // The existing API is newest-first. A completed boundary page proves
        // coverage of both periods; no lifetime-history download is needed.
        if (pagination['hasMore'] == false ||
            (lastDate != null && lastDate.isBefore(window.previousStart))) {
          return CustomerTransactionInsights.fromRows(rows, window);
        }
        final next = pagination['nextCursor']?.toString().trim() ?? '';
        if (rawRows.isEmpty || next.isEmpty || !cursors.add(next)) {
          throw const FormatException(
              'Transaction pagination did not advance.');
        }
        cursor = next;
      }
      // Never present a sampled/partial history as a complete total.
      throw StateError(
          'This history needs more pages than can be loaded safely. '
          'No partial totals are shown. Please use Transaction History.');
    } finally {
      elapsed.stop();
      if (_client == null) client.close();
    }
  }
}
