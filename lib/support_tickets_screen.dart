import 'package:flutter/material.dart';
import 'dart:math';

import 'services/support_api_service.dart';

class SupportTicketsScreen extends StatefulWidget {
  const SupportTicketsScreen({super.key, this.api});
  final SupportApiService? api;
  @override
  State<SupportTicketsScreen> createState() => _SupportTicketsScreenState();
}

class _SupportTicketsScreenState extends State<SupportTicketsScreen> {
  late final SupportApiService _api = widget.api ?? SupportApiService();
  List<SupportTicket> _tickets = [];
  bool _loading = true;
  String _error = '';
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final page = await _api.tickets();
      if (mounted) setState(() => _tickets = page.tickets);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('My Support Tickets'), actions: [
          IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh))
        ]),
        body: Column(children: [
          if (_error.isNotEmpty)
            MaterialBanner(content: Text(_error), actions: [
              TextButton(onPressed: _load, child: const Text('Retry'))
            ]),
          if (_loading) const LinearProgressIndicator(),
          Expanded(
            child: RefreshIndicator(
                onRefresh: _load,
                child: _tickets.isEmpty && !_loading
                    ? ListView(children: const [
                        SizedBox(height: 130),
                        Center(child: Text('You have no support tickets yet.'))
                      ])
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _tickets.length,
                        itemBuilder: (_, i) {
                          final t = _tickets[i];
                          return Card(
                              child: ListTile(
                            title: Text(t.subject,
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold)),
                            subtitle: Text(
                                '${t.reference}\n${t.status} • ${t.priority}'),
                            isThreeLine: true,
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => SupportTicketDetailScreen(
                                        ticketId: t.id, api: _api))),
                          ));
                        })),
          ),
        ]),
      );
}

class SupportTicketDetailScreen extends StatefulWidget {
  const SupportTicketDetailScreen(
      {super.key, required this.ticketId, required this.api});
  final String ticketId;
  final SupportApiService api;
  @override
  State<SupportTicketDetailScreen> createState() =>
      _SupportTicketDetailScreenState();
}

class _SupportTicketDetailScreenState extends State<SupportTicketDetailScreen> {
  SupportTicket? _ticket;
  bool _loading = true;
  bool _sending = false;
  String _error = '';
  final _reply = TextEditingController();
  String? _replyIdempotencyKey;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final t = await widget.api.ticket(widget.ticketId);
      if (mounted) setState(() => _ticket = t);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final key = _replyIdempotencyKey ??= _newIdempotencyKey();
      final t =
          await widget.api.reply(widget.ticketId, text, idempotencyKey: key);
      if (mounted) {
        setState(() {
          _ticket = t;
          _reply.clear();
          _replyIdempotencyKey = null;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _newIdempotencyKey() =>
      '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  @override
  Widget build(BuildContext context) {
    final t = _ticket;
    return Scaffold(
        appBar: AppBar(title: const Text('Support Ticket')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : t == null
                ? Center(
                    child: Text(_error.isEmpty ? 'Ticket not found.' : _error))
                : Column(children: [
                    Expanded(
                        child: ListView(
                            padding: const EdgeInsets.all(16),
                            children: [
                          Text(t.subject,
                              style: Theme.of(context).textTheme.titleLarge),
                          const SizedBox(height: 6),
                          Text('Reference: ${t.reference}'),
                          Wrap(spacing: 8, children: [
                            Chip(label: Text(t.status)),
                            Chip(label: Text(t.priority))
                          ]),
                          Text(t.description),
                          if (t.resolution.isNotEmpty)
                            Card(
                                color: Colors.green.shade50,
                                child: Padding(
                                    padding: const EdgeInsets.all(12),
                                    child:
                                        Text('Resolution: ${t.resolution}'))),
                          const Divider(),
                          const Text('Conversation',
                              style: TextStyle(fontWeight: FontWeight.bold)),
                          ...t.replies.map((r) {
                            final mine = (r['senderType'] ?? r['role'] ?? '')
                                .toString()
                                .toUpperCase()
                                .contains('CUSTOMER');
                            return Align(
                                alignment: mine
                                    ? Alignment.centerRight
                                    : Alignment.centerLeft,
                                child: Card(
                                    color: mine ? Colors.green.shade50 : null,
                                    child: Padding(
                                        padding: const EdgeInsets.all(10),
                                        child: Text(
                                            (r['message'] ?? r['body'] ?? '')
                                                .toString()))));
                          }),
                        ])),
                    SafeArea(
                        child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Row(children: [
                              Expanded(
                                  child: TextField(
                                      controller: _reply,
                                      enabled: !_sending &&
                                          !['RESOLVED', 'CLOSED']
                                              .contains(t.status),
                                      decoration: const InputDecoration(
                                          labelText: 'Reply to support',
                                          border: OutlineInputBorder()))),
                              const SizedBox(width: 8),
                              IconButton(
                                  onPressed: _sending ? null : _send,
                                  icon: _sending
                                      ? const CircularProgressIndicator()
                                      : const Icon(Icons.send))
                            ]))),
                  ]));
  }
}
