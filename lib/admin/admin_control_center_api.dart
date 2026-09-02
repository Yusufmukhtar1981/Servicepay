import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Protected client for the Head Office control-centre endpoints.
class AdminControlCenterApi {
  AdminControlCenterApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api/admin/control-center',
    Future<SharedPreferences> Function()? preferencesLoader,
  })  : _client = client ?? http.Client(),
        _preferencesLoader = preferencesLoader ?? SharedPreferences.getInstance;

  final http.Client _client;
  final String baseUrl;
  final Future<SharedPreferences> Function() _preferencesLoader;

  Future<Map<String, dynamic>> catalog() => _json('catalog');

  static const Map<String, String> modulePaths = <String, String>{
    'audit-logs': 'audit-logs',
    'security-events': 'security-events',
    'access-logs': 'access-logs',
    'data-exports': 'exports/history',
    'backups': 'readiness',
    'privacy-controls': 'privacy-requests',
    'executive-dashboard': 'analytics/executive',
    'service-performance': 'analytics/services',
    'transaction-analytics': 'analytics/transactions',
    'customer-analytics': 'analytics/customers',
  };

  Future<Map<String, dynamic>> module(
    String module, {
    String search = '',
    String filter = '',
    String method = '',
    int page = 1,
    int limit = 25,
    DateTime? start,
    DateTime? end,
    String action = '',
    String status = '',
    String actorId = '',
    String moduleFilter = '',
    String eventType = '',
    String severity = '',
    String workflow = '',
    String outcome = '',
    String statusCode = '',
    String path = '',
    String ip = '',
    String serviceType = '',
    String provider = '',
    String branchId = '',
    String customerId = '',
    String state = '',
    String role = '',
    String kycStatus = '',
    String type = '',
    String subjectUser = '',
  }) {
    final String endpoint = modulePaths[module] ?? module;
    final String cleanFilter = filter.trim();
    final bool numericAccessFilter =
        module == 'access-logs' && RegExp(r'^\d{3}$').hasMatch(cleanFilter);
    final String? filterKey = module == 'audit-logs'
        ? 'action'
        : module == 'security-events'
            ? 'outcome'
            : module == 'access-logs'
                ? numericAccessFilter
                    ? 'statusCode'
                    : 'method'
                : module == 'privacy-controls'
                    ? 'status'
                    : null;
    _validateRange(start, end);
    final Map<String, String> query = <String, String>{
      'page': page.clamp(1, 100).toString(),
      'limit': limit.clamp(1, 100).toString(),
      if (start != null) 'start': _date(start),
      if (end != null) 'end': _date(end),
      if (search.trim().isNotEmpty) 'search': _clean(search, 80),
    };
    void add(String key, String value, {int max = 80}) {
      if (value.trim().isNotEmpty) query[key] = _clean(value, max);
    }

    // `filter` is retained for callers of the original API, while explicit
    // fields ensure a workspace never sends a filter its endpoint ignores.
    if (cleanFilter.isNotEmpty && filterKey != null) {
      add(filterKey, cleanFilter, max: 40);
    }
    switch (module) {
      case 'audit-logs':
        add('action', action, max: 40);
        add('status', status, max: 40);
        add('actorId', actorId);
        add('module', moduleFilter);
        break;
      case 'security-events':
        add('eventType', eventType, max: 40);
        add('severity', severity, max: 40);
        add('status', workflow.isNotEmpty ? workflow : status, max: 40);
        add('outcome', outcome, max: 40);
        break;
      case 'access-logs':
        add('method', method, max: 16);
        add('statusCode', statusCode, max: 3);
        add('actorId', actorId);
        add('path', path);
        add('ip', ip);
        break;
      case 'privacy-controls':
        add('status', status, max: 40);
        add('type', type, max: 40);
        add('subjectUser', subjectUser);
        break;
      case 'transaction-analytics':
        add('serviceType', serviceType, max: 60);
        add('status', status, max: 40);
        add('provider', provider, max: 80);
        add('branchId', branchId);
        add('customerId', customerId);
        break;
      case 'customer-analytics':
        add('status', status, max: 40);
        add('state', state, max: 80);
        add('role', role, max: 40);
        add('kycStatus', kycStatus, max: 16);
        break;
    }
    return _json(endpoint, query: query);
  }

  /// Updates the investigation workflow for a returned security event.
  Future<Map<String, dynamic>> updateSecurityEvent(
    String id, {
    required String action,
    required String note,
  }) {
    final String safeId = id.trim();
    final String safeAction = action.trim().toUpperCase();
    if (safeId.isEmpty ||
        !const <String>['ACKNOWLEDGE', 'RESOLVE', 'REOPEN']
            .contains(safeAction)) {
      throw const AdminControlApiException(
          0, 'Choose a valid security event action.');
    }
    if ((safeAction == 'ACKNOWLEDGE' || safeAction == 'RESOLVE') &&
        note.trim().length < 10) {
      throw const AdminControlApiException(
          0, 'Provide an investigation note of at least 10 characters.');
    }
    return _requestJson(
      'PATCH',
      'security-events/${Uri.encodeComponent(safeId)}',
      payload: <String, dynamic>{
        'action': safeAction,
        if (note.trim().isNotEmpty) 'note': _clean(note, 1000),
      },
    );
  }

  Future<AdminControlExport> exportDataset(
    String dataset, {
    DateTime? from,
    DateTime? to,
    String status = '',
    String service = '',
  }) async {
    final String safeDataset =
        dataset.trim().replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '');
    if (safeDataset.isEmpty) {
      throw const AdminControlApiException(0, 'Choose a valid dataset.');
    }
    _validateRange(from, to);
    final http.Response response = await _request(
        'POST', 'exports/$safeDataset.csv',
        query: <String, String>{
          if (from != null) 'start': _date(from),
          if (to != null) 'end': _date(to),
          if (status.trim().isNotEmpty) 'status': _clean(status, 40),
          if (service.trim().isNotEmpty) 'service': _clean(service, 60),
        },
        payload: <String, dynamic>{},
        headers: const <String, String>{
          'Accept': 'text/csv, application/json'
        });
    _check(response);
    final String type = response.headers['content-type'] ?? '';
    if (type.contains('text/csv') || type.contains('application/csv')) {
      return AdminControlExport(csv: response.body);
    }
    final dynamic decoded = _decode(response.body);
    if (decoded is Map) {
      return AdminControlExport(json: Map<String, dynamic>.from(decoded));
    }
    throw const AdminControlApiException(
        0, 'The export service returned an invalid response.');
  }

  Future<Map<String, dynamic>> createPrivacyRequest(
          Map<String, dynamic> payload) =>
      _requestJson('POST', 'privacy-requests', payload: payload);
  Future<Map<String, dynamic>> updatePrivacyRequest(
          String id, Map<String, dynamic> payload) =>
      _requestJson('PATCH', 'privacy-requests/${Uri.encodeComponent(id)}',
          payload: payload);

  Future<Map<String, dynamic>> _json(String path,
      {Map<String, String>? query}) async {
    final http.Response response = await _get(path, query: query);
    _check(response);
    final dynamic decoded = _decode(response.body);
    if (decoded is Map) {
      return Map<String, dynamic>.from(decoded);
    }
    throw const AdminControlApiException(
        0, 'The service returned an invalid response.');
  }

  Future<Map<String, dynamic>> _requestJson(String method, String path,
      {Map<String, dynamic>? payload}) async {
    final http.Response response =
        await _request(method, path, payload: payload);
    _check(response);
    final dynamic decoded = _decode(response.body);
    if (decoded is Map) {
      return Map<String, dynamic>.from(decoded);
    }
    throw const AdminControlApiException(
        0, 'The service returned an invalid response.');
  }

  Future<http.Response> _get(String path,
      {Map<String, String>? query, Map<String, String>? headers}) async {
    final SharedPreferences prefs = await _preferencesLoader();
    String token = '';
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt'
    ]) {
      token = prefs.getString(key)?.trim() ?? '';
      if (token.isNotEmpty) {
        break;
      }
    }
    if (token.toLowerCase().startsWith('bearer ')) {
      token = token.substring(7);
    }
    if (token.isEmpty) {
      throw const AdminControlApiException(
          401, 'Your session has expired. Please sign in again.');
    }
    return _request('GET', path, query: query, headers: headers, token: token);
  }

  Future<http.Response> _request(String method, String path,
      {Map<String, String>? query,
      Map<String, dynamic>? payload,
      Map<String, String>? headers,
      String? token}) async {
    token ??= await _token();
    final Uri uri = Uri.parse('$baseUrl/$path').replace(queryParameters: query);
    final Map<String, String> requestHeaders = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      ...?headers,
      if (payload != null) 'Content-Type': 'application/json',
    };
    if (method == 'POST') {
      return _client
          .post(uri, headers: requestHeaders, body: jsonEncode(payload))
          .timeout(const Duration(seconds: 30));
    }
    if (method == 'PATCH') {
      return _client
          .patch(uri, headers: requestHeaders, body: jsonEncode(payload))
          .timeout(const Duration(seconds: 30));
    }
    return _client
        .get(uri, headers: requestHeaders)
        .timeout(const Duration(seconds: 30));
  }

  Future<String> _token() async {
    final SharedPreferences prefs = await _preferencesLoader();
    String token = '';
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt'
    ]) {
      token = prefs.getString(key)?.trim() ?? '';
      if (token.isNotEmpty) {
        break;
      }
    }
    if (token.toLowerCase().startsWith('bearer ')) {
      token = token.substring(7);
    }
    if (token.isEmpty) {
      throw const AdminControlApiException(
          401, 'Your session has expired. Please sign in again.');
    }
    return token;
  }

  String _date(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
  String _clean(String value, int maximum) {
    final String trimmed = value.trim();
    return trimmed.substring(0, trimmed.length.clamp(0, maximum).toInt());
  }

  void _validateRange(DateTime? start, DateTime? end) {
    if (start != null && end != null) {
      final DateTime first = DateTime(start.year, start.month, start.day);
      final DateTime last = DateTime(end.year, end.month, end.day);
      if (first.isAfter(last) || last.difference(first).inDays > 90) {
        throw const AdminControlApiException(
            0, 'Use dates spanning no more than 90 days.');
      }
    }
  }

  void _check(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return;
    }
    final dynamic body = _decode(response.body);
    final String message = body is Map ? body['message']?.toString() ?? '' : '';
    throw AdminControlApiException(
        response.statusCode,
        message.isNotEmpty
            ? message
            : response.statusCode == 401
                ? 'Your session has expired. Please sign in again.'
                : response.statusCode == 403
                    ? 'Your account is not authorized for this operation.'
                    : 'Unable to complete this request.');
  }

  dynamic _decode(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }
}

class AdminControlApiException implements Exception {
  const AdminControlApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
  @override
  String toString() => message;
}

class AdminControlExport {
  const AdminControlExport({this.csv, this.json});
  final String? csv;
  final Map<String, dynamic>? json;
}
