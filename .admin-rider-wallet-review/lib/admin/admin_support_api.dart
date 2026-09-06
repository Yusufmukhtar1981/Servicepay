import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminSupportApi {
  AdminSupportApi({http.Client? client})
    : _client = client ?? http.Client(),
      _ownsClient = client == null;
  static const baseUrl = 'https://api.servicepay.ng/api/admin/support';
  final http.Client _client;
  final bool _ownsClient;

  Future<Map<String, dynamic>> metrics() => _request('GET', 'metrics');
  Future<Map<String, dynamic>> tickets({
    String search = '',
    String status = '',
    String priority = '',
    String category = '',
    String assignedTo = '',
    int page = 1,
    int limit = 20,
  }) => _request(
    'GET',
    'tickets',
    query: {
      'search': search,
      'status': status,
      'priority': priority,
      'category': category,
      'assignedTo': assignedTo,
      'page': '$page',
      'limit': '$limit',
    }..removeWhere((k, v) => v.isEmpty),
  );
  Future<Map<String, dynamic>> ticket(String id) =>
      _request('GET', 'tickets/${Uri.encodeComponent(id)}');
  Future<Map<String, dynamic>> update(
    String id,
    Map<String, dynamic> changes,
  ) =>
      _request('PATCH', 'tickets/${Uri.encodeComponent(id)}', payload: changes);
  Future<Map<String, dynamic>> reply(
    String id,
    String message, {
    required String idempotencyKey,
  }) => _request(
    'POST',
    'tickets/${Uri.encodeComponent(id)}/replies',
    payload: {'message': message.trim(), 'idempotencyKey': idempotencyKey},
  );
  Future<Map<String, dynamic>> note(
    String id,
    String note, {
    required String idempotencyKey,
  }) => _request(
    'POST',
    'tickets/${Uri.encodeComponent(id)}/notes',
    payload: {'body': note.trim(), 'idempotencyKey': idempotencyKey},
  );
  Future<List<Map<String, dynamic>>> staff(String search) async {
    final data = await _request(
      'GET',
      'staff',
      query: search.isEmpty ? null : {'search': search},
    );
    final nested = data['data'] is Map
        ? Map<String, dynamic>.from(data['data'])
        : data;
    final raw = nested['staff'] ?? nested['users'] ?? nested['items'];
    return raw is List
        ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : [];
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? payload,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    String token =
        prefs.getString('auth_token')?.trim() ??
        prefs.getString('token')?.trim() ??
        '';
    token = token.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '');
    if (token.isEmpty) {
      throw Exception(
        'Your login session was not found. Please sign in again.',
      );
    }
    final headers = {
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (payload != null) 'Content-Type': 'application/json',
    };
    final uri = Uri.parse('$baseUrl/$path').replace(queryParameters: query);
    final r = switch (method) {
      'PATCH' =>
        await _client
            .patch(uri, headers: headers, body: jsonEncode(payload))
            .timeout(const Duration(seconds: 30)),
      'POST' =>
        await _client
            .post(uri, headers: headers, body: jsonEncode(payload))
            .timeout(const Duration(seconds: 30)),
      _ =>
        await _client
            .get(uri, headers: headers)
            .timeout(const Duration(seconds: 30)),
    };
    dynamic raw;
    try {
      raw = jsonDecode(r.body);
    } catch (_) {}
    final data = raw is Map
        ? Map<String, dynamic>.from(raw)
        : <String, dynamic>{};
    if (r.statusCode < 200 || r.statusCode >= 300 || data['success'] == false) {
      throw Exception((data['message'] ?? 'Support action failed.').toString());
    }
    return data;
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
