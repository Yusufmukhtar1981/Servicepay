import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class PhoneFinancingException implements Exception {
  const PhoneFinancingException(this.message, [this.statusCode]);
  final String message; final int? statusCode;
  @override String toString() => message;
}

class PhoneFinancingApi {
  PhoneFinancingApi({http.Client? client, this.baseUrl = 'https://api.servicepay.ng/api/phone-financing'}) : _client = client ?? http.Client();
  final http.Client _client; final String baseUrl;
  Future<Map<String, dynamic>> get(String path) => _request('GET', path);
  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body, {String? idempotencyKey}) => _request('POST', path, body: body, idempotencyKey: idempotencyKey);
  Future<Map<String, dynamic>> products() => get('/products');
  Future<Map<String, dynamic>> product(String id) => get('/products/${Uri.encodeComponent(id)}');
  Future<Map<String, dynamic>> applications() => get('/my-applications');
  Future<Map<String, dynamic>> application(String id) => get('/my-applications/${Uri.encodeComponent(id)}');
  Future<Map<String, dynamic>> finance() => get('/my-finance');
  Future<Map<String, dynamic>> schedule(String id) => get('/finance/${Uri.encodeComponent(id)}/schedule');
  Future<Map<String, dynamic>> payments(String id) => get('/finance/${Uri.encodeComponent(id)}/payments');
  Future<Map<String, dynamic>> submit(Map<String, dynamic> body) => post('/applications', body);
  Future<Map<String, dynamic>> deposit(String id, double amount, String pin, String key) => post('/applications/${Uri.encodeComponent(id)}/pay-deposit', {'amount': amount, 'transactionPin': pin}, idempotencyKey: key);
  Future<Map<String, dynamic>> pay(String id, double amount, String pin, String key) => post('/finance/${Uri.encodeComponent(id)}/pay', {'amount': amount, 'transactionPin': pin}, idempotencyKey: key);
  Future<String> pendingKey(String operation) async {
    final p = await SharedPreferences.getInstance(); final name = 'phone_financing_pending_$operation';
    final old = p.getString(name); if (old != null && old.isNotEmpty) return old;
    final key = 'phone-$operation-${DateTime.now().microsecondsSinceEpoch}'; await p.setString(name, key); return key;
  }
  Future<void> completeKey(String operation) async => (await SharedPreferences.getInstance()).remove('phone_financing_pending_$operation');
  Future<Map<String, String>> _headers() async {
    final p = await SharedPreferences.getInstance(); String? token;
    for (final k in ['auth_token','token','access_token','accessToken','jwt_token','jwt']) { final value = p.getString(k); if (value != null && value.trim().isNotEmpty) { token = value.trim(); break; } }
    if (token == null) throw const PhoneFinancingException('Your login session was not found. Please sign in again.');
    return {'Accept':'application/json','Content-Type':'application/json','Authorization':token.toLowerCase().startsWith('bearer ') ? token : 'Bearer $token'};
  }
  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body, String? idempotencyKey}) async {
    final headers = await _headers(); if (idempotencyKey != null) headers['Idempotency-Key'] = idempotencyKey;
    final uri = Uri.parse('$baseUrl$path'); final response = method == 'GET' ? await _client.get(uri, headers: headers) : await _client.post(uri, headers: headers, body: jsonEncode(body ?? {}));
    dynamic decoded; try { decoded = jsonDecode(response.body); } catch (_) {}
    final data = decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) throw PhoneFinancingException('${data['message'] ?? 'Phone financing request failed. Please try again.'}', response.statusCode);
    return data;
  }
}