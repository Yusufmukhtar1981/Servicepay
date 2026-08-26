import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class SolarOfficerApiException implements Exception {
  const SolarOfficerApiException(this.message, [this.statusCode]);

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class SolarOfficerApiService {
  static const String _baseUrl =
      'https://api.servicepay.ng/api/solar/officer';

  Future<Map<String, dynamic>> get(String path) =>
      _request('GET', path);

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) =>
      _request('POST', path, body: body);

  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) =>
      _request('PATCH', path, body: body);

  Future<Map<String, String>> _headers() async {
    final SharedPreferences preferences =
        await SharedPreferences.getInstance();
    String token = '';
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final String candidate =
          preferences.getString(key)?.trim() ?? '';
      if (candidate.isNotEmpty) {
        token = candidate;
        break;
      }
    }
    if (token.isEmpty) {
      throw const SolarOfficerApiException(
        'Your Solar Officer login session was not found.',
      );
    }
    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': token.toLowerCase().startsWith('bearer ')
          ? token
          : 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final Uri uri = Uri.parse('$_baseUrl$path');
    final Map<String, String> headers = await _headers();
    final String? encoded = body == null ? null : jsonEncode(body);
    final http.Response response;
    if (method == 'POST') {
      response = await http
          .post(uri, headers: headers, body: encoded)
          .timeout(const Duration(seconds: 60));
    } else if (method == 'PATCH') {
      response = await http
          .patch(uri, headers: headers, body: encoded)
          .timeout(const Duration(seconds: 60));
    } else {
      response = await http
          .get(uri, headers: headers)
          .timeout(const Duration(seconds: 45));
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = null;
    }
    final Map<String, dynamic> data = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300) {
      throw SolarOfficerApiException(
        data['message']?.toString() ??
            'Solar Officer request failed.',
        response.statusCode,
      );
    }
    return data;
  }
}