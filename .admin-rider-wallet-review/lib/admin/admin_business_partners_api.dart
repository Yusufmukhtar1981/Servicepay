import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Authenticated Head Office client for the Business Partner control centre.
///
/// This client deliberately never reads or retains credentials returned by an
/// API response. Business partner records are operational records, not API
/// client accounts.
class AdminBusinessPartnersApi {
  AdminBusinessPartnersApi({
    http.Client? client,
    this.baseUrl =
        'https://api.servicepay.ng/api/business-partner/admin/partners',
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null;

  final http.Client _client;
  final bool _ownsClient;
  final String baseUrl;

  Future<Map<String, dynamic>> list({String search = '', String status = ''}) =>
      get('', query: {
        if (search.trim().isNotEmpty) 'q': search.trim(),
        if (status.trim().isNotEmpty) 'status': status.trim().toUpperCase(),
      });

  Future<Map<String, dynamic>> counts() => get('/count');
  Future<Map<String, dynamic>> detail(String id) => get('/$id');
  Future<Map<String, dynamic>> create(Map<String, dynamic> body) =>
      post('', body);
  Future<Map<String, dynamic>> update(String id, Map<String, dynamic> body) =>
      patch('/$id', body);
  Future<Map<String, dynamic>> setStatus(String id, String status,
          {String note = ''}) =>
      patch('/$id/status', {
        'status': status.toUpperCase(),
        if (note.trim().isNotEmpty) 'note': note.trim(),
      });

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) =>
      _request('GET', path, query: query);
  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) =>
      _request('POST', path, payload: body);
  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) =>
      _request('PATCH', path, payload: body);

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, String>? query, Map<String, dynamic>? payload}) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final token = await _token();
    final request = http.Request(method, uri)
      ..headers.addAll({
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
        if (payload != null) 'Content-Type': 'application/json',
      });
    if (payload != null) {
      request.body = jsonEncode(payload);
    }
    final response = await _client.send(request).then(http.Response.fromStream);
    dynamic decoded;
    try {
      decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
    } catch (_) {
      decoded = <String, dynamic>{};
    }
    final body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        (body.containsKey('success') && body['success'] != true)) {
      throw AdminBusinessPartnersException(
        body['message']?.toString() ??
            body['error']?.toString() ??
            'Business partner request failed.',
      );
    }
    return body;
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();
    for (final key in const [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt'
    ]) {
      var token = prefs.getString(key)?.trim() ?? '';
      if (token.toLowerCase().startsWith('bearer ')) {
        token = token.substring(7).trim();
      }
      if (token.isNotEmpty) {
        return token;
      }
    }
    throw const AdminBusinessPartnersException(
        'Your login session was not found. Please sign in again.');
  }

  void close() {
    if (_ownsClient) {
      _client.close();
    }
  }
}

class AdminBusinessPartnersException implements Exception {
  const AdminBusinessPartnersException(this.message);
  final String message;
  @override
  String toString() => message;
}
