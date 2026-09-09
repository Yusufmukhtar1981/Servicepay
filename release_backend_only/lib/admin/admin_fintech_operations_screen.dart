import 'dart:convert';

import 'package:flutter/material.dart';

import 'admin_fintech_operations_api.dart';

class AdminFintechOperationsScreen extends StatefulWidget {
  const AdminFintechOperationsScreen({super.key});

  @override
  State<AdminFintechOperationsScreen> createState() =>
      _AdminFintechOperationsScreenState();
}

class _AdminFintechOperationsScreenState
    extends State<AdminFintechOperationsScreen> {
  static const List<_OperationModule> _modules = <_OperationModule>[
    _OperationModule(
        'complaints', 'Cases', 'cases', Icons.support_agent_outlined),
    _OperationModule(
        'chargebacks', 'Chargebacks', 'cases', Icons.replay_outlined),
    _OperationModule('manual_resolution', 'Manual resolution', 'cases',
        Icons.gavel_outlined),
    _OperationModule('suspicious_transactions', 'Suspicious transactions',
        'risk-alerts', Icons.warning_amber_rounded),
    _OperationModule(
        'aml', 'AML monitoring', 'risk-alerts', Icons.policy_outlined),
    _OperationModule('scheduled_payments', 'Scheduled payments',
        'scheduled-payments', Icons.event_repeat_outlined),
    _OperationModule('providers', 'Provider management', 'providers',
        Icons.account_tree_outlined),
    _OperationModule(
        'reports', 'Operational reports', 'reports', Icons.assessment_outlined),
    _OperationModule('kyb', 'KYB records', 'kyb', Icons.business_outlined),
    _OperationModule('identity_verifications', 'Identity records',
        'identity-verifications', Icons.badge_outlined),
  ];
  final TextEditingController _search = TextEditingController();
  final TextEditingController _filter = TextEditingController();
  Map<String, dynamic>? _catalog;
  _OperationModule? _selected;
  List<Map<String, dynamic>> _records = <Map<String, dynamic>>[];
  bool _loading = true;
  String? _error;

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
      final Map<String, dynamic> result =
          await AdminFintechOperationsApi.catalog();
      if (mounted) setState(() => _catalog = result);
    } catch (error) {
      if (mounted) setState(() => _error = _clean(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open(_OperationModule module) async {
    if (module.path == 'reports') {
      setState(() => _selected = module);
      return;
    }
    setState(() {
      _selected = module;
      _loading = true;
      _error = null;
      _records = <Map<String, dynamic>>[];
    });
    try {
      final Map<String, dynamic> result =
          await AdminFintechOperationsApi.collection(
        module.path,
        search: _search.text,
        status: _filter.text,
      );
      if (mounted) setState(() => _records = _recordsFrom(result));
    } catch (error) {
      if (mounted) setState(() => _error = _clean(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> _recordsFrom(Map<String, dynamic> body) {
    dynamic candidate = body['data'] ?? body['items'] ?? body['results'];
    if (candidate is Map) {
      candidate =
          candidate['items'] ?? candidate['records'] ?? candidate['data'];
    }
    if (candidate is! List) return <Map<String, dynamic>>[];
    return candidate
        .whereType<Map>()
        .map((Map item) => Map<String, dynamic>.from(item))
        .toList();
  }

  bool _live(_OperationModule module) {
    final dynamic capabilities =
        _catalog?['capabilities'] ?? _catalog?['modules'];
    if (capabilities is Map) {
      final dynamic value =
          capabilities[module.key] ?? capabilities[module.path];
      if (value is bool) return value;
      if (value is Map) {
        return value['available'] == true ||
            value['enabled'] == true ||
            value['live'] == true;
      }
    }
    if (capabilities is List) {
      return capabilities.any((dynamic value) =>
          value is String && (value == module.key || value == module.path));
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final _OperationModule? selected = _selected;
    return Scaffold(
      backgroundColor: const Color(0xfff4f7f8),
      appBar: AppBar(
        title:
            Text(selected == null ? 'Fintech Control Center' : selected.title),
        backgroundColor: const Color(0xff123b42),
        foregroundColor: Colors.white,
        actions: <Widget>[
          if (selected != null && _canCreate(selected))
            IconButton(
              onPressed: _loading ? null : () => _createRecord(selected),
              icon: const Icon(Icons.add),
              tooltip: 'Create record',
            ),
          IconButton(
              onPressed: _loading
                  ? null
                  : (selected == null ? _loadCatalog : () => _open(selected)),
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh'),
        ],
      ),
      body: selected == null ? _workspace() : _moduleView(selected),
    );
  }

  Widget _workspace() => RefreshIndicator(
        onRefresh: _loadCatalog,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            const Text('ServicePay Head Office',
                style: TextStyle(
                    fontSize: 13,
                    letterSpacing: 1.2,
                    color: Color(0xff477278),
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 5),
            const Text('Operational cockpit',
                style: TextStyle(
                    fontSize: 27,
                    fontWeight: FontWeight.w800,
                    color: Color(0xff123b42))),
            const SizedBox(height: 8),
            const Text(
                'Review live operational queues and the capabilities currently returned by the protected service.',
                style: TextStyle(height: 1.4, color: Color(0xff52666a))),
            if (_loading)
              const Padding(
                  padding: EdgeInsets.only(top: 22),
                  child: LinearProgressIndicator()),
            if (_error != null) _errorPanel(_error!, _loadCatalog),
            const SizedBox(height: 18),
            LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) {
              final int columns = constraints.maxWidth > 900
                  ? 3
                  : constraints.maxWidth > 580
                      ? 2
                      : 1;
              final double width =
                  (constraints.maxWidth - (columns - 1) * 12) / columns;
              return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: _modules
                      .map((_OperationModule module) =>
                          SizedBox(width: width, child: _moduleCard(module)))
                      .toList());
            }),
          ],
        ),
      );

  Widget _moduleCard(_OperationModule module) {
    final bool live = _live(module);
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: Color(0xffdce7e6))),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _open(module),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: <Widget>[
            Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                    color: const Color(0xffe1f0ed),
                    borderRadius: BorderRadius.circular(10)),
                child: Icon(module.icon, color: const Color(0xff0e6b61))),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                  Text(module.title,
                      style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: Color(0xff183b40))),
                  const SizedBox(height: 5),
                  Text(
                      live
                          ? 'Capability confirmed by API'
                          : 'Capability information unavailable',
                      style: const TextStyle(
                          fontSize: 12, color: Color(0xff63777a))),
                ])),
            _capability(live),
          ]),
        ),
      ),
    );
  }

  Widget _capability(bool live) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
            color: live ? const Color(0xffd9f3e5) : const Color(0xffedf1f1),
            borderRadius: BorderRadius.circular(20)),
        child: Text(live ? 'LIVE' : 'STATUS UNKNOWN',
            style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                color:
                    live ? const Color(0xff137044) : const Color(0xff627376))),
      );

  Widget _moduleView(_OperationModule module) {
    if (module.path == 'reports') return _reports(module);
    return Column(children: <Widget>[
      _filters(module),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null)
        Expanded(child: _errorPanel(_error!, () => _open(module))),
      if (!_loading && _error == null)
        Expanded(
            child: RefreshIndicator(
          onRefresh: () => _open(module),
          child: _records.isEmpty
              ? ListView(children: const <Widget>[
                  SizedBox(height: 170),
                  Center(child: Text('No records returned for this queue.'))
                ])
              : ListView.separated(
                  padding: const EdgeInsets.all(12),
                  itemCount: _records.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (_, int index) =>
                      _recordCard(module, _records[index]),
                ),
        )),
    ]);
  }

  Widget _filters(_OperationModule module) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
        child: Column(children: <Widget>[
          TextField(
              controller: _search,
              maxLength: 80,
              onSubmitted: (_) => _open(module),
              decoration: const InputDecoration(
                  counterText: '',
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search returned records',
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder())),
          const SizedBox(height: 8),
          TextField(
              controller: _filter,
              maxLength: 40,
              onSubmitted: (_) => _open(module),
              decoration: InputDecoration(
                  counterText: '',
                  prefixIcon: const Icon(Icons.filter_list),
                  hintText: 'Status filter',
                  suffixIcon: IconButton(
                      onPressed: () => _open(module),
                      icon: const Icon(Icons.arrow_forward)),
                  filled: true,
                  fillColor: Colors.white,
                  border: const OutlineInputBorder())),
        ]),
      );

  Widget _recordCard(_OperationModule module, Map<String, dynamic> record) {
    final String title = _value(record,
        <String>['title', 'reference', 'name', 'id', '_id'], 'Untitled record');
    final String status = _value(
        record, <String>['status', 'state', 'riskLevel'], 'Returned record');
    return Card(
        child: ListTile(
      leading: Icon(module.icon, color: const Color(0xff0e6b61)),
      title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(status),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => _details(module, record),
    ));
  }

  Future<void> _details(
      _OperationModule module, Map<String, dynamic> record) async {
    final String? id = record['_id']?.toString() ?? record['id']?.toString();
    Map<String, dynamic> detail = record;
    if (module.path == 'cases' && id != null && id.isNotEmpty) {
      try {
        final Map<String, dynamic> body =
            await AdminFintechOperationsApi.record(module.path, id);
        final dynamic raw = body['data'] ?? body['case'];
        if (raw is Map) detail = Map<String, dynamic>.from(raw);
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(_clean(error))));
        }
      }
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) => DraggableScrollableSheet(
        expand: false,
        builder: (_, ScrollController controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(20),
          children: <Widget>[
            Text(module.title,
                style:
                    const TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            ...detail.entries.map((MapEntry<String, dynamic> entry) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child:
                    Text('${_pretty(entry.key)}\n${_display(entry.value)}'))),
            if (_canPatch(module))
              OutlinedButton.icon(
                  onPressed: () => _statusDialog(module, record),
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Update status')),
          ],
        ),
      ),
    );
  }

  bool _canPatch(_OperationModule module) => <String>[
        'cases',
        'risk-alerts',
        'scheduled-payments',
        'providers'
      ].contains(module.path);

  bool _canCreate(_OperationModule module) => <String>[
        'cases',
        'risk-alerts',
        'scheduled-payments'
      ].contains(module.path);

  Future<void> _createRecord(_OperationModule module) async {
    final TextEditingController payload = TextEditingController();
    final String? submitted = await showDialog<String>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: Text('Create ${module.title} record'),
        content: TextField(
          controller: payload,
          autofocus: true,
          maxLines: 6,
          decoration: const InputDecoration(
            labelText: 'JSON request body',
            hintText: '{"reference":"..."}',
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, payload.text),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    payload.dispose();
    if (submitted == null || submitted.trim().isEmpty) return;
    try {
      final dynamic decoded = jsonDecode(submitted);
      if (decoded is! Map) {
        throw Exception('Enter a JSON object for the request body.');
      }
      await AdminFintechOperationsApi.create(
        module.path,
        Map<String, dynamic>.from(decoded),
      );
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Record submitted.')));
        _open(module);
      }
    } on FormatException {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Enter valid JSON for the request body.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_clean(error))));
      }
    }
  }

  Future<void> _statusDialog(
      _OperationModule module, Map<String, dynamic> record) async {
    final TextEditingController status =
        TextEditingController(text: _value(record, <String>['status']));
    final String? id = record['_id']?.toString() ?? record['id']?.toString();
    if (id == null || id.isEmpty) return;
    final bool? submit = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
                title: const Text('Update status'),
                content: TextField(
                    controller: status,
                    maxLength: 40,
                    decoration: const InputDecoration(labelText: 'Status')),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Update'))
                ]));
    if (submit != true || status.text.trim().isEmpty) return;
    try {
      await AdminFintechOperationsApi.update(
          module.path, id, <String, dynamic>{'status': status.text.trim()});
      if (mounted) {
        Navigator.pop(context);
        _open(module);
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_clean(error))));
      }
    } finally {
      status.dispose();
    }
  }

  Widget _reports(_OperationModule module) =>
      ListView(padding: const EdgeInsets.all(16), children: <Widget>[
        const Text(
            'Request an API-provided JSON or CSV report. Reports are generated by the backend; this console does not claim an automatic scheduler.',
            style: TextStyle(height: 1.4)),
        const SizedBox(height: 16),
        for (final String type in <String>['operations', 'risk', 'providers'])
          Card(
              child: ListTile(
                  title: Text(_pretty(type)),
                  subtitle: const Text('Fetch current server report'),
                  trailing: const Icon(Icons.download_outlined),
                  onTap: () => _report(type))),
      ]);

  Future<void> _report(String type) async {
    try {
      final AdminFintechReport report =
          await AdminFintechOperationsApi.report(type);
      if (!mounted) return;
      await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (_) => DraggableScrollableSheet(
              expand: false,
              builder: (_, ScrollController controller) =>
                  SingleChildScrollView(
                      controller: controller,
                      padding: const EdgeInsets.all(20),
                      child: SelectableText(report.csv ??
                          const JsonEncoder.withIndent('  ')
                              .convert(report.json)))));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_clean(error))));
      }
    }
  }

  Widget _errorPanel(String message, VoidCallback retry) => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xffa13328))),
            const SizedBox(height: 10),
            OutlinedButton.icon(
                onPressed: retry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'))
          ])));
}

class _OperationModule {
  const _OperationModule(this.key, this.title, this.path, this.icon);
  final String key;
  final String title;
  final String path;
  final IconData icon;
}

String _value(Map<String, dynamic> record, List<String> keys,
    [String fallback = '']) {
  for (final String key in keys) {
    final String value = record[key]?.toString().trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  return fallback;
}

String _pretty(String value) => value
    .replaceAll(RegExp(r'[_-]'), ' ')
    .split(' ')
    .where((String word) => word.isNotEmpty)
    .map((String word) => '${word[0].toUpperCase()}${word.substring(1)}')
    .join(' ');
String _display(dynamic value) => value is Map || value is List
    ? const JsonEncoder.withIndent('  ').convert(value)
    : value?.toString() ?? '—';
String _clean(Object error) => error.toString().replaceFirst('Exception: ', '');
