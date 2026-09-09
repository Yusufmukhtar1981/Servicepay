import 'package:flutter/material.dart';

import 'svp_api_service.dart';

class SvpReportsScreen extends StatefulWidget {
  const SvpReportsScreen({super.key, this.headOffice = false});
  final bool headOffice;
  @override
  State<SvpReportsScreen> createState() => _SvpReportsScreenState();
}

class _SvpReportsScreenState extends State<SvpReportsScreen> {
  final api = SvpApiService();
  List<dynamic> reports = const [];
  bool loading = true;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final r = await api.request(
          'GET', widget.headOffice ? '/svp/reports' : '/svp/me/reports');
      if (mounted) {
        setState(() {
          reports = (r['data'] as List?) ?? const [];
          loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(
          title: Text(widget.headOffice
              ? 'SVP Reports · Head Office'
              : 'My SVP Reports'),
          actions: [
            IconButton(onPressed: load, icon: const Icon(Icons.refresh))
          ]),
      floatingActionButton: widget.headOffice
          ? null
          : FloatingActionButton.extended(
              onPressed: _create,
              icon: const Icon(Icons.note_add_outlined),
              label: const Text('New report')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : reports.isEmpty
              ? const Center(child: Text('No reports have been created.'))
              : ListView(
                  children: reports.map((x) => _report(x as Map)).toList()));
  Widget _report(Map x) => Card(
      elevation: 0,
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: ListTile(
          title: Text('${x['title'] ?? 'Untitled'}',
              style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text('${x['type'] ?? '—'} · ${x['status'] ?? '—'}'),
          trailing: widget.headOffice
              ? TextButton(
                  onPressed: () => _review(x), child: const Text('Review'))
              : (x['status'] == 'DRAFT'
                  ? PopupMenuButton<String>(
                      onSelected: (v) {
                        if (v == 'edit') _edit(x);
                        if (v == 'submit') _submit(x);
                      },
                      itemBuilder: (_) => const [
                            PopupMenuItem(
                                value: 'edit', child: Text('Edit draft')),
                            PopupMenuItem(
                                value: 'submit', child: Text('Submit'))
                          ])
                  : null),
          onTap: widget.headOffice ? () => _review(x) : null));
  Future<void> _create() async {
    final r = await showDialog<Map<String, dynamic>>(
        context: context, builder: (_) => const _ReportForm());
    if (r == null) {
      return;
    }
    try {
      await api.request('POST', '/svp/me/reports', body: r);
      load();
    } catch (e) {
      _message(e);
    }
  }

  Future<void> _edit(Map x) async {
    final r = await showDialog<Map<String, dynamic>>(
        context: context, builder: (_) => _ReportForm(existing: x));
    if (r == null) return;
    try {
      await api.request('PATCH', '/svp/me/reports/${x['_id'] ?? x['id']}',
          body: r);
      load();
    } catch (e) {
      _message(e);
    }
  }

  Future<void> _submit(Map x) async {
    try {
      await api.request(
          'POST', '/svp/me/reports/${x['_id'] ?? x['id']}/submit');
      load();
    } catch (e) {
      _message(e);
    }
  }

  Future<void> _review(Map x) async {
    final r = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (_) => _ReviewForm(status: '${x['status']}'));
    if (r == null) return;
    try {
      await api.request('PATCH', '/svp/reports/${x['_id'] ?? x['id']}/review',
          body: r);
      load();
    } catch (e) {
      _message(e);
    }
  }

  void _message(Object e) => ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
}

class _ReportForm extends StatefulWidget {
  const _ReportForm({this.existing});
  final Map? existing;
  @override
  State<_ReportForm> createState() => _ReportFormState();
}

class _ReportFormState extends State<_ReportForm> {
  late final TextEditingController title, summary;
  String type = 'OPERATIONAL';
  @override
  void initState() {
    super.initState();
    title = TextEditingController(text: '${widget.existing?['title'] ?? ''}');
    summary =
        TextEditingController(text: '${widget.existing?['summary'] ?? ''}');
    type = '${widget.existing?['type'] ?? type}';
  }

  @override
  void dispose() {
    title.dispose();
    summary.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext c) => AlertDialog(
          title: Text(widget.existing == null ? 'New report' : 'Edit draft'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
                value: type,
                items: const [
                  'DAILY',
                  'WEEKLY',
                  'MONTHLY',
                  'QUARTERLY',
                  'INCIDENT',
                  'OPERATIONAL',
                  'FINANCIAL_PERFORMANCE',
                  'BRANCH_PERFORMANCE',
                  'STAFF_PERFORMANCE'
                ]
                    .map((x) => DropdownMenuItem(value: x, child: Text(x)))
                    .toList(),
                onChanged: (v) => setState(() => type = v!)),
            TextField(
                controller: title,
                decoration: const InputDecoration(labelText: 'Title')),
            TextField(
                controller: summary,
                maxLines: 4,
                decoration: const InputDecoration(labelText: 'Summary'))
          ]),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(c, {
                      'type': type,
                      'title': title.text.trim(),
                      'summary': summary.text
                    }),
                child: const Text('Save draft'))
          ]);
}

class _ReviewForm extends StatefulWidget {
  const _ReviewForm({required this.status});
  final String status;
  @override
  State<_ReviewForm> createState() => _ReviewFormState();
}

class _ReviewFormState extends State<_ReviewForm> {
  String next = 'UNDER_REVIEW';
  final c = TextEditingController();
  @override
  Widget build(BuildContext context) => AlertDialog(
          title: const Text('Review report'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
                value: next,
                items: const [
                  'UNDER_REVIEW',
                  'ACKNOWLEDGED',
                  'ACTION_REQUIRED',
                  'RESOLVED',
                  'CLOSED'
                ]
                    .map((x) => DropdownMenuItem(value: x, child: Text(x)))
                    .toList(),
                onChanged: (v) => setState(() => next = v!)),
            TextField(
                controller: c,
                maxLines: 3,
                decoration:
                    const InputDecoration(labelText: 'Required comment'))
          ]),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(
                    context, {'status': next, 'comment': c.text.trim()}),
                child: const Text('Apply review'))
          ]);
}
