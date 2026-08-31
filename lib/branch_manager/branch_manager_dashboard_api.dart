import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Read-only, server-scoped data source for a Branch Manager.
///
/// The API deliberately does not accept a branch id: the authenticated
/// manager's assignment is the authority for the branch being displayed.
abstract class BranchManagerDashboardApi {
  Future<BranchManagerDashboard> loadDashboard();
}

class BranchManagerDashboard {
  const BranchManagerDashboard({
    required this.branch,
    required this.periods,
    required this.targets,
    required this.approvals,
    required this.staff,
    required this.reports,
    required this.modules,
  });

  final Map<String, dynamic> branch;
  final List<Map<String, dynamic>> periods;
  final List<Map<String, dynamic>> targets;
  final List<Map<String, dynamic>> approvals;
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> reports;
  final List<Map<String, dynamic>> modules;
}

class BranchManagerDashboardHttpApi implements BranchManagerDashboardApi {
  BranchManagerDashboardHttpApi({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    this.preferencesLoader = SharedPreferences.getInstance,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final Future<SharedPreferences> Function() preferencesLoader;

  @override
  Future<BranchManagerDashboard> loadDashboard() async {
    final Map<String, dynamic> response = await _requestDashboard();
    final Map<String, dynamic> data = _map(response['dashboard']);
    final Map<String, dynamic> branch = _map(data['branch']);
    final Map<String, dynamic> metrics = _map(data['metrics']);
    return BranchManagerDashboard(
      branch: branch,
      periods: _periods(metrics),
      targets: _list(data['targets'] ?? branch['targets']),
      approvals: _approvalRows(data),
      staff: _list(data['staff'] ?? branch['members']),
      reports: _reportRows(metrics),
      modules: _modules(data['assignedModules'] ?? branch['assignedModules']),
    );
  }

  Future<Map<String, dynamic>> _requestDashboard() async {
    final SharedPreferences prefs = await preferencesLoader();
    final String token = (prefs.getString('auth_token') ??
            prefs.getString('access_token') ??
            prefs.getString('token') ??
            '')
        .trim();
    if (token.isEmpty) {
      throw Exception('Your session has expired. Please sign in again.');
    }
    final String root =
        baseUrl.replaceFirst(RegExp(r'/+$'), '').endsWith('/api')
            ? baseUrl.replaceFirst(RegExp(r'/+$'), '')
            : '${baseUrl.replaceFirst(RegExp(r'/+$'), '')}/api';
    final http.Response response = await _client.get(
      Uri.parse('$root/branches/dashboard'),
      headers: <String, String>{
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(decoded is Map && decoded['message'] != null
          ? decoded['message'].toString()
          : 'Unable to load your branch dashboard.');
    }
    return _map(decoded);
  }

  static Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  static List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map((Map row) => _map(row)).toList()
      : <Map<String, dynamic>>[];
  static List<Map<String, dynamic>> _modules(dynamic value) => value is List
      ? value
          .map((dynamic item) => item is Map
              ? _map(item)
              : <String, dynamic>{'name': item.toString()})
          .toList()
      : <Map<String, dynamic>>[];
  static List<Map<String, dynamic>> _periods(Map<String, dynamic> metrics) =>
      <Map<String, dynamic>>[
        <String, dynamic>{'period': 'Today', 'value': metrics['today']},
        <String, dynamic>{'period': 'This week', 'value': metrics['weekly']},
        <String, dynamic>{'period': 'This month', 'value': metrics['monthly']},
      ].where((row) => row['value'] != null).toList();
  static List<Map<String, dynamic>> _approvalRows(Map<String, dynamic> data) {
    final List<Map<String, dynamic>> rows = _map(data['approvalStatuses'])
        .entries
        .map((entry) => <String, dynamic>{
              'name': entry.key,
              'value': entry.value,
            })
        .toList();
    if (data['pendingApprovals'] != null) {
      rows.insert(0, <String, dynamic>{
        'name': 'Pending Head Office approvals',
        'value': data['pendingApprovals'],
      });
    }
    return rows;
  }

  static List<Map<String, dynamic>> _reportRows(Map<String, dynamic> metrics) =>
      metrics.entries
          .where((entry) => entry.value is Map)
          .map((entry) => <String, dynamic>{
                'name': entry.key,
                'value':
                    _map(entry.value)['value'] ?? _map(entry.value)['count'],
              })
          .toList();
}
