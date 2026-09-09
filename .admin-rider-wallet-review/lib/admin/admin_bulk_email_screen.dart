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
      _heading = TextEditingController(),
      _message = TextEditingController(),
      _buttonText = TextEditingController(),
      _buttonUrl = TextEditingController(),
      _testEmail = TextEditingController(),
      _search = TextEditingController();
  Timer? _debounce;
  String _audience = 'ALL_CUSTOMERS',
      _accountStatus = 'ACTIVE',
      _kycStatus = 'VERIFIED',
      _state = '',
      _error = '',
      _capability = 'Checking email capability…';
  bool _loading = false, _sending = false;
  int? _recipientCount;
  String? _draftId;
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
    _heading.dispose();
    _message.dispose();
    _buttonText.dispose();
    _buttonUrl.dispose();
    _testEmail.dispose();
    _search.dispose();
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Map<String, dynamic> get _audiencePayload => {
        'kind': _audience,
        if (_audience == 'ACCOUNT_STATUS') 'status': _accountStatus,
        if (_audience == 'KYC_STATUS') 'kycStatus': _kycStatus,
        if (_audience == 'STATE') 'state': _state.trim(),
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
  bool get _validTestEmail => RegExp(
        r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$',
      ).hasMatch(_testEmail.text.trim());

  Future<void> _test() async {
    if (_sending) return;
    if (!_valid) {
      const message = 'Enter a subject and message before sending a test.';
      setState(() => _error = message);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(message)),
      );
      return;
    }
    if (!_validTestEmail) {
      const message = 'Enter a valid test recipient email.';
      setState(() => _error = message);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(message)),
      );
      return;
    }
    setState(() {
      _sending = true;
      _error = '';
    });
    try {
      await _api.sendTest(
          subject: _subject.text,
          message: _message.text,
          heading: _heading.text,
          buttonText: _buttonText.text,
          buttonUrl: _buttonUrl.text,
          email: _testEmail.text);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Test email sent successfully')),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'Unable to send test email. Please try again.');
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to send test email. Please try again.'),
          ),
        );
      }
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
          heading: _heading.text,
          buttonText: _buttonText.text,
          buttonUrl: _buttonUrl.text,
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

  Future<void> _saveDraft() async {
    setState(() {
      _sending = true;
      _error = '';
    });
    try {
      final Map<String, dynamic> response = await _api.saveDraft(
        id: _draftId,
        subject: _subject.text,
        heading: _heading.text,
        message: _message.text,
        buttonText: _buttonText.text,
        buttonUrl: _buttonUrl.text,
        audience: _audiencePayload,
      );
      final dynamic campaign = response['campaign'];
      if (campaign is Map) {
        _draftId = (campaign['id'] ?? campaign['_id'])?.toString();
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Email draft saved.')),
      );
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = _clean(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _openDraft(Map<String, dynamic> draft) {
    final Map<String, dynamic> audience = draft['audience'] is Map
        ? Map<String, dynamic>.from(draft['audience'] as Map)
        : <String, dynamic>{'kind': 'ALL_CUSTOMERS'};
    setState(() {
      _draftId = (draft['id'] ?? draft['_id'])?.toString();
      _subject.text = draft['subject']?.toString() ?? '';
      _heading.text = draft['heading']?.toString() ?? '';
      _message.text = draft['message']?.toString() ?? '';
      _buttonText.text = draft['buttonText']?.toString() ?? '';
      _buttonUrl.text = draft['buttonUrl']?.toString() ?? '';
      _audience = audience['kind']?.toString() ?? 'ALL_CUSTOMERS';
      _accountStatus = audience['status']?.toString() ?? 'ACTIVE';
      _kycStatus = audience['kycStatus']?.toString() ?? 'VERIFIED';
      _state = audience['state']?.toString() ?? '';
      _selected
        ..clear()
        ..addAll((audience['userIds'] as List? ?? const <dynamic>[])
            .map((dynamic id) => id.toString()));
      _campaignKey.resetForContentOrAudienceChange();
    });
    _preview();
  }

  Future<void> _deleteDraft(Map<String, dynamic> draft) async {
    final String id = (draft['id'] ?? draft['_id'])?.toString() ?? '';
    if (id.isEmpty ||
        !await _confirm(
            'Delete draft', 'Permanently delete this unsent email draft?')) {
      return;
    }
    try {
      await _api.deleteDraft(id);
      if (_draftId == id) _draftId = null;
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = _clean(error));
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
                            maxLength: 160,
                            onChanged: (_) => setState(
                                _campaignKey.resetForContentOrAudienceChange),
                            decoration: const InputDecoration(
                                labelText: 'Email subject',
                                border: OutlineInputBorder())),
                        const SizedBox(height: 12),
                        TextField(
                            controller: _heading,
                            maxLength: 160,
                            onChanged: (_) => setState(
                                _campaignKey.resetForContentOrAudienceChange),
                            decoration: const InputDecoration(
                                labelText: 'Heading (optional)',
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
                        const SizedBox(height: 12),
                        Row(children: [
                          Expanded(
                              child: TextField(
                                  controller: _buttonText,
                                  maxLength: 80,
                                  decoration: const InputDecoration(
                                      labelText: 'Button text (optional)',
                                      border: OutlineInputBorder()))),
                          const SizedBox(width: 12),
                          Expanded(
                              child: TextField(
                                  controller: _buttonUrl,
                                  keyboardType: TextInputType.url,
                                  decoration: const InputDecoration(
                                      labelText: 'HTTPS button link',
                                      border: OutlineInputBorder())))
                        ]),
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
                                labelText: 'Test recipient email',
                                border: OutlineInputBorder())),
                        const SizedBox(height: 12),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          OutlinedButton.icon(
                              onPressed: _sending ? _null : _saveDraft,
                              icon: const Icon(Icons.save_outlined),
                              label: Text(_draftId == null
                                  ? 'Save draft'
                                  : 'Update draft')),
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
              DropdownMenuItem(
                  value: 'ACCOUNT_STATUS', child: Text('By account status')),
              DropdownMenuItem(
                  value: 'KYC_STATUS', child: Text('By KYC status')),
              DropdownMenuItem(value: 'STATE', child: Text('By state'))
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
        if (_audience == 'ACCOUNT_STATUS')
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child: DropdownButtonFormField<String>(
                  value: _accountStatus,
                  decoration: const InputDecoration(
                      labelText: 'Account status',
                      border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(
                        value: 'ACTIVE', child: Text('Active customers')),
                    DropdownMenuItem(
                        value: 'SUSPENDED', child: Text('Suspended customers'))
                  ],
                  onChanged: (v) {
                    if (v == _accountStatus) return;
                    setState(() {
                      _accountStatus = v!;
                      _campaignKey.resetForContentOrAudienceChange();
                    });
                    _preview();
                  })),
        if (_audience == 'KYC_STATUS')
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child: DropdownButtonFormField<String>(
                  value: _kycStatus,
                  decoration: const InputDecoration(
                      labelText: 'KYC status', border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(
                        value: 'VERIFIED', child: Text('Verified')),
                    DropdownMenuItem(
                        value: 'UNVERIFIED', child: Text('Unverified'))
                  ],
                  onChanged: (v) {
                    setState(() {
                      _kycStatus = v!;
                      _campaignKey.resetForContentOrAudienceChange();
                    });
                    _preview();
                  })),
        if (_audience == 'STATE')
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child: TextField(
                  decoration: const InputDecoration(
                      labelText: 'Stored customer state',
                      border: OutlineInputBorder()),
                  onChanged: (v) {
                    _state = v;
                    _campaignKey.resetForContentOrAudienceChange();
                    _debounce?.cancel();
                    _debounce =
                        Timer(const Duration(milliseconds: 350), _preview);
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
  Widget _historyCard(Map<String, dynamic> x) {
    final bool draft = x['kind']?.toString() == 'DRAFT';
    return Card(
        child: ListTile(
            title: Text(x['subject']?.toString().isNotEmpty == true
                ? x['subject'].toString()
                : 'Untitled email draft'),
            subtitle: Text(draft
                ? 'Draft • tap to continue editing'
                : _result(x, 'No provider result recorded.')),
            trailing: draft
                ? IconButton(
                    tooltip: 'Delete draft',
                    onPressed: () => _deleteDraft(x),
                    icon: const Icon(Icons.delete_outline))
                : const Icon(Icons.chevron_right),
            onTap: () => draft ? _openDraft(x) : _detail(x)));
  }

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
