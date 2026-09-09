import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminFeatureControlsApi {
  AdminFeatureControlsApi({
    http.Client? client,
    this.baseUrl = const String.fromEnvironment(
      'SERVICEPAY_API_BASE_URL',
      defaultValue: 'https://api.servicepay.ng/api',
    ),
    Future<SharedPreferences> Function()? preferencesLoader,
  })  : _client = client ?? http.Client(),
        _preferencesLoader = preferencesLoader ?? SharedPreferences.getInstance;

  final http.Client _client;
  final String baseUrl;
  final Future<SharedPreferences> Function() _preferencesLoader;

  Future<Map<String, bool>> load() async {
    final response = await _request('GET');
    final decoded = _decode(response);
    final data = decoded['data'];
    final raw = data is Map ? data['featureToggles'] : null;
    if (raw is! Map) {
      throw const AdminFeatureControlsException(
        502,
        'The service returned an invalid feature-control response.',
      );
    }
    return <String, bool>{
      for (final entry in raw.entries)
        if (entry.value is bool) entry.key.toString(): entry.value as bool,
    };
  }

  Future<void> save(Map<String, bool> toggles, String reason) async {
    final cleanReason = reason.trim();
    if (cleanReason.length < 10) {
      throw const AdminFeatureControlsException(
        0,
        'Provide a reason of at least 10 characters.',
      );
    }
    final response = await _request(
      'PUT',
      body: jsonEncode(<String, dynamic>{
        'reason': cleanReason,
        'fintechControl': <String, dynamic>{
          'featureToggles': toggles,
        },
      }),
    );
    _decode(response);
  }

  Future<http.Response> _request(String method, {String? body}) async {
    final prefs = await _preferencesLoader();
    final token = (prefs.getString('auth_token') ?? '').trim();
    if (token.isEmpty) {
      throw const AdminFeatureControlsException(
        401,
        'Your session has expired. Please sign in again.',
      );
    }
    final uri = Uri.parse('$baseUrl/settings/admin/fintech-control');
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
    };
    final response = method == 'PUT'
        ? await _client.put(uri, headers: headers, body: body)
        : await _client.get(uri, headers: headers);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String message = 'Unable to load Feature Controls.';
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map && decoded['message'] != null) {
          message = decoded['message'].toString();
        }
      } catch (_) {}
      throw AdminFeatureControlsException(response.statusCode, message);
    }
    return response;
  }

  Map<String, dynamic> _decode(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } catch (_) {}
    throw const AdminFeatureControlsException(
      502,
      'The service returned an invalid response.',
    );
  }
}

class AdminFeatureControlsException implements Exception {
  const AdminFeatureControlsException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  @override
  String toString() => message;
}
