import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminPartnerReconciliationView extends StatefulWidget {
  const AdminPartnerReconciliationView({super.key, this.client});

  final http.Client? client;

  @override
  State<AdminPartnerReconciliationView> createState() =>
      _AdminPartnerReconciliationViewState();
}

class _AdminPartnerReconciliationViewState
    extends State<AdminPartnerReconciliationView> {
  static const _baseUrl = 'https://api.servicepay.ng/api';
  static const _statuses = <String>[
    'ALL',
    'PENDING',
    'PROCESSING',
    'REQUERY_REQUIRED',
    'SUCCESSFUL',
    'FAILED',
    'REVERSED',
  ];

  late final http.Client _client;
  late final bool _ownsClient;
  final _search = TextEditingController();
  List<Map<String, dynamic>> _transactions = <Map<String, dynamic>>[];
  Map<String, List<Map<String, dynamic>>> _audits =
      <String, List<Map<String, dynamic>>>{};
  bool _loading = true;
  bool _headOffice = false;
  String _error = '';
  String _status = 'ALL';
  String _providerNotice = '';

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    if (_ownsClient) _client.close();
    super.dispose();
  }

  String _text(dynamic value, [String fallback = '—']) {
    final text = value?.toString().trim() ?? '';
    return text.isEmpty ? fallback : text;
  }

  String _id(Map<String, dynamic> item) => _text(item['_id'] ?? item['id'], '');

  String _reference(Map<String, dynamic> item) => _text(item['reference'], '');

  double _number(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

  String _money(dynamic value) => '₦${_number(value).toStringAsFixed(2)}';

  String _statusOf(Map<String, dynamic> item) =>
      _text(item['status'], 'UNKNOWN').toUpperCase();

  bool _isUncertain(Map<String, dynamic> item) =>
      _statusOf(item) == 'REQUERY_REQUIRED';

  Future<Map<String, String>> _headers() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('auth_token') ?? prefs.getString('token') ?? '';
    if (token.isEmpty) throw Exception('Admin session not found. Please login again.');
    return <String, String>{
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    };
  }

  dynamic _decode(http.Response response) {
    if (response.body.trim().isEmpty) return <String, dynamic>{};
    return jsonDecode(response.body);
  }

  Future<dynamic> _get(String path) async {
    final response = await _client.get(
      Uri.parse('$_baseUrl$path'),
      headers: await _headers(),
    );
    final data = _decode(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(data is Map ? _text(data['message'], 'Request failed.') : 'Request failed.');
    }
    return data;
  }

  Future<void> _load() async {
    if (mounted) setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      final role = (prefs.getString('user_role') ?? '')
          .trim()
          .toUpperCase()
          .replaceAll(RegExp(r'[\s-]+'), '_');
      if (role != 'HEAD_OFFICE') {
        if (mounted) setState(() {
          _headOffice = false;
          _loading = false;
          _error = 'Head Office access is required for Partner API reconciliation.';
        });
        return;
      }
      _headOffice = true;
      final partnerResponse = await _get('/admin/partners');
      final rawPartners = partnerResponse is Map && partnerResponse['partners'] is List
          ? partnerResponse['partners'] as List
          : <dynamic>[];
      final partners = rawPartners.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList();
      final usageResponses = await Future.wait(
        partners.map((partner) => _get('/admin/partners/${_id(partner)}/usage')),
      );
      final byReference = <String, Map<String, dynamic>>{};
      final audits = <String, List<Map<String, dynamic>>>{};
      for (var index = 0; index < partners.length; index++) {
        final partner = partners[index];
        final usage = usageResponses[index];
        final transactions = usage is Map && usage['transactions'] is List
            ? usage['transactions'] as List
            : <dynamic>[];
        for (final raw in transactions.whereType<Map>()) {
          final transaction = Map<String, dynamic>.from(raw)
            ..['partnerName'] = partner['businessName'] ?? partner['name']
            ..['partnerId'] = _id(partner)
            ..['apiKey'] = partner['apiKey'];
          byReference[_reference(transaction)] = transaction;
        }
        final events = usage is Map && usage['auditEvents'] is List
            ? usage['auditEvents'] as List
            : <dynamic>[];
        for (final raw in events.whereType<Map>()) {
          final event = Map<String, dynamic>.from(raw);
          final metadata = event['metadata'] is Map
              ? Map<String, dynamic>.from(event['metadata'] as Map)
              : <String, dynamic>{};
          final reference = _text(metadata['reference'], '');
          if (reference.isNotEmpty) {
            (audits[reference] ??= <Map<String, dynamic>>[]).add(event);
          }
        }
      }
      final reconciliation = await _get('/admin/partners/reconciliation?limit=200');
      if (reconciliation is Map) {
        _providerNotice = _text(reconciliation['message'], '');
        final unresolved = reconciliation['transactions'] is List
            ? reconciliation['transactions'] as List
            : <dynamic>[];
        for (final raw in unresolved.whereType<Map>()) {
          final transaction = Map<String, dynamic>.from(raw);
          final old = byReference[_reference(transaction)];
          byReference[_reference(transaction)] = <String, dynamic>{
            ...old ?? <String, dynamic>{},
            ...transaction,
          };
        }
      }
      final transactions = byReference.values.toList()
        ..sort((a, b) => _text(b['updatedAt'] ?? b['createdAt'], '').compareTo(
              _text(a['updatedAt'] ?? a['createdAt'], ''),
            ));
      if (mounted) setState(() {
        _transactions = transactions;
        _audits = audits;
        _loading = false;
      });
    } catch (error) {
      if (mounted) setState(() {
        _loading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  List<Map<String, dynamic>> get _visible {
    final query = _search.text.trim().toLowerCase();
    return _transactions.where((item) {
      final matchesStatus = _status == 'ALL' || _statusOf(item) == _status;
      if (!matchesStatus) return false;
      if (query.isEmpty) return true;
      return <String>[
        _text(item['partnerName'], ''),
        _text(item['partnerId'] ?? item['partner'], ''),
        _text(item['apiKey'], ''),
        _reference(item),
        _text(item['providerReference'], ''),
        _text(item['phone'], ''),
      ].join(' ').toLowerCase().contains(query);
    }).toList();
  }

  Future<void> _post(String path, Map<String, dynamic> body) async {
    final response = await _client.post(
      Uri.parse('$_baseUrl$path'),
      headers: await _headers(),
      body: jsonEncode(body),
    );
    final data = _decode(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(data is Map ? _text(data['message'], 'Reconciliation failed.') : 'Reconciliation failed.');
    }
  }

  Future<void> _resolve(Map<String, dynamic> transaction, String outcome) async {
    if (!_isUncertain(transaction)) {
      _notice('Only a REQUERY_REQUIRED transaction can be manually resolved.');
      return;
    }
    final note = TextEditingController();
    final providerReference = TextEditingController(text: _text(transaction['providerReference'], ''));
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(outcome == 'SUCCESSFUL' ? 'Mark successful' : 'Mark failed and refund'),
        content: SizedBox(
          width: 510,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _impact(transaction, outcome),
                const SizedBox(height: 16),
                TextField(
                  controller: note,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Resolution note / evidence',
                    hintText: 'At least 10 characters. Explain how the provider outcome was verified.',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (outcome == 'SUCCESSFUL') ...<Widget>[
                  const SizedBox(height: 12),
                  TextField(
                    controller: providerReference,
                    decoration: const InputDecoration(
                      labelText: 'Provider reference (if available)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (note.text.trim().length < 10) {
                _notice('Enter a resolution note of at least 10 characters.');
                return;
              }
              Navigator.pop(context, true);
            },
            child: Text(outcome == 'SUCCESSFUL' ? 'Confirm successful' : 'Confirm refund'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      note.dispose();
      providerReference.dispose();
      return;
    }
    try {
      await _post('/admin/partners/reconciliation/${_reference(transaction)}/resolve', <String, dynamic>{
        'outcome': outcome,
        'verificationNote': note.text.trim(),
        if (outcome == 'SUCCESSFUL' && providerReference.text.trim().isNotEmpty)
          'providerReference': providerReference.text.trim(),
      });
      _notice(outcome == 'SUCCESSFUL'
          ? 'Transaction marked successful without another debit or provider purchase.'
          : 'Transaction marked failed; the protected refund was requested exactly once.', success: true);
      await _load();
    } catch (error) {
      _notice(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      note.dispose();
      providerReference.dispose();
    }
  }

  Future<void> _keepPending(Map<String, dynamic> transaction) async {
    if (!_isUncertain(transaction)) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Keep pending'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
          _impact(transaction, 'PENDING'),
          const SizedBox(height: 12),
          const Text('This records a safe reconciliation check. It will not resend the purchase or alter the partner wallet balance.'),
        ]),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Keep pending')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await _post('/admin/partners/reconciliation/${_reference(transaction)}/requery', const <String, dynamic>{});
      _notice('Pending status retained and a no-replay reconciliation check was audited.', success: true);
      await _load();
    } catch (error) {
      _notice(error.toString().replaceFirst('Exception: ', ''));
    }
  }

  void _notice(String message, {bool success = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: success ? const Color(0xFF08783E) : null));
  }

  bool _sameDay(dynamic value) {
    final date = DateTime.tryParse(_text(value, ''));
    final now = DateTime.now();
    return date != null && date.year == now.year && date.month == now.month && date.day == now.day;
  }

  Widget _metric(String title, String value, IconData icon) => Expanded(
    child: Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(children: <Widget>[
          CircleAvatar(child: Icon(icon)),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
            Text(value, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
            Text(title, style: const TextStyle(fontSize: 12)),
          ])),
        ]),
      ),
    ),
  );

  Widget _chip(String label, {Color? color}) => Chip(
    label: Text(label.replaceAll('_', ' '), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
    backgroundColor: color,
    visualDensity: VisualDensity.compact,
  );

  Widget _impact(Map<String, dynamic> transaction, String outcome) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: const Color(0xFFF6F8F7), borderRadius: BorderRadius.circular(10)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
      Text(_text(transaction['partnerName'], 'Partner API transaction'), style: const TextStyle(fontWeight: FontWeight.w800)),
      Text('Reference: ${_reference(transaction)}'),
      Text('Service: ${_text(transaction['service'])} · Amount: ${_money(transaction['amount'])}'),
      const SizedBox(height: 6),
      Text(
        outcome == 'SUCCESSFUL'
            ? 'Financial impact: no new debit and no provider purchase will be sent.'
            : outcome == 'FAILED'
                ? 'Financial impact: refund is permitted only if the original debit is still unreversed.'
                : 'Financial impact: no wallet change and no provider purchase will be sent.',
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 6,
        runSpacing: 4,
        children: <Widget>[
          _chip(
            _text(transaction['walletDebitStatus'], 'DEBITED') == 'REFUNDED'
                ? 'Already refunded'
                : 'Already debited',
          ),
          _chip(
            _text(transaction['providerReference'], '').isEmpty
                ? 'Provider reference not available'
                : 'Provider reference available',
          ),
          if (_isUncertain(transaction)) _chip('Manual reconciliation required'),
        ],
      ),
    ]),
  );

  void _details(Map<String, dynamic> item) {
    final audit = _audits[_reference(item)] ?? <Map<String, dynamic>>[];
    showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720, maxHeight: 760),
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Column(children: <Widget>[
              Row(children: <Widget>[
                const Icon(Icons.receipt_long_outlined),
                const SizedBox(width: 10),
                const Expanded(child: Text('Partner API transaction', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900))),
                IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
              ]),
              const Divider(),
              Expanded(child: ListView(children: <Widget>[
                _impact(item, _statusOf(item)),
                const SizedBox(height: 16),
                _detail('Partner / ID', '${_text(item['partnerName'])} · ${_text(item['partnerId'] ?? item['partner'])}'),
                _detail('API transaction reference', _reference(item)),
                _detail('Idempotency key', _text(item['idempotencyKey'])),
                _detail('Service / network', '${_text(item['service'])} · ${_text(item['network'])}'),
                _detail('Beneficiary phone', _text(item['phone'])),
                _detail('Amount', _money(item['amount'])),
                _detail('Partner wallet debit', '${_text(item['walletDebitStatus'], 'DEBITED')} · ${_money(item['amount'])}'),
                _detail('Provider reference', _text(item['providerReference'], 'Not available')),
                _detail('Created', _text(item['createdAt'])),
                _detail('Last updated', _text(item['updatedAt'])),
                _detail('Current status', _statusOf(item)),
                _detail('Uncertainty reason', _text(item['uncertaintyReason'] ?? item['errorMessage'])),
                const SizedBox(height: 16),
                const Text('Audit / reconciliation history', style: TextStyle(fontWeight: FontWeight.w900)),
                const SizedBox(height: 8),
                if (audit.isEmpty) const Text('No matching audit events returned for this transaction.')
                else ...audit.map((event) => ListTile(
                  dense: true,
                  leading: const Icon(Icons.history_rounded),
                  title: Text(_text(event['action'], 'Audit event')),
                  subtitle: Text('${_text(event['createdAt'])}\n${_text(event['metadata'], '')}'),
                )),
              ])),
              if (_headOffice && _isUncertain(item))
                Wrap(spacing: 8, runSpacing: 8, children: <Widget>[
                  FilledButton(onPressed: () { Navigator.pop(context); _resolve(item, 'SUCCESSFUL'); }, child: const Text('MARK SUCCESSFUL')),
                  OutlinedButton(onPressed: () { Navigator.pop(context); _resolve(item, 'FAILED'); }, child: const Text('MARK FAILED / REFUND')),
                  TextButton(onPressed: () { Navigator.pop(context); _keepPending(item); }, child: const Text('KEEP PENDING')),
                ]),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _detail(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 9),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
      SizedBox(width: 180, child: Text(label, style: const TextStyle(color: Color(0xFF667085)))),
      Expanded(child: SelectableText(value, style: const TextStyle(fontWeight: FontWeight.w600))),
    ]),
  );

  @override
  Widget build(BuildContext context) {
    final pending = _transactions.where(_isUncertain).length;
    final resolvedToday = _transactions.where((item) => <String>['SUCCESSFUL', 'FAILED', 'REVERSED'].contains(_statusOf(item)) && _sameDay(item['resolvedAt'] ?? item['updatedAt'])).length;
    final successful = _transactions.where((item) => _statusOf(item) == 'SUCCESSFUL').length;
    final refunded = _transactions.where((item) => <String>['FAILED', 'REVERSED'].contains(_statusOf(item))).length;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(18), children: <Widget>[
        Text('Partner API Reconciliation', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900)),
        const SizedBox(height: 6),
        Text(_providerNotice.isEmpty ? 'Review uncertain Provider API outcomes without replaying a purchase or duplicating a wallet debit.' : _providerNotice),
        const SizedBox(height: 14),
        Row(children: <Widget>[
          _metric('Pending reconciliation', '$pending', Icons.warning_amber_rounded),
          const SizedBox(width: 10),
          _metric('Resolved today', '$resolvedToday', Icons.task_alt_rounded),
          const SizedBox(width: 10),
          _metric('Total successful', '$successful', Icons.check_circle_outline),
          const SizedBox(width: 10),
          _metric('Refunded / reversed', '$refunded', Icons.undo_rounded),
        ]),
        const SizedBox(height: 16),
        Row(children: <Widget>[
          Expanded(child: TextField(
            controller: _search,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), border: OutlineInputBorder(), hintText: 'Search partner, partner ID, API key, transaction/provider reference or phone'),
          )),
          const SizedBox(width: 10),
          DropdownButton<String>(
            value: _status,
            onChanged: (value) => setState(() => _status = value ?? 'ALL'),
            items: _statuses.map((status) => DropdownMenuItem(value: status, child: Text(status.replaceAll('_', ' ')))).toList(),
          ),
        ]),
        const SizedBox(height: 14),
        if (_loading) const Padding(padding: EdgeInsets.only(top: 52), child: Center(child: CircularProgressIndicator()))
        else if (_error.isNotEmpty) Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(children: <Widget>[
          const Icon(Icons.error_outline_rounded, size: 44),
          const SizedBox(height: 8), Text(_error, textAlign: TextAlign.center),
          const SizedBox(height: 10), FilledButton(onPressed: _load, child: const Text('Try again')),
        ])))
        else if (_visible.isEmpty) const Padding(padding: EdgeInsets.all(40), child: Center(child: Text('No Partner API transactions match these filters.')))
        else ..._visible.map((item) => Card(
          elevation: 0,
          child: ListTile(
            onTap: () => _details(item),
            leading: CircleAvatar(child: Icon(_isUncertain(item) ? Icons.warning_amber_rounded : Icons.receipt_long_outlined)),
            title: Text('${_text(item['partnerName'])} · ${_money(item['amount'])}', style: const TextStyle(fontWeight: FontWeight.w800)),
            subtitle: Text('${_reference(item)}\n${_text(item['service'])} · ${_text(item['network'])} · ${_text(item['phone'])}'),
            isThreeLine: true,
            trailing: Column(mainAxisAlignment: MainAxisAlignment.center, children: <Widget>[
              _chip(_statusOf(item), color: _isUncertain(item) ? const Color(0xFFFFF2CC) : null),
              const SizedBox(height: 3),
              Text(_text(item['providerReference'], 'No provider ref'), style: const TextStyle(fontSize: 10)),
            ]),
          ),
        )),
      ]),
    );
  }
}