import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Authenticated client for interstate-operations endpoints.  Branch and rider
/// identity is deliberately inferred by the server from the access token.
class LogisticsApi {
  LogisticsApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    this.tokenLoader,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final Future<String> Function()? tokenLoader;

  Future<List<Map<String, dynamic>>> list(
    String scope,
    String resource, {
    Map<String, String>? query,
  }) async {
    final Map<String, dynamic> root = await request(
        'GET', '/$scope/logistics/interstate/$resource',
        query: query);
    final Map<String, dynamic> data = map(root['data']);
    // Interstate endpoints currently return named arrays at the top level
    // (for example, `{ shipments: [...] }`), while newer endpoints may wrap
    // the same named array in `data`.
    final dynamic rows = data[resource] ??
        data['items'] ??
        data['results'] ??
        root[resource] ??
        root['items'] ??
        root['results'];
    return listOf(rows);
  }

  Future<List<Map<String, dynamic>>> listBranches() async {
    final Map<String, dynamic> root =
        await request('GET', '/admin/logistics/interstate/branches');
    return listOf(root['branches'] ?? map(root['data'])['branches']);
  }

  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    final String token = await _token();
    if (token.isEmpty)
      throw const LogisticsApiException(
          'Your session has expired. Please sign in again.');
    final Uri uri =
        Uri.parse('${baseUrl.replaceFirst(RegExp(r'/+$'), '')}$path')
            .replace(queryParameters: query);
    final Map<String, String> headers = <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
    final http.Response response;
    if (method == 'POST') {
      response =
          await _client.post(uri, headers: headers, body: jsonEncode(body));
    } else if (method == 'PATCH') {
      response =
          await _client.patch(uri, headers: headers, body: jsonEncode(body));
    } else if (method == 'DELETE') {
      response = await _client.delete(uri, headers: headers);
    } else {
      response = await _client.get(uri, headers: headers);
    }
    dynamic decoded;
    try {
      decoded = response.body.trim().isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
    } on FormatException {
      throw LogisticsApiException(
          'The server returned an invalid response.', response.statusCode);
    }
    final Map<String, dynamic> root = map(decoded);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw LogisticsApiException(
        root['message']?.toString() ??
            'The logistics request could not be completed.',
        response.statusCode,
        root['code']?.toString(),
        map(root['shipment']).isNotEmpty
            ? map(root['shipment'])
            : map(root['data']),
      );
    }
    return root;
  }

  Future<String> _token() async {
    if (tokenLoader != null)
      return (await tokenLoader!())
          .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
          .trim();
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    for (final String key in <String>[
      'auth_token',
      'access_token',
      'token',
      'jwt_token',
      'jwt'
    ]) {
      final String value = (prefs.getString(key) ?? '')
          .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
          .trim();
      if (value.isNotEmpty) return value;
    }
    return '';
  }

  static Map<String, dynamic> map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  static List<Map<String, dynamic>> listOf(dynamic value) => value is List
      ? value.whereType<Map>().map((Map item) => map(item)).toList()
      : <Map<String, dynamic>>[];
}

class LogisticsApiException implements Exception {
  const LogisticsApiException(this.message,
      [this.statusCode, this.code, this.data]);
  final String message;
  final int? statusCode;
  final String? code;
  final Map<String, dynamic>? data;
  @override
  String toString() => message;
}
