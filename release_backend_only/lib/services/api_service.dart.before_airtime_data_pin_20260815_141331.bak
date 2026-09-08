import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Duration requestTimeout = Duration(seconds: 60);

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
          },
          body: jsonEncode({
            'network': network.trim(),
            'phone': phone.trim(),
            'amount': amount.trim(),
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
          },
          body: jsonEncode({
            'network': network.trim(),
            'phone': phone.trim(),
            'planCode': planCode.trim(),
            'amount': amount,
          }),
        )
        .timeout(requestTimeout);

    return _handleResponse(response);
  }

  static Future<String> _getAuthToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    final String? token = prefs.getString('auth_token')?.trim();

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
