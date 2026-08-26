import 'dart:async';

import 'package:flutter/material.dart';

import 'admin_communications_api.dart';
import 'campaign_idempotency_key.dart';

class AdminNotificationsScreen extends StatefulWidget {
  const AdminNotificationsScreen({super.key, this.api});
  final AdminCommunicationsApi? api;
  @override
  State<AdminNotificationsScreen> createState() =>
      _AdminNotificationsScreenState();
}

class _AdminNotificationsScreenState extends State<AdminNotificationsScreen> {
  late final AdminCommunicationsApi _api =
      widget.api ?? AdminCommunicationsApi();
  final _title = TextEditingController(),
      _message = TextEditingController(),
      _search = TextEditingController();
  Timer? _debounce;
  String _audience = 'ALL_CUSTOMERS',
      _role = 'CUSTOMER',
      _error = '',
      _capability = 'Checking notification capability…';
  bool _loading = false, _sending = false;
  int? _count;
  final Set<String> _selected = {};
  final _campaignKey = CampaignIdempotencyKey();
  List<Map<String, dynamic>> _customers = [], _history = [];
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _title.dispose();
    _message.dispose();
    _search.dispose();
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Map<String, dynamic> get _payload => {
        'kind': _audience,
        if (_audience == 'ROLE') 'role': _role,
        if (_audience == 'SELECTED_CUSTOMERS') 'userIds': _selected.toList()
      };
  String _clean(Object e) => e.toString().replaceFirst('Exception: ', '');
  String _capabilityText(Map<String, dynamic> response, String key) {
    final capabilities = response['capabilities'];
    final value =
        response[key] ?? (capabilities is Map ? capabilities[key] : null);
    if (value is Map) {
      final status = value['status'] ?? value['configured'] ?? value['enabled'];
      if (status != null) return '$key: $status';
      return value['message']?.toString() ??
          '$key capability status is unavailable.';
    }
    return value?.toString() ??
        response['message']?.toString() ??
        '$key capability status is unavailable.';
  }

  List<Map<String, dynamic>> _items(Map<String, dynamic> r) {
    final v = r['campaigns'] ??
        r['history'] ??
        r['items'] ??
        r['customers'] ??
        r['data'];
    return v is List
        ? v.whereType<Map>().map((x) => Map<String, dynamic>.from(x)).toList()
        : [];
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final r = await Future.wait(
          [_api.capabilities(), _api.history('notifications')]);
      if (!mounted) return;
      final c = r[0];
      setState(() {
        _capability = _capabilityText(c, 'inAppNotification');
        _history = _items(r[1]);
      });
      await _preview();
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _preview() async {
    try {
      final r = await _api.preview(channel: 'IN_APP', audience: _payload);
      if (mounted) {
        setState(() => _count =
            (r['count'] ?? r['recipientCount'] ?? r['recipients'] as num?)
                ?.toInt());
      }
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    }
  }

  Future<void> _find(String q) async {
    try {
      final r = await _api.customers(search: q);
      if (mounted) setState(() => _customers = _items(r));
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    }
  }

  bool get _valid =>
      _title.text.trim().isNotEmpty &&
      _message.text.trim().isNotEmpty &&
      (_audience != 'SELECTED_CUSTOMERS' || _selected.isNotEmpty);
  Future<void> _send() async {
    if (!_valid) {
      setState(() => _error = 'Enter a title, message, and valid audience.');
      return;
    }
    final yes = await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
                    title: const Text('Send in-app notification'),
                    content: Text(
                        'Queue this notification for ${_count?.toString() ?? 'the previewed'} recipient(s)?'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(c, false),
                          child: const Text('Cancel')),
                      FilledButton(
                          onPressed: () => Navigator.pop(c, true),
                          child: const Text('Queue'))
                    ])) ??
        false;
    if (!yes) return;
    setState(() => _sending = true);
    try {
      final r = await _api.broadcastNotification(
          title: _title.text,
          message: _message.text,
          audience: _payload,
          idempotencyKey: _campaignKey.value);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(_result(r, 'Notification broadcast submitted.'))));
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _result(Map<String, dynamic> r, String fallback) {
    final value =
        r['campaign'] is Map ? Map<String, dynamic>.from(r['campaign']) : r;
    return r['message']?.toString() ??
        'Delivered: ${value['deliveredCount'] ?? value['sentCount'] ?? value['sent'] ?? 0}; failed: ${value['failedCount'] ?? value['failed'] ?? 0}.';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('In-App Notifications'), actions: [
        IconButton(
            onPressed: _loading ? null : _load,
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh))
      ]),
      body: SafeArea(
          child: LayoutBuilder(
              builder: (context, size) => RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                      padding: EdgeInsets.symmetric(
                          horizontal: size.maxWidth > 700
                              ? (size.maxWidth - 680) / 2
                              : 16,
                          vertical: 16),
                      children: [
                        if (_loading) const LinearProgressIndicator(),
                        if (_error.isNotEmpty)
                          MaterialBanner(content: Text(_error), actions: [
                            TextButton(
                                onPressed: _load, child: const Text('Retry'))
                          ]),
                        const Card(
                            child: Padding(
                                padding: EdgeInsets.all(16),
                                child: Text(
                                    'This sends in-app notifications only. Device push delivery is unavailable.'))),
                        Card(
                            child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Text(_capability))),
                        const SizedBox(height: 12),
                        TextField(
                            controller: _title,
                            maxLength: 160,
                            onChanged: (_) => setState(
                                _campaignKey.resetForContentOrAudienceChange),
                            decoration: const InputDecoration(
                                labelText: 'Notification title',
                                border: OutlineInputBorder())),
                        const SizedBox(height: 12),
                        TextField(
                            controller: _message,
                            minLines: 4,
                            maxLines: 7,
                            onChanged: (_) => setState(
                                _campaignKey.resetForContentOrAudienceChange),
                            decoration: const InputDecoration(
                                labelText: 'Message',
                                border: OutlineInputBorder())),
                        const SizedBox(height: 16),
                        _audienceControl(),
                        const SizedBox(height: 12),
                        Text(
                            'Server preview: ${_count?.toString() ?? 'Unavailable'} recipient(s)',
                            style:
                                const TextStyle(fontWeight: FontWeight.bold)),
                        const SizedBox(height: 12),
                        FilledButton(
                            onPressed: _sending ? null : _send,
                            child: Text(
                                _sending ? 'Queueing…' : 'Confirm & queue')),
                        const SizedBox(height: 24),
                        const Text('Notification history',
                            style: TextStyle(
                                fontSize: 18, fontWeight: FontWeight.bold)),
                        ..._history.map(_card)
                      ])))));
  Widget _audienceControl() =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        DropdownButtonFormField<String>(
            value: _audience,
            decoration: const InputDecoration(
                labelText: 'Audience', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(
                  value: 'ALL_CUSTOMERS', child: Text('All customers')),
              DropdownMenuItem(
                  value: 'ACTIVE_CUSTOMERS', child: Text('Active customers')),
              DropdownMenuItem(
                  value: 'SELECTED_CUSTOMERS',
                  child: Text('Selected customers')),
              DropdownMenuItem(value: 'ROLE', child: Text('By role'))
            ],
            onChanged: _sending
                ? null
                : (v) {
                    if (v == _audience) return;
                    setState(() {
                      _audience = v!;
                      _campaignKey.resetForContentOrAudienceChange();
                    });
                    _preview();
                  }),
        if (_audience == 'ROLE')
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child: DropdownButtonFormField<String>(
                  value: _role,
                  decoration: const InputDecoration(
                      labelText: 'Role', border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(
                        value: 'CUSTOMER', child: Text('Customer')),
                    DropdownMenuItem(value: 'AGENT', child: Text('Agent')),
                    DropdownMenuItem(value: 'MERCHANT', child: Text('Merchant'))
                  ],
                  onChanged: (v) {
                    if (v == _role) return;
                    setState(() {
                      _role = v!;
                      _campaignKey.resetForContentOrAudienceChange();
                    });
                    _preview();
                  })),
        if (_audience == 'SELECTED_CUSTOMERS')
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Column(children: [
                TextField(
                    controller: _search,
                    onChanged: (v) {
                      _debounce?.cancel();
                      _debounce = Timer(
                          const Duration(milliseconds: 350), () => _find(v));
                    },
                    decoration: const InputDecoration(
                        labelText: 'Search name, phone, or email',
                        border: OutlineInputBorder())),
                ..._customers.map((c) {
                  final id = (c['_id'] ?? c['id']).toString();
                  return CheckboxListTile(
                      value: _selected.contains(id),
                      title: Text(c['fullName']?.toString() ??
                          c['name']?.toString() ??
                          'Customer'),
                      subtitle: Text('${c['phone'] ?? ''} ${c['email'] ?? ''}'),
                      onChanged: (v) {
                        setState(() {
                          if (v == true) {
                            if (_selected.add(id)) {
                              _campaignKey.resetForContentOrAudienceChange();
                            }
                          } else {
                            if (_selected.remove(id)) {
                              _campaignKey.resetForContentOrAudienceChange();
                            }
                          }
                        });
                        _preview();
                      });
                })
              ]))
      ]);
  Widget _card(Map<String, dynamic> x) => Card(
      child: ListTile(
          title: Text(x['title']?.toString() ?? 'In-app notification'),
          subtitle: Text(_result(x, 'No delivery result recorded.')),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _detail(x)));
  Future<void> _detail(Map<String, dynamic> x) async {
    final id = (x['_id'] ?? x['id']).toString();
    if (id.isEmpty) return;
    try {
      final d = await _api.historyDetail('notifications', id);
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (c) => AlertDialog(
                  title: const Text('Notification details'),
                  content: SingleChildScrollView(child: Text(d.toString())),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(c),
                        child: const Text('Close'))
                  ]));
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    }
  }
}
