import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Small, admin-scoped client for the Fintech Operations contract.
///
/// The API deliberately returns its server payload without manufacturing local
/// records: capability flags and records shown by the control centre are the
/// ones supplied by Head Office's API.
class AdminFintechOperationsApi {
  static const String _baseUrl =
      'https://api.servicepay.ng/api/admin/fintech-operations';
  static const Duration _timeout = Duration(seconds: 30);

  static Future<Map<String, dynamic>> catalog() => _request('GET', 'catalog');

  static Future<Map<String, dynamic>> collection(
    String path, {
    String search = '',
    String status = '',
    int limit = 50,
  }) {
    final String cleanSearch = search.trim();
    final String cleanStatus = status.trim();
    final Map<String, String> query = <String, String>{
      'limit': limit.clamp(1, 100).toString(),
      if (cleanSearch.isNotEmpty)
        'search': cleanSearch.substring(
          0,
          cleanSearch.length.clamp(0, 80).toInt(),
        ),
      if (cleanStatus.isNotEmpty)
        'status': cleanStatus.substring(
          0,
          cleanStatus.length.clamp(0, 40).toInt(),
        ),
    };
    return _request('GET', path, query: query);
  }

  static Future<Map<String, dynamic>> create(
    String path,
    Map<String, dynamic> payload,
  ) =>
      _request('POST', path, payload: payload);

  static Future<Map<String, dynamic>> record(String path, String id) =>
      _request('GET', '$path/${Uri.encodeComponent(id)}');

  static Future<Map<String, dynamic>> update(
    String path,
    String id,
    Map<String, dynamic> payload,
  ) =>
      _request(
        'PATCH',
        '$path/${Uri.encodeComponent(id)}',
        payload: payload,
      );

  static Future<AdminFintechReport> report(String type) async {
    final http.Response response = await _rawRequest(
      'GET',
      'reports/${Uri.encodeComponent(type)}',
      headers: <String, String>{'Accept': 'application/json, text/csv'},
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(_message(response));
    }
    final String contentType = response.headers['content-type'] ?? '';
    if (contentType.contains('csv')) {
      return AdminFintechReport(type: type, csv: response.body);
    }
    try {
      final dynamic decoded = jsonDecode(response.body);
      if (decoded is Map) {
        return AdminFintechReport(
          type: type,
          json: Map<String, dynamic>.from(decoded),
        );
      }
    } catch (_) {}
    throw Exception('The report service returned an invalid response.');
  }

  static Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? payload,
  }) async {
    final http.Response response = await _rawRequest(
      method,
      path,
      query: query,
      payload: payload,
    );
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final Map<String, dynamic> body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(body['message']?.toString() ?? _message(response));
    }
    return body;
  }

  static Future<http.Response> _rawRequest(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? payload,
    Map<String, String>? headers,
  }) async {
    final String token = await _token();
    final Uri uri =
        Uri.parse('$_baseUrl/$path').replace(queryParameters: query);
    final Map<String, String> requestHeaders = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      ...?headers,
      if (payload != null) 'Content-Type': 'application/json',
    };
    if (method == 'POST') {
      return http
          .post(uri, headers: requestHeaders, body: jsonEncode(payload))
          .timeout(_timeout);
    }
    if (method == 'PATCH') {
      return http
          .patch(uri, headers: requestHeaders, body: jsonEncode(payload))
          .timeout(_timeout);
    }
    return http.get(uri, headers: requestHeaders).timeout(_timeout);
  }

  static Future<String> _token() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      String value = preferences.getString(key)?.trim() ?? '';
      if (value.toLowerCase().startsWith('bearer ')) value = value.substring(7);
      if (value.trim().isNotEmpty) return value.trim();
    }
    throw Exception('Your login session was not found. Please sign in again.');
  }

  static String _message(http.Response response) {
    if (response.statusCode == 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (response.statusCode == 403) {
      return 'Your account is not authorized for this operation.';
    }
    return response.body.trim().isNotEmpty
        ? response.body.trim()
        : 'Unable to complete this request.';
  }
}

class AdminFintechReport {
  const AdminFintechReport({required this.type, this.json, this.csv});
  final String type;
  final Map<String, dynamic>? json;
  final String? csv;
}
