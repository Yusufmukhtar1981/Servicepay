import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminPrivacyRequestsApi {
  AdminPrivacyRequestsApi({
    http.Client? client,
    this.baseUrl =
        'https://api.servicepay.ng/api/admin/control-center/account-deletion-requests',
  }) : _client = client ?? http.Client(),
       _ownsClient = client == null;

  final http.Client _client;
  final bool _ownsClient;
  final String baseUrl;

  Future<Map<String, dynamic>> list({
    String search = '',
    String status = '',
    String kind = '',
    int page = 1,
    int limit = 50,
  }) => _request(
    'GET',
    '',
    query: <String, String>{
      'search': search.trim(),
      'status': status,
      'kind': kind,
      'page': '$page',
      'limit': '$limit',
    }..removeWhere((_, String value) => value.isEmpty),
  );

  Future<Map<String, dynamic>> detail(String id) =>
      _request('GET', '/${Uri.encodeComponent(id)}');

  Future<Map<String, dynamic>> update(
    String id, {
    required String status,
    String note = '',
  }) => _request(
    'PATCH',
    '/${Uri.encodeComponent(id)}',
    payload: <String, dynamic>{'status': status, 'note': note.trim()},
  );

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? payload,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    String token =
        (prefs.getString('auth_token') ??
                prefs.getString('token') ??
                prefs.getString('access_token') ??
                '')
            .trim()
            .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '');
    if (token.isEmpty) {
      throw const AdminPrivacyRequestsException(
        'Your Admin session was not found. Please sign in again.',
      );
    }
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (payload != null) 'Content-Type': 'application/json',
    };
    final response = method == 'PATCH'
        ? await _client
              .patch(uri, headers: headers, body: jsonEncode(payload))
              .timeout(const Duration(seconds: 30))
        : await _client
              .get(uri, headers: headers)
              .timeout(const Duration(seconds: 30));
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = null;
    }
    final data = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        data['success'] == false) {
      throw AdminPrivacyRequestsException(
        (data['message'] ?? 'Privacy request action failed.').toString(),
      );
    }
    return data;
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

class AdminPrivacyRequestsException implements Exception {
  const AdminPrivacyRequestsException(this.message);
  final String message;

  @override
  String toString() => message;
}
