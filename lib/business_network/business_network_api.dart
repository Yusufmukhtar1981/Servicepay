import 'dart:convert';

import 'package:http/http.dart' as http;

import '../services/session_store.dart';

/// Authenticated client for the Business Network API. Both transport and
/// token lookup are injectable so endpoint behavior can be tested without a
/// live account or service.
class BusinessNetworkApi {
  BusinessNetworkApi({
    http.Client? client,
    Future<String?> Function()? tokenProvider,
    this.baseUrl = const String.fromEnvironment(
      'SERVICEPAY_API_BASE_URL',
      defaultValue: 'https://api.servicepay.ng/api',
    ),
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _tokenProvider = tokenProvider ?? SessionStore.readToken;

  final http.Client _client;
  final bool _ownsClient;
  final Future<String?> Function() _tokenProvider;
  final String baseUrl;

  Future<dynamic> get(String path, {Map<String, String>? query}) =>
      _request('GET', path, query: query);

  Future<dynamic> put(String path, Map<String, dynamic> body) =>
      _request('PUT', path, body: body);

  Future<dynamic> post(String path, Map<String, dynamic> body,
          {Map<String, String>? query}) =>
      _request('POST', path, body: body, query: query);

  Future<dynamic> patch(String path, Map<String, dynamic> body) =>
      _request('PATCH', path, body: body);

  Future<dynamic> delete(String path, {Map<String, String>? query}) =>
      _request('DELETE', path, query: query);

  Future<String> getCsv(String path, {Map<String, String>? query}) async {
    final response = await _send(
      'GET',
      path,
      query: query,
      accept: 'text/csv, application/csv',
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      try {
        final body = jsonDecode(response.body);
        if (body is Map && body['message'] != null) {
          throw BusinessNetworkException(body['message'].toString());
        }
      } on BusinessNetworkException {
        rethrow;
      } catch (_) {
        // The status-based message below covers non-JSON error responses.
      }
      throw BusinessNetworkException(
          'Report export failed (${response.statusCode}).');
    }
    return response.body;
  }

  Future<http.Response> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
    String accept = 'application/json',
  }) async {
    final rawToken = (await _tokenProvider())?.trim() ?? '';
    if (rawToken.isEmpty) {
      throw const BusinessNetworkException('Please sign in again.');
    }
    final token =
        rawToken.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '');
    final uri = Uri.parse('$baseUrl/business-network/$path')
        .replace(queryParameters: query);
    final headers = <String, String>{
      'Accept': accept,
      'Authorization': 'Bearer $token',
    };
    if (body != null) headers['Content-Type'] = 'application/json';
    late final http.Response response;
    switch (method) {
      case 'GET':
        response = await _client
            .get(uri, headers: headers)
            .timeout(const Duration(seconds: 25));
      case 'PUT':
        response = await _client
            .put(uri, headers: headers, body: jsonEncode(body))
            .timeout(const Duration(seconds: 25));
      case 'POST':
        response = await _client
            .post(uri, headers: headers, body: jsonEncode(body))
            .timeout(const Duration(seconds: 25));
      case 'PATCH':
        response = await _client
            .patch(uri, headers: headers, body: jsonEncode(body))
            .timeout(const Duration(seconds: 25));
      case 'DELETE':
        response = await _client
            .delete(uri, headers: headers)
            .timeout(const Duration(seconds: 25));
      default:
        throw ArgumentError.value(method, 'method');
    }
    return response;
  }

  Future<dynamic> _request(String method, String path,
      {Map<String, String>? query, Map<String, dynamic>? body}) async {
    final response = await _send(method, path, query: query, body: body);
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw BusinessNetworkException(
          'The service returned an unreadable response (${response.statusCode}).');
    }
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded is! Map ||
        decoded['success'] != true) {
      final message = decoded is Map ? decoded['message']?.toString() : null;
      throw BusinessNetworkException(message?.isNotEmpty == true
          ? message!
          : 'Business Network request failed (${response.statusCode}).');
    }
    return decoded['data'];
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

class BusinessNetworkException implements Exception {
  const BusinessNetworkException(this.message);
  final String message;
  @override
  String toString() => message;
}
