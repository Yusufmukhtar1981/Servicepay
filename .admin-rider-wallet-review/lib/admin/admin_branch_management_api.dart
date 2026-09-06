import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminBranchManagementApi {
  AdminBranchManagementApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api/branches',
    this.usersUrl = 'https://api.servicepay.ng/api/admin/users',
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null;

  final http.Client _client;
  final bool _ownsClient;
  final String baseUrl;
  final String usersUrl;

  Future<List<Map<String, dynamic>>> list() async {
    final result = await _request('GET', baseUrl);
    return _maps(result['branches'] ?? result['data']);
  }

  Future<Map<String, dynamic>> detail(String branchId) =>
      _request('GET', '$baseUrl/${Uri.encodeComponent(branchId)}');

  Future<Map<String, dynamic>> overview() =>
      _request('GET', '$baseUrl/overview');

  Future<Map<String, dynamic>> create(Map<String, dynamic> payload) =>
      _request('POST', baseUrl, body: payload);

  Future<Map<String, dynamic>> update(
          String branchId, Map<String, dynamic> payload) =>
      _request('PUT', '$baseUrl/${Uri.encodeComponent(branchId)}',
          body: payload);

  Future<Map<String, dynamic>> setStatus(String branchId, String status) =>
      _request('PUT', '$baseUrl/${Uri.encodeComponent(branchId)}/activate',
          body: <String, dynamic>{'status': status});

  Future<Map<String, dynamic>> assignManager(String branchId,
          {String? managerId, String? jobTitle}) =>
      _request('PUT', '$baseUrl/${Uri.encodeComponent(branchId)}/manager',
          body: <String, dynamic>{
            'managerId': managerId,
            if (jobTitle != null && jobTitle.trim().isNotEmpty)
              'jobTitle': jobTitle.trim(),
          });

  /// Removes the branch assignment only; it does not delete the staff user.
  Future<Map<String, dynamic>> removeManager(String branchId) =>
      _request('DELETE', '$baseUrl/${Uri.encodeComponent(branchId)}/manager');

  Future<List<Map<String, dynamic>>> managers() async {
    final result = await _request('GET', usersUrl, query: <String, String>{
      'role': 'STAFF',
      'status': 'ACTIVE',
      'limit': '100',
    });
    return _maps(result['users'] ?? result['data']);
  }

  Future<Map<String, dynamic>> targets(String branchId) =>
      _request('GET', '$baseUrl/targets',
          query: <String, String>{'branchId': branchId});

  Future<Map<String, dynamic>> reports(String branchId) =>
      _request('GET', '$baseUrl/reports',
          query: <String, String>{'branchId': branchId});

  Future<Map<String, dynamic>> approvals(String branchId) =>
      _request('GET', '$baseUrl/approvals',
          query: <String, String>{'branchId': branchId});

  Future<Map<String, dynamic>> allApprovals() =>
      _request('GET', '$baseUrl/approvals');

  Future<Map<String, dynamic>> _request(
    String method,
    String url, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    final token = await _token();
    final uri = Uri.parse(url).replace(queryParameters: query);
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
    };
    late http.Response response;
    switch (method) {
      case 'POST':
        response =
            await _client.post(uri, headers: headers, body: jsonEncode(body));
        break;
      case 'PUT':
        response =
            await _client.put(uri, headers: headers, body: jsonEncode(body));
        break;
      case 'DELETE':
        response = await _client.delete(uri, headers: headers);
        break;
      default:
        response = await _client.get(uri, headers: headers);
    }
    final decoded = _decode(response.body);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        (decoded.containsKey('success') && decoded['success'] != true)) {
      throw AdminBranchException(
        decoded['message']?.toString() ??
            decoded['error']?.toString() ??
            'Unable to complete the branch request.',
      );
    }
    return decoded;
  }

  Future<String> _token() async {
    final preferences = await SharedPreferences.getInstance();
    for (final key in const <String>[
      'auth_token',
      'token',
      'admin_token',
      'access_token',
      'accessToken',
    ]) {
      var token = preferences.getString(key)?.trim() ?? '';
      token =
          token.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '');
      if (token.isNotEmpty) return token;
    }
    throw const AdminBranchException(
      'Your login session was not found. Please sign in again.',
    );
  }

  Map<String, dynamic> _decode(String source) {
    try {
      final decoded = jsonDecode(source);
      return decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  List<Map<String, dynamic>> _maps(dynamic value) => value is List
      ? value
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList()
      : <Map<String, dynamic>>[];

  void close() {
    if (_ownsClient) _client.close();
  }
}

class AdminBranchException implements Exception {
  const AdminBranchException(this.message);

  final String message;

  @override
  String toString() => message;
}
