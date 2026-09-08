import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class SolarApiException implements Exception {
  const SolarApiException(this.message, [this.statusCode]);

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// Customer API client for the ServicePay Solar product.
///
/// Keeping this client separate makes it clear that Solar uses the existing
/// ServicePay login and wallet, rather than creating another identity flow.
class SolarApiService {
  static const String _baseUrl = 'https://api.servicepay.ng/api/solar';

  Future<Map<String, dynamic>> get(String path) => _request('GET', path);

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
    String? idempotencyKey,
  }) =>
      _request('POST', path, body: body, idempotencyKey: idempotencyKey);

  Future<Map<String, dynamic>> getPackages() => get('/packages');
  Future<Map<String, dynamic>> getApplications() => get('/my-applications');
  Future<Map<String, dynamic>> getFinance() => get('/my-finance');
  Future<Map<String, dynamic>> getSchedule(String financeId) =>
      get('/finance/${Uri.encodeComponent(financeId)}/schedule');
  Future<Map<String, dynamic>> getPayments(String financeId) =>
      get('/finance/${Uri.encodeComponent(financeId)}/payments');
  Future<Map<String, dynamic>> getApplication(String id) =>
      get('/my-applications/${Uri.encodeComponent(id)}');

  Future<Map<String, dynamic>> submitApplication(
    Map<String, dynamic> application,
  ) =>
      post('/applications', body: application);

  String _pendingOperationPreferenceKey(String operation) =>
      'solar_pending_operation_$operation';

  Future<String> beginMonetaryOperation(String operation) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    final String preferenceKey = _pendingOperationPreferenceKey(operation);
    final String? existing = preferences.getString(preferenceKey);
    if (existing != null && existing.trim().isNotEmpty) {
      return existing.trim();
    }
    final String key =
        'solar-$operation-${DateTime.now().microsecondsSinceEpoch}';
    await preferences.setString(preferenceKey, key);
    return key;
  }

  Future<void> completeMonetaryOperation(String operation) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    await preferences.remove(_pendingOperationPreferenceKey(operation));
  }

  Future<Map<String, dynamic>> payDeposit({
    required String applicationId,
    required num amount,
    required String transactionPin,
    required String idempotencyKey,
  }) =>
      post('/applications/${Uri.encodeComponent(applicationId)}/pay-deposit',
          body: <String, dynamic>{
            'amount': amount,
            'transactionPin': transactionPin,
          },
          idempotencyKey: idempotencyKey);

  Future<Map<String, dynamic>> payInstallment({
    required String financeId,
    required num amount,
    required String transactionPin,
    required String idempotencyKey,
  }) =>
      post('/finance/${Uri.encodeComponent(financeId)}/pay',
          body: <String, dynamic>{
            'amount': amount,
            'transactionPin': transactionPin,
          },
          idempotencyKey: idempotencyKey);

  Future<Map<String, String>> _headers() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    String? savedToken;
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final String? candidate = preferences.getString(key)?.trim();
      if (candidate != null && candidate.isNotEmpty) {
        savedToken = candidate;
        break;
      }
    }
    if (savedToken == null) {
      throw const SolarApiException(
        'Your login session was not found. Please sign in again.',
      );
    }
    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': savedToken.toLowerCase().startsWith('bearer ')
          ? savedToken
          : 'Bearer $savedToken',
    };
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? idempotencyKey,
  }) async {
    final Uri uri = Uri.parse('$_baseUrl$path');
    final Map<String, String> headers = await _headers();
    if (idempotencyKey != null) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    final http.Response response;
    if (method == 'POST') {
      response = await http
          .post(uri, headers: headers, body: jsonEncode(body ?? {}))
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
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw SolarApiException(
        data['message']?.toString() ??
            'Solar request failed. Please try again.',
        response.statusCode,
      );
    }
    return data;
  }
}
