import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminDeliveryApiException implements Exception {
  const AdminDeliveryApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

abstract class AdminDeliveryApiClient {
  Future<List<Map<String, dynamic>>> getDeliveries({String status = 'ALL'});

  Future<List<Map<String, dynamic>>> getAvailableRiders(String deliveryId);

  Future<Map<String, dynamic>> assignRider({
    required String deliveryId,
    required String riderId,
  });
  Future<Map<String, dynamic>> reassignRider({
    required String deliveryId,
    required String riderId,
  });
}

class AdminDeliveryApi implements AdminDeliveryApiClient {
  AdminDeliveryApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api/admin',
    this.requestTimeout = const Duration(seconds: 30),
    this.tokenLoader,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final Duration requestTimeout;
  final Future<String> Function()? tokenLoader;

  static Map<String, dynamic> mapFrom(dynamic value) {
    return value is Map
        ? Map<String, dynamic>.from(value)
        : <String, dynamic>{};
  }

  static List<Map<String, dynamic>> listFrom(dynamic value) {
    return value is List
        ? value
              .whereType<Map>()
              .map(
                (Map<dynamic, dynamic> item) => Map<String, dynamic>.from(item),
              )
              .toList()
        : <Map<String, dynamic>>[];
  }

  Future<String> _loadToken() async {
    if (tokenLoader != null) {
      return (await tokenLoader!()).trim();
    }
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      String token = preferences.getString(key)?.trim() ?? '';
      if (token.toLowerCase().startsWith('bearer ')) {
        token = token.substring(7).trim();
      }
      if (token.isNotEmpty) return token;
    }
    return '';
  }

  Future<Map<String, String>> _headers() async {
    final String token = await _loadToken();
    if (token.isEmpty) {
      throw const AdminDeliveryApiException(
        'Your admin session was not found. Please sign in again.',
        statusCode: 401,
      );
    }
    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    final Uri uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    try {
      final Map<String, String> headers = await _headers();
      final http.Response response;
      if (method == 'PATCH') {
        response = await _client
            .patch(uri, headers: headers, body: jsonEncode(body))
            .timeout(requestTimeout);
      } else {
        response = await _client
            .get(uri, headers: headers)
            .timeout(requestTimeout);
      }

      Map<String, dynamic> decoded = <String, dynamic>{};
      if (response.body.trim().isNotEmpty) {
        try {
          decoded = mapFrom(jsonDecode(response.body));
        } on FormatException {
          throw AdminDeliveryApiException(
            'The ServicePay server returned an invalid response.',
            statusCode: response.statusCode,
          );
        }
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw AdminDeliveryApiException(
          decoded['message']?.toString().trim().isNotEmpty == true
              ? decoded['message'].toString()
              : 'The delivery request failed.',
          statusCode: response.statusCode,
        );
      }
      return decoded;
    } on TimeoutException {
      throw const AdminDeliveryApiException(
        'The ServicePay server took too long to respond. Please retry.',
      );
    } on http.ClientException {
      throw const AdminDeliveryApiException(
        'Unable to reach the ServicePay server. Check your connection and retry.',
      );
    }
  }

  @override
  Future<List<Map<String, dynamic>>> getDeliveries({
    String status = 'ALL',
  }) async {
    final String normalizedStatus = status.trim().toUpperCase();
    final Map<String, String> query = <String, String>{
      'page': '1',
      'limit': '100',
    };
    if (normalizedStatus.isNotEmpty && normalizedStatus != 'ALL') {
      query['status'] = normalizedStatus;
    }
    final Map<String, dynamic> root = await _request(
      'GET',
      '/deliveries',
      query: query,
    );
    final Map<String, dynamic> data = mapFrom(root['data']);
    return listFrom(data['deliveries'] ?? root['deliveries']);
  }

  @override
  Future<List<Map<String, dynamic>>> getAvailableRiders(
    String deliveryId,
  ) async {
    final Map<String, dynamic> root = await _request(
      'GET',
      '/deliveries/${Uri.encodeComponent(deliveryId)}/available-riders',
    );
    final Map<String, dynamic> data = mapFrom(root['data']);
    return listFrom(data['riders'] ?? root['riders']);
  }

  @override
  Future<Map<String, dynamic>> assignRider({
    required String deliveryId,
    required String riderId,
  }) async {
    final Map<String, dynamic> root = await _request(
      'PATCH',
      '/deliveries/${Uri.encodeComponent(deliveryId)}/assign-rider',
      body: <String, dynamic>{'riderId': riderId},
    );
    final Map<String, dynamic> data = mapFrom(root['data']);
    return mapFrom(data['delivery'] ?? root['delivery']);
  }

  @override
  Future<Map<String, dynamic>> reassignRider({
    required String deliveryId,
    required String riderId,
  }) async {
    final Map<String, dynamic> root = await _request(
      'PATCH',
      '/deliveries/${Uri.encodeComponent(deliveryId)}/reassign-rider',
      body: <String, dynamic>{'riderId': riderId},
    );
    return mapFrom(root['delivery'] ?? mapFrom(root['data'])['delivery']);
  }
}
