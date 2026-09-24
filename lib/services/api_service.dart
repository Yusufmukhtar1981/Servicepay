import 'dart:convert';

import 'package:http/http.dart' as http;
import 'session_store.dart';

class ApiService {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Duration requestTimeout = Duration(seconds: 60);

  static Future<List<Map<String, dynamic>>> getBeneficiaries({
    String search = '',
  }) async {
    final token = await _getAuthToken();
    final query = search.trim().isEmpty
        ? ''
        : '?search=${Uri.encodeQueryComponent(search.trim())}';
    final response = await http.get(
      Uri.parse('$baseUrl/customer/beneficiaries$query'),
      headers: {'Accept': 'application/json', 'Authorization': 'Bearer $token'},
    ).timeout(requestTimeout);
    final result = _handleResponse(response);
    final raw = result['beneficiaries'];
    return raw is List
        ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
  }

  static Future<Map<String, dynamic>> saveBeneficiary({
    required String phone,
    required String name,
    String network = '',
    String serviceType = '',
  }) async {
    final token = await _getAuthToken();
    final response = await http.post(
      Uri.parse('$baseUrl/customer/beneficiaries'),
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer $token'},
      body: jsonEncode({'phone': phone.trim(), 'name': name.trim(), 'network': network.trim(), 'serviceType': serviceType}),
    ).timeout(requestTimeout);
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateBeneficiary({
    required String id,
    required String name,
  }) async {
    final token = await _getAuthToken();
    final response = await http.patch(
      Uri.parse('$baseUrl/customer/beneficiaries/$id'),
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer $token'},
      body: jsonEncode({'name': name.trim()}),
    ).timeout(requestTimeout);
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> deleteBeneficiary(String id) async {
    final token = await _getAuthToken();
    final response = await http.delete(
      Uri.parse('$baseUrl/customer/beneficiaries/$id'),
      headers: {'Accept': 'application/json', 'Authorization': 'Bearer $token'},
    ).timeout(requestTimeout);
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getDataPlans({
    required String network,
  }) async {
    final String token = await _getAuthToken();

    final String selectedNetwork = network.trim();

    if (selectedNetwork.isEmpty) {
      throw Exception(
        'Please select a valid network.',
      );
    }

    final Uri uri = Uri.parse(
      '$baseUrl/clubkonnect/data-plans/'
      '${Uri.encodeComponent(selectedNetwork)}',
    );

    final http.Response response = await http.get(
      uri,
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    ).timeout(requestTimeout);

    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> buyAirtime({
    required String network,
    required String phone,
    required String amount,
    required String transactionPin,
    String? biometricGrant,
    String? deviceId,
    String? idempotencyKey,
  }) async {
    final String token = await _getAuthToken();

    final http.Response response = await http
        .post(
          Uri.parse(
            '$baseUrl/clubkonnect/airtime',
          ),
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Bearer $token',
            if (idempotencyKey != null && idempotencyKey.isNotEmpty)
              'Idempotency-Key': idempotencyKey,
          },
          body: jsonEncode({
            'network': network.trim(),
            'phone': phone.trim(),
            'amount': amount.trim(),
            if (transactionPin.isNotEmpty) 'transactionPin': transactionPin,
            if (biometricGrant != null) 'biometricGrant': biometricGrant,
            if (deviceId != null) 'deviceId': deviceId,
          }),
        )
        .timeout(requestTimeout);

    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> buyData({
    required String network,
    required String phone,
    required String planCode,
    required num amount,
    required String transactionPin,
    String? biometricGrant,
    String? deviceId,
    String? idempotencyKey,
  }) async {
    final String token = await _getAuthToken();

    final http.Response response = await http
        .post(
          Uri.parse(
            '$baseUrl/clubkonnect/data',
          ),
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Bearer $token',
            if (idempotencyKey != null && idempotencyKey.isNotEmpty)
              'Idempotency-Key': idempotencyKey,
          },
          body: jsonEncode({
            'network': network.trim(),
            'phone': phone.trim(),
            'planCode': planCode.trim(),
            'amount': amount,
            if (transactionPin.isNotEmpty) 'transactionPin': transactionPin,
            if (biometricGrant != null) 'biometricGrant': biometricGrant,
            if (deviceId != null) 'deviceId': deviceId,
          }),
        )
        .timeout(requestTimeout);

    return _handleResponse(response);
  }

  static Future<String> _getAuthToken() async {
    final String? token = (await SessionStore.readToken())?.trim();

    if (token == null || token.isEmpty) {
      throw Exception(
        'Your login session was not found. '
        'Please sign in again.',
      );
    }

    return token;
  }

  static Map<String, dynamic> _handleResponse(
    http.Response response,
  ) {
    Map<String, dynamic> result;

    try {
      final dynamic decoded = jsonDecode(response.body);

      if (decoded is Map<String, dynamic>) {
        result = Map<String, dynamic>.from(decoded);
      } else if (decoded is Map) {
        result = Map<String, dynamic>.from(decoded);
      } else {
        result = {
          'success': false,
          'message': 'The server returned an invalid response.',
          'data': decoded,
        };
      }
    } catch (_) {
      final String responseText = response.body.trim();

      result = {
        'success': false,
        'message': responseText.isNotEmpty
            ? responseText
            : 'The server returned an empty response.',
      };
    }

    result['httpStatus'] = response.statusCode;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return result;
    }

    result['success'] = false;

    final String? currentMessage = result['message']?.toString().trim();

    if (currentMessage == null || currentMessage.isEmpty) {
      result['message'] = _defaultErrorMessage(
        response.statusCode,
      );
    }

    return result;
  }

  static String _defaultErrorMessage(
    int statusCode,
  ) {
    switch (statusCode) {
      case 400:
        return 'The request could not be processed.';

      case 401:
        return 'Your login session has expired. '
            'Please sign in again.';

      case 403:
        return 'Your account is not allowed to '
            'complete this transaction.';

      case 404:
        return 'The requested service was not found.';

      case 408:
      case 504:
        return 'The provider took too long to respond.';

      case 500:
      case 502:
      case 503:
        return 'The service is temporarily unavailable.';

      default:
        return 'The transaction could not be completed.';
    }
  }
}
