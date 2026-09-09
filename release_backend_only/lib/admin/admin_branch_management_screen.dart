import 'package:flutter/material.dart';

import 'admin_branch_management_api.dart';
import 'admin_permissions.dart';

class AdminBranchManagementScreen extends StatefulWidget {
  const AdminBranchManagementScreen({super.key, this.api, this.access});
  final AdminBranchManagementApi? api;
  final AdminAccess? access;

  @override
  State<AdminBranchManagementScreen> createState() =>
      _AdminBranchManagementScreenState();
}

class _AdminBranchManagementScreenState
    extends State<AdminBranchManagementScreen> {
  late final AdminBranchManagementApi _api;
  AdminAccess? _access;
  BranchOverview? _overview;
  List<Map<String, dynamic>> _branches = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _approvals = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _reports = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _targets = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _audit = <Map<String, dynamic>>[];
  bool _loading = true;
  String? _error;

  bool get _full => _access?.isFullAccess ?? false;
  bool _can(String p) => _access?.has(p) ?? false;
  bool _any(Iterable<String> p) => _access?.hasAny(p) ?? false;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? AdminBranchManagementHttpApi();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final AdminAccess access =
          widget.access ?? await AdminSessionStore.loadAccess();
      final bool headOffice = access.isFullAccess;
      final bool needsBranchRecord = headOffice ||
          access.hasAny(<String>[
            AdminPermissions.branchesView,
            AdminPermissions.branchDashboardView,
            AdminPermissions.branchStaffView,
            AdminPermissions.branchTargetsView,
          ]);
      final List<Future<dynamic>> jobs = <Future<dynamic>>[
        _api.overview(),
        if (needsBranchRecord) _api.branches(),
        if (access.has(AdminPermissions.branchTargetsView)) _api.targets(),
        if (access.hasAny(<String>[
          AdminPermissions.branchApprovalsView,
          AdminPermissions.branchesApprovalsView,
        ]))
          _api.approvals(),
        if (access.hasAny(<String>[
          AdminPermissions.branchReportsView,
          AdminPermissions.branchesReportsView,
        ]))
          _api.reports(),
        if (access.has(AdminPermissions.branchesApprovalsView)) _api.audit(),
      ];
      final List<dynamic> values = await Future.wait(jobs);
      if (!mounted) return;
      setState(() {
        _access = access;
        _overview = values[0] as BranchOverview;
        var i = 1;
        _branches = needsBranchRecord
            ? values[i++] as List<Map<String, dynamic>>
            : <Map<String, dynamic>>[];
        _targets = access.has(AdminPermissions.branchTargetsView)
            ? values[i++] as List<Map<String, dynamic>>
            : <Map<String, dynamic>>[];
        _approvals = access.hasAny(<String>[
          AdminPermissions.branchApprovalsView,
          AdminPermissions.branchesApprovalsView,
        ])
            ? values[i++] as List<Map<String, dynamic>>
            : <Map<String, dynamic>>[];
        _reports = access.hasAny(<String>[
          AdminPermissions.branchReportsView,
          AdminPermissions.branchesReportsView,
        ])
            ? values[i++] as List<Map<String, dynamic>>
            : <Map<String, dynamic>>[];
        _audit = access.has(AdminPermissions.branchesApprovalsView)
            ? values[i++] as List<Map<String, dynamic>>
            : <Map<String, dynamic>>[];
      });
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  String _text(Map<String, dynamic> value, List<String> keys,
      [String fallback = '—']) {
    for (final String key in keys) {
      final dynamic item = value[key];
      if (item != null && '$item'.trim().isNotEmpty && '$item' != 'null') {
        return '$item';
      }
    }
    return fallback;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xfff5f7fa),
      appBar: AppBar(title: const Text('Branch Management'), actions: <Widget>[
        IconButton(
            onPressed: _loading ? null : _load,
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh)),
      ]),
      floatingActionButton: _full || _can(AdminPermissions.branchesManage)
          ? FloatingActionButton.extended(
              key: const Key('branch-create-button'),
              onPressed: _createBranch,
              icon: const Icon(Icons.add),
              label: const Text('New branch'))
          : null,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _state(Icons.cloud_off_outlined,
                  'Unable to load branch management', _error!,
                  retry: _load)
              : RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    final Map<String, dynamic> scoped =
        _branches.isEmpty ? <String, dynamic>{} : _branches.first;
    return LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
      final bool wide = constraints.maxWidth >= 900;
      final List<Widget> sections = <Widget>[
        _header(scoped),
        if (_overview != null) _metrics(_overview!.metrics, wide),
        _operationalModules(),
        if (_full) ...<Widget>[
          _ranking('Top branches', _overview!.topBranches,
              Icons.emoji_events_outlined),
          _ranking('Needs attention', _overview!.attentionBranches,
              Icons.priority_high_outlined)
        ],
        if (_full || _can(AdminPermissions.branchesView)) _branchesPanel(wide),
        if (_any(<String>[
          AdminPermissions.branchStaffView,
          AdminPermissions.branchStaffManage,
          AdminPermissions.branchesStaffManage,
        ]))
          _staffPanel(scoped),
        if (_can(AdminPermissions.branchTargetsView)) _targetsPanel(scoped),
        if (_any(<String>[
          AdminPermissions.branchApprovalsView,
          AdminPermissions.branchesApprovalsView,
        ]))
          _approvalsPanel(),
        if (_any(<String>[
          AdminPermissions.branchReportsView,
          AdminPermissions.branchesReportsView,
        ]))
          _recordsPanel('Reports', _reports, Icons.assessment_outlined),
        if (_can(AdminPermissions.branchesApprovalsView))
          _recordsPanel('Audit trail', _audit, Icons.history_outlined),
        if (!_full && _can(AdminPermissions.branchApprovalsSubmit))
          _requestButton(),
      ];
      return ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: sections);
    });
  }

  Widget _header(Map<String, dynamic> branch) {
    if (_full) {
      return const Padding(
          padding: EdgeInsets.only(bottom: 16),
          child: Text('Branch command center',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)));
    }
    final Map<String, dynamic> scope = _access?.scope ?? <String, dynamic>{};
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                      _text(
                          branch,
                          <String>['name', 'branchName'],
                          _text(scope, <String>['branchName', 'name'],
                              'Your branch')),
                      style: const TextStyle(
                          fontSize: 21, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text('Code: ${_text(branch, <String>[
                        'code',
                        'branchCode'
                      ], _text(scope, <String>[
                            'branchCode',
                            'branchId'
                          ]))}  •  ${_text(branch, <String>['status'], 'ACTIVE')}'),
                  Text('Manager: ${_text(branch, <String>[
                        'managerName',
                        'manager'
                      ], _text(scope, <String>['managerName']))}'),
                ])));
  }

  Widget _metrics(Map<String, dynamic> metrics, bool wide) {
    final List<MapEntry<String, dynamic>> rows = metrics.entries
        .where((MapEntry<String, dynamic> e) =>
            e.value is! Map && e.value is! List)
        .toList();
    if (rows.isEmpty) return const SizedBox.shrink();
    return Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: rows
                .map((e) => SizedBox(
                    width: wide ? 190 : 160,
                    child: Card(
                        child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  Text(
                                      e.key.replaceAll(
                                          RegExp(r'([A-Z])'), r' $1'),
                                      style: const TextStyle(
                                          color: Color(0xff64748b))),
                                  const SizedBox(height: 6),
                                  Text('${e.value}',
                                      style: const TextStyle(
                                          fontSize: 20,
                                          fontWeight: FontWeight.w800)),
                                ])))))
                .toList()));
  }

  /// Service workspaces are permission driven, not role driven.  In
  /// particular, granting Delivery and Solar does not surface Marketplace or
  /// Empowerment operations.
  Widget _operationalModules() {
    const List<(List<String>, String, IconData)> modules =
        <(List<String>, String, IconData)>[
      (
        <String>[
          AdminPermissions.branchDeliveryView,
          AdminPermissions.branchDeliveryManage
        ],
        'Delivery operations',
        Icons.local_shipping_outlined
      ),
      (
        <String>[
          AdminPermissions.branchSolarView,
          AdminPermissions.branchSolarManage
        ],
        'Solar operations',
        Icons.solar_power_outlined
      ),
      (
        <String>[
          AdminPermissions.branchMarketplaceView,
          AdminPermissions.branchMarketplaceManage
        ],
        'Marketplace operations',
        Icons.storefront_outlined
      ),
      (
        <String>[
          AdminPermissions.branchEmpowermentView,
          AdminPermissions.branchEmpowermentManage
        ],
        'Empowerment operations',
        Icons.volunteer_activism_outlined
      ),
      (
        <String>[
          AdminPermissions.branchPhoneView,
          AdminPermissions.branchPhoneManage
        ],
        'Phone finance operations',
        Icons.phone_android_outlined
      ),
    ];
    final List<(List<String>, String, IconData)> permitted =
        modules.where((module) => _any(module.$1)).toList();
    if (permitted.isEmpty) return const SizedBox.shrink();
    return Card(
        margin: const EdgeInsets.only(bottom: 16),
        child: Padding(
            padding: const EdgeInsets.all(12),
            child: Wrap(
                spacing: 10,
                runSpacing: 10,
                children: permitted
                    .map((module) => Chip(
                        avatar: Icon(module.$3, size: 18),
                        label: Text(module.$2)))
                    .toList())));
  }

  Widget _ranking(
          String title, List<Map<String, dynamic>> rows, IconData icon) =>
      _recordsPanel(title, rows, icon);
  Widget _branchesPanel(bool wide) => Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Row(children: <Widget>[
                  Icon(Icons.account_tree_outlined, color: Color(0xff0f766e)),
                  SizedBox(width: 8),
                  Text('Branches',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                ]),
                if (_branches.isEmpty)
                  const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('No records available.'))
                else
                  ..._branches.map((Map<String, dynamic> branch) => ListTile(
                        title:
                            Text(_text(branch, <String>['name', 'branchName'])),
                        subtitle: Text('${_text(branch, <String>[
                              'code',
                              'branchCode'
                            ])} • ${_text(branch, <String>['status'])}'),
                        trailing: (_full ||
                                _any(<String>[
                                  AdminPermissions.branchesManage,
                                  AdminPermissions.branchesStaffManage,
                                ]))
                            ? PopupMenuButton<String>(
                                onSelected: (String value) =>
                                    _branchAction(branch, value),
                                itemBuilder: (_) => <PopupMenuEntry<String>>[
                                  if (_full ||
                                      _can(AdminPermissions.branchesManage))
                                    const PopupMenuItem(
                                        value: 'edit',
                                        child: Text('Edit branch')),
                                  if (_full ||
                                      _can(AdminPermissions.branchesManage))
                                    const PopupMenuItem(
                                        value: 'activate',
                                        child: Text('Activate')),
                                  if (_full ||
                                      _can(AdminPermissions.branchesManage))
                                    const PopupMenuItem(
                                        value: 'suspend',
                                        child: Text('Suspend')),
                                  if (_full ||
                                      _can(
                                          AdminPermissions.branchesStaffManage))
                                    const PopupMenuItem(
                                        value: 'manager',
                                        child: Text('Assign manager')),
                                  if (_full ||
                                      _can(
                                          AdminPermissions.branchesStaffManage))
                                    const PopupMenuItem(
                                        value: 'remove-manager',
                                        child: Text('Remove manager')),
                                  if (_full ||
                                      _can(
                                          AdminPermissions.branchesStaffManage))
                                    const PopupMenuItem(
                                        value: 'member',
                                        child: Text('Assign staff member')),
                                ],
                              )
                            : null,
                        onTap: () => _branchDetails(branch),
                      )),
              ])));

  Widget _recordsPanel(
          String title, List<Map<String, dynamic>> rows, IconData icon,
          {void Function(Map<String, dynamic>)? onTap}) =>
      Card(
          margin: const EdgeInsets.only(bottom: 16),
          child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(children: <Widget>[
                      Icon(icon, color: const Color(0xff0f766e)),
                      const SizedBox(width: 8),
                      Text(title,
                          style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w800))
                    ]),
                    if (rows.isEmpty)
                      const Padding(
                          padding: EdgeInsets.all(16),
                          child: Text('No records available.'))
                    else
                      ...rows.map((Map<String, dynamic> row) => ListTile(
                            title: Text(_text(row, <String>[
                              'name',
                              'title',
                              'branchName',
                              'reference',
                              'action'
                            ])),
                            subtitle: Text(_text(row, <String>[
                              'code',
                              'status',
                              'description',
                              'createdAt'
                            ])),
                            trailing: row['status'] == null
                                ? null
                                : Chip(label: Text('${row['status']}')),
                            onTap: onTap == null ? null : () => onTap(row),
                          )),
                  ])));

  Widget _staffPanel(Map<String, dynamic> branch) => _recordsPanel(
      'Branch staff',
      _list(branch['members'] ?? branch['staff']),
      Icons.people_outline);

  Widget _targetsPanel(Map<String, dynamic> branch) {
    final List<Map<String, dynamic>> targets =
        _targets.isNotEmpty ? _targets : _list(branch['targets']);
    return Card(
        margin: const EdgeInsets.only(bottom: 16),
        child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(children: <Widget>[
                    const Icon(Icons.track_changes_outlined),
                    const SizedBox(width: 8),
                    const Text('Targets',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w800)),
                    const Spacer(),
                    if (_full || _can(AdminPermissions.branchesTargetsManage))
                      TextButton(
                          onPressed: _createTarget,
                          child: const Text('Add target'))
                  ]),
                  if (targets.isEmpty)
                    const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No targets available.')),
                  ...targets.map((Map<String, dynamic> t) {
                    final num achieved =
                        _num(t['achieved'] ?? t['actual'] ?? t['progress']);
                    final num target = _num(t['target'] ?? t['targetValue']);
                    // Keep the real ratio for the label: target overachievement
                    // must not be silently represented as 100%.
                    final double progress =
                        target > 0 ? (achieved / target).toDouble() : 0;
                    return ListTile(
                        title:
                            Text(_text(t, <String>['name', 'title', 'metric'])),
                        subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                  '${achieved.toString()} / ${target.toString()} (${(progress * 100).toStringAsFixed(0)}%)'),
                              const SizedBox(height: 5),
                              LinearProgressIndicator(
                                  key: const Key('branch-target-progress'),
                                  // Material's bar accepts 0..1 only; the
                                  // accompanying percentage remains raw.
                                  value: progress > 1 ? 1 : progress),
                            ]));
                  }),
                ])));
  }

  Widget _approvalsPanel() => Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text('Approvals',
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                if (_approvals.isEmpty)
                  const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('No approvals awaiting review.')),
                ..._approvals.map((Map<String, dynamic> item) => ListTile(
                    title: Text(
                        _text(item, <String>['title', 'type', 'reference'])),
                    subtitle:
                        Text(_text(item, <String>['status', 'description'])),
                    trailing: Wrap(spacing: 4, children: <Widget>[
                      if (_full ||
                          _can(AdminPermissions.branchesApprovalsManage))
                        IconButton(
                            key: const Key('branch-approval-approve'),
                            icon: const Icon(Icons.check, color: Colors.green),
                            onPressed: () => _decision(item, 'approve')),
                      if (_full ||
                          _can(AdminPermissions.branchesApprovalsManage))
                        IconButton(
                            icon: const Icon(Icons.close, color: Colors.red),
                            onPressed: () => _decision(item, 'reject')),
                      if (_full ||
                          _can(AdminPermissions.branchesApprovalsManage))
                        IconButton(
                            icon: const Icon(Icons.edit_note),
                            onPressed: () => _decision(item, 'correct')),
                    ]))),
              ])));

  Widget _requestButton() => Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: OutlinedButton.icon(
          key: const Key('branch-request-button'),
          onPressed: _submitRequest,
          icon: const Icon(Icons.send_outlined),
          label: const Text('Submit operational request')));
  Widget _state(IconData icon, String title, String message,
          {required Future<void> Function() retry}) =>
      Center(
          child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                Icon(icon, size: 44),
                Text(title,
                    style: const TextStyle(fontWeight: FontWeight.w800)),
                Text(message, textAlign: TextAlign.center),
                TextButton(onPressed: retry, child: const Text('Retry'))
              ])));
  List<Map<String, dynamic>> _list(dynamic v) => v is List
      ? v.whereType<Map>().map((Map x) => Map<String, dynamic>.from(x)).toList()
      : <Map<String, dynamic>>[];
  num _num(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;

  Future<void> _branchDetails(Map<String, dynamic> branch) async {
    final String id = _text(branch, <String>['_id', 'id']);
    if (id == '—') {
      return;
    }
    try {
      final Map<String, dynamic> detail = await _api.branch(id);
      if (mounted) {
        setState(() {
          final int i = _branches.indexOf(branch);
          if (i >= 0) _branches[i] = detail;
        });
      }
    } catch (_) {}
  }

  Future<void> _branchAction(Map<String, dynamic> branch, String action) async {
    final String id = _text(branch, <String>['_id', 'id']);
    if (id == '—') return;
    try {
      if (action == 'activate' || action == 'suspend') {
        await _api.setBranchStatus(
            id, action == 'activate' ? 'ACTIVE' : 'SUSPENDED');
        await _load();
        return;
      }
      if (action == 'remove-manager') {
        await _api.removeManager(id);
        await _load();
        return;
      }
      if (action == 'edit') {
        await _simpleAction(
            'Edit branch name',
            (String value) =>
                _api.updateBranch(id, <String, dynamic>{'name': value}));
        return;
      }
      await _simpleAction(
          action == 'manager'
              ? 'Assign or replace manager (staff user ID)'
              : 'Assign staff member (user ID)',
          (String userId) => action == 'manager'
              ? _api.assignManager(id, userId)
              : _api.assignMember(id, userId));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', ''))));
      }
    }
  }

  Future<void> _decision(Map<String, dynamic> item, String decision) async {
    final String id = _text(item, <String>['_id', 'id']);
    if (id == '—') return;
    final String status = decision == 'approve'
        ? 'APPROVED'
        : decision == 'reject'
            ? 'REJECTED'
            : 'CORRECTION_REQUESTED';
    await _api.reviewApproval(id, status,
        reviewNote: status == 'APPROVED'
            ? null
            : 'Correction requested by branch administration.');
    await _load();
  }

  Future<void> _createBranch() async {
    const List<String> required = <String>[
      'code',
      'name',
      'state',
      'lga',
      'address',
      'phone',
      'email',
      'openingDate'
    ];
    final Map<String, TextEditingController> fields =
        <String, TextEditingController>{
      for (final String field in <String>[
        ...required,
        'notes',
        'existingManagerId',
        'managerFullName',
        'managerEmail',
        'managerPhone',
      ])
        field: TextEditingController()
    };
    final GlobalKey<FormState> key = GlobalKey<FormState>();
    bool newManager = true;
    final Set<String> modules = <String>{};
    final Map<String, dynamic>? values = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (BuildContext dialogContext) => StatefulBuilder(
            builder: (BuildContext context,
                    void Function(void Function()) setDialogState) =>
                AlertDialog(
                  title: const Text('Create branch'),
                  content: SizedBox(
                      width: 520,
                      child: Form(
                          key: key,
                          child: SingleChildScrollView(
                              child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: <Widget>[
                                ...fields.entries
                                    .where((entry) => !<String>[
                                          'managerMode',
                                          'existingManagerId',
                                          'managerFullName',
                                          'managerEmail',
                                          'managerPhone',
                                        ].contains(entry.key))
                                    .map((entry) => Padding(
                                        padding:
                                            const EdgeInsets.only(bottom: 10),
                                        child: TextFormField(
                                            controller: entry.value,
                                            decoration: InputDecoration(
                                                labelText: entry.key,
                                                border:
                                                    const OutlineInputBorder()),
                                            validator: required
                                                    .contains(entry.key)
                                                ? (String? value) => value ==
                                                            null ||
                                                        value.trim().isEmpty
                                                    ? '${entry.key} is required'
                                                    : null
                                                : null))),
                                const Align(
                                    alignment: Alignment.centerLeft,
                                    child: Text('Assigned modules',
                                        style: TextStyle(
                                            fontWeight: FontWeight.w700))),
                                Wrap(
                                    children: <String>[
                                  'DELIVERY',
                                  'SOLAR',
                                  'MARKETPLACE',
                                  'EMPOWERMENT',
                                  'PHONE_FINANCE'
                                ]
                                        .map((String module) => FilterChip(
                                            label: Text(
                                                module.replaceAll('_', ' ')),
                                            selected: modules.contains(module),
                                            onSelected: (bool selected) =>
                                                setDialogState(() {
                                                  selected
                                                      ? modules.add(module)
                                                      : modules.remove(module);
                                                })))
                                        .toList()),
                                const SizedBox(height: 12),
                                RadioListTile<bool>(
                                    value: true,
                                    groupValue: newManager,
                                    contentPadding: EdgeInsets.zero,
                                    title: const Text('Create a new manager'),
                                    onChanged: (bool? value) => setDialogState(
                                        () => newManager = value!)),
                                RadioListTile<bool>(
                                    value: false,
                                    groupValue: newManager,
                                    contentPadding: EdgeInsets.zero,
                                    title: const Text('Assign existing staff'),
                                    onChanged: (bool? value) => setDialogState(
                                        () => newManager = value!)),
                                ...fields.entries
                                    .where((entry) => newManager
                                        ? <String>[
                                            'managerFullName',
                                            'managerEmail',
                                            'managerPhone'
                                          ].contains(entry.key)
                                        : entry.key == 'existingManagerId')
                                    .map((entry) => Padding(
                                        padding:
                                            const EdgeInsets.only(bottom: 10),
                                        child: TextFormField(
                                            controller: entry.value,
                                            decoration: InputDecoration(
                                                labelText: entry.key,
                                                border:
                                                    const OutlineInputBorder()),
                                            validator: (String? value) =>
                                                value == null ||
                                                        value.trim().isEmpty
                                                    ? '${entry.key} is required'
                                                    : null))),
                              ])))),
                  actions: <Widget>[
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: () {
                          if (!(key.currentState?.validate() ?? false) ||
                              modules.isEmpty) {
                            return;
                          }
                          Navigator.pop(dialogContext, <String, dynamic>{
                            for (final MapEntry<String,
                                    TextEditingController> entry
                                in fields.entries.where((entry) => !<String>[
                                      'existingManagerId',
                                      'managerFullName',
                                      'managerEmail',
                                      'managerPhone',
                                    ].contains(entry.key)))
                              entry.key: entry.value.text.trim(),
                            'assignedModules': modules.toList(),
                            if (newManager)
                              'manager': <String, dynamic>{
                                'fullName':
                                    fields['managerFullName']!.text.trim(),
                                'email': fields['managerEmail']!.text.trim(),
                                'phone': fields['managerPhone']!.text.trim(),
                              }
                            else
                              'managerId':
                                  fields['existingManagerId']!.text.trim(),
                          });
                        },
                        child: const Text('Create'))
                  ],
                )));
    for (final TextEditingController controller in fields.values) {
      controller.dispose();
    }
    if (values != null) {
      try {
        final Map<String, dynamic> created = await _api.createBranch(values);
        await _load();
        final dynamic value = created['_temporaryCredentials'];
        if (mounted && value is Map && value.isNotEmpty) {
          await _showTemporaryCredentials(Map<String, dynamic>.from(value));
        }
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(error.toString().replaceFirst('Exception: ', ''))));
        }
      }
    }
  }

  Future<void> _showTemporaryCredentials(Map<String, dynamic> credentials) =>
      showDialog<void>(
          context: context,
          builder: (BuildContext dialogContext) => AlertDialog(
                  title: const Text('Temporary manager credentials'),
                  content: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Text(
                        'Copy these now. They are shown only after this creation.'),
                    const SizedBox(height: 10),
                    SelectableText(
                        'Login identifier: ${_text(credentials, <String>[
                          'identifier',
                          'email',
                          'phone',
                          'username'
                        ])}\n'
                        'Phone: ${_text(credentials, <String>[
                          'phone',
                          'identifier'
                        ])}\n'
                        'Temporary password: ${_text(credentials, <String>[
                          'temporaryPassword',
                          'password'
                        ])}'),
                  ]),
                  actions: [
                    FilledButton(
                        onPressed: () => Navigator.pop(dialogContext),
                        child: const Text('I have saved them'))
                  ]));

  Future<void> _createTarget() =>
      _simpleAction('Create target', (String value) {
        final String id = _text(
            _branches.isEmpty ? <String, dynamic>{} : _branches.first,
            <String>['_id', 'id']);
        return _api
            .createTarget(<String, dynamic>{'branchId': id, 'metric': value});
      });
  Future<void> _submitRequest() => _simpleAction(
      'Operational request',
      (String value) => _api.submitOperationalRequest(<String, dynamic>{
            'type': 'GENERAL',
            'title': value,
            'description': value,
          },
              idempotencyKey:
                  'branch-${DateTime.now().microsecondsSinceEpoch}'));
  Future<void> _simpleAction(
      String title, Future<dynamic> Function(String) action) async {
    final TextEditingController controller = TextEditingController();
    final bool? submit = await showDialog<bool>(
        context: context,
        builder: (BuildContext c) => AlertDialog(
                title: Text(title),
                content: TextField(
                    controller: controller,
                    decoration:
                        const InputDecoration(border: OutlineInputBorder())),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(c),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, true),
                      child: const Text('Submit'))
                ]));
    if (submit == true && controller.text.trim().isNotEmpty) {
      await action(controller.text.trim());
      await _load();
    }
    controller.dispose();
  }
}
