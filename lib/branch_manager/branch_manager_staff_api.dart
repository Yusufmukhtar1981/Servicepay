import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class BranchStaff {
  const BranchStaff(this.data);
  final Map<String, dynamic> data;
  String get id => '${data['_id'] ?? data['id'] ?? ''}';
  String get name => '${data['fullName'] ?? ''}';
  String get status => '${data['status'] ?? 'ACTIVE'}';
}

class TemporaryCredentials {
  const TemporaryCredentials(this.data);
  final Map<String, dynamic> data;
  String get identifier => '${data['identifier'] ?? data['phone'] ?? ''}';
  String get password => '${data['temporaryPassword'] ?? ''}';
}

abstract class BranchManagerStaffApi {
  Future<List<BranchStaff>> list(String branchId,
      {String? search, String? status});
  Future<({BranchStaff staff, TemporaryCredentials credentials})> create(
      String branchId, Map<String, dynamic> input);
  Future<BranchStaff> update(
      String branchId, String staffId, Map<String, dynamic> input);
  Future<BranchStaff> setStatus(String branchId, String staffId, String status);
  Future<TemporaryCredentials> resetPassword(String branchId, String staffId);
}

class BranchManagerStaffHttpApi implements BranchManagerStaffApi {
  BranchManagerStaffHttpApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    this.preferencesLoader = SharedPreferences.getInstance,
  }) : _client = client ?? http.Client();
  final http.Client _client;
  final String baseUrl;
  final Future<SharedPreferences> Function() preferencesLoader;

  @override
  Future<List<BranchStaff>> list(String branchId,
      {String? search, String? status}) async {
    final data = await _request('GET', 'branches/$branchId/staff',
        query: <String, String>{
          if (search != null && search.isNotEmpty) 'search': search,
          if (status != null && status.isNotEmpty) 'status': status,
        });
    final rows = data['staff'];
    return rows is List
        ? rows
            .whereType<Map>()
            .map((e) => BranchStaff(Map<String, dynamic>.from(e)))
            .toList()
        : <BranchStaff>[];
  }

  @override
  Future<({BranchStaff staff, TemporaryCredentials credentials})> create(
      String branchId, Map<String, dynamic> input) async {
    final data =
        await _request('POST', 'branches/$branchId/staff', body: input);
    return (
      staff: BranchStaff(_map(data['staff'])),
      credentials: TemporaryCredentials(_map(data['temporaryCredentials']))
    );
  }

  @override
  Future<BranchStaff> update(
      String branchId, String staffId, Map<String, dynamic> input) async {
    final data =
        await _request('PUT', 'branches/$branchId/staff/$staffId', body: input);
    return BranchStaff(_map(data['staff']));
  }

  @override
  Future<BranchStaff> setStatus(
      String branchId, String staffId, String status) async {
    final data = await _request(
        'PUT', 'branches/$branchId/staff/$staffId/status',
        body: <String, dynamic>{'status': status});
    return BranchStaff(_map(data['staff']));
  }

  @override
  Future<TemporaryCredentials> resetPassword(
      String branchId, String staffId) async {
    final data = await _request(
        'POST', 'branches/$branchId/staff/$staffId/password-reset');
    return TemporaryCredentials(_map(data['temporaryCredentials']));
  }

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, String>? query, Map<String, dynamic>? body}) async {
    final prefs = await preferencesLoader();
    final token = (prefs.getString('auth_token') ??
            prefs.getString('access_token') ??
            prefs.getString('token') ??
            '')
        .trim();
    if (token.isEmpty) {
      throw Exception('Your session has expired. Please sign in again.');
    }
    final root = baseUrl.replaceFirst(RegExp(r'/+$'), '').endsWith('/api')
        ? baseUrl.replaceFirst(RegExp(r'/+$'), '')
        : '${baseUrl.replaceFirst(RegExp(r'/+$'), '')}/api';
    final uri = Uri.parse('$root/$path')
        .replace(queryParameters: query?.isEmpty == false ? query : null);
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json'
    };
    final response = switch (method) {
      'POST' => await _client.post(uri,
          headers: headers, body: body == null ? null : jsonEncode(body)),
      'PUT' => await _client.put(uri,
          headers: headers, body: body == null ? null : jsonEncode(body)),
      _ => await _client.get(uri, headers: headers),
    };
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(decoded is Map && decoded['message'] != null
          ? '${decoded['message']}'
          : 'Unable to complete staff request.');
    }
    return _map(decoded);
  }

  static Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
}
