import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class BusinessPartnerApiException implements Exception {
  const BusinessPartnerApiException(this.message, [this.statusCode]);

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// Read-only client for the Business Partner workspace.
///
/// Partner users can review only the portfolio assigned to their business.
/// Head Office approvals, pricing, wallet, and device operations intentionally
/// do not belong in this client.
class BusinessPartnerApiService {
  BusinessPartnerApiService({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api/business-partner',
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;

  Future<Map<String, dynamic>> dashboard({Map<String, String>? filters}) =>
      get('/dashboard', query: filters);
  Future<Map<String, dynamic>> officers({Map<String, String>? filters}) =>
      get('/officers', query: filters);
  Future<Map<String, dynamic>> getOfficer({
    required String type,
    required String id,
  }) =>
      get('/officers/${Uri.encodeComponent(type)}/${Uri.encodeComponent(id)}');

  Future<Map<String, dynamic>> createOfficer({
    required String type,
    required String fullName,
    required String phone,
    required String email,
    required String password,
    required String state,
    required String lga,
    required String address,
  }) =>
      post('/officers', <String, dynamic>{
        'type': type,
        'fullName': fullName,
        'phone': phone,
        'email': email,
        'password': password,
        'state': state,
        'lga': lga,
        'address': address,
      });

  Future<Map<String, dynamic>> updateOfficer({
    required String type,
    required String id,
    required Map<String, dynamic> fields,
  }) =>
      patch('/officers/${Uri.encodeComponent(type)}/${Uri.encodeComponent(id)}',
          fields);

  Future<Map<String, dynamic>> updateOfficerStatus({
    required String type,
    required String id,
    required String status,
  }) =>
      patch(
          '/officers/${Uri.encodeComponent(type)}/${Uri.encodeComponent(id)}/status',
          <String, dynamic>{'status': status});

  Future<Map<String, dynamic>> resetOfficerAccess({
    required String type,
    required String id,
    required String password,
  }) =>
      post(
          '/officers/${Uri.encodeComponent(type)}/${Uri.encodeComponent(id)}/reset-access',
          <String, dynamic>{'password': password});
  Future<Map<String, dynamic>> customers({Map<String, String>? filters}) =>
      get('/customers', query: filters);

  /// The applications response has the server-scoped `solar` and `phone`
  /// collections; the dashboard presents each collection independently.
  Future<Map<String, dynamic>> applications({Map<String, String>? filters}) =>
      get('/applications', query: filters);
  Future<Map<String, dynamic>> repayments({Map<String, String>? filters}) =>
      get('/repayments', query: filters);
  Future<Map<String, dynamic>> commission({Map<String, String>? filters}) =>
      get('/commissions', query: filters);
  Future<Map<String, dynamic>> performance({Map<String, String>? filters}) =>
      get('/performance', query: filters);
  Future<Map<String, dynamic>> reports({Map<String, String>? filters}) =>
      get('/reports', query: filters);
  Future<Map<String, dynamic>> notifications({Map<String, String>? filters}) =>
      get('/notifications', query: filters);
  Future<Map<String, dynamic>> activity({Map<String, String>? filters}) =>
      get('/activity', query: filters);
  Future<Map<String, dynamic>> profile() => get('/me');

  Future<Map<String, dynamic>> assignApplication({
    required String applicationId,
    required String type,
    required String officerId,
    String? note,
  }) =>
      post('/applications/${Uri.encodeComponent(applicationId)}/assign', {
        'type': type,
        'officerId': officerId,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      });

  /// Records the partner's field-verification quality review only. It does
  /// not approve financing, pricing, payment, or any Head Office decision.
  Future<Map<String, dynamic>> reviewVerification({
    required String applicationId,
    required String type,
    required String decision,
    String? note,
  }) =>
      post(
          '/applications/${Uri.encodeComponent(applicationId)}/verification-review',
          {
            'type': type,
            'decision': decision,
            if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
          });

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, String>? query,
  }) async {
    final Uri uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final http.Response response = await _client
        .get(uri, headers: await _headers())
        .timeout(const Duration(seconds: 45));
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
        response.statusCode >= 300 ||
        (data.containsKey('success') && data['success'] != true)) {
      throw BusinessPartnerApiException(
        data['message']?.toString() ?? 'Unable to load Business Partner data.',
        response.statusCode,
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final http.Response response = await _client
        .post(Uri.parse('$baseUrl$path'),
            headers: <String, String>{
              ...await _headers(),
              'Content-Type': 'application/json',
            },
            body: jsonEncode(body))
        .timeout(const Duration(seconds: 45));
    return _decode(response);
  }

  Future<Map<String, dynamic>> patch(
    String path,
    Map<String, dynamic> body,
  ) async {
    final http.Response response = await _client
        .patch(Uri.parse('$baseUrl$path'),
            headers: <String, String>{
              ...await _headers(),
              'Content-Type': 'application/json',
            },
            body: jsonEncode(body))
        .timeout(const Duration(seconds: 45));
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final Map<String, dynamic> data = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        (data.containsKey('success') && data['success'] != true)) {
      throw BusinessPartnerApiException(
        data['message']?.toString() ?? 'Unable to load Business Partner data.',
        response.statusCode,
      );
    }
    return data;
  }

  Future<Map<String, String>> _headers() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    String token = '';
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final String candidate = preferences.getString(key)?.trim() ?? '';
      if (candidate.isNotEmpty) {
        token = candidate;
        break;
      }
    }
    if (token.isEmpty) {
      throw const BusinessPartnerApiException(
        'Your Business Partner login session was not found.',
      );
    }
    return <String, String>{
      'Accept': 'application/json',
      'Authorization':
          token.toLowerCase().startsWith('bearer ') ? token : 'Bearer $token',
    };
  }
}
