import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminBankReconciliationScreen extends StatefulWidget {
  const AdminBankReconciliationScreen({super.key});

  @override
  State<AdminBankReconciliationScreen> createState() =>
      _AdminBankReconciliationScreenState();
}

class _AdminBankReconciliationScreenState
    extends State<AdminBankReconciliationScreen> {
  static const _baseUrl = 'https://api.servicepay.ng/api';
  final _search = TextEditingController();
  final _from = TextEditingController();
  final _to = TextEditingController();
  List<Map<String, dynamic>> _records = [];
  String _status = 'ALL';
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    _from.dispose();
    _to.dispose();
    super.dispose();
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('auth_token') ?? prefs.getString('token') ?? '';
    return raw.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '').trim();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final token = await _token();
      final query = <String, String>{
        'status': _status,
        if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
        if (_from.text.trim().isNotEmpty) 'from': _from.text.trim(),
        if (_to.text.trim().isNotEmpty) 'to': _to.text.trim(),
      };
      final response = await http.get(
        Uri.parse('$_baseUrl/admin/bank-reconciliation').replace(queryParameters: query),
        headers: {'Accept': 'application/json', 'Authorization': 'Bearer $token'},
      );
      final decoded = jsonDecode(response.body) as Map;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(decoded['message'] ?? 'Unable to load bank reconciliation.');
      }
      if (!mounted) return;
      setState(() {
        _records = (decoded['records'] as List? ?? const [])
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList();
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _text(dynamic value, [String fallback = '—']) {
    final result = value?.toString().trim() ?? '';
    return result.isEmpty ? fallback : result;
  }

  String _money(dynamic value) {
    final amount = value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
    return '₦${amount.toStringAsFixed(2)}';
  }

  Color _color(Map<String, dynamic> record) {
    switch (_text(record['status'])) {
      case 'SUCCESSFUL': return Colors.green;
      case 'REFUNDED': return Colors.blue;
      case 'FAILED': return Colors.red;
      default: return Colors.orange;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        title: const Text('Bank Reconciliation'),
        actions: [IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('Reconcile live bank-transfer records. This screen never fabricates bank confirmation or changes a wallet balance.', style: TextStyle(height: 1.4)),
            const SizedBox(height: 16),
            TextField(controller: _search, onSubmitted: (_) => _load(), decoration: const InputDecoration(labelText: 'Reference, provider reference, account or recipient', prefixIcon: Icon(Icons.search), border: OutlineInputBorder())),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: _from, decoration: const InputDecoration(labelText: 'From (YYYY-MM-DD)', border: OutlineInputBorder()))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: _to, decoration: const InputDecoration(labelText: 'To (YYYY-MM-DD)', border: OutlineInputBorder()))),
            ]),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              value: _status,
              decoration: const InputDecoration(labelText: 'Status', border: OutlineInputBorder()),
              items: const ['ALL', 'PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REFUNDED'].map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(),
              onChanged: (value) => setState(() => _status = value ?? 'ALL'),
            ),
            const SizedBox(height: 10),
            FilledButton.icon(onPressed: _loading ? null : _load, icon: const Icon(Icons.filter_alt_outlined), label: const Text('Apply filters')),
            const SizedBox(height: 16),
            if (_loading) const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
            else if (_error != null) Card(child: Padding(padding: const EdgeInsets.all(18), child: Text(_error!, style: const TextStyle(color: Colors.red))))
            else if (_records.isEmpty) const Padding(padding: EdgeInsets.all(40), child: Center(child: Text('No bank-transfer records match these filters.')))
            else ..._records.map((record) => Card(
              child: ListTile(
                title: Text('${_text(record['reference'])} · ${_money(record['amount'])}', style: const TextStyle(fontWeight: FontWeight.w800)),
                subtitle: Text('${_text(record['bankName'])} · ${_text(record['accountName'])}\nProvider: ${_text(record['provider'])} · ${_text(record['providerReference'], 'No provider reference')}\nCreated: ${_text(record['createdAt'])}'),
                isThreeLine: true,
                trailing: Chip(label: Text(_text(record['status'])), backgroundColor: _color(record).withValues(alpha: .12)),
                onTap: () => showDialog<void>(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text('Reconciliation record'),
                    content: SelectableText(const JsonEncoder.withIndent('  ').convert(record)),
                    actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
                  ),
                ),
              ),
            )),
          ],
        ),
      ),
    );
  }
}