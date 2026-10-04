import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../services/session_store.dart';

class CounterApiException implements Exception {
  const CounterApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

abstract class BranchCounterApi {
  Future<Map<String, dynamic>> loadConfig();
  Future<Map<String, dynamic>> listOrders({
    required String status,
    required String search,
    required int page,
  });
  Future<Map<String, dynamic>> quote(Map<String, dynamic> draft);
  Future<Map<String, dynamic>> createOrder(
    Map<String, dynamic> draft, {
    required String quoteToken,
    required String idempotencyKey,
  });
  Future<Map<String, dynamic>> getOrder(String kind, String id);
  Future<Map<String, dynamic>> submitPaymentEvidence(
    String kind,
    String id, {
    required String reference,
    required String note,
  });
  Future<Map<String, dynamic>> confirmPayment(
    String kind,
    String id, {
    required String reference,
    required String note,
  });
  Future<Map<String, dynamic>> cancelOrder(String kind, String id);
  Future<Map<String, dynamic>> getReceipt(
    String kind,
    String id, {
    required String layout,
  });
  Future<void> recordPrintEvent(
    String kind,
    String id, {
    required bool reprint,
    required String layout,
  });
}

class BranchCounterHttpApi implements BranchCounterApi {
  BranchCounterHttpApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    this.tokenReader = SessionStore.readToken,
    this.requestTimeout = const Duration(seconds: 35),
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final Future<String?> Function() tokenReader;
  final Duration requestTimeout;

  String get _root {
    final String value = baseUrl.replaceFirst(RegExp(r'/+$'), '');
    return value.endsWith('/api') ? value : '$value/api';
  }

  Future<Map<String, String>> _headers({String? idempotencyKey}) async {
    final String token = (await tokenReader() ?? '').trim();
    if (token.isEmpty) {
      throw const CounterApiException(
          'Your session has expired. Sign in again.');
    }
    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
    };
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
    String? idempotencyKey,
    bool acceptJson = true,
  }) async {
    final Uri uri = Uri.parse('$_root/branches/counter-deliveries$path')
        .replace(queryParameters: query);
    final Map<String, String> headers =
        await _headers(idempotencyKey: idempotencyKey);
    if (acceptJson) headers['Accept'] = 'application/json';
    late final http.Response response;
    switch (method) {
      case 'GET':
        response =
            await _client.get(uri, headers: headers).timeout(requestTimeout);
        break;
      case 'POST':
        response = await _client
            .post(uri,
                headers: headers, body: jsonEncode(body ?? <String, dynamic>{}))
            .timeout(requestTimeout);
        break;
      default:
        throw ArgumentError.value(method, 'method');
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final Map<String, dynamic> data = _map(decoded);
      throw CounterApiException(
        '${data['message'] ?? data['error'] ?? 'Request failed. Please retry.'}',
        statusCode: response.statusCode,
      );
    }
    final Map<String, dynamic> data = _map(decoded);
    if (data['success'] == false) {
      throw CounterApiException(
          '${data['message'] ?? 'Request was not completed.'}');
    }
    return data;
  }

  static Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  @override
  Future<Map<String, dynamic>> loadConfig() => _request('GET', '/config');

  @override
  Future<Map<String, dynamic>> listOrders({
    required String status,
    required String search,
    required int page,
  }) =>
      _request('GET', '/', query: <String, String>{
        'status': status,
        'search': search,
        'page': '$page',
      });

  @override
  Future<Map<String, dynamic>> quote(Map<String, dynamic> draft) =>
      _request('POST', '/quote', body: draft);

  @override
  Future<Map<String, dynamic>> createOrder(
    Map<String, dynamic> draft, {
    required String quoteToken,
    required String idempotencyKey,
  }) =>
      _request(
        'POST',
        '/',
        body: <String, dynamic>{...draft, 'quoteToken': quoteToken},
        idempotencyKey: idempotencyKey,
      );

  String _orderPath(String kind, String id) =>
      '/${Uri.encodeComponent(kind)}/${Uri.encodeComponent(id)}';

  @override
  Future<Map<String, dynamic>> getOrder(String kind, String id) =>
      _request('GET', _orderPath(kind, id));

  @override
  Future<Map<String, dynamic>> submitPaymentEvidence(
    String kind,
    String id, {
    required String reference,
    required String note,
  }) =>
      _request('POST', '${_orderPath(kind, id)}/payment-evidence',
          body: <String, dynamic>{'reference': reference, 'note': note});

  @override
  Future<Map<String, dynamic>> confirmPayment(
    String kind,
    String id, {
    required String reference,
    required String note,
  }) =>
      _request('POST', '${_orderPath(kind, id)}/confirm-payment',
          body: <String, dynamic>{
            'confirmed': true,
            'reference': reference,
            'note': note,
          });

  @override
  Future<Map<String, dynamic>> cancelOrder(String kind, String id) =>
      _request('POST', '${_orderPath(kind, id)}/cancel');

  @override
  Future<Map<String, dynamic>> getReceipt(
    String kind,
    String id, {
    required String layout,
  }) =>
      _request('GET', '${_orderPath(kind, id)}/receipt',
          query: <String, String>{'layout': layout});

  @override
  Future<void> recordPrintEvent(
    String kind,
    String id, {
    required bool reprint,
    required String layout,
  }) async {
    await _request('POST', '${_orderPath(kind, id)}/print-events',
        body: <String, dynamic>{'reprint': reprint, 'layout': layout});
  }
}

/// Durable idempotency intent, scoped to the signed-in account.
class CounterPendingIntentStore {
  CounterPendingIntentStore({
    this.preferencesLoader = SharedPreferences.getInstance,
    this.tokenReader = SessionStore.readToken,
  });

  final Future<SharedPreferences> Function() preferencesLoader;
  final Future<String?> Function() tokenReader;

  Future<String> keyForAccount() async {
    final SharedPreferences prefs = await preferencesLoader();
    final String token = (await tokenReader() ?? '').trim();
    String account = '';
    try {
      final parts = token.split('.');
      if (parts.length == 3) {
        final claims = jsonDecode(
            utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
        if (claims is Map) {
          account =
              '${claims['id'] ?? claims['_id'] ?? claims['sub'] ?? ''}'.trim();
        }
      }
    } catch (_) {
      // Fixtures/older sessions may instead have the saved account ID.
    }
    account = account.isNotEmpty
        ? account
        : (prefs.getString('user_id') ?? '').trim();
    if (account.isEmpty) {
      throw const CounterApiException(
          'Sign in again before saving or resuming a counter request.');
    }
    // Claims only partition local retry storage; the server authenticates them.
    // A renewed token for the same account must preserve the same retry record.
    final String accountHash =
        sha256.convert(utf8.encode(account)).toString().substring(0, 24);
    return 'branch_counter_pending_$accountHash';
  }

  Future<Map<String, dynamic>?> read() async {
    final SharedPreferences prefs = await preferencesLoader();
    final String? raw = prefs.getString(await keyForAccount());
    if (raw == null) return null;
    try {
      final dynamic value = jsonDecode(raw);
      return value is Map ? Map<String, dynamic>.from(value) : null;
    } catch (_) {
      return null;
    }
  }

  Future<bool> write(Map<String, dynamic> intent) async {
    final SharedPreferences prefs = await preferencesLoader();
    return prefs.setString(await keyForAccount(), jsonEncode(intent));
  }

  Future<bool> clear() async {
    final SharedPreferences prefs = await preferencesLoader();
    return prefs.remove(await keyForAccount());
  }
}
