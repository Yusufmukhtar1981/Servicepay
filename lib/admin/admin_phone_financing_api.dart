import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Authenticated, injectable client for the phone-financing control room.
class AdminPhoneFinancingApi {
  AdminPhoneFinancingApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api/phone-financing',
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null;

  final http.Client _client;
  final bool _ownsClient;
  final String baseUrl;

  Future<Map<String, dynamic>> dashboard() => get('/admin/dashboard');
  Future<Map<String, dynamic>> applicationDetail(String id) =>
      get('/admin/applications/$id');
  Future<Map<String, dynamic>> products() => get('/admin/products');
  Future<Map<String, dynamic>> applications(
          {String search = '', String status = ''}) =>
      get('/admin/applications', query: {
        if (search.trim().isNotEmpty) 'q': search.trim(),
        if (status.isNotEmpty) 'status': status,
      });
  Future<Map<String, dynamic>> devices({String search = ''}) =>
      get('/admin/devices',
          query: {if (search.trim().isNotEmpty) 'q': search.trim()});
  Future<Map<String, dynamic>> finance(
          {String search = '', String status = ''}) =>
      get('/admin/finance', query: {
        if (search.trim().isNotEmpty) 'q': search.trim(),
        if (status.isNotEmpty) 'status': status,
      });
  Future<Map<String, dynamic>> createProduct(Map<String, dynamic> body) =>
      post('/admin/products', body);
  Future<Map<String, dynamic>> updateProduct(
          String id, Map<String, dynamic> body) =>
      patch('/admin/products/$id', body);
  Future<Map<String, dynamic>> setProductActive(String id, bool active) =>
      patch('/admin/products/$id/${active ? 'activate' : 'deactivate'}', {});
  Future<Map<String, dynamic>> createDevice(Map<String, dynamic> body) =>
      post('/admin/devices', body);
  Future<Map<String, dynamic>> transition(
          String id, String status, String note) =>
      patch('/admin/applications/$id/status', {'status': status, 'note': note});
  Future<Map<String, dynamic>> assignOfficer(
          String applicationId, String officerId) =>
      patch('/admin/applications/$applicationId/assign-officer',
          {'officerId': officerId.trim()});
  Future<Map<String, dynamic>> approve(String id,
          {String? price, String note = ''}) =>
      post('/admin/applications/$id/approve', {
        if (price?.trim().isNotEmpty == true) 'approvedPrice': price!.trim(),
        'note': note,
      });
  Future<Map<String, dynamic>> assignDevice(
          String applicationId, String deviceId) =>
      post('/admin/applications/$applicationId/assign-device',
          {'deviceId': deviceId});
  Future<Map<String, dynamic>> handover(String applicationId) =>
      post('/admin/applications/$applicationId/handover', {});
  Future<Map<String, dynamic>> evaluateOverdue() =>
      post('/admin/overdue/evaluate', {});
  Future<Map<String, dynamic>> evaluateExpiredReservations() =>
      post('/admin/reservations/evaluate-expired', {});
  Future<Map<String, dynamic>> refundDeposit(String applicationId,
          {required String reason, required String idempotencyKey}) =>
      _request('POST', '/admin/applications/$applicationId/refund-deposit',
          payload: {'reason': reason, 'idempotencyKey': idempotencyKey},
          extraHeaders: {'Idempotency-Key': idempotencyKey});
  Future<Map<String, dynamic>> providerRequest(String financeId, String action,
          {String provider = 'NONE', required String idempotencyKey}) =>
      post('/admin/finance/$financeId/provider-request', {
        'action': action,
        'provider': provider,
        'idempotencyKey': idempotencyKey,
      });

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) =>
      _request('GET', path, query: query);
  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) =>
      _request('POST', path, payload: body);
  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) =>
      _request('PATCH', path, payload: body);

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, String>? query,
      Map<String, dynamic>? payload,
      Map<String, String>? extraHeaders}) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer ${await _token()}',
      if (payload != null) 'Content-Type': 'application/json',
      ...?extraHeaders,
    };
    final request = http.Request(method, uri)..headers.addAll(headers);
    if (payload != null) request.body = jsonEncode(payload);
    final response = await _client.send(request).then(http.Response.fromStream);
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        (body.containsKey('success') && body['success'] != true)) {
      throw AdminPhoneFinancingException(
          body['message']?.toString() ?? 'Phone-financing request failed.');
    }
    return body;
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();
    for (final key in [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt'
    ]) {
      var value = prefs.getString(key)?.trim() ?? '';
      if (value.toLowerCase().startsWith('bearer ')) {
        value = value.substring(7).trim();
      }
      if (value.isNotEmpty) {
        return value;
      }
    }
    throw AdminPhoneFinancingException(
        'Your login session was not found. Please sign in again.');
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

class AdminPhoneFinancingException implements Exception {
  const AdminPhoneFinancingException(this.message);
  final String message;
  @override
  String toString() => message;
}
