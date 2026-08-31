import '../admin/admin_branch_management_api.dart';

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
  BranchManagerDashboardHttpApi({AdminBranchManagementApi? api})
      : _api = api ?? AdminBranchManagementHttpApi();

  final AdminBranchManagementApi _api;

  @override
  Future<BranchManagerDashboard> loadDashboard() async {
    final Map<String, dynamic> data = await _api.dashboard();
    final String branchId = (data['branchId'] ?? '').toString();
    final Map<String, dynamic> detail =
        branchId.isEmpty ? <String, dynamic>{} : await _api.branch(branchId);
    final Map<String, dynamic> branch =
        _map(data['branch']).isNotEmpty ? _map(data['branch']) : detail;
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
