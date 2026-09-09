import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminRolesPermissionsApi {
  AdminRolesPermissionsApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;

  Future<Map<String, String>> _headers() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String token = prefs.getString('auth_token') ?? '';
    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      if (token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final Uri uri = Uri.parse('$baseUrl$path');
    final Map<String, String> headers = await _headers();
    late final http.Response response;
    switch (method) {
      case 'POST':
        response = await _client.post(
          uri,
          headers: headers,
          body: jsonEncode(body ?? <String, dynamic>{}),
        );
      case 'PUT':
        response = await _client.put(
          uri,
          headers: headers,
          body: jsonEncode(body ?? <String, dynamic>{}),
        );
      case 'DELETE':
        response = await _client.delete(uri, headers: headers);
      default:
        response = await _client.get(uri, headers: headers);
    }
    final dynamic decoded = response.body.trim().isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body);
    final Map<String, dynamic> result = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AdminRolesApiException(
        result['message']?.toString() ?? 'The Admin request failed.',
        statusCode: response.statusCode,
        code: result['code']?.toString(),
        invalidPermissions: (result['invalidPermissions'] as List?)
                ?.map((dynamic value) => value.toString())
                .toList() ??
            const <String>[],
      );
    }
    return result;
  }

  Future<Map<String, dynamic>> loadCatalog() =>
      _request('GET', '/staff-management/permissions');

  Future<List<Map<String, dynamic>>> loadRoles() async {
    final Map<String, dynamic> result =
        await _request('GET', '/staff-management/roles?status=ALL');
    return (result['roles'] as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map((Map value) => Map<String, dynamic>.from(value))
        .toList();
  }

  Future<List<Map<String, dynamic>>> loadStaff() async {
    final Map<String, dynamic> result =
        await _request('GET', '/staff-management/staff?status=ALL');
    return (result['staff'] as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map((Map value) => Map<String, dynamic>.from(value))
        .toList();
  }

  Future<List<Map<String, dynamic>>> loadRoleStaff(String roleId) async {
    final Map<String, dynamic> result =
        await _request('GET', '/staff-management/roles/$roleId/staff');
    return (result['staff'] as List? ?? const <dynamic>[])
        .whereType<Map>()
        .map((Map value) => Map<String, dynamic>.from(value))
        .toList();
  }

  Future<void> createRole(Map<String, dynamic> body) =>
      _request('POST', '/staff-management/roles', body: body);

  Future<void> updateRole(String roleId, Map<String, dynamic> body) =>
      _request('PUT', '/staff-management/roles/$roleId', body: body);

  Future<void> duplicateRole(
    String roleId,
    Map<String, dynamic> body,
  ) =>
      _request(
        'POST',
        '/staff-management/roles/$roleId/duplicate',
        body: body,
      );

  Future<void> assignStaffRole(String staffId, String roleId) => _request(
        'PUT',
        '/staff-management/staff/$staffId/role',
        body: <String, dynamic>{'roleId': roleId},
      );
}

class AdminRolesApiException implements Exception {
  const AdminRolesApiException(
    this.message, {
    required this.statusCode,
    this.code,
    this.invalidPermissions = const <String>[],
  });

  final String message;
  final int statusCode;
  final String? code;
  final List<String> invalidPermissions;

  @override
  String toString() => message;
}
