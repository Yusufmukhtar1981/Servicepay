import 'package:flutter/material.dart';
import 'dart:math';

import 'services/support_api_service.dart';
import 'servicepay_theme.dart';
import 'servicepay_ui.dart';

class SupportTicketsScreen extends StatefulWidget {
  const SupportTicketsScreen({super.key, this.api});
  final SupportApiService? api;
  @override
  State<SupportTicketsScreen> createState() => _SupportTicketsScreenState();
}

class _SupportTicketsScreenState extends State<SupportTicketsScreen> {
  late final SupportApiService _api = widget.api ?? SupportApiService();
  final ScrollController _scroll = ScrollController();
  List<SupportTicket> _tickets = [];
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  int _page = 1;
  String _status = '';
  String _error = '';
  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _load();
  }

  @override
  void dispose() {
    if (widget.api == null) _api.close();
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.hasClients &&
        _scroll.position.extentAfter < 300 &&
        _hasMore &&
        !_loadingMore) {
      _load(more: true);
    }
  }

  Future<void> _load({bool more = false}) async {
    if (!mounted || (more && (_loadingMore || !_hasMore))) return;
    setState(() {
      if (more) {
        _loadingMore = true;
      } else {
        _loading = true;
        _page = 1;
      }
      _error = '';
    });
    try {
      final nextPage = more ? _page + 1 : 1;
      final page = await _api.tickets(page: nextPage, status: _status);
      if (mounted) {
        setState(() {
          _tickets = more ? [..._tickets, ...page.tickets] : page.tickets;
          _page = page.page;
          _hasMore = page.hasMore;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('My Support Tickets'), actions: [
          IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh))
        ]),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 850),
            child: Column(children: [
              if (_loading) const LinearProgressIndicator(),
              SizedBox(
                height: 52,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  children: [
                    '',
                    'OPEN',
                    'IN_REVIEW',
                    'WAITING_ON_CUSTOMER',
                    'RESOLVED',
                    'CLOSED'
                  ]
                      .map((value) => Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text(value.isEmpty
                                  ? 'All'
                                  : value == 'IN_REVIEW'
                                      ? 'In Review'
                                      : value == 'WAITING_ON_CUSTOMER'
                                          ? 'Awaiting Customer'
                                          : value[0] +
                                              value.substring(1).toLowerCase()),
                              selected: _status == value,
                              onSelected: (_) {
                                setState(() => _status = value);
                                _load();
                              },
                            ),
                          ))
                      .toList(),
                ),
              ),
              Expanded(
                child: RefreshIndicator(
                    onRefresh: _load,
                    child: _tickets.isEmpty && !_loading
                        ? _error.isNotEmpty
                            ? ServicePayStateView(
                                icon: Icons.cloud_off_outlined,
                                title: 'Tickets are unavailable',
                                message: _error,
                                actionLabel: 'Try again',
                                onAction: _load,
                              )
                            : const ServicePayStateView(
                                icon: Icons.confirmation_number_outlined,
                                title: 'No support tickets yet',
                                message:
                                    'When you report a problem, your ticket and replies will appear here.',
                              )
                        : ListView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.all(16),
                            itemCount: _tickets.length + (_loadingMore ? 1 : 0),
                            itemBuilder: (_, i) {
                              if (i == _tickets.length) {
                                return const Padding(
                                  padding: EdgeInsets.all(16),
                                  child: Center(
                                      child: CircularProgressIndicator()),
                                );
                              }
                              final t = _tickets[i];
                              return Card(
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(12),
                                  onTap: () => Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                          builder: (_) =>
                                              SupportTicketDetailScreen(
                                                  ticketId: t.id, api: _api))),
                                  child: Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                t.subject,
                                                maxLines: 2,
                                                overflow: TextOverflow.ellipsis,
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .titleMedium,
                                              ),
                                              const SizedBox(height: 7),
                                              Text(
                                                t.reference,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .bodySmall,
                                              ),
                                              const SizedBox(height: 7),
                                              Wrap(
                                                spacing: 7,
                                                runSpacing: 7,
                                                children: [
                                                  ServicePayStatusPill(
                                                    status: t.status,
                                                    label: t.statusLabel,
                                                  ),
                                                  Chip(
                                                    label:
                                                        Text(t.categoryLabel),
                                                  ),
                                                ],
                                              ),
                                              if (t.createdAt != null)
                                                Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                          top: 8),
                                                  child: Text(
                                                    _formatTicketDate(
                                                        t.createdAt!),
                                                    style: Theme.of(context)
                                                        .textTheme
                                                        .bodySmall,
                                                  ),
                                                ),
                                              if ((t.transactionContext?[
                                                          'reference'] ??
                                                      '')
                                                  .toString()
                                                  .isNotEmpty)
                                                Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                          top: 4),
                                                  child: Text(
                                                    'Transaction: ${t.transactionContext!['reference']}',
                                                    maxLines: 1,
                                                    overflow:
                                                        TextOverflow.ellipsis,
                                                    style: Theme.of(context)
                                                        .textTheme
                                                        .bodySmall,
                                                  ),
                                                ),
                                            ],
                                          ),
                                        ),
                                        const Icon(Icons.chevron_right),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            })),
              ),
            ]),
          ),
        ),
      );
}

class SupportTicketDetailScreen extends StatefulWidget {
  const SupportTicketDetailScreen(
      {super.key, required this.ticketId, this.api});
  final String ticketId;
  final SupportApiService? api;
  @override
  State<SupportTicketDetailScreen> createState() =>
      _SupportTicketDetailScreenState();
}

class _SupportTicketDetailScreenState extends State<SupportTicketDetailScreen> {
  late final SupportApiService _api = widget.api ?? SupportApiService();
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
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final t = await _api.ticket(widget.ticketId);
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
      final t = await _api.reply(widget.ticketId, text, idempotencyKey: key);
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
    final replyClosed =
        t != null && ['RESOLVED', 'CLOSED', 'REJECTED'].contains(t.status);
    return Scaffold(
        appBar: AppBar(title: const Text('Support Ticket')),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 850),
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : t == null
                    ? ServicePayStateView(
                        icon: Icons.confirmation_number_outlined,
                        title: 'Ticket unavailable',
                        message: _error.isEmpty
                            ? 'This support ticket could not be found.'
                            : _error,
                        actionLabel: 'Try again',
                        onAction: _load,
                      )
                    : Column(children: [
                        Expanded(
                            child: ListView(
                                padding: const EdgeInsets.all(16),
                                children: [
                              Text(t.subject,
                                  style:
                                      Theme.of(context).textTheme.titleLarge),
                              const SizedBox(height: 6),
                              Text('Reference: ${t.reference}'),
                              Wrap(spacing: 8, children: [
                                ServicePayStatusPill(
                                  status: t.status,
                                  label: t.statusLabel,
                                ),
                                Chip(label: Text(t.categoryLabel))
                              ]),
                              _TicketTimeline(status: t.status),
                              if (t.transactionContext != null)
                                Card(
                                  color: Colors.blue.shade50,
                                  child: Padding(
                                    padding: const EdgeInsets.all(12),
                                    child: Text(
                                      'Related transaction\nReference: ${t.transactionContext!['reference'] ?? 'Unavailable'}\nStatus: ${t.transactionContext!['status'] ?? 'Unavailable'}',
                                    ),
                                  ),
                                ),
                              Card(
                                margin:
                                    const EdgeInsets.only(top: 8, bottom: 12),
                                child: Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Text(
                                    t.description,
                                    style:
                                        Theme.of(context).textTheme.bodyLarge,
                                  ),
                                ),
                              ),
                              if (t.resolution.isNotEmpty)
                                Card(
                                    color: Colors.green.shade50,
                                    child: Padding(
                                        padding: const EdgeInsets.all(12),
                                        child: Text(
                                            'Resolution: ${t.resolution}'))),
                              const ServicePaySectionHeading(
                                title: 'Conversation',
                                subtitle:
                                    'Messages from you and ServicePay Support',
                              ),
                              const SizedBox(height: 12),
                              ...t.replies.map((r) {
                                final role = (r['authorRole'] ??
                                        r['senderType'] ??
                                        r['role'] ??
                                        '')
                                    .toString()
                                    .toUpperCase();
                                final mine = role == 'CUSTOMER';
                                final author = mine
                                    ? 'You'
                                    : (r['authorName'] ?? 'ServicePay Support')
                                        .toString();
                                final createdAt =
                                    DateTime.tryParse('${r['createdAt']}')
                                        ?.toLocal();
                                return Align(
                                    alignment: mine
                                        ? Alignment.centerRight
                                        : Alignment.centerLeft,
                                    child: Card(
                                        color: mine
                                            ? ServicePayColors.brandSoft
                                            : Colors.white,
                                        child: Padding(
                                          padding: const EdgeInsets.all(10),
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                author,
                                                style: const TextStyle(
                                                    fontWeight: FontWeight.bold,
                                                    fontSize: 12),
                                              ),
                                              const SizedBox(height: 4),
                                              Text((r['message'] ??
                                                      r['body'] ??
                                                      '')
                                                  .toString()),
                                              if (createdAt != null) ...[
                                                const SizedBox(height: 5),
                                                Text(
                                                  _formatTicketDate(createdAt),
                                                  style: const TextStyle(
                                                    color: Colors.grey,
                                                    fontSize: 10,
                                                  ),
                                                ),
                                              ],
                                            ],
                                          ),
                                        )));
                              }),
                              const Padding(
                                padding: EdgeInsets.only(top: 12),
                                child: Text(
                                  'ServicePay Support will never ask for your password, OTP or transaction PIN.',
                                  style: TextStyle(
                                    color: Color(0xFF9A3412),
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            ])),
                        SafeArea(
                            child: Padding(
                                padding:
                                    const EdgeInsets.fromLTRB(12, 8, 12, 12),
                                child: Row(children: [
                                  Expanded(
                                      child: TextField(
                                          controller: _reply,
                                          enabled: !_sending && !replyClosed,
                                          textInputAction: TextInputAction.send,
                                          onSubmitted: replyClosed || _sending
                                              ? null
                                              : (_) => _send(),
                                          decoration: InputDecoration(
                                              labelText: replyClosed
                                                  ? 'This ticket is closed'
                                                  : 'Reply to support',
                                              hintText: replyClosed
                                                  ? 'Replies are unavailable'
                                                  : 'Write a clear update',
                                              prefixIcon: const Icon(
                                                Icons
                                                    .chat_bubble_outline_rounded,
                                              )))),
                                  const SizedBox(width: 8),
                                  Semantics(
                                      button: true,
                                      label: 'Send support reply',
                                      child: IconButton(
                                          onPressed: _sending || replyClosed
                                              ? null
                                              : _send,
                                          tooltip: 'Send reply',
                                          icon: _sending
                                              ? const SizedBox(
                                                  width: 20,
                                                  height: 20,
                                                  child:
                                                      CircularProgressIndicator(
                                                    strokeWidth: 2,
                                                  ),
                                                )
                                              : const Icon(Icons.send))),
                                ]))),
                      ]),
          ),
        ));
  }
}

class _TicketTimeline extends StatelessWidget {
  const _TicketTimeline({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final current = switch (status) {
      'OPEN' => 0,
      'IN_PROGRESS' || 'IN_REVIEW' => 1,
      'WAITING_ON_CUSTOMER' => 2,
      'RESOLVED' || 'CLOSED' || 'REJECTED' => 3,
      _ => 0,
    };
    const labels = ['Submitted', 'In Review', 'Support Response', 'Resolved'];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        children: List.generate(labels.length, (index) {
          final active = index <= current;
          return Expanded(
            child: Column(
              children: [
                Icon(
                  active ? Icons.check_circle : Icons.radio_button_unchecked,
                  color: active ? Colors.green : Colors.grey,
                  size: 20,
                ),
                const SizedBox(height: 4),
                Text(
                  labels[index],
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 10,
                    color: active ? Colors.green.shade800 : Colors.grey,
                  ),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }
}

String _formatTicketDate(DateTime date) {
  final day = date.day.toString().padLeft(2, '0');
  final month = date.month.toString().padLeft(2, '0');
  final hour = date.hour.toString().padLeft(2, '0');
  final minute = date.minute.toString().padLeft(2, '0');
  return '$day/$month/${date.year} • $hour:$minute';
}
