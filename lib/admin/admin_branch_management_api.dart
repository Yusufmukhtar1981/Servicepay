import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

abstract class AdminBranchManagementApi {
  Future<BranchOverview> overview();
  Future<Map<String, dynamic>> dashboard({String? branchId});
  Future<List<Map<String, dynamic>>> branches();
  Future<Map<String, dynamic>> branch(String branchId);
  Future<Map<String, dynamic>> createBranch(Map<String, dynamic> values);
  Future<Map<String, dynamic>> updateBranch(
      String branchId, Map<String, dynamic> values);
  Future<void> setBranchStatus(String branchId, String status,
      {String? reason});
  Future<void> assignManager(String branchId, String managerId,
      {String? jobTitle});

  /// Removes the current manager without removing their staff account.
  ///
  /// Implementations that predate manager lifecycle support can override this.
  Future<void> removeManager(String branchId) =>
      Future<void>.error(UnimplementedError('Manager removal is unavailable.'));
  Future<void> assignMember(String branchId, String userId, {String? jobTitle});
  Future<void> removeMember(String branchId, String userId);
  Future<List<Map<String, dynamic>>> members(String branchId);
  Future<List<Map<String, dynamic>>> targets({String? branchId});
  Future<Map<String, dynamic>> createTarget(Map<String, dynamic> values);
  Future<Map<String, dynamic>> updateTargetProgress(
      String targetId, num actual);
  Future<List<Map<String, dynamic>>> approvals({String? branchId});
  Future<void> reviewApproval(String requestId, String status,
      {String? reviewNote});
  Future<List<Map<String, dynamic>>> reports();
  Future<List<Map<String, dynamic>>> audit();
  Future<List<Map<String, dynamic>>> operationalRequests({String? branchId});
  Future<Map<String, dynamic>> submitOperationalRequest(
      Map<String, dynamic> values,
      {required String idempotencyKey});
}

class BranchOverview {
  const BranchOverview(
      {required this.metrics,
      required this.topBranches,
      required this.attentionBranches});
  final Map<String, dynamic> metrics;
  final List<Map<String, dynamic>> topBranches;
  final List<Map<String, dynamic>> attentionBranches;
}

class AdminBranchManagementHttpApi implements AdminBranchManagementApi {
  AdminBranchManagementHttpApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    this.preferencesLoader = SharedPreferences.getInstance,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final Future<SharedPreferences> Function() preferencesLoader;

  @override
  Future<BranchOverview> overview() async {
    final Map<String, dynamic> response =
        await _request('GET', 'branches/overview');
    final Map<String, dynamic> data =
        _map(response['overview'] ?? response['dashboard']);
    final List<Map<String, dynamic>> rankings = _list(data['rankings']);
    return BranchOverview(
      metrics: _map(data['metrics']),
      topBranches: rankings,
      attentionBranches: _list(data['attentionBranches']),
    );
  }

  @override
  Future<Map<String, dynamic>> dashboard({String? branchId}) =>
      _request('GET', 'branches/dashboard', query: _branchQuery(branchId))
          .then((value) => _map(value['dashboard']));

  @override
  Future<List<Map<String, dynamic>>> branches() async =>
      _list((await _request('GET', 'branches'))['branches']);
  @override
  Future<Map<String, dynamic>> branch(String branchId) =>
      _request('GET', 'branches/$branchId')
          .then((value) => _map(value['branch']));
  @override
  Future<Map<String, dynamic>> createBranch(Map<String, dynamic> values) =>
      _request('POST', 'branches', body: values).then((value) {
        final Map<String, dynamic> branch = _map(value['branch']);
        // Credentials are intentionally retained only in this immediate
        // creation result so callers can show them once, not fetch them later.
        final Map<String, dynamic> credentials =
            _map(value['temporaryCredentials'] ?? value['credentials']);
        if (credentials.isNotEmpty) {
          branch['_temporaryCredentials'] = credentials;
        }
        return branch;
      });
  @override
  Future<Map<String, dynamic>> updateBranch(
          String branchId, Map<String, dynamic> values) =>
      _request('PUT', 'branches/$branchId', body: values)
          .then((value) => _map(value['branch']));
  @override
  Future<void> setBranchStatus(String branchId, String status,
          {String? reason}) =>
      _request('PUT', 'branches/$branchId/activate', body: <String, dynamic>{
        'status': status,
        if (reason != null) 'reason': reason
      }).then<void>((_) {});
  @override
  Future<void> assignManager(String branchId, String managerId,
          {String? jobTitle}) =>
      _request('PUT', 'branches/$branchId/manager', body: <String, dynamic>{
        'managerId': managerId,
        if (jobTitle != null) 'jobTitle': jobTitle
      }).then<void>((_) {});
  @override
  Future<void> removeManager(String branchId) =>
      _request('DELETE', 'branches/$branchId/manager').then<void>((_) {});
  @override
  Future<void> assignMember(String branchId, String userId,
          {String? jobTitle}) =>
      _request('POST', 'branches/$branchId/members', body: <String, dynamic>{
        'userId': userId,
        if (jobTitle != null) 'jobTitle': jobTitle
      }).then<void>((_) {});
  @override
  Future<void> removeMember(String branchId, String userId) =>
      _request('DELETE', 'branches/$branchId/members/$userId')
          .then<void>((_) {});
  @override
  Future<List<Map<String, dynamic>>> members(String branchId) async =>
      _list((await _request('GET', 'branches/$branchId/members'))['members']);
  @override
  Future<List<Map<String, dynamic>>> targets({String? branchId}) async =>
      _list((await _request('GET', 'branches/targets',
          query: _branchQuery(branchId)))['targets']);
  @override
  Future<Map<String, dynamic>> createTarget(Map<String, dynamic> values) =>
      _request('POST', 'branches/targets',
              body: values, query: _branchQuery(values['branchId']?.toString()))
          .then((value) => _map(value['target'] ?? value['request']));
  @override
  Future<Map<String, dynamic>> updateTargetProgress(
          String targetId, num actual) =>
      _request('PUT', 'branches/targets/$targetId/progress',
              body: <String, dynamic>{'actual': actual})
          .then((value) => _map(value['target'] ?? value['request']));
  @override
  Future<List<Map<String, dynamic>>> approvals({String? branchId}) async =>
      _list((await _request('GET', 'branches/approvals',
          query: _branchQuery(branchId)))['requests']);
  @override
  Future<void> reviewApproval(String requestId, String status,
          {String? reviewNote}) =>
      _request('PUT', 'branches/approvals/$requestId/review',
          body: <String, dynamic>{
            'status': status,
            if (reviewNote != null) 'reviewNote': reviewNote
          }).then<void>((_) {});
  @override
  Future<List<Map<String, dynamic>>> reports() async =>
      _list((await _request('GET', 'branches/reports'))['transactions']);
  @override
  Future<List<Map<String, dynamic>>> audit() async =>
      _list((await _request('GET', 'branches/audit'))['logs']);
  @override
  Future<List<Map<String, dynamic>>> operationalRequests(
          {String? branchId}) async =>
      _list((await _request('GET', 'branches/operational-requests',
          query: _branchQuery(branchId)))['requests']);
  @override
  Future<Map<String, dynamic>> submitOperationalRequest(
          Map<String, dynamic> values,
          {required String idempotencyKey}) =>
      _request('POST', 'branches/operational-requests',
              body: values,
              headers: <String, String>{'Idempotency-Key': idempotencyKey})
          .then((value) => _map(value['request']));

  Map<String, String> _branchQuery(String? branchId) =>
      branchId == null || branchId.trim().isEmpty
          ? <String, String>{}
          : <String, String>{'branchId': branchId};

  Future<Map<String, dynamic>> _request(String method, String path,
      {Map<String, dynamic>? body,
      Map<String, String>? query,
      Map<String, String>? headers}) async {
    final SharedPreferences prefs = await preferencesLoader();
    final String token = (prefs.getString('auth_token') ??
            prefs.getString('access_token') ??
            prefs.getString('token') ??
            '')
        .trim();
    if (token.isEmpty) {
      throw Exception('Your admin session has expired. Please sign in again.');
    }
    final String root =
        baseUrl.replaceFirst(RegExp(r'/+$'), '').endsWith('/api')
            ? baseUrl.replaceFirst(RegExp(r'/+$'), '')
            : '${baseUrl.replaceFirst(RegExp(r'/+$'), '')}/api';
    final Uri uri = Uri.parse('$root/$path')
        .replace(queryParameters: query?.isEmpty ?? true ? null : query);
    final Map<String, String> requestHeaders = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
      ...?headers
    };
    final http.Response response = method == 'POST'
        ? await _client.post(uri,
            headers: requestHeaders, body: jsonEncode(body))
        : method == 'PUT'
            ? await _client.put(uri,
                headers: requestHeaders, body: jsonEncode(body))
            : method == 'DELETE'
                ? await _client.delete(uri, headers: requestHeaders)
                : await _client.get(uri, headers: requestHeaders);
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(decoded is Map && decoded['message'] != null
          ? decoded['message'].toString()
          : 'Branch request failed.');
    }
    return _map(decoded);
  }

  static Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  static List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value
          .whereType<Map>()
          .map((Map item) => Map<String, dynamic>.from(item))
          .toList()
      : <Map<String, dynamic>>[];
}
