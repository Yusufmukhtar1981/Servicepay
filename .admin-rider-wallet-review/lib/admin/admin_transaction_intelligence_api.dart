import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_transaction_intelligence_models.dart';
import 'admin_transaction_intelligence_csv_stub.dart'
    if (dart.library.html) 'admin_transaction_intelligence_csv_web.dart'
    as csv;

/// Protected, display-only client for the transaction intelligence API.
class AdminTransactionIntelligenceApi {
  static const String _baseUrl =
      'https://api.servicepay.ng/api/admin/transaction-intelligence';
  static const Duration _timeout = Duration(seconds: 30);

  static Future<TransactionIntelligenceSummary> summary({String? date}) async =>
      TransactionIntelligenceSummary.fromJson(
        await _json(
          'summary',
          query: <String, String>{if (date != null) 'date': date},
        ),
      );

  static Future<TransactionSearchResult> transactions(
    TransactionFilters filters, {
    int page = 1,
  }) async => TransactionSearchResult.fromJson(
    await _json(
      'transactions',
      query: <String, String>{...filters.query, 'page': '$page', 'limit': '25'},
    ),
  );

  static Future<ReconciliationQueue> queue(
    TransactionFilters filters, {
    String? cursor,
  }) async => ReconciliationQueue.fromJson(
    await _json(
      'queue',
      query: <String, String>{
        ...filters.query,
        'limit': '25',
        if (cursor != null) 'cursor': cursor,
      },
    ),
  );

  static Future<List<ProviderHealth>> providers() async {
    final Map<String, dynamic> body = await _json(
      'providers',
      query: const <String, String>{'days': '7'},
    );
    return (body['providers'] as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map(
          (Map value) =>
              ProviderHealth.fromJson(Map<String, dynamic>.from(value)),
        )
        .toList();
  }

  static Future<List<TransactionAlert>> alerts() async {
    final Map<String, dynamic> body = await _json('alerts');
    final dynamic rows =
        body['alerts'] ?? body['transactions'] ?? body['items'];
    return (rows as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map(
          (Map value) =>
              TransactionAlert.fromJson(Map<String, dynamic>.from(value)),
        )
        .toList();
  }

  static Future<TransactionDetail> detail(String id) async =>
      TransactionDetail.fromJson(
        await _json('transactions/${Uri.encodeComponent(id)}'),
      );

  static Future<List<TimelineEvent>> timeline(String id) async {
    final Map<String, dynamic> body = await _json(
      'transactions/${Uri.encodeComponent(id)}/timeline',
    );
    return (body['events'] as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map(
          (Map value) =>
              TimelineEvent.fromJson(Map<String, dynamic>.from(value)),
        )
        .toList();
  }

  static Future<void> requery(String id) async {
    final String key =
        '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 31)}';
    await _json(
      'transactions/${Uri.encodeComponent(id)}/requery',
      method: 'POST',
      headers: <String, String>{'Idempotency-Key': key},
    );
  }

  static Future<void> exportCsv(TransactionFilters filters) async {
    final http.Response response = await _request(
      'POST',
      'export.csv',
      query: filters.query,
      headers: const <String, String>{'Accept': 'text/csv'},
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(_message(response));
    }
    csv.download(
      response.body,
      'servicepay-transactions-${DateTime.now().toIso8601String().substring(0, 10)}.csv',
    );
  }

  static Future<Map<String, dynamic>> _json(
    String path, {
    String method = 'GET',
    Map<String, String>? query,
    Map<String, String>? headers,
  }) async {
    final http.Response response = await _request(
      method,
      path,
      query: query,
      headers: headers,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(_message(response));
    }
    final dynamic decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      throw Exception('The intelligence service returned an invalid response.');
    }
    return Map<String, dynamic>.from(decoded);
  }

  static Future<http.Response> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, String>? headers,
  }) async {
    final Uri uri = Uri.parse(
      '$_baseUrl/$path',
    ).replace(queryParameters: query);
    final http.Response response = method == 'POST'
        ? await http
              .post(uri, headers: await _headers(headers))
              .timeout(_timeout)
        : await http
              .get(uri, headers: await _headers(headers))
              .timeout(_timeout);
    return response;
  }

  static Future<Map<String, String>> _headers(
    Map<String, String>? extra,
  ) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    String token = '';
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      token = prefs.getString(key)?.trim() ?? '';
      if (token.isNotEmpty) {
        break;
      }
    }
    if (token.toLowerCase().startsWith('bearer ')) {
      token = token.substring(7);
    }
    if (token.isEmpty) {
      throw Exception(
        'Your login session was not found. Please sign in again.',
      );
    }
    return <String, String>{
      'Authorization': 'Bearer $token',
      'Accept': 'application/json',
      ...?extra,
    };
  }

  static String _message(http.Response response) {
    try {
      final dynamic body = jsonDecode(response.body);
      if (body is Map && body['message'] != null) {
        return body['message'].toString();
      }
    } catch (_) {}
    return response.statusCode == 403
        ? 'Your account is not authorized for this operation.'
        : 'Unable to complete this request.';
  }
}
