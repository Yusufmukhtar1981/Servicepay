import 'dart:convert';

import 'package:flutter/material.dart';

import 'admin_control_center_api.dart';
import 'admin_permissions.dart';
import 'login_screen.dart';

class AdminControlCenterScreen extends StatefulWidget {
  const AdminControlCenterScreen({super.key, this.api});
  final AdminControlCenterApi? api;
  @override
  State<AdminControlCenterScreen> createState() =>
      _AdminControlCenterScreenState();
}

class _AdminControlCenterScreenState extends State<AdminControlCenterScreen> {
  static const List<_ControlModule> modules = <_ControlModule>[
    _ControlModule('audit-logs', 'Audit Logs', Icons.history_outlined),
    _ControlModule('security-events', 'Security Events', Icons.shield_outlined),
    _ControlModule('access-logs', 'Access Logs', Icons.login_outlined),
    _ControlModule(
        'data-exports', 'Data Exports', Icons.file_download_outlined),
    _ControlModule('backups', 'Backups', Icons.backup_outlined),
    _ControlModule(
        'privacy-controls', 'Privacy Controls', Icons.privacy_tip_outlined),
    _ControlModule(
        'executive-dashboard', 'Executive Dashboard', Icons.dashboard_outlined),
    _ControlModule(
        'service-performance', 'Service Performance', Icons.speed_outlined),
    _ControlModule('transaction-analytics', 'Transaction Analytics',
        Icons.insights_outlined),
    _ControlModule(
        'customer-analytics', 'Customer Analytics', Icons.people_outline),
  ];
  late final AdminControlCenterApi _api = widget.api ?? AdminControlCenterApi();
  final TextEditingController _search = TextEditingController();
  final TextEditingController _filter = TextEditingController();
  Map<String, dynamic>? _catalog;
  Map<String, dynamic>? _data;
  _ControlModule? _selected;
  bool _loading = true;
  String? _error;
  DateTime? _refreshed;
  int _page = 1;
  String _dataset = 'AUDIT';
  DateTime? _exportFrom;
  DateTime? _exportTo;
  final Set<String> _responded = <String>{};

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  @override
  void dispose() {
    _search.dispose();
    _filter.dispose();
    super.dispose();
  }

  Future<void> _loadCatalog() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _catalog = await _api.catalog();
      _refreshed = DateTime.now();
    } catch (e) {
      await _handle(e);
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _open(_ControlModule module, {int page = 1}) async {
    setState(() {
      _selected = module;
      _loading = true;
      _error = null;
      _page = page;
    });
    try {
      _data = await _api.module(module.id,
          search: _search.text, filter: _filter.text, page: page);
      _responded.add(module.id);
      _refreshed = DateTime.now();
    } catch (e) {
      await _handle(e);
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _handle(Object error) async {
    if (error is AdminControlApiException && error.statusCode == 401) {
      await AdminSessionStore.clearSession();
      if (mounted) {
        Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute<void>(builder: (_) => const AdminLoginScreen()),
            (_) => false);
      }
      return;
    }
    if (mounted) {
      setState(() => _error = error.toString());
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xfff4f7f8),
        appBar: AppBar(
            backgroundColor: const Color(0xff123b42),
            foregroundColor: Colors.white,
            title: Text(_selected?.title ?? 'Admin Control Center'),
            leading: _selected == null
                ? null
                : IconButton(
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
        body: _selected == null ? _home() : _detail(_selected!),
      );

  Widget _home() => RefreshIndicator(
      onRefresh: _loadCatalog,
      child: ListView(padding: const EdgeInsets.all(16), children: <Widget>[
        const Text('HEAD OFFICE',
            style: TextStyle(
                letterSpacing: 1.3,
                color: Color(0xff477278),
                fontWeight: FontWeight.w800)),
        const SizedBox(height: 5),
        const Text('Control Center',
            style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: Color(0xff123b42))),
        const SizedBox(height: 7),
        const Text(
            'Protected oversight tools powered only by returned service data.',
            style: TextStyle(color: Color(0xff52666a))),
        _freshness(),
        if (_loading)
          const Padding(
              padding: EdgeInsets.only(top: 16),
              child: LinearProgressIndicator()),
        if (_error != null) _errorPanel(_loadCatalog),
        const SizedBox(height: 16),
        LayoutBuilder(builder: (_, c) {
          final int cols = c.maxWidth > 900
              ? 3
              : c.maxWidth > 560
                  ? 2
                  : 1;
          final double w = (c.maxWidth - (cols - 1) * 12) / cols;
          return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: modules
                  .map((m) => SizedBox(width: w, child: _card(m)))
                  .toList());
        }),
      ]));

  Widget _card(_ControlModule m) {
    final bool live = _responded.contains(m.id);
    final bool available = _available(m);
    return Card(
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: const BorderSide(color: Color(0xffdce7e6))),
        child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: available ? () => _open(m) : null,
            child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(children: <Widget>[
                  Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                          color: const Color(0xffe1f0ed),
                          borderRadius: BorderRadius.circular(10)),
                      child: Icon(m.icon, color: const Color(0xff0e6b61))),
                  const SizedBox(width: 12),
                  Expanded(
                      child: Text(m.title,
                          style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              color: Color(0xff183b40)))),
                  _badge(live, available),
                ]))));
  }

  bool _available(_ControlModule module) {
    final dynamic root = _catalog?['data'] ?? _catalog;
    final dynamic values =
        root is Map ? root['modules'] ?? root['capabilities'] : root;
    if (values is Map) {
      final dynamic value = values[module.id] ??
          values[AdminControlCenterApi.modulePaths[module.id]];
      if (value is bool) {
        return value;
      }
      if (value is Map) {
        return value['available'] != false && value['authorized'] != false;
      }
    }
    if (values is List) {
      final String expected = _normalizeEndpoint(
          AdminControlCenterApi.modulePaths[module.id] ?? '');
      for (final dynamic value in values) {
        if (value is Map) {
          final String endpoint =
              _normalizeEndpoint(value['endpoint']?.toString() ?? '');
          if (endpoint == expected) {
            return value['available'] != false;
          }
        }
      }
      return false;
    }
    return true;
  }

  String _normalizeEndpoint(String value) =>
      value.trim().replaceFirst(RegExp(r'^/+'), '');

  Widget _badge(bool live, bool available) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: live ? const Color(0xffd9f3e5) : const Color(0xffedf1f1),
          borderRadius: BorderRadius.circular(20)),
      child: Text(
          !available
              ? 'UNAVAILABLE'
              : live
                  ? 'LIVE'
                  : 'NOT CHECKED',
          style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color:
                  live ? const Color(0xff137044) : const Color(0xff627376))));
  Widget _freshness() => Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Text(
          _refreshed == null
              ? 'Not refreshed yet'
              : 'Last refreshed ${TimeOfDay.fromDateTime(_refreshed!).format(context)}',
          style: const TextStyle(fontSize: 12, color: Color(0xff63777a))));

  Widget _detail(_ControlModule module) {
    final List<Map<String, dynamic>> records = _records(_data);
    return Column(children: <Widget>[
      Padding(
          padding: const EdgeInsets.all(12),
          child: Column(children: <Widget>[
            if (_hasFilters(module)) ...<Widget>[
              TextField(
                  controller: _search,
                  maxLength: 80,
                  onSubmitted: (_) => _open(module),
                  decoration: _input('Search returned data', Icons.search)),
              const SizedBox(height: 8),
              TextField(
                  controller: _filter,
                  maxLength: 40,
                  onSubmitted: (_) => _open(module),
                  decoration: _input(_filterLabel(module), Icons.filter_list)),
            ],
            Row(children: <Widget>[
              Expanded(child: _freshness()),
              if (module.id == 'data-exports')
                TextButton.icon(
                    onPressed: _loading ? null : _exportDialog,
                    icon: const Icon(Icons.download_outlined),
                    label: const Text('Create CSV')),
              if (module.id == 'privacy-controls')
                TextButton.icon(
                    onPressed: _loading ? null : _privacyCreate,
                    icon: const Icon(Icons.add),
                    label: const Text('New request'))
            ]),
          ])),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null)
        Expanded(child: _errorPanel(() => _open(module, page: _page))),
      if (!_loading && _error == null)
        Expanded(
            child: RefreshIndicator(
                onRefresh: () => _open(module, page: _page),
                child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: <Widget>[
                      _analyticsContent(module),
                      const SizedBox(height: 10),
                      _chart(_data),
                      if (records.isEmpty)
                        const Padding(
                            padding: EdgeInsets.only(top: 48),
                            child: Center(
                                child: Text(
                                    'No data was returned for these filters.')))
                      else
                        ...records.map(_record),
                      _pagination(module, records.length),
                    ]))),
    ]);
  }

  InputDecoration _input(String hint, IconData icon) => InputDecoration(
      counterText: '',
      prefixIcon: Icon(icon),
      hintText: hint,
      filled: true,
      fillColor: Colors.white,
      border: const OutlineInputBorder());
  bool _hasFilters(_ControlModule module) => <String>[
        'audit-logs',
        'security-events',
        'access-logs',
        'privacy-controls'
      ].contains(module.id);
  String _filterLabel(_ControlModule module) {
    if (module.id == 'audit-logs') return 'Action';
    if (module.id == 'security-events') return 'Outcome';
    if (module.id == 'access-logs') return 'HTTP status or method';
    return 'Privacy request status';
  }

  List<Map<String, dynamic>> _records(Map<String, dynamic>? data) {
    dynamic v = data?['data'] ?? data?['items'] ?? data?['results'];
    if (v is Map) {
      v = v['items'] ?? v['records'] ?? v['data'];
    }
    return v is List
        ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
  }

  Widget _kpis(Map<String, dynamic>? data) {
    final dynamic root = data?['data'] is Map ? data!['data'] : data;
    final dynamic raw = root?['kpis'] ??
        root?['metrics'] ??
        root?['summary'] ??
        (root is Map && root['items'] == null ? root : null);
    if (raw is! Map || raw.isEmpty) {
      return const SizedBox.shrink();
    }
    return Wrap(
        spacing: 8,
        runSpacing: 8,
        children: raw.entries
            .take(6)
            .map<Widget>((e) => SizedBox(
                width: 145,
                child: Card(
                    child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(_pretty(e.key.toString()),
                                  style: const TextStyle(
                                      fontSize: 11, color: Color(0xff63777a))),
                              const SizedBox(height: 5),
                              Text(e.value.toString(),
                                  style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w800))
                            ])))))
            .toList());
  }

  Widget _analyticsContent(_ControlModule module) {
    final dynamic root = _data?['data'] is Map ? _data!['data'] : _data;
    if (module.id == 'service-performance' && root is List) {
      return _labeledList(root, 'Service performance');
    }
    if (root is! Map) {
      return _kpis(_data);
    }
    if (module.id == 'executive-dashboard') {
      return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _labeledMap(root['transactions'], 'Executive KPIs'),
            _labeledMap(root['pendingOperations'], 'Pending operations'),
          ]);
    }
    if (module.id == 'transaction-analytics') {
      return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _labeledList(root['statuses'], 'Transaction status'),
            _labeledList(root['daily'], 'Daily activity'),
            _labeledList(root['services'], 'Service activity'),
          ]);
    }
    if (module.id == 'customer-analytics') {
      return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _labeledMap(<String, dynamic>{
              'walletBalance': root['walletBalance'],
              'transactionActiveCustomers': root['transactionActiveCustomers'],
            }, 'Customer summary'),
            _labeledList(root['growth'], 'Customer growth'),
            _labeledList(root['states'], 'State'),
            _labeledList(root['kycTiers'], 'KYC tier'),
            _labeledList(root['topActivity'], 'Top customer activity'),
            _labeledList(root['recentRegistrations'], 'Recent registrations'),
          ]);
    }
    if (module.id == 'service-performance') {
      return _labeledList(
          root['services'] ?? root['items'] ?? root, 'Service performance');
    }
    return _kpis(_data);
  }

  Widget _labeledMap(dynamic values, String title) {
    if (values is! Map || values.isEmpty) {
      return const SizedBox.shrink();
    }
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title,
                    style: const TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                ...values.entries.map<Widget>((entry) => Padding(
                      padding: const EdgeInsets.only(bottom: 5),
                      child: Text(
                          '${_pretty(entry.key.toString())}: ${_scalar(entry.value)}'),
                    )),
              ],
            )));
  }

  Widget _labeledList(dynamic values, String title) {
    if (values is! List || values.isEmpty) {
      return const SizedBox.shrink();
    }
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title,
                    style: const TextStyle(fontWeight: FontWeight.w800)),
                ...values
                    .take(8)
                    .whereType<Map>()
                    .map<Widget>((value) => ListTile(
                          dense: true,
                          title: Text(_value(
                              Map<String, dynamic>.from(value),
                              const <String>[
                                '_id',
                                'name',
                                'service',
                                'date',
                                'id'
                              ],
                              'Returned item')),
                          subtitle: Text(
                              _safeFields(Map<String, dynamic>.from(value))),
                        )),
              ],
            )));
  }

  Widget _chart(Map<String, dynamic>? data) {
    final dynamic root = data?['data'] is Map ? data!['data'] : data;
    final dynamic raw = root?['progress'] ?? root?['rates'];
    if (raw is! Map || raw.isEmpty) {
      return const SizedBox.shrink();
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: raw.entries.take(5).map<Widget>((e) {
            final double value = double.tryParse(e.value.toString()) ?? 0;
            final double progress =
                (value > 1 ? value / 100 : value).clamp(0, 1).toDouble();
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: <Widget>[
                SizedBox(
                    width: 105,
                    child: Text(_pretty(e.key.toString()),
                        overflow: TextOverflow.ellipsis)),
                Expanded(
                    child: LinearProgressIndicator(
                        value: progress, color: const Color(0xff0e6b61))),
                const SizedBox(width: 8),
                Text(e.value.toString()),
              ]),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _record(Map<String, dynamic> record) => Card(
        child: ListTile(
          title: Text(_value(
              record,
              const <String>['title', 'name', 'event', 'id', '_id'],
              'Returned record')),
          subtitle: Text(_value(
              record,
              const <String>['status', 'type', 'createdAt', 'timestamp'],
              'Details returned by service')),
          trailing: _selected?.id == 'privacy-controls'
              ? IconButton(
                  tooltip: 'Update request status',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _privacyStatus(record))
              : null,
          onTap: () => showModalBottomSheet<void>(
            context: context,
            builder: (_) => SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Text(_safeFields(record)),
            ),
          ),
        ),
      );
  Widget _pagination(_ControlModule module, int count) =>
      Row(mainAxisAlignment: MainAxisAlignment.end, children: <Widget>[
        Text('Page $_page'),
        IconButton(
            onPressed: _page > 1 && !_loading
                ? () => _open(module, page: _page - 1)
                : null,
            icon: const Icon(Icons.chevron_left)),
        IconButton(
            onPressed: count > 0 && !_loading
                ? () => _open(module, page: _page + 1)
                : null,
            icon: const Icon(Icons.chevron_right))
      ]);
  Future<void> _exportDialog() async {
    await showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) => AlertDialog(
                title: const Text('Create data export'),
                content: StatefulBuilder(
                    builder: (_, setDialogState) => Column(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              DropdownButtonFormField<String>(
                                  value: _dataset,
                                  decoration: const InputDecoration(
                                      labelText: 'Dataset'),
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
                                    'SOLAR'
                                  ]
                                      .map((value) => DropdownMenuItem(
                                          value: value, child: Text(value)))
                                      .toList(),
                                  onChanged: (value) => setDialogState(
                                      () => _dataset = value ?? _dataset)),
                              TextButton(
                                  onPressed: () async {
                                    final value = await showDatePicker(
                                        context: context,
                                        firstDate: DateTime(2020),
                                        lastDate: DateTime.now(),
                                        initialDate:
                                            _exportFrom ?? DateTime.now());
                                    if (value != null) {
                                      setDialogState(() => _exportFrom = value);
                                    }
                                  },
                                  child: Text(_exportFrom == null
                                      ? 'Start date (optional)'
                                      : 'From ${_exportFrom!.toIso8601String().split('T').first}')),
                              TextButton(
                                  onPressed: () async {
                                    final value = await showDatePicker(
                                        context: context,
                                        firstDate:
                                            _exportFrom ?? DateTime(2020),
                                        lastDate: DateTime.now(),
                                        initialDate:
                                            _exportTo ?? DateTime.now());
                                    if (value != null) {
                                      setDialogState(() => _exportTo = value);
                                    }
                                  },
                                  child: Text(_exportTo == null
                                      ? 'End date (optional)'
                                      : 'To ${_exportTo!.toIso8601String().split('T').first}')),
                            ])),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () {
                        Navigator.pop(dialogContext);
                        _export();
                      },
                      child: const Text('Create CSV'))
                ]));
  }

  Future<void> _export() async {
    try {
      final AdminControlExport export =
          await _api.exportDataset(_dataset, from: _exportFrom, to: _exportTo);
      if (!mounted) {
        return;
      }
      await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (_) => DraggableScrollableSheet(
              expand: false,
              builder: (_, controller) => SingleChildScrollView(
                  controller: controller,
                  padding: const EdgeInsets.all(20),
                  child: SelectableText(export.csv ??
                      const JsonEncoder.withIndent('  ')
                          .convert(export.json)))));
    } catch (e) {
      await _handle(e);
    }
  }

  Future<void> _privacyStatus(Map<String, dynamic> record) async {
    final String? id = record['id']?.toString() ?? record['_id']?.toString();
    if (id == null || id.isEmpty) {
      return;
    }
    final TextEditingController status =
        TextEditingController(text: record['status']?.toString() ?? '');
    final TextEditingController note = TextEditingController();
    final bool? update = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
                title: const Text('Update privacy request'),
                content:
                    Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                  TextField(
                      controller: status,
                      decoration: const InputDecoration(labelText: 'Status')),
                  TextField(
                      controller: note,
                      decoration:
                          const InputDecoration(labelText: 'Resolution note')),
                ]),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Update'))
                ]));
    if (update == true && status.text.trim().isNotEmpty) {
      try {
        await _api.updatePrivacyRequest(id, <String, dynamic>{
          'status': status.text.trim(),
          'note': note.text.trim(),
        });
        if (mounted) {
          _open(_selected!);
        }
      } catch (e) {
        await _handle(e);
      }
    }
    status.dispose();
    note.dispose();
  }

  Future<void> _privacyCreate() async {
    final TextEditingController type = TextEditingController();
    final TextEditingController subjectUser = TextEditingController();
    final bool? create = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
                title: const Text('Create privacy request'),
                content:
                    Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                  TextField(
                      controller: type,
                      decoration:
                          const InputDecoration(labelText: 'Request type')),
                  TextField(
                      controller: subjectUser,
                      decoration:
                          const InputDecoration(labelText: 'Subject user ID')),
                  const Padding(
                    padding: EdgeInsets.only(top: 10),
                    child: Text(
                        'ERASURE cannot be completed until retention-safe anonymization is confirmed.',
                        style: TextStyle(fontSize: 12)),
                  ),
                ]),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Create'))
                ]));
    if (create == true &&
        type.text.trim().isNotEmpty &&
        subjectUser.text.trim().isNotEmpty) {
      try {
        await _api.createPrivacyRequest(<String, dynamic>{
          'type': type.text.trim(),
          'subjectUser': subjectUser.text.trim(),
        });
        if (mounted) {
          _open(_selected!);
        }
      } catch (e) {
        await _handle(e);
      }
    }
    type.dispose();
    subjectUser.dispose();
  }

  Widget _errorPanel(VoidCallback retry) => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            Text(_error ?? 'Unable to load data.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xffa13328))),
            const SizedBox(height: 10),
            OutlinedButton.icon(
                onPressed: retry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'))
          ])));
}

class _ControlModule {
  const _ControlModule(this.id, this.title, this.icon);
  final String id;
  final String title;
  final IconData icon;
}

String _pretty(String v) => v
    .replaceAllMapped(RegExp(r'([a-z0-9])([A-Z])'),
        (Match match) => '${match[1]} ${match[2]}')
    .replaceAll(RegExp(r'[_-]'), ' ')
    .split(' ')
    .where((w) => w.isNotEmpty)
    .map((w) => '${w[0].toUpperCase()}${w.substring(1)}')
    .join(' ');
String _value(Map<String, dynamic> value, List<String> keys, String fallback) {
  for (final String k in keys) {
    final String v = value[k]?.toString() ?? '';
    if (v.isNotEmpty) {
      return v;
    }
  }
  return fallback;
}

String _scalar(dynamic value) {
  if (value is Map || value is List) {
    return 'Details available';
  }
  return value?.toString() ?? '—';
}

String _safeFields(Map<String, dynamic> record) {
  return record.entries
      .where((entry) => entry.value is! Map && entry.value is! List)
      .take(4)
      .map((entry) => '${_pretty(entry.key)}: ${_scalar(entry.value)}')
      .join(' • ');
}
