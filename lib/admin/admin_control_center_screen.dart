import 'package:flutter/material.dart';

import 'admin_control_center_api.dart';
import 'admin_control_center_download.dart';
import 'admin_permissions.dart';
import 'login_screen.dart';

/// Legal security-event transitions for the workflow state returned by the API.
List<String> controlCenterSecurityActions(Map<String, dynamic> event) {
  final String outcome = (event['outcome'] ?? '').toString().toUpperCase();
  final bool explicitlyNonActionable = event['actionable'] == false ||
      event['investigationRequired'] == false ||
      event['nonActionable'] == true;
  if (explicitlyNonActionable ||
      const <String>['SUCCESS', 'SUCCESSFUL', 'SUCCEEDED', 'BENIGN', 'ALLOWED']
          .contains(outcome)) {
    return const <String>[];
  }
  final String status =
      (event['workflowStatus'] ?? event['workflow'] ?? event['status'] ?? '')
          .toString()
          .toUpperCase();
  switch (status) {
    case 'OPEN':
      return const <String>['ACKNOWLEDGE'];
    case 'ACKNOWLEDGED':
      return const <String>['RESOLVE'];
    case 'RESOLVED':
      return const <String>['REOPEN'];
    default:
      return const <String>[];
  }
}

class AdminControlCenterScreen extends StatefulWidget {
  const AdminControlCenterScreen({super.key, this.api});
  final AdminControlCenterApi? api;
  @override
  State<AdminControlCenterScreen> createState() =>
      _AdminControlCenterScreenState();
}

class _AdminControlCenterScreenState extends State<AdminControlCenterScreen> {
  static const List<_Module> _modules = <_Module>[
    _Module('audit-logs', 'Audit Logs', Icons.history_outlined),
    _Module('security-events', 'Security Events', Icons.shield_outlined),
    _Module('access-logs', 'Access Logs', Icons.login_outlined),
    _Module('data-exports', 'Data Exports', Icons.file_download_outlined),
    _Module('backups', 'Backups & Readiness', Icons.backup_outlined),
    _Module('privacy-controls', 'Privacy Controls', Icons.privacy_tip_outlined),
    _Module(
        'executive-dashboard', 'Executive Dashboard', Icons.dashboard_outlined),
    _Module('service-performance', 'Service Performance', Icons.speed_outlined),
    _Module('transaction-analytics', 'Transaction Analytics',
        Icons.insights_outlined),
    _Module('customer-analytics', 'Customer Analytics', Icons.people_outline),
  ];
  late final AdminControlCenterApi _api = widget.api ?? AdminControlCenterApi();
  final TextEditingController _search = TextEditingController();
  final Map<String, TextEditingController> _filters =
      <String, TextEditingController>{};
  Map<String, dynamic>? _catalog, _data;
  _Module? _selected;
  bool _loading = true;
  String? _error;
  int _page = 1;
  DateTimeRange _range = DateTimeRange(
      start: DateTime.now().subtract(const Duration(days: 29)),
      end: DateTime.now());
  String _preset = '30 Days';

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  @override
  void dispose() {
    _search.dispose();
    for (final c in _filters.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadCatalog() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _catalog = await _api.catalog();
    } catch (e) {
      await _handle(e);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _open(_Module module, {int page = 1}) async {
    setState(() {
      _selected = module;
      _loading = true;
      _error = null;
      _page = page;
    });
    try {
      _data = await _api.module(module.id,
          page: page,
          limit: 25,
          start: _range.start,
          end: _range.end,
          search: _search.text,
          action: _f('action'),
          status: _f('status'),
          actorId: _f('actorId'),
          moduleFilter: _f('module'),
          eventType: _f('eventType'),
          severity: _f('severity'),
          workflow: _f('workflow'),
          outcome: _f('outcome'),
          method: _f('method'),
          statusCode: _f('statusCode'),
          path: _f('path'),
          ip: _f('ip'),
          serviceType: _f('serviceType'),
          provider: _f('provider'),
          branchId: _f('branchId'),
          customerId: _f('customerId'),
          state: _f('state'),
          role: _f('role'),
          kycStatus: _f('kycStatus'),
          type: _f('type'),
          subjectUser: _f('subjectUser'));
    } catch (e) {
      await _handle(e);
    }
    if (mounted) setState(() => _loading = false);
  }

  String _f(String key) => _filters[key]?.text ?? '';
  Future<void> _handle(Object e) async {
    if (e is AdminControlApiException && e.statusCode == 401) {
      await AdminSessionStore.clearSession();
      if (mounted) {
        Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute<void>(builder: (_) => const AdminLoginScreen()),
            (_) => false);
      }
    } else if (mounted) {
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
            title: Text(_selected?.title ?? 'Admin Control Center'),
            backgroundColor: const Color(0xff123b42),
            foregroundColor: Colors.white,
            leading: _selected == null
                ? null
                : IconButton(
                    tooltip: 'Back to Control Center',
                    icon: const Icon(Icons.arrow_back),
                    onPressed: () => setState(() {
                          _selected = null;
                          _error = null;
                        })),
            actions: <Widget>[
              IconButton(
                  tooltip: 'Refresh',
                  icon: const Icon(Icons.refresh),
                  onPressed: _loading
                      ? null
                      : () => _selected == null
                          ? _loadCatalog()
                          : _open(_selected!, page: _page))
            ]),
        body: _selected == null ? _home() : _workspace(_selected!),
      );

  Widget _home() =>
      ListView(padding: const EdgeInsets.all(16), children: <Widget>[
        const Text('HEAD OFFICE',
            style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.2)),
        const Text('Control Center',
            style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _errorBox(_loadCatalog),
        LayoutBuilder(builder: (_, c) {
          final double width =
              c.maxWidth > 700 ? (c.maxWidth - 12) / 2 : c.maxWidth;
          return Wrap(
            spacing: 12,
            runSpacing: 12,
            children: _modules
                .map((m) => SizedBox(
                      width: width,
                      child: Card(
                          child: ListTile(
                        leading: Icon(m.icon),
                        title: Text(m.title),
                        subtitle: Text(_available(m)
                            ? 'Open operational workspace'
                            : 'Unavailable for this session'),
                        enabled: _available(m),
                        onTap: _available(m) ? () => _open(m) : null,
                      )),
                    ))
                .toList(),
          );
        }),
      ]);

  bool _available(_Module module) {
    final dynamic root = _catalog?['data'] ?? _catalog;
    if (root is List) {
      return root.whereType<Map>().any((v) =>
          _normal(v['endpoint']?.toString() ?? '') ==
              _normal(AdminControlCenterApi.modulePaths[module.id]!) &&
          v['live'] == true);
    }
    final dynamic modules =
        root is Map ? root['modules'] ?? root['capabilities'] : null;
    if (modules is Map) {
      final dynamic v = modules[module.id] ??
          modules[AdminControlCenterApi.modulePaths[module.id]];
      return v is bool
          ? v
          : v is Map && v['available'] == true && v['authorized'] != false;
    }
    return false;
  }

  String _normal(String s) => s.replaceFirst(RegExp(r'^/+'), '').trim();

  Widget _workspace(_Module m) {
    final List<Map<String, dynamic>> records = _items();
    return Column(children: <Widget>[
      Padding(
          padding: const EdgeInsets.all(12),
          child: Column(children: <Widget>[
            _dates(m),
            if (_filterNames(m).isNotEmpty) ...<Widget>[
              TextField(
                  controller: _search,
                  decoration: const InputDecoration(
                      labelText: 'Search', prefixIcon: Icon(Icons.search))),
              Wrap(
                  spacing: 8,
                  children: _filterNames(m)
                      .map((n) => SizedBox(
                          width: 180,
                          child: TextField(
                              controller: _controller(n),
                              decoration:
                                  InputDecoration(labelText: _title(n)))))
                      .toList()),
              Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton.icon(
                      onPressed: _loading ? null : () => _open(m),
                      icon: const Icon(Icons.filter_alt),
                      label: const Text('Apply filters'))),
            ],
            Row(children: <Widget>[
              if (m.id == 'data-exports' || m.id.contains('analytics'))
                TextButton.icon(
                    onPressed: () => _exportDialog(m),
                    icon: const Icon(Icons.download),
                    label: const Text('Export CSV')),
              if (m.id == 'privacy-controls')
                TextButton.icon(
                    onPressed: _privacyCreate,
                    icon: const Icon(Icons.add),
                    label: const Text('New privacy request'))
            ]),
          ])),
      if (_loading) const LinearProgressIndicator(),
      Expanded(
          child: _error != null
              ? _errorBox(() => _open(m, page: _page))
              : RefreshIndicator(
                  onRefresh: () => _open(m, page: _page),
                  child: ListView(
                      padding: const EdgeInsets.all(12),
                      children: <Widget>[
                        _moduleBody(m, records),
                        if (_usesRecords(m)) _pagination(m, records),
                        const SizedBox(height: 30),
                      ]))),
    ]);
  }

  Widget _dates(_Module m) => Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 6,
          children: <Widget>[
            const Text('Date range:'),
            ...<String>['Today', '7 Days', '30 Days', 'This Month', 'Custom']
                .map((p) => ChoiceChip(
                    label: Text(p),
                    selected: _preset == p,
                    onSelected: (_) => _setPreset(p, m))),
            Text('${_date(_range.start)} – ${_date(_range.end)}'),
          ]);
  Future<void> _setPreset(String preset, _Module m) async {
    final DateTime now = DateTime.now();
    DateTime start;
    if (preset == 'Custom') {
      final DateTimeRange? r = await showDateRangePicker(
          context: context,
          firstDate: DateTime(now.year - 2),
          lastDate: now,
          initialDateRange: _range);
      if (r == null) return;
      if (r.duration.inDays > 90) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Custom range cannot exceed 90 days.')));
        }
        return;
      }
      setState(() {
        _range = r;
        _preset = preset;
      });
      _open(m);
      return;
    }
    start = preset == 'Today'
        ? DateTime(now.year, now.month, now.day)
        : preset == '7 Days'
            ? now.subtract(const Duration(days: 6))
            : preset == 'This Month'
                ? DateTime(now.year, now.month)
                : now.subtract(const Duration(days: 29));
    setState(() {
      _range = DateTimeRange(start: start, end: now);
      _preset = preset;
    });
    _open(m);
  }

  TextEditingController _controller(String name) =>
      _filters.putIfAbsent(name, TextEditingController.new);
  List<String> _filterNames(_Module m) {
    switch (m.id) {
      case 'audit-logs':
        return <String>['action', 'status', 'actorId', 'module'];
      case 'security-events':
        return <String>['eventType', 'severity', 'workflow', 'outcome'];
      case 'access-logs':
        return <String>['method', 'statusCode', 'path', 'ip'];
      case 'privacy-controls':
        return <String>['status', 'type', 'subjectUser'];
      case 'transaction-analytics':
        return <String>[
          'serviceType',
          'status',
          'provider',
          'branchId',
          'customerId'
        ];
      case 'customer-analytics':
        return <String>['status', 'state', 'role', 'kycStatus'];
    }
    return <String>[];
  }

  String _title(String value) => value
      .replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}')
      .replaceFirst(value[0], value[0].toUpperCase());

  Widget _moduleBody(_Module m, List<Map<String, dynamic>> records) {
    if (m.id == 'data-exports') return _exportHistory(records);
    if (m.id == 'backups') return _readiness();
    if (m.id == 'executive-dashboard') return _executive();
    if (m.id == 'service-performance') {
      final dynamic root = _root();
      if (root is Map) {
        return _services(
          root['rows'] is List ? root['rows'] as List : <dynamic>[],
          message: root['message']?.toString(),
        );
      }
      return _services(root is List ? root : <dynamic>[]);
    }
    if (m.id == 'transaction-analytics') return _transaction(records);
    if (m.id == 'customer-analytics') return _customers(records);
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
              m.id == 'audit-logs'
                  ? 'Audit log records'
                  : m.id == 'security-events'
                      ? 'Security event investigation queue'
                      : m.id == 'access-logs'
                          ? 'Access request records'
                          : 'Privacy request history',
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          if (records.isEmpty)
            _empty()
          else
            ...records.map((r) => _logCard(r, m)),
        ]);
  }

  bool _usesRecords(_Module m) => !<String>[
        'data-exports',
        'backups',
        'executive-dashboard',
        'service-performance'
      ].contains(m.id);
  dynamic _root() => _data?['data'] ?? _data ?? <String, dynamic>{};
  List<Map<String, dynamic>> _items() {
    dynamic r = _root();
    if (r is Map) r = r['items'];
    return r is List
        ? r.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
  }

  Widget _empty() => const Padding(
      padding: EdgeInsets.all(32),
      child: Center(child: Text('No matching records for this date range.')));
  Widget _logCard(Map<String, dynamic> r, _Module m) {
    final String name = _first(
        r,
        m.id == 'audit-logs'
            ? <String>['action', 'actorName', 'requestPath']
            : m.id == 'security-events'
                ? <String>['eventType', 'identifier', 'ipAddress']
                : m.id == 'access-logs'
                    ? <String>['path', 'method', 'ipAddress']
                    : <String>['type', 'status', 'description']);
    return Card(
        child: ListTile(
            title: Text(name),
            subtitle: Text(_summary(r)),
            onTap: () => _details(r, name),
            trailing: m.id == 'security-events' &&
                    controlCenterSecurityActions(r).isNotEmpty
                ? PopupMenuButton<String>(
                    tooltip: 'Security workflow action',
                    onSelected: (a) => _securityAction(r, a),
                    itemBuilder: (_) => controlCenterSecurityActions(r)
                        .map((action) => PopupMenuItem<String>(
                            value: action, child: Text(_title(action))))
                        .toList())
                : m.id == 'privacy-controls'
                    ? IconButton(
                        tooltip: 'Update privacy request',
                        icon: const Icon(Icons.edit),
                        onPressed: () => _privacyUpdate(r))
                    : null));
  }

  String _first(Map<String, dynamic> r, List<String> keys) {
    for (final k in keys) {
      final v = r[k]?.toString();
      if (v != null && v.isNotEmpty) return v;
    }
    return 'Record';
  }

  String _summary(Map<String, dynamic> r) => r.entries
      .where((e) =>
          e.value is! Map &&
          e.value is! List &&
          !RegExp('password|token|secret|cookie', caseSensitive: false)
              .hasMatch(e.key))
      .take(4)
      .map((e) => '${_title(e.key)}: ${e.value}')
      .join(' • ');
  void _details(Map<String, dynamic> r, String title) {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title,
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              ...r.entries
                  .where((e) => !RegExp(
                          'password|token|secret|cookie|authorization',
                          caseSensitive: false)
                      .hasMatch(e.key))
                  .map(
                    (e) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text('${_title(e.key)}: ${e.value}'),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _securityAction(Map<String, dynamic> r, String action) async {
    if (!controlCenterSecurityActions(r).contains(action)) return;
    final id = r['_id']?.toString() ?? r['id']?.toString();
    if (id == null) return;
    final note = TextEditingController();
    String? validationError;
    final bool? ok = await showDialog<bool>(
        context: context,
        builder: (_) => StatefulBuilder(
            builder: (context, setDialogState) => AlertDialog(
                    title: Text('$action security event'),
                    content: TextField(
                        controller: note,
                        maxLength: 1000,
                        decoration: InputDecoration(
                            labelText: action == 'REOPEN'
                                ? 'Investigation note (optional)'
                                : 'Investigation note (at least 10 characters)',
                            errorText: validationError)),
                    actions: <Widget>[
                      TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Cancel')),
                      FilledButton(
                          onPressed: () {
                            if (action != 'REOPEN' &&
                                note.text.trim().length < 10) {
                              setDialogState(() {
                                validationError =
                                    'Provide an investigation note of at least 10 characters.';
                              });
                              return;
                            }
                            Navigator.pop(context, true);
                          },
                          child: Text(action))
                    ])));
    if (ok == true) {
      try {
        await _api.updateSecurityEvent(id, action: action, note: note.text);
        if (mounted) _open(_selected!);
      } catch (e) {
        await _handle(e);
      }
    }
    note.dispose();
  }

  Widget _readiness() {
    final r = _root();
    if (r is! Map) return _empty();
    final backup = r['backup'];
    final database = r['database'];
    final service = r['service'];
    final providers = r['providers'];
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Infrastructure readiness',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          _info('Database', database),
          _info('Application service', service),
          _info('Backup status', backup),
          if (backup is Map && backup['manualBackupSupported'] == false)
            const Card(
                child: Padding(
                    padding: EdgeInsets.all(12),
                    child: Text(
                        'Provider-managed backups. Manual backup is unavailable.'))),
          if (providers is Map)
            ...providers.entries.map((e) => _info('Provider ${e.key}', e.value))
        ]);
  }

  Widget _info(String title, dynamic v) => Card(
      child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title,
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                Text(v is Map
                    ? _summary(Map<String, dynamic>.from(v))
                    : v?.toString() ?? 'No status returned')
              ])));
  Widget _executive() {
    final r = _root();
    if (r is! Map) return _empty();
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Executive operations',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          _kpis(<String, dynamic>{
            'Customers': r['customers'],
            'Workforce': r['workforce'],
            'Branches': r['branches'],
            'Wallet': r['walletBalance'],
            'Transactions': r['transactions'],
            'Pending operations': r['pendingOperations']
          }),
          _trend('Transaction trend', r['transactionTrend']),
          const Text('Service and product performance',
              style: TextStyle(fontWeight: FontWeight.bold)),
          _services(r['operations'] is List ? r['operations'] : <dynamic>[]),
          const Text('Recent activity',
              style: TextStyle(fontWeight: FontWeight.bold)),
          ...((r['recentActivity'] as List? ?? <dynamic>[])
              .whereType<Map>()
              .map(
                (x) => _logCard(Map<String, dynamic>.from(x),
                    _Module('audit-logs', '', Icons.history)),
              )),
        ]);
  }

  Widget _transaction(List<Map<String, dynamic>> records) {
    final r = _root() as Map? ?? <String, dynamic>{};
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Transaction summary and drill-down',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          _kpis(r['summary'] is Map
              ? Map<String, dynamic>.from(r['summary'])
              : <String, dynamic>{}),
          _breakdown('Status', r['statuses']),
          _breakdown('Services', r['services']),
          _breakdown('Providers', r['providers']),
          _trend('Daily transaction trend', r['daily']),
          const Text('Transactions',
              style: TextStyle(fontWeight: FontWeight.bold)),
          if (records.isEmpty)
            _empty()
          else
            ...records.map((x) => _logCard(
                x, _Module('transaction-analytics', '', Icons.insights)))
        ]);
  }

  Widget _customers(List<Map<String, dynamic>> records) {
    final r = _root() as Map? ?? <String, dynamic>{};
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Customer analytics',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          _kpis(r['summary'] is Map
              ? Map<String, dynamic>.from(r['summary'])
              : <String, dynamic>{
                  'Transaction-active customers':
                      r['transactionActiveCustomers']
                }),
          _breakdown('Customer state', r['states']),
          _breakdown('KYC status', r['kycTiers']),
          _trend('Customer growth', r['growth']),
          const Text('Customers',
              style: TextStyle(fontWeight: FontWeight.bold)),
          if (records.isEmpty)
            _empty()
          else
            ...records.map((x) =>
                _logCard(x, _Module('customer-analytics', '', Icons.people)))
        ]);
  }

  Widget _services(List<dynamic> rows, {String? message}) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Lifecycle operational views',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          if (message != null && message.trim().isNotEmpty)
            Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(message.trim())),
          const Padding(
              padding: EdgeInsets.only(top: 4, bottom: 8),
              child: Text(
                  'Applications, finance schedules, and payments are separate lifecycle views. Row values are non-additive and must not be summed.')),
          if (rows.isEmpty)
            _empty()
          else
            ...rows.whereType<Map>().map((x) {
              final r = Map<String, dynamic>.from(x);
              return Card(
                  child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(_first(r, const <String>['service', 'source']),
                              style:
                                  const TextStyle(fontWeight: FontWeight.bold)),
                          Text(
                              'Source: ${r['source'] ?? '—'} • Value meaning: ${r['valueMeaning'] ?? '—'} • Additive: ${r['additive'] ?? false}'),
                          Text(
                              'Count: ${r['count'] ?? 0} • Value: ${r['value'] ?? 0} (non-additive)'),
                          Text(
                              'Successful: ${r['successful'] ?? 0} • Pending: ${r['pending'] ?? 0} • Failed: ${r['failed'] ?? 0}'),
                          Text(
                              'Success rate: ${r['successRate'] ?? 0}% • Last activity: ${r['lastActivity'] ?? '—'}'),
                          Text(
                              'Operational status: ${r['operationalStatus'] ?? '—'}'),
                          _trend('Service trend', r['trend']),
                        ],
                      )));
            }),
        ],
      );
  Widget _kpis(Map<String, dynamic> values) => Wrap(
        spacing: 8,
        runSpacing: 8,
        children: values.entries
            .map((e) => SizedBox(
                width: 160,
                child: Card(
                  child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(_title(e.key)),
                          Text(
                              e.value is Map
                                  ? _summary(Map<String, dynamic>.from(e.value))
                                  : e.value?.toString() ?? '—',
                              style:
                                  const TextStyle(fontWeight: FontWeight.bold))
                        ],
                      )),
                )))
            .toList(),
      );
  Widget _breakdown(String title, dynamic values) {
    if (values is! List || values.isEmpty) return const SizedBox.shrink();
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title,
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                ...values
                    .whereType<Map>()
                    .take(10)
                    .map((x) => Text(_summary(Map<String, dynamic>.from(x))))
              ],
            )));
  }

  Widget _trend(String title, dynamic values) {
    if (values is! List || values.isEmpty) return const SizedBox.shrink();
    final nums = values
        .whereType<Map>()
        .map((x) =>
            double.tryParse(
                (x['count'] ?? x['registrations'] ?? x['value'] ?? 0)
                    .toString()) ??
            0)
        .toList();
    final max = nums.fold<double>(0, (a, b) => a > b ? a : b);
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title,
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                  ...nums.take(14).map((n) => Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: LinearProgressIndicator(
                          value: max == 0 ? 0 : n / max,
                          semanticsLabel: '$title chart value $n'))),
                ])));
  }

  Widget _exportHistory(List<Map<String, dynamic>> rows) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        const Text('Export history',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        if (rows.isEmpty)
          _empty()
        else
          ...rows.map(
              (x) => _logCard(x, _Module('data-exports', '', Icons.download)))
      ]);
  Widget _pagination(_Module m, List<Map<String, dynamic>> records) {
    final r = _root();
    final p = r is Map ? r['pagination'] : null;
    final total = p is Map ? p['total'] : null;
    final pages = p is Map ? p['totalPages'] : null;
    return Row(mainAxisAlignment: MainAxisAlignment.end, children: <Widget>[
      Text('Page $_page${total != null ? ' of $pages • $total total' : ''}'),
      IconButton(
          tooltip: 'Previous page',
          onPressed: _page > 1 ? () => _open(m, page: _page - 1) : null,
          icon: const Icon(Icons.chevron_left)),
      IconButton(
          tooltip: 'Next page',
          onPressed: (pages is num ? _page < pages : records.length == 25)
              ? () => _open(m, page: _page + 1)
              : null,
          icon: const Icon(Icons.chevron_right))
    ]);
  }

  Future<void> _exportDialog(_Module m) async {
    String dataset = m.id == 'transaction-analytics'
        ? 'TRANSACTIONS'
        : m.id == 'customer-analytics'
            ? 'CUSTOMERS'
            : 'AUDIT';
    await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: const Text('Download CSV export'),
                content: DropdownButtonFormField<String>(
                    value: dataset,
                    items: const <String>[
                      'AUDIT',
                      'SECURITY',
                      'TRANSACTIONS',
                      'CUSTOMERS',
                      'STAFF',
                      'BRANCHES',
                      'DELIVERIES',
                      'WITHDRAWALS',
                      'KYC',
                      'MARKETPLACE',
                      'SOLAR',
                      'FINANCING',
                      'EMPOWERMENT',
                      'AMANA'
                    ]
                        .map((x) => DropdownMenuItem(value: x, child: Text(x)))
                        .toList(),
                    onChanged: (v) => dataset = v ?? dataset),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () {
                        Navigator.pop(ctx);
                        _export(dataset, m);
                      },
                      child: const Text('Download CSV'))
                ]));
  }

  Future<void> _export(String dataset, _Module m) async {
    try {
      final ex = await _api.exportDataset(dataset,
          from: _range.start,
          to: _range.end,
          status: m.id == 'transaction-analytics' ? _f('status') : '',
          service: m.id == 'transaction-analytics' ? _f('serviceType') : '');
      if (!controlCenterDownloadSupported) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content:
                  Text('CSV download is supported in a web browser only.')));
        }
        return;
      }
      if (ex.csv == null) {
        throw const AdminControlApiException(
            0, 'The export service did not return CSV data.');
      }
      await downloadControlCenterCsv(ex.csv!,
          '${dataset.toLowerCase()}-${_date(_range.start)}-${_date(_range.end)}.csv');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('CSV download started.')));
        if (_selected?.id == 'data-exports') _open(_selected!);
      }
    } catch (e) {
      await _handle(e);
    }
  }

  Future<void> _privacyCreate() async {
    String type = 'ACCESS';
    final subject = TextEditingController(),
        description = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: const Text('Create privacy request'),
                content:
                    Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                  DropdownButtonFormField<String>(
                      value: type,
                      decoration:
                          const InputDecoration(labelText: 'Request type'),
                      items: const [
                        'ACCESS',
                        'ERASURE',
                        'CORRECTION',
                        'OBJECTION'
                      ]
                          .map(
                              (x) => DropdownMenuItem(value: x, child: Text(x)))
                          .toList(),
                      onChanged: (x) => type = x ?? type),
                  TextField(
                      controller: subject,
                      decoration:
                          const InputDecoration(labelText: 'Subject user ID')),
                  TextField(
                      controller: description,
                      decoration:
                          const InputDecoration(labelText: 'Description')),
                  const Text(
                      'ERASURE execution requires an approved anonymization and retention pipeline; it cannot be marked completed while unavailable.',
                      style: TextStyle(fontSize: 12))
                ]),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Create'))
                ]));
    if (ok == true) {
      try {
        await _api.createPrivacyRequest(<String, dynamic>{
          'type': type,
          'subjectUser': subject.text.trim(),
          'description': description.text.trim()
        });
        if (mounted) _open(_selected!);
      } catch (e) {
        await _handle(e);
      }
    }
    subject.dispose();
    description.dispose();
  }

  Future<void> _privacyUpdate(Map<String, dynamic> r) async {
    final id = r['_id']?.toString() ?? r['id']?.toString();
    if (id == null) return;
    String status = r['status']?.toString() ?? 'OPEN';
    final note = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: const Text('Update privacy request'),
                content:
                    Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                  DropdownButtonFormField<String>(
                      value: const [
                        'OPEN',
                        'IN_REVIEW',
                        'COMPLETED',
                        'REJECTED'
                      ].contains(status)
                          ? status
                          : 'OPEN',
                      items: const [
                        'OPEN',
                        'IN_REVIEW',
                        'COMPLETED',
                        'REJECTED'
                      ]
                          .map(
                              (x) => DropdownMenuItem(value: x, child: Text(x)))
                          .toList(),
                      onChanged: (x) => status = x ?? status),
                  TextField(
                      controller: note,
                      decoration: const InputDecoration(
                          labelText: 'Meaningful status note'))
                ]),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Update'))
                ]));
    if (ok == true) {
      try {
        await _api.updatePrivacyRequest(
            id, <String, dynamic>{'status': status, 'note': note.text.trim()});
        if (mounted) _open(_selected!);
      } catch (e) {
        await _handle(e);
      }
    }
    note.dispose();
  }

  String _date(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  Widget _errorBox(VoidCallback retry) => Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
        Text(_error ?? 'Unable to load this workspace.'),
        OutlinedButton(onPressed: retry, child: const Text('Retry'))
      ]));
}

class _Module {
  const _Module(this.id, this.title, this.icon);
  final String id, title;
  final IconData icon;
}
