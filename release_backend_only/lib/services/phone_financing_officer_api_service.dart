import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class PhoneFinancingOfficerApiException implements Exception {
  const PhoneFinancingOfficerApiException(this.message, [this.statusCode]);
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

/// Client for the role-scoped phone-financing field workflow.
///
/// This deliberately contains no approval, deposit, inventory, repayment, or
/// device-management operation. Those decisions remain in the admin workspace.
class PhoneFinancingOfficerApiService {
  PhoneFinancingOfficerApiService({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api/phone-financing/officer',
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;

  Future<Map<String, dynamic>> me() => get('/me');
  Future<Map<String, dynamic>> applications() => get('/applications');
  Future<Map<String, dynamic>> application(String id) =>
      get('/applications/${Uri.encodeComponent(id)}');
  Future<Map<String, dynamic>> submitVerification(
    String id,
    Map<String, dynamic> report,
  ) =>
      post('/applications/${Uri.encodeComponent(id)}/verification',
          <String, dynamic>{'report': report});
  Future<Map<String, dynamic>> createFollowUp(
    String id,
    Map<String, dynamic> followUp,
  ) =>
      post('/applications/${Uri.encodeComponent(id)}/follow-ups', <String, dynamic>{
        'note': followUp['notes'] ?? followUp['note'] ?? '',
        'outcome': followUp['outcome'] ?? '',
        if (followUp['nextFollowUpAt'] != null)
          'nextFollowUpAt': followUp['nextFollowUpAt'],
      });

  Future<Map<String, dynamic>> get(String path) => _request('GET', path);
  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) =>
      _request('POST', path, body: body);

  Future<Map<String, String>> _headers() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    String token = '';
    for (final String key in <String>[
      'auth_token', 'token', 'access_token', 'accessToken', 'jwt_token', 'jwt',
    ]) {
      final String candidate = prefs.getString(key)?.trim() ?? '';
      if (candidate.isNotEmpty) {
        token = candidate;
        break;
      }
    }
    if (token.isEmpty) {
      throw const PhoneFinancingOfficerApiException(
        'Your Phone Financing Officer login session was not found.',
      );
    }
    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization':
          token.toLowerCase().startsWith('bearer ') ? token : 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final Uri uri = Uri.parse('$baseUrl$path');
    final Map<String, String> headers = await _headers();
    final http.Response response = method == 'GET'
        ? await _client.get(uri, headers: headers)
        : await _client.post(uri, headers: headers, body: jsonEncode(body));
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final Map<String, dynamic> data = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300 ||
        (data.containsKey('success') && data['success'] != true)) {
      throw PhoneFinancingOfficerApiException(
        data['message']?.toString() ?? 'Phone Financing Officer request failed.',
        response.statusCode,
      );
    }
    return data;
  }
}