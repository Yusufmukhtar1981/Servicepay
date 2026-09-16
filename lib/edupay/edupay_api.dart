import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class EduPayApi {
  EduPayApi({http.Client? client}) : _client = client ?? http.Client();
  static const baseUrl = 'https://api.servicepay.ng/api/edupay';
  final http.Client _client;

  Future<String> _token() async {
    final p = await SharedPreferences.getInstance();
    return p.getString('auth_token') ?? '';
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    final token = await _token();
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
    };
    final uri = Uri.parse('$baseUrl$path');
    final response = method == 'GET'
        ? await _client.get(uri, headers: headers)
        : method == 'PATCH'
            ? await _client.patch(uri, headers: headers, body: jsonEncode(body))
            : await _client.post(uri, headers: headers, body: jsonEncode(body));
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = {};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EduPayException(
        decoded is Map ? decoded['message']?.toString() : null,
        code: decoded is Map ? decoded['code']?.toString() : null,
      );
    }
    return decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> dashboard() => _send('GET', '/dashboard');
  Future<List<dynamic>> schools() async =>
      (await _send('GET', '/schools'))['schools'] as List? ?? [];
  Future<List<dynamic>> fees(
    String school, {
    String? session,
    String? term,
    String? classLevel,
  }) async {
    final q = <String, String>{
      if (session != null) 'session': session,
      if (term != null) 'term': term,
      if (classLevel != null) 'classLevel': classLevel,
    };
    final suffix = q.isEmpty
        ? ''
        : '?${q.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&')}';
    return (await _send('GET', '/schools/$school/fees$suffix'))['fees']
            as List? ??
        [];
  }

  Future<List<dynamic>> children() async =>
      (await _send('GET', '/children'))['children'] as List? ?? [];
  Future<Map<String, dynamic>> createChild(Map<String, dynamic> data) =>
      _send('POST', '/children', body: data);
  Future<List<dynamic>> plans() async =>
      (await _send('GET', '/plans'))['plans'] as List? ?? [];
  Future<Map<String, dynamic>> createPlan(Map<String, dynamic> data) =>
      _send('POST', '/plans', body: data);
  Future<Map<String, dynamic>> plan(String id) => _send('GET', '/plans/$id');
  Future<Map<String, dynamic>> contribute(String id, double amount, String pin,
          {String? idempotencyKey}) =>
      _send(
        'POST',
        '/plans/$id/contributions',
        body: {'amount': amount, 'transactionPin': pin},
        idempotencyKey:
            idempotencyKey ?? 'edupay-${DateTime.now().microsecondsSinceEpoch}',
      );
  Future<Map<String, dynamic>> autosave(String id, Map<String, dynamic> data) =>
      _send('PATCH', '/plans/$id/autosave', body: data);
  Future<Map<String, dynamic>> invite(String id, String name) =>
      _send('POST', '/plans/$id/sponsor-invites', body: {'sponsorName': name});
  Future<Map<String, dynamic>> sponsorView(String token) =>
      _send('GET', '/sponsor/$token');
  Future<Map<String, dynamic>> sponsorContribute(
    String token,
    double amount,
    String pin, {
    String? idempotencyKey,
  }) =>
      _send(
        'POST',
        '/sponsor/$token/contribute',
        body: {'amount': amount, 'transactionPin': pin},
        idempotencyKey: idempotencyKey ??
            'edupay-sponsor-${DateTime.now().microsecondsSinceEpoch}',
      );
  Future<Map<String, dynamic>> history() => _send('GET', '/history');
  Future<List<dynamic>> repayments() async =>
      (await _send('GET', '/repayments'))['repayments'] as List? ?? [];
  Future<Map<String, dynamic>> repay(
    String id,
    double amount,
    String pin, {
    String? idempotencyKey,
  }) =>
      _send(
        'POST',
        '/repayments/$id/payments',
        body: {'amount': amount, 'transactionPin': pin},
        idempotencyKey: idempotencyKey ??
            'edupay-repay-${DateTime.now().microsecondsSinceEpoch}',
      );
  Future<Map<String, dynamic>> receipt(String reference) =>
      _send('GET', '/receipts/$reference');
}

class EduPayException implements Exception {
  EduPayException(this.message, {this.code});
  final String? message;
  final String? code;
  @override
  String toString() => message ?? 'Unable to complete that EduPay request.';
}
