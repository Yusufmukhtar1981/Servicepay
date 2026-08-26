import 'package:flutter/material.dart';
import 'dart:math';
import 'admin_support_api.dart';

class AdminCustomerSupportScreen extends StatefulWidget {
  const AdminCustomerSupportScreen({super.key, this.api});
  final AdminSupportApi? api;
  @override
  State<AdminCustomerSupportScreen> createState() =>
      _AdminCustomerSupportScreenState();
}

class _AdminCustomerSupportScreenState
    extends State<AdminCustomerSupportScreen> {
  late final AdminSupportApi api = widget.api ?? AdminSupportApi();
  final search = TextEditingController();
  List<Map<String, dynamic>> tickets = [];
  Map<String, dynamic> metrics = {};
  String status = '', priority = '', error = '';
  bool loading = true;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    search.dispose();
    if (widget.api == null) api.close();
    super.dispose();
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      final values = await Future.wait([
        api.metrics(),
        api.tickets(search: search.text, status: status, priority: priority)
      ]);
      final metricsData = values[0]['data'] is Map
          ? Map<String, dynamic>.from(values[0]['data'])
          : values[0];
      final ticketData = values[1]['data'] is Map
          ? Map<String, dynamic>.from(values[1]['data'])
          : values[1];
      final raw = ticketData['tickets'] ?? ticketData['items'];
      if (mounted) {
        setState(() {
          metrics = metricsData;
          tickets = raw is List
              ? raw
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList()
              : [];
          error = '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Customer Support'), actions: [
          IconButton(
              onPressed: loading ? null : load, icon: const Icon(Icons.refresh))
        ]),
        body: Column(children: [
          if (loading) const LinearProgressIndicator(),
          if (error.isNotEmpty)
            MaterialBanner(content: Text(error), actions: [
              TextButton(onPressed: load, child: const Text('Retry'))
            ]),
          Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Wrap(
                    spacing: 8,
                    children: metrics.entries
                        .map((e) => Chip(label: Text('${e.key}: ${e.value}')))
                        .toList()),
                TextField(
                    controller: search,
                    onSubmitted: (_) => load(),
                    decoration: InputDecoration(
                        labelText: 'Search reference, customer, phone or email',
                        suffixIcon: IconButton(
                            onPressed: load, icon: const Icon(Icons.search)),
                        border: const OutlineInputBorder())),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(
                      child: filter('Status', status, [
                    '',
                    'OPEN',
                    'IN_PROGRESS',
                    'RESOLVED',
                    'CLOSED'
                  ], (v) {
                    status = v;
                    load();
                  })),
                  const SizedBox(width: 8),
                  Expanded(
                      child: filter('Priority', priority,
                          ['', 'LOW', 'NORMAL', 'HIGH', 'URGENT'], (v) {
                    priority = v;
                    load();
                  })),
                ]),
              ])),
          Expanded(
            child: RefreshIndicator(
                onRefresh: load,
                child: tickets.isEmpty && !loading
                    ? ListView(children: const [
                        SizedBox(height: 120),
                        Center(child: Text('No support tickets found.'))
                      ])
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: tickets.length,
                        itemBuilder: (_, i) {
                          final t = tickets[i];
                          final customer = t['customer'] is Map
                              ? Map<String, dynamic>.from(t['customer'])
                              : <String, dynamic>{};
                          return Card(
                              child: ListTile(
                                  title: Text(
                                      '${t['subject'] ?? 'Support request'}'),
                                  subtitle: Text(
                                      '${t['caseReference'] ?? t['reference'] ?? t['_id']}\n${customer['fullName'] ?? customer['name'] ?? 'Customer'} • ${t['status'] ?? 'OPEN'} • ${t['priority'] ?? 'NORMAL'}'),
                                  isThreeLine: true,
                                  onTap: () => Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                          builder: (_) => _Detail(
                                              id: '${t['_id'] ?? t['id']}',
                                              api: api)))));
                        })),
          ),
        ]),
      );
  Widget filter(String label, String value, List<String> values,
          ValueChanged<String> changed) =>
      DropdownButtonFormField<String>(
          value: value,
          decoration: InputDecoration(
              labelText: label, border: const OutlineInputBorder()),
          items: values
              .map((x) => DropdownMenuItem(
                  value: x, child: Text(x.isEmpty ? 'All' : x)))
              .toList(),
          onChanged: loading
              ? null
              : (v) {
                  if (v != null) changed(v);
                });
}

class _Detail extends StatefulWidget {
  const _Detail({required this.id, required this.api});
  final String id;
  final AdminSupportApi api;
  @override
  State<_Detail> createState() => _DetailState();
}

class _DetailState extends State<_Detail> {
  Map<String, dynamic>? ticket;
  bool loading = true, busy = false;
  String error = '';
  final replyMessage = TextEditingController();
  final internalNote = TextEditingController();
  final resolution = TextEditingController();
  String? replyIdempotencyKey;
  String? noteIdempotencyKey;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    replyMessage.dispose();
    internalNote.dispose();
    resolution.dispose();
    super.dispose();
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      final x = await widget.api.ticket(widget.id);
      final value = x['data'] is Map
          ? Map<String, dynamic>.from(x['data'])
          : x['ticket'] is Map
              ? Map<String, dynamic>.from(x['ticket'])
              : x;
      if (mounted) {
        setState(() {
          ticket = value;
          resolution.text = '${value['resolution'] ?? ''}';
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> run(Future<Map<String, dynamic>> Function() f,
      {VoidCallback? onSuccess}) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await f();
      onSuccess?.call();
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  String newIdempotencyKey() =>
      '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  Future<void> changeStatus(String value) async {
    if (['RESOLVED', 'CLOSED'].contains(value)) {
      final ok = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
                  title: Text('Mark $value?'),
                  content: const Text('Confirm this terminal status change.'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(c, false),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: () => Navigator.pop(c, true),
                        child: const Text('Confirm'))
                  ]));
      if (ok != true) return;
    }
    await run(() => widget.api.update(widget.id, {'status': value}));
  }

  Future<void> assign() async {
    final q = TextEditingController();
    final person = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (c) => AlertDialog(
                title: const Text('Assign staff'),
                content: TextField(
                    controller: q,
                    decoration:
                        const InputDecoration(labelText: 'Search staff')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () async {
                        final people = await widget.api.staff(q.text);
                        if (c.mounted && people.isNotEmpty) {
                          Navigator.pop(c, people.first);
                        }
                      },
                      child: const Text('Search'))
                ]));
    q.dispose();
    if (person != null) {
      await run(() => widget.api
          .update(widget.id, {'assignedTo': person['_id'] ?? person['id']}));
    }
  }

  @override
  Widget build(BuildContext context) {
    final x = ticket;
    return Scaffold(
        appBar: AppBar(title: const Text('Ticket details')),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : x == null
                ? Center(child: Text(error))
                : ListView(padding: const EdgeInsets.all(16), children: [
                    Text('${x['subject'] ?? 'Support request'}',
                        style: Theme.of(context).textTheme.titleLarge),
                    Text(
                        'Reference: ${x['caseReference'] ?? x['reference'] ?? widget.id}'),
                    Text('${x['description'] ?? ''}'),
                    const SizedBox(height: 12),
                    Wrap(spacing: 8, children: [
                      DropdownButton<String>(
                          value: '${x['status'] ?? 'OPEN'}',
                          items: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
                              .map((v) =>
                                  DropdownMenuItem(value: v, child: Text(v)))
                              .toList(),
                          onChanged: busy
                              ? null
                              : (v) {
                                  if (v != null) {
                                    changeStatus(v);
                                  }
                                }),
                      DropdownButton<String>(
                          value: '${x['priority'] ?? 'NORMAL'}',
                          items: ['LOW', 'NORMAL', 'HIGH', 'URGENT']
                              .map((v) =>
                                  DropdownMenuItem(value: v, child: Text(v)))
                              .toList(),
                          onChanged: busy
                              ? null
                              : (v) {
                                  if (v != null) {
                                    run(() => widget.api
                                        .update(widget.id, {'priority': v}));
                                  }
                                }),
                      OutlinedButton(
                          onPressed: busy ? null : assign,
                          child: const Text('Assign staff'))
                    ]),
                    const Divider(),
                    const Text('Conversation',
                        style: TextStyle(fontWeight: FontWeight.bold)),
                    ...((x['publicReplies'] ?? x['replies']) is List
                            ? (x['publicReplies'] ?? x['replies']) as List
                            : const <dynamic>[])
                        .whereType<Map>()
                        .map((entry) => ListTile(
                              dense: true,
                              title:
                                  Text('${entry['authorName'] ?? 'Support'}'),
                              subtitle: Text('${entry['message'] ?? ''}'),
                            )),
                    const Text('Customer-visible reply'),
                    TextField(
                        controller: replyMessage,
                        minLines: 3,
                        maxLines: 5,
                        decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            hintText: 'Write a reply')),
                    FilledButton(
                        onPressed: busy
                            ? null
                            : () {
                                final key =
                                    replyIdempotencyKey ??= newIdempotencyKey();
                                run(
                                    () => widget.api.reply(
                                        widget.id, replyMessage.text,
                                        idempotencyKey: key), onSuccess: () {
                                  replyMessage.clear();
                                  replyIdempotencyKey = null;
                                });
                              },
                        child: const Text('Send reply')),
                    const SizedBox(height: 12),
                    const Text('Internal note (never visible to customer)',
                        style: TextStyle(fontWeight: FontWeight.bold)),
                    TextField(
                        controller: internalNote,
                        minLines: 2,
                        maxLines: 4,
                        decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            hintText: 'Write an internal note')),
                    OutlinedButton(
                        onPressed: busy
                            ? null
                            : () {
                                final key =
                                    noteIdempotencyKey ??= newIdempotencyKey();
                                run(
                                    () => widget.api.note(
                                        widget.id, internalNote.text,
                                        idempotencyKey: key), onSuccess: () {
                                  internalNote.clear();
                                  noteIdempotencyKey = null;
                                });
                              },
                        child: const Text('Add internal note')),
                    const SizedBox(height: 12),
                    const Text('Resolution note',
                        style: TextStyle(fontWeight: FontWeight.bold)),
                    TextField(
                        controller: resolution,
                        minLines: 2,
                        maxLines: 4,
                        decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            hintText: 'Record the customer resolution')),
                    OutlinedButton(
                        onPressed: busy
                            ? null
                            : () => run(() => widget.api.update(
                                widget.id, {'resolution': resolution.text})),
                        child: const Text('Save resolution')),
                    if (x['notes'] is List) ...[
                      const Divider(),
                      const Text('Internal notes',
                          style: TextStyle(fontWeight: FontWeight.bold)),
                      ...(x['notes'] as List).whereType<Map>().map((entry) =>
                          ListTile(
                              dense: true,
                              leading: const Icon(Icons.lock_outline),
                              title: Text('${entry['body'] ?? ''}'))),
                    ],
                  ]));
  }
}
