import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminFintechOperationsScreen extends StatefulWidget {
  const AdminFintechOperationsScreen({required this.module, super.key});

  final String module;

  @override
  State<AdminFintechOperationsScreen> createState() =>
      _AdminFintechOperationsScreenState();
}

class _AdminFintechOperationsScreenState
    extends State<AdminFintechOperationsScreen> {
  static const _baseUrl = 'https://api.servicepay.ng/api';
  static const _green = Color(0xFF08783E);
  final _search = TextEditingController();
  List<Map<String, dynamic>> _items = [];
  String? _error;
  bool _loading = true;
  int _total = 0;

  String get _endpoint {
    switch (widget.module) {
      case 'Account Restrictions':
        return '/admin/fintech-operations/customers';
      case 'Wallet Holds & Releases':
        return '/admin/fintech-operations/wallet-holds';
      case 'Failed Transactions':
        return '/admin/fintech-operations/failed-transactions';
      case 'Virtual Accounts':
        return '/admin/fintech-operations/virtual-accounts';
      case 'Dedicated Accounts':
        return '/admin/fintech-operations/dedicated-accounts';
      case 'Bank Partners':
        return '/admin/fintech-operations/bank-partners';
      case 'Switching / Routing':
        return '/admin/fintech-operations/routing-status';
      case 'Fraud Monitoring':
        return '/admin/fintech-operations/fraud-alerts';
      case 'Blacklist / Watchlist':
        return '/admin/fintech-operations/watchlist';
      case 'Device & Login Risk':
        return '/admin/fintech-operations/login-risk';
      case 'Refunds':
      case 'Reversals':
        return '/admin/fintech-operations/financial-actions';
      case 'Disputes':
        return '/admin/fintech-operations/disputes';
      default:
        return '/admin/fintech-operations/customers';
    }
  }

  String get _listKey {
    switch (widget.module) {
      case 'Account Restrictions':
        return 'customers';
      case 'Wallet Holds & Releases':
        return 'holds';
      case 'Failed Transactions':
        return 'transactions';
      case 'Virtual Accounts':
      case 'Dedicated Accounts':
        return 'accounts';
      case 'Bank Partners':
        return 'providers';
      case 'Switching / Routing':
        return 'routes';
      case 'Fraud Monitoring':
        return 'alerts';
      case 'Blacklist / Watchlist':
        return 'entries';
      case 'Device & Login Risk':
        return 'events';
      case 'Disputes':
        return 'disputes';
      default:
        return 'actions';
    }
  }

  String get _description {
    switch (widget.module) {
      case 'Account Restrictions':
        return 'Search real customer accounts and apply or remove audited controls.';
      case 'Wallet Holds & Releases':
        return 'Reserve spendable funds safely and release them only with an audit trail.';
      case 'Failed Transactions':
        return 'Review live failed or pending transactions before requery or financial correction.';
      case 'Virtual Accounts':
        return 'Inspect provisioned customer virtual accounts from the current provider integration.';
      case 'Dedicated Accounts':
        return 'Review real customer dedicated-account records without creating unsupported provider accounts.';
      case 'Bank Partners':
        return 'Review safe configuration status and supported capabilities for real payment integrations.';
      case 'Switching / Routing':
        return 'Inspect the current code-backed service routes. Automatic switching is not represented where it is not implemented.';
      case 'Fraud Monitoring':
        return 'Review live fraud-risk alerts and document controlled investigation decisions.';
      case 'Blacklist / Watchlist':
        return 'Manage risk identifiers. Blacklisted identifiers are blocked; watchlist entries are flagged.';
      case 'Device & Login Risk':
        return 'Review stored login security events without collecting additional invasive data.';
      case 'Refunds':
        return 'Issue only an eligible, idempotent refund after confirming the failed wallet debit.';
      case 'Reversals':
        return 'Correct an eligible failed wallet debit through a separate audited reversal workflow.';
      case 'Disputes':
        return 'Open and resolve operational disputes against real ServicePay transactions without moving money automatically.';
      default:
        return '';
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('admin_token') ??
        '';
    return raw.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '').trim();
  }

  Future<Map<String, String>> _headers({bool json = false, bool idempotent = false}) async {
    final token = await _token();
    return {
      'Accept': 'application/json',
      if (json) 'Content-Type': 'application/json',
      if (token.isNotEmpty) 'Authorization': 'Bearer $token',
      if (idempotent) 'X-Idempotency-Key': 'admin-${DateTime.now().microsecondsSinceEpoch}',
    };
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = <String, String>{
        'limit': '50',
        if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
        if (widget.module == 'Refunds') 'type': 'REFUND',
        if (widget.module == 'Reversals') 'type': 'REVERSAL',
      };
      final response = await http.get(
        Uri.parse('$_baseUrl$_endpoint').replace(queryParameters: query),
        headers: await _headers(),
      );
      final data = _decode(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(_message(data, 'Unable to load ${widget.module}.'));
      }
      final raw = data[_listKey] as List? ?? const [];
      if (!mounted) return;
      setState(() {
        _items = raw.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList();
        _total = ((data['pagination'] as Map?)?['total'] as num?)?.toInt() ?? _items.length;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map _decode(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);
      return decoded is Map ? decoded : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{'message': response.body};
    }
  }

  String _message(Map data, String fallback) =>
      data['message']?.toString().trim().isNotEmpty == true
          ? data['message'].toString()
          : fallback;

  String _id(Map item) => (item['_id'] ?? item['id'] ?? '').toString();
  String _text(dynamic value, [String fallback = '—']) {
    final result = value?.toString().trim() ?? '';
    return result.isEmpty ? fallback : result;
  }

  String _money(dynamic value) {
    final amount = value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
    return '₦${amount.toStringAsFixed(2)}';
  }

  String _title(Map item) {
    switch (widget.module) {
      case 'Account Restrictions':
        return _text(item['fullName'], _text(item['phone']));
      case 'Wallet Holds & Releases':
        return '${_text((item['user'] as Map?)?['fullName'], 'Customer')} · ${_text(item['reference'])}';
      case 'Failed Transactions':
        return _text(item['reference']);
      case 'Virtual Accounts':
      case 'Dedicated Accounts':
        return _text((item['virtualAccount'] as Map?)?['accountNumber']);
      case 'Bank Partners':
        return _text(item['name']);
      case 'Switching / Routing':
        return _text(item['service']);
      case 'Fraud Monitoring':
        return _text(item['rule']);
      case 'Blacklist / Watchlist':
        return _text(item['identifierDisplay'], _text(item['identifierValue']));
      case 'Device & Login Risk':
        return _text(item['identifier']);
      case 'Disputes':
        return _text(item['reference']);
      default:
        return _text(item['reference']);
    }
  }

  String _subtitle(Map item) {
    switch (widget.module) {
      case 'Account Restrictions':
        return '${_text(item['phone'])} · Spendable ${_money(item['spendableBalance'])} · ${((item['restrictions'] as List?) ?? const []).length} active control(s)';
      case 'Wallet Holds & Releases':
        return 'Held ${_money(item['remainingAmount'])} of ${_money(item['initialAmount'])} · ${_text(item['reason'])}';
      case 'Failed Transactions':
        return '${_text(item['serviceType'])} · ${_money(item['amount'])} · ${_text((item['customerId'] as Map?)?['fullName'])}';
      case 'Virtual Accounts':
      case 'Dedicated Accounts':
        final account = item['virtualAccount'] as Map? ?? const {};
        return '${_text(account['accountName'])} · ${_text(account['bankName'])} · ${_text(account['provider'])}';
      case 'Bank Partners':
        return ((item['capabilities'] as List?) ?? const []).join(' · ');
      case 'Switching / Routing':
        return '${_text(item['provider'])} · ${_text(item['detail'])}';
      case 'Fraud Monitoring':
        return '${_text((item['user'] as Map?)?['fullName'])} · ${_text(item['details'])}';
      case 'Blacklist / Watchlist':
        return '${_text(item['identifierType'])} · ${_text(item['reason'])}';
      case 'Device & Login Risk':
        return '${_text((item['user'] as Map?)?['fullName'])} · ${_text(item['userAgent'], 'No device agent stored')}';
      case 'Disputes':
        return '${_text((item['customer'] as Map?)?['fullName'])} · ${_money(item['amount'])} · ${_text(item['category'])}';
      default:
        final transaction = item['originalTransaction'] as Map? ?? const {};
        return '${_text(transaction['reference'])} · ${_money(item['amount'])} · ${_text((item['customer'] as Map?)?['fullName'])}';
    }
  }

  String _status(Map item) {
    if (widget.module == 'Virtual Accounts' || widget.module == 'Dedicated Accounts') return _text((item['virtualAccount'] as Map?)?['status']);
    if (widget.module == 'Device & Login Risk') return _text(item['outcome']);
    if (widget.module == 'Fraud Monitoring') return '${_text(item['riskLevel'])} · ${_text(item['status'])}';
    if (widget.module == 'Account Restrictions') return _text(item['status']);
    return _text(item['status']);
  }

  Color _statusColor(String status) {
    final value = status.toUpperCase();
    if (value.contains('FAILED') || value.contains('BLACKLIST') || value.contains('CRITICAL')) return Colors.red;
    if (value.contains('PENDING') || value.contains('OPEN') || value.contains('WATCH') || value.contains('MEDIUM')) return Colors.orange.shade800;
    if (value.contains('SUCCESS') || value.contains('ACTIVE') || value.contains('COMPLETED') || value.contains('CLEARED') || value.contains('RELEASED')) return _green;
    return Colors.blueGrey;
  }

  Future<void> _post(String path, Map<String, dynamic> body, {bool idempotent = false}) async {
    final response = await http.post(
      Uri.parse('$_baseUrl$path'),
      headers: await _headers(json: true, idempotent: idempotent),
      body: jsonEncode(body),
    );
    final data = _decode(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(_message(data, 'Action could not be completed.'));
    }
  }

  Future<void> _confirmAction({
    required String title,
    required String action,
    required Future<void> Function(String reason) submit,
  }) async {
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('This action is audited and cannot be undone automatically. Enter a clear reason to continue.'),
            const SizedBox(height: 12),
            TextField(controller: reason, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason (minimum 5 characters)', border: OutlineInputBorder())),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(action)),
        ],
      ),
    );
    if (confirmed != true) return;
    if (reason.text.trim().length < 5) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a reason with at least 5 characters.')));
      return;
    }
    try {
      await submit(reason.text.trim());
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Action completed and audited.')));
      await _load();
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString().replaceFirst('Exception: ', ''))));
    }
  }

  Future<void> _releaseHold(Map item) async {
    final amount = TextEditingController(
      text: ((item['remainingAmount'] as num?)?.toDouble() ?? 0).toStringAsFixed(2),
    );
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Release wallet hold'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Remaining held amount: ${_money(item['remainingAmount'])}'),
            const SizedBox(height: 12),
            TextField(controller: amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Release amount (NGN)', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: reason, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason (minimum 5 characters)', border: OutlineInputBorder())),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Release')),
        ],
      ),
    );
    if (confirmed != true) return;
    final requested = double.tryParse(amount.text.trim());
    final remaining = (item['remainingAmount'] as num?)?.toDouble() ?? 0;
    if (requested == null || requested <= 0 || requested > remaining || reason.text.trim().length < 5) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a valid amount up to the held balance and a clear reason.')));
      return;
    }
    try {
      await _post('/admin/fintech-operations/wallet-holds/${_id(item)}/release', {'amount': requested, 'reason': reason.text.trim()}, idempotent: true);
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Hold release completed and audited.')));
      }
      await _load();
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString().replaceFirst('Exception: ', ''))));
    }
  }

  Future<void> _updateDispute(Map item) async {
    final note = TextEditingController();
    var status = _text(item['status'], 'OPEN');
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('Update ${_text(item['reference'])}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: const ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED'].contains(status) ? status : 'OPEN',
                decoration: const InputDecoration(labelText: 'Resolution status', border: OutlineInputBorder()),
                items: const ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED'].map((value) => DropdownMenuItem(value: value, child: Text(value.replaceAll('_', ' ')))).toList(),
                onChanged: (value) => setDialogState(() => status = value ?? status),
              ),
              const SizedBox(height: 12),
              TextField(controller: note, maxLines: 3, decoration: const InputDecoration(labelText: 'Review note (minimum 5 characters)', border: OutlineInputBorder())),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
          ],
        ),
      ),
    );
    if (saved != true || note.text.trim().length < 5) {
      if (saved == true && mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a review note with at least 5 characters.')));
      return;
    }
    try {
      await _post('/admin/fintech-operations/disputes/${_id(item)}', {'status': status, 'note': note.text.trim()});
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Dispute updated and audited.')));
      }
      await _load();
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString().replaceFirst('Exception: ', ''))));
    }
  }

  Future<void> _addAction() async {
    final userId = TextEditingController();
    final amount = TextEditingController();
    final detail = TextEditingController();
    final extra = TextEditingController();
    String selection = widget.module == 'Account Restrictions'
        ? 'BLOCK_OUTGOING_TRANSFERS'
        : widget.module == 'Disputes'
            ? 'UNRECOGNISED'
            : 'WATCHLIST';
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(_addLabel),
          content: SingleChildScrollView(
            child: SizedBox(
              width: 430,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (widget.module == 'Account Restrictions' || widget.module == 'Wallet Holds & Releases')
                    TextField(controller: userId, decoration: const InputDecoration(labelText: 'Customer ServicePay user ID', border: OutlineInputBorder())),
                  if (widget.module == 'Wallet Holds & Releases') ...[
                    const SizedBox(height: 12),
                    TextField(controller: amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Amount (NGN)', border: OutlineInputBorder())),
                    const SizedBox(height: 12),
                    TextField(controller: extra, decoration: const InputDecoration(labelText: 'Linked transaction/reference (optional)', border: OutlineInputBorder())),
                  ],
                  if (widget.module == 'Account Restrictions') ...[
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: selection,
                      decoration: const InputDecoration(labelText: 'Restriction', border: OutlineInputBorder()),
                      items: const ['BLOCK_LOGIN', 'BLOCK_OUTGOING_TRANSFERS', 'BLOCK_WITHDRAWALS', 'BLOCK_WALLET_DEBIT', 'BLOCK_BILL_PURCHASES', 'BLOCK_MARKETPLACE_PURCHASE', 'BLOCK_PARTNER_API', 'FULL_FREEZE'].map((item) => DropdownMenuItem(value: item, child: Text(item.replaceAll('_', ' ')))).toList(),
                      onChanged: (value) => setDialogState(() => selection = value ?? selection),
                    ),
                  ],
                  if (widget.module == 'Blacklist / Watchlist') ...[
                    TextField(controller: userId, decoration: const InputDecoration(labelText: 'Identifier value', border: OutlineInputBorder())),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: selection,
                      decoration: const InputDecoration(labelText: 'Risk status', border: OutlineInputBorder()),
                      items: const ['WATCHLIST', 'BLACKLISTED'].map((item) => DropdownMenuItem(value: item, child: Text(item))).toList(),
                      onChanged: (value) => setDialogState(() => selection = value ?? selection),
                    ),
                  ],
                  if (widget.module == 'Refunds' || widget.module == 'Reversals' || widget.module == 'Disputes') ...[
                    TextField(controller: userId, decoration: InputDecoration(labelText: widget.module == 'Disputes' ? 'Related transaction ID' : 'Original transaction ID', border: const OutlineInputBorder())),
                    if (widget.module == 'Disputes') ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: selection,
                        decoration: const InputDecoration(labelText: 'Dispute category', border: OutlineInputBorder()),
                        items: const ['UNRECOGNISED', 'SERVICE_NOT_RECEIVED', 'DUPLICATE_CHARGE', 'INCORRECT_AMOUNT', 'OTHER'].map((item) => DropdownMenuItem(value: item, child: Text(item.replaceAll('_', ' ')))).toList(),
                        onChanged: (value) => setDialogState(() => selection = value ?? selection),
                      ),
                    ],
                  ],
                  const SizedBox(height: 12),
                  TextField(controller: detail, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason (minimum 5 characters)', border: OutlineInputBorder())),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                if (detail.text.trim().length < 5) return;
                try {
                  if (widget.module == 'Account Restrictions') {
                    await _post('/admin/fintech-operations/restrictions', {'userId': userId.text.trim(), 'type': selection, 'reason': detail.text.trim()});
                  } else if (widget.module == 'Wallet Holds & Releases') {
                    await _post('/admin/fintech-operations/wallet-holds', {'userId': userId.text.trim(), 'amount': double.tryParse(amount.text.trim()), 'linkedReference': extra.text.trim(), 'reason': detail.text.trim()}, idempotent: true);
                  } else if (widget.module == 'Blacklist / Watchlist') {
                    await _post('/admin/fintech-operations/watchlist', {'identifierType': 'PHONE', 'identifierValue': userId.text.trim(), 'identifierDisplay': userId.text.trim(), 'status': selection, 'severity': 'MEDIUM', 'reason': detail.text.trim()});
                  } else if (widget.module == 'Disputes') {
                    await _post('/admin/fintech-operations/disputes', {'transactionId': userId.text.trim(), 'category': selection, 'reason': detail.text.trim()});
                  } else {
                    await _post('/admin/fintech-operations/financial-actions/${widget.module == 'Refunds' ? 'REFUND' : 'REVERSAL'}', {'transactionId': userId.text.trim(), 'reason': detail.text.trim()}, idempotent: true);
                  }
                  if (mounted) Navigator.pop(dialogContext);
                  await _load();
                } catch (error) {
                  if (mounted) ScaffoldMessenger.of(this.context).showSnackBar(SnackBar(content: Text(error.toString().replaceFirst('Exception: ', ''))));
                }
              },
              child: const Text('Confirm'),
            ),
          ],
        ),
      ),
    );
  }

  String get _addLabel {
    switch (widget.module) {
      case 'Account Restrictions': return 'Apply restriction';
      case 'Wallet Holds & Releases': return 'Place wallet hold';
      case 'Blacklist / Watchlist': return 'Add risk identifier';
      case 'Refunds': return 'Initiate refund';
      case 'Reversals': return 'Initiate reversal';
      case 'Disputes': return 'Open dispute';
      default: return 'New action';
    }
  }

  bool get _canAdd => const ['Account Restrictions', 'Wallet Holds & Releases', 'Blacklist / Watchlist', 'Refunds', 'Reversals', 'Disputes'].contains(widget.module);

  void _showDetails(Map item) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(_title(item), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                SelectableText(const JsonEncoder.withIndent('  ').convert(item), style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
                const SizedBox(height: 16),
                if (widget.module == 'Account Restrictions')
                  OutlinedButton(
                    onPressed: () => _confirmAction(title: 'Apply restriction', action: 'Continue', submit: (reason) async {
                      Navigator.pop(context);
                      await _addAction();
                    }),
                    child: const Text('Manage restrictions'),
                  ),
                if (widget.module == 'Wallet Holds & Releases' && const ['ACTIVE', 'PARTIALLY_RELEASED'].contains(_text(item['status'])))
                  FilledButton(
                    onPressed: () => _releaseHold(item),
                    child: const Text('Release hold'),
                  ),
                if (widget.module == 'Blacklist / Watchlist' && _text(item['status']) != 'CLEARED')
                  FilledButton(
                    onPressed: () => _confirmAction(title: 'Clear risk identifier', action: 'Clear', submit: (reason) async {
                      await _post('/admin/fintech-operations/watchlist/${_id(item)}/clear', {'reason': reason});
                      if (mounted) Navigator.pop(context);
                    }),
                    child: const Text('Clear entry'),
                  ),
                if (widget.module == 'Failed Transactions')
                  Column(children: [
                    OutlinedButton(
                      onPressed: () => _confirmAction(title: 'Requery transaction', action: 'Requery', submit: (reason) async {
                        await _post('/admin/transaction-requery', {'reference': _text(item['reference'])});
                      }),
                      child: const Text('Safe provider requery'),
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: () => _confirmAction(title: 'Mark for investigation', action: 'Mark', submit: (reason) async {
                        await _post('/admin/fintech-operations/failed-transactions/${_id(item)}/investigate', {'reason': reason});
                        if (mounted) Navigator.pop(context);
                      }),
                      child: const Text('Mark for investigation'),
                    ),
                  ]),
                if (widget.module == 'Disputes')
                  FilledButton(
                    onPressed: () => _updateDispute(item),
                    child: const Text('Review / resolve dispute'),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7F6),
      appBar: AppBar(
        title: Text(widget.module),
        actions: [IconButton(onPressed: _loading ? null : _load, tooltip: 'Refresh live data', icon: const Icon(Icons.refresh))],
      ),
      floatingActionButton: _canAdd
          ? FloatingActionButton.extended(onPressed: _addAction, backgroundColor: _green, icon: const Icon(Icons.add), label: Text(_addLabel))
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(color: _green, borderRadius: BorderRadius.circular(16)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('SERVICEPAY FINTECH CONTROL CENTER', style: TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text(widget.module, style: const TextStyle(color: Colors.white, fontSize: 23, fontWeight: FontWeight.w900)),
                const SizedBox(height: 8),
                Text(_description, style: const TextStyle(color: Colors.white, height: 1.35)),
              ]),
            ),
            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: _summaryCard('Live records', '$_total', Icons.assessment_outlined)),
              const SizedBox(width: 12),
                Expanded(child: _summaryCard('Security', 'Protected', Icons.admin_panel_settings_outlined)),
            ]),
            const SizedBox(height: 16),
            TextField(
              controller: _search,
              onSubmitted: (_) => _load(),
              decoration: InputDecoration(
                hintText: 'Search reference, customer, identifier or account',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(onPressed: _load, icon: const Icon(Icons.arrow_forward)),
                border: const OutlineInputBorder(),
                filled: true,
                fillColor: Colors.white,
              ),
            ),
            const SizedBox(height: 16),
            if (_loading) const Padding(padding: EdgeInsets.all(36), child: Center(child: CircularProgressIndicator()))
            else if (_error != null) _errorState()
            else if (_items.isEmpty) _emptyState()
            else ..._items.map((item) => Card(
              child: ListTile(
                onTap: () => _showDetails(item),
                title: Text(_title(item), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800)),
                subtitle: Padding(padding: const EdgeInsets.only(top: 5), child: Text(_subtitle(item), maxLines: 2, overflow: TextOverflow.ellipsis)),
                trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text(_status(item), style: TextStyle(color: _statusColor(_status(item)), fontWeight: FontWeight.w800, fontSize: 11)),
                  const SizedBox(height: 4),
                  const Icon(Icons.chevron_right),
                ]),
              ),
            )),
            const SizedBox(height: 88),
          ],
        ),
      ),
    );
  }

  Widget _summaryCard(String label, String value, IconData icon) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: Colors.black12)),
    child: Row(children: [Icon(icon, color: _green), const SizedBox(width: 10), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 11)), Text(value, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800))]))]),
  );

  Widget _emptyState() => Padding(
    padding: const EdgeInsets.all(36),
    child: Column(children: [
      Icon(Icons.inbox_outlined, size: 46, color: Colors.grey.shade500),
      const SizedBox(height: 10),
      const Text('No live records found', style: TextStyle(fontWeight: FontWeight.w800)),
      const SizedBox(height: 4),
      const Text('Try another search, change the current data, or refresh.', textAlign: TextAlign.center),
    ]),
  );

  Widget _errorState() => Padding(
    padding: const EdgeInsets.all(28),
    child: Column(children: [
      const Icon(Icons.error_outline, size: 42, color: Colors.red),
      const SizedBox(height: 10),
      Text(_error!, textAlign: TextAlign.center),
      const SizedBox(height: 12),
      OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Try again')),
    ]),
  );
}