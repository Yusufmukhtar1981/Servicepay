import 'dart:async';

import 'package:flutter/material.dart';

import 'admin_communications_api.dart';
import 'campaign_idempotency_key.dart';

class AdminBulkEmailScreen extends StatefulWidget {
  const AdminBulkEmailScreen({super.key, this.api});
  final AdminCommunicationsApi? api;
  @override
  State<AdminBulkEmailScreen> createState() => _AdminBulkEmailScreenState();
}

class _AdminBulkEmailScreenState extends State<AdminBulkEmailScreen> {
  late final AdminCommunicationsApi _api =
      widget.api ?? AdminCommunicationsApi();
  final _subject = TextEditingController(),
      _message = TextEditingController(),
      _testEmail = TextEditingController(),
      _search = TextEditingController();
  Timer? _debounce;
  String _audience = 'ALL_CUSTOMERS',
      _role = 'CUSTOMER',
      _error = '',
      _capability = 'Checking email capability…';
  bool _loading = false, _sending = false;
  int? _recipientCount;
  List<Map<String, dynamic>> _customers = [], _history = [];
  final Set<String> _selected = {};
  final _campaignKey = CampaignIdempotencyKey();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _subject.dispose();
    _message.dispose();
    _testEmail.dispose();
    _search.dispose();
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Map<String, dynamic> get _audiencePayload => {
        'kind': _audience,
        if (_audience == 'ROLE') 'role': _role,
        if (_audience == 'SELECTED_CUSTOMERS') 'userIds': _selected.toList()
      };
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final results =
          await Future.wait([_api.capabilities(), _api.history('email')]);
      if (!mounted) return;
      final capability = results[0];
      setState(() {
        _capability = _capabilityText(capability, 'email');
        _history = _items(results[1]);
      });
      await _preview();
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> _items(Map<String, dynamic> r) {
    final x = r['campaigns'] ??
        r['history'] ??
        r['items'] ??
        r['customers'] ??
        r['data'];
    return x is List
        ? x.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : [];
  }

  Future<void> _searchCustomers(String value) async {
    try {
      final r = await _api.customers(search: value);
      if (mounted) setState(() => _customers = _items(r));
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    }
  }

  Future<void> _preview() async {
    try {
      final r =
          await _api.preview(channel: 'email', audience: _audiencePayload);
      if (mounted) {
        setState(() => _recipientCount =
            (r['count'] ?? r['recipientCount'] ?? r['recipients'] as num?)
                ?.toInt());
      }
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    }
  }

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

  bool get _valid =>
      _subject.text.trim().isNotEmpty &&
      _message.text.trim().isNotEmpty &&
      (_audience != 'SELECTED_CUSTOMERS' || _selected.isNotEmpty);
  Future<void> _test() async {
    if (!_valid) {
      setState(
          () => _error = 'Enter a subject and message before sending a test.');
      return;
    }
    setState(() => _sending = true);
    try {
      final r = await _api.sendTest(
          subject: _subject.text,
          message: _message.text,
          email: _testEmail.text);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(r['message']?.toString() ??
                'Test email accepted by the provider.')));
      }
    } catch (e) {
      if (mounted) setState(() => _error = _clean(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _send() async {
    if (!_valid) {
      setState(() => _error = 'Complete the message and audience first.');
      return;
    }
    final ok = await _confirm('Send bulk email',
        'Send this email to ${_recipientCount?.toString() ?? 'the previewed'} recipient(s)?');
    if (!ok) return;
    setState(() => _sending = true);
    try {
      final r = await _api.broadcastEmail(
          subject: _subject.text,
          message: _message.text,
          audience: _audiencePayload,
          idempotencyKey: _campaignKey.value);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_result(r, 'Email broadcast submitted.'))));
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
        'Provider accepted: ${value['sentCount'] ?? value['sent'] ?? 0}; failed: ${value['failedCount'] ?? value['failed'] ?? 0}.';
  }

  Future<bool> _confirm(String title, String text) async =>
      await showDialog<bool>(
          context: context,
          builder: (c) =>
              AlertDialog(title: Text(title), content: Text(text), actions: [
                TextButton(
                    onPressed: () => Navigator.pop(c, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(c, true),
                    child: const Text('Confirm'))
              ])) ??
      false;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Bulk Email'), actions: [
        IconButton(
            onPressed: _loading ? _null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh')
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
                        Card(
                            child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Text(_capability))),
                        const SizedBox(height: 12),
                        TextField(
                            controller: _subject,
                            maxLength: 180,
                            onChanged: (_) => setState(
                                _campaignKey.resetForContentOrAudienceChange),
                            decoration: const InputDecoration(
                                labelText: 'Email subject',
                                border: OutlineInputBorder())),
                        const SizedBox(height: 12),
                        TextField(
                            controller: _message,
                            maxLines: 7,
                            minLines: 4,
                            onChanged: (_) => setState(
                                _campaignKey.resetForContentOrAudienceChange),
                            decoration: const InputDecoration(
                                labelText: 'Email message',
                                border: OutlineInputBorder())),
                        const SizedBox(height: 16),
                        _audienceControls(),
                        const SizedBox(height: 12),
                        Text(
                            'Server preview: ${_recipientCount?.toString() ?? 'Unavailable'} recipient(s)',
                            style:
                                const TextStyle(fontWeight: FontWeight.bold)),
                        const SizedBox(height: 12),
                        TextField(
                            controller: _testEmail,
                            keyboardType: TextInputType.emailAddress,
                            decoration: const InputDecoration(
                                labelText: 'Test recipient email (optional)',
                                border: OutlineInputBorder())),
                        const SizedBox(height: 12),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          OutlinedButton(
                              onPressed: _sending ? _null : _test,
                              child: const Text('Send test')),
                          FilledButton(
                              onPressed: _sending ? _null : _send,
                              child: Text(
                                  _sending ? 'Sending…' : 'Confirm & send'))
                        ]),
                        const SizedBox(height: 24),
                        const Text('Email history',
                            style: TextStyle(
                                fontSize: 18, fontWeight: FontWeight.bold)),
                        ..._history.map(_historyCard)
                      ])))));
  VoidCallback? get _null => null;
  Widget _audienceControls() =>
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
        if (_audience == 'SELECTED_CUSTOMERS') ...[_customerPicker()]
      ]);
  Widget _customerPicker() => Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(children: [
        TextField(
            controller: _search,
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(
                  const Duration(milliseconds: 350), () => _searchCustomers(v));
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
      ]));
  Widget _historyCard(Map<String, dynamic> x) => Card(
      child: ListTile(
          title: Text(x['subject']?.toString() ?? 'Email broadcast'),
          subtitle: Text(_result(x, 'No provider result recorded.')),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _detail(x)));
  Future<void> _detail(Map<String, dynamic> x) async {
    final id = (x['_id'] ?? x['id']).toString();
    if (id.isEmpty) return;
    try {
      final d = await _api.historyDetail('email', id);
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (c) => AlertDialog(
                  title: const Text('Email provider acceptance details'),
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
