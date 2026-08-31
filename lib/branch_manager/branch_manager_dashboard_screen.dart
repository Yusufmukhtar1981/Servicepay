import 'package:flutter/material.dart';

import 'branch_manager_dashboard_api.dart';

class BranchManagerDashboardScreen extends StatefulWidget {
  const BranchManagerDashboardScreen({super.key, this.api});
  final BranchManagerDashboardApi? api;

  @override
  State<BranchManagerDashboardScreen> createState() =>
      _BranchManagerDashboardScreenState();
}

class _BranchManagerDashboardScreenState
    extends State<BranchManagerDashboardScreen> {
  late final BranchManagerDashboardApi _api;
  BranchManagerDashboard? _dashboard;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? BranchManagerDashboardHttpApi();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final BranchManagerDashboard value = await _api.loadDashboard();
      if (mounted) setState(() => _dashboard = value);
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _text(Map<String, dynamic> row, List<String> keys,
      [String fallback = '—']) {
    for (final String key in keys) {
      final dynamic value = row[key];
      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }
    return fallback;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xfff5f7fa),
        appBar: AppBar(title: const Text('Branch Manager'), actions: <Widget>[
          IconButton(
              tooltip: 'Refresh',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh)),
        ]),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Padding(
                        padding: const EdgeInsets.all(24),
                        child:
                            Column(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.cloud_off_outlined, size: 44),
                          const SizedBox(height: 8),
                          const Text('Unable to load your branch dashboard',
                              style: TextStyle(fontWeight: FontWeight.w800)),
                          Text(_error!, textAlign: TextAlign.center),
                          TextButton(
                              onPressed: _load, child: const Text('Retry')),
                        ])))
                : RefreshIndicator(onRefresh: _load, child: _content()),
      );

  Widget _content() {
    final BranchManagerDashboard data = _dashboard!;
    return LayoutBuilder(builder: (BuildContext context, BoxConstraints box) {
      final bool wide = box.maxWidth >= 760;
      final List<Widget> cards = <Widget>[
        _identity(data.branch),
        _section('Reporting periods', Icons.date_range_outlined, data.periods),
        _section('Targets', Icons.track_changes_outlined, data.targets),
        _section('Approvals', Icons.fact_check_outlined, data.approvals),
        _section('Branch staff', Icons.people_outline, data.staff),
        _section('Reports', Icons.assessment_outlined, data.reports),
        _section('Assigned modules', Icons.widgets_outlined, data.modules),
      ];
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: wide
            ? <Widget>[
                _identity(data.branch),
                Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: cards
                        .skip(1)
                        .map((Widget card) => SizedBox(
                            width: (box.maxWidth - 44) / 2, child: card))
                        .toList())
              ]
            : cards,
      );
    });
  }

  Widget _identity(Map<String, dynamic> branch) => Card(
      child: Padding(
          padding: const EdgeInsets.all(18),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(_text(branch, <String>['name', 'branchName'], 'Your branch'),
                style:
                    const TextStyle(fontSize: 23, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text('Code: ${_text(branch, <String>['code', 'branchCode'])}'),
            Text(_text(
                branch, <String>['address', 'location'], 'Location not set')),
            const SizedBox(height: 8),
            Chip(label: Text(_text(branch, <String>['status'], 'ACTIVE'))),
          ])));

  Widget _section(
          String title, IconData icon, List<Map<String, dynamic>> rows) =>
      Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(icon, color: const Color(0xff0f766e)),
                      const SizedBox(width: 8),
                      Text(title,
                          style: const TextStyle(
                              fontSize: 17, fontWeight: FontWeight.w800)),
                    ]),
                    if (rows.isEmpty)
                      const Padding(
                          padding: EdgeInsets.all(14),
                          child: Text('No records available.'))
                    else
                      ...rows.map((Map<String, dynamic> row) => ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(_text(row, <String>[
                              'name',
                              'title',
                              'period',
                              'metric',
                              'reference',
                              'email'
                            ])),
                            subtitle: Text(_text(row, <String>[
                              'status',
                              'description',
                              'value',
                              'role',
                              'startDate'
                            ])),
                          )),
                  ])));
}
