import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Authenticated, read-only client for ServicePay call metadata.
class AdminCallsApi {
  AdminCallsApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api/admin/calls',
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null;

  final http.Client _client;
  final bool _ownsClient;
  final String baseUrl;

  Future<Map<String, dynamic>> list({
    required int page,
    required int limit,
    String? status,
    DateTime? startDate,
    DateTime? endDate,
  }) {
    return _get(<String, String>{
      'page': page.toString(),
      'limit': limit.toString(),
      if (status != null && status.isNotEmpty) 'status': status,
      if (startDate != null) 'startDate': _date(startDate),
      if (endDate != null) 'endDate': _date(endDate),
    });
  }

  Future<Map<String, dynamic>> _get(Map<String, String> query) async {
    final String token = await _token();
    final response = await _client.get(
      Uri.parse(baseUrl).replace(queryParameters: query),
      headers: <String, String>{
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );
    final Map<String, dynamic> body = _decode(response.body);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        (body.containsKey('success') && body['success'] != true)) {
      throw AdminCallsException(
        body['message']?.toString() ??
            body['error']?.toString() ??
            'Unable to load call metadata.',
      );
    }
    return body;
  }

  Future<String> _token() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    for (final String key in const <String>[
      'auth_token',
      'token',
      'admin_token',
      'access_token',
      'accessToken',
    ]) {
      String token = preferences.getString(key)?.trim() ?? '';
      token = token.replaceFirst(
        RegExp(r'^Bearer\s+', caseSensitive: false),
        '',
      );
      if (token.isNotEmpty) return token;
    }
    throw const AdminCallsException(
      'Your login session was not found. Please sign in again.',
    );
  }

  Map<String, dynamic> _decode(String source) {
    try {
      final dynamic decoded = jsonDecode(source);
      return decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  String _date(DateTime value) {
    final DateTime local = value.toLocal();
    return '${local.year.toString().padLeft(4, '0')}-'
        '${local.month.toString().padLeft(2, '0')}-'
        '${local.day.toString().padLeft(2, '0')}';
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

class AdminCallsException implements Exception {
  const AdminCallsException(this.message);

  final String message;

  @override
  String toString() => message;
}