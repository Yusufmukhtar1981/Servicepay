import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class EmpowermentApiException implements Exception {
  final String message;
  final int? statusCode;

  const EmpowermentApiException(this.message, [this.statusCode]);

  @override
  String toString() => message;
}

class EmpowermentApiService {
  static const String _baseUrl = 'https://api.servicepay.ng/api/empowerment';

  String _pendingOperationPreferenceKey(String operation) =>
      'empowerment_pending_operation_$operation';

  Future<String> beginMonetaryOperation(String operation) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    final String preferenceKey = _pendingOperationPreferenceKey(operation);
    final String? existingKey = preferences.getString(preferenceKey);
    if (existingKey != null && existingKey.trim().isNotEmpty) {
      return existingKey.trim();
    }

    final String key =
        'empowerment-$operation-${DateTime.now().microsecondsSinceEpoch}';
    await preferences.setString(preferenceKey, key);
    return key;
  }

  Future<void> completeMonetaryOperation(String operation) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    await preferences.remove(_pendingOperationPreferenceKey(operation));
  }

  Future<void> abandonMonetaryOperation(String operation) async {
    await completeMonetaryOperation(operation);
  }

  Future<Map<String, String>> _headers({
    String? idempotencyKey,
  }) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    String token = '';

    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'jwt_token',
    ]) {
      final String? value = preferences.getString(key);
      if (value != null && value.trim().isNotEmpty) {
        token = value.trim();
        break;
      }
    }

    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      if (token.isNotEmpty)
        'Authorization': token.startsWith('Bearer ') ? token : 'Bearer $token',
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
    };
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, String>? query,
  }) async {
    final Uri uri = Uri.parse('$_baseUrl$path').replace(
      queryParameters: query?.isEmpty ?? true ? null : query,
    );
    final http.Response response = await http
        .get(uri, headers: await _headers())
        .timeout(const Duration(seconds: 45));
    return _decode(response);
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
    String? idempotencyKey,
  }) async {
    final http.Response response = await http
        .post(
          Uri.parse('$_baseUrl$path'),
          headers: await _headers(idempotencyKey: idempotencyKey),
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 60));
    return _decode(response);
  }

  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) async {
    final http.Response response = await http
        .patch(
          Uri.parse('$_baseUrl$path'),
          headers: await _headers(),
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 45));
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = <String, dynamic>{};
    }

    final Map<String, dynamic> body = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EmpowermentApiException(
        body['message']?.toString() ?? 'Empowerment request failed.',
        response.statusCode,
      );
    }
    return body;
  }
}
