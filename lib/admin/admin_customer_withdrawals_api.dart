import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminCustomerWithdrawalsApi {
  AdminCustomerWithdrawalsApi({
    http.Client? client,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null;

  static const String _baseUrl = 'https://api.servicepay.ng/api/withdrawals';
  static const Duration _timeout = Duration(seconds: 30);

  final http.Client _client;
  final bool _ownsClient;

  Future<List<Map<String, dynamic>>> list({
    String status = '',
  }) async {
    final response = await _request(
      'GET',
      'admin',
      query: status.isEmpty ? null : <String, String>{'status': status},
    );
    final raw = response['withdrawals'];
    return raw is List
        ? raw
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList()
        : <Map<String, dynamic>>[];
  }

  Future<Map<String, dynamic>> approve(
    String id, {
    required String payoutReference,
    String adminNote = '',
  }) {
    return _request(
      'POST',
      'admin/${Uri.encodeComponent(id)}/approve',
      payload: <String, dynamic>{
        'payoutReference': payoutReference.trim(),
        'adminNote': adminNote.trim(),
      },
    );
  }

  Future<Map<String, dynamic>> reject(
    String id, {
    required String reason,
  }) {
    return _request(
      'POST',
      'admin/${Uri.encodeComponent(id)}/reject',
      payload: <String, dynamic>{
        'adminNote': reason.trim(),
      },
    );
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? payload,
  }) async {
    final token = await _token();
    final uri = Uri.parse('$_baseUrl/$path').replace(
      queryParameters: query,
    );
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (payload != null) 'Content-Type': 'application/json',
    };
    final http.Response response;

    if (method == 'POST') {
      response = await _client
          .post(
            uri,
            headers: headers,
            body: jsonEncode(payload),
          )
          .timeout(_timeout);
    } else {
      response = await _client.get(uri, headers: headers).timeout(_timeout);
    }

    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};

    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body['success'] != true) {
      throw Exception(
        body['message']?.toString() ??
            'Unable to complete the withdrawal action.',
      );
    }

    return body;
  }

  Future<String> _token() async {
    final preferences = await SharedPreferences.getInstance();
    for (final key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      var value = preferences.getString(key)?.trim() ?? '';
      if (value.toLowerCase().startsWith('bearer ')) {
        value = value.substring(7).trim();
      }
      if (value.isNotEmpty) return value;
    }
    throw Exception('Your login session was not found. Please sign in again.');
  }

  void close() {
    if (_ownsClient) {
      _client.close();
    }
  }
}
