import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static Future<Map<String, dynamic>> buyAirtime({
    required String network,
    required String phone,
    required String amount,
  }) async {
    final token = await _getAuthToken();

    final response = await http
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
            'network': network,
            'phone': phone,
            'amount': amount,
          }),
        )
        .timeout(
          const Duration(seconds: 60),
        );

    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> buyData({
    required String network,
    required String phone,
    required String planCode,
    required num amount,
  }) async {
    final token = await _getAuthToken();

    final response = await http
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
            'network': network,
            'phone': phone,
            'planCode': planCode,
            'amount': amount,
          }),
        )
        .timeout(
          const Duration(seconds: 60),
        );

    return _handleResponse(response);
  }

  static Future<String> _getAuthToken() async {
    final prefs =
        await SharedPreferences.getInstance();

    final token =
        prefs.getString('auth_token')?.trim();

    if (token == null || token.isEmpty) {
      throw Exception(
        'Your login session was not found. Please sign in again.',
      );
    }

    return token;
  }

  static Map<String, dynamic> _handleResponse(
    http.Response response,
  ) {
    Map<String, dynamic> result;

    try {
      final decoded = jsonDecode(response.body);

      if (decoded is Map<String, dynamic>) {
        result = decoded;
      } else if (decoded is Map) {
        result = Map<String, dynamic>.from(
          decoded,
        );
      } else {
        result = {
          'success': false,
          'message':
              'The server returned an invalid response.',
          'data': decoded,
        };
      }
    } catch (_) {
      result = {
        'success': false,
        'message':
            response.body.trim().isNotEmpty
                ? response.body.trim()
                : 'The server returned an empty response.',
      };
    }

    result['httpStatus'] = response.statusCode;

    if (response.statusCode >= 200 &&
        response.statusCode < 300) {
      return result;
    }

    result['success'] = false;

    result['message'] ??=
        _defaultErrorMessage(
          response.statusCode,
        );

    return result;
  }

  static String _defaultErrorMessage(
    int statusCode,
  ) {
    switch (statusCode) {
      case 400:
        return 'The request could not be processed.';
      case 401:
        return 'Your login session has expired. Please sign in again.';
      case 403:
        return 'Your account is not allowed to complete this transaction.';
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
