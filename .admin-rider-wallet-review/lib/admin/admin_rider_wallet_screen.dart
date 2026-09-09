import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminRiderWalletScreen extends StatefulWidget {
  const AdminRiderWalletScreen({super.key});

  @override
  State<AdminRiderWalletScreen> createState() => _AdminRiderWalletScreenState();
}

class _AdminRiderWalletScreenState extends State<AdminRiderWalletScreen> {
  static const String _baseUrl = 'https://api.servicepay.ng/api';
  static const Color _green = Color(0xFF0F766E);
  final TextEditingController _search = TextEditingController();
  List<Map<String, dynamic>> _results = <Map<String, dynamic>>[];
  Map<String, dynamic>? _rider;
  Map<String, dynamic> _metrics = <String, dynamic>{};
  List<Map<String, dynamic>> _ledger = <Map<String, dynamic>>[];
  bool _searching = false;
  bool _loadingRider = false;
  bool _adjusting = false;
  String _error = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  String _text(dynamic value, [String fallback = '']) {
    final String result = value?.toString().trim() ?? '';
    return result.isEmpty ? fallback : result;
  }

  double _number(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

  String _money(dynamic value) => '₦${_number(value).toStringAsFixed(2)}';

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value
          .whereType<Map>()
          .map((Map item) => Map<String, dynamic>.from(item))
          .toList()
      : <Map<String, dynamic>>[];

  Future<String> _token() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    for (final String key in const <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      String token = prefs.getString(key)?.trim() ?? '';
      if (token.toLowerCase().startsWith('bearer ')) {
        token = token.substring(7).trim();
      }
      if (token.isNotEmpty) return token;
    }
    return '';
  }

  Map<String, String> _headers(String token) => <String, String>{
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      };

  Map<String, dynamic> _decode(http.Response response) {
    if (response.body.trim().isEmpty) return <String, dynamic>{};
    return _map(jsonDecode(response.body));
  }

  void _message(String message, {bool error = true}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? Colors.red.shade700 : _green,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Future<void> _searchRiders() async {
    final String query = _search.text.trim();
    if (query.isEmpty) {
      _message('Enter a rider name, phone, email or Rider ID.');
      return;
    }
    setState(() {
      _searching = true;
      _error = '';
    });
    try {
      final String token = await _token();
      if (token.isEmpty) throw Exception('Admin login token was not found.');
      final http.Response response = await http
          .get(
            Uri.parse('$_baseUrl/admin/riders').replace(
              queryParameters: <String, String>{'search': query, 'limit': '50'},
            ),
            headers: _headers(token),
          )
          .timeout(const Duration(seconds: 30));
      final Map<String, dynamic> root = _decode(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(_text(root['message'], 'Unable to search riders.'));
      }
      if (!mounted) return;
      setState(() {
        _results = _list(
          root['riders'] ?? _map(root['data'])['riders'] ?? root['data'],
        );
      });
    } on TimeoutException {
      _error = 'The server took too long to respond.';
    } on FormatException {
      _error = 'The server returned an invalid response.';
    } catch (error) {
      _error = error.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _loadRider(Map<String, dynamic> rider) async {
    final String id = _text(rider['_id'] ?? rider['id']);
    if (id.isEmpty) return _message('Rider ID is missing.');
    setState(() {
      _rider = rider;
      _loadingRider = true;
      _error = '';
    });
    try {
      final String token = await _token();
      if (token.isEmpty) throw Exception('Admin login token was not found.');
      final http.Response response = await http
          .get(
            Uri.parse('$_baseUrl/admin/riders/$id'),
            headers: _headers(token),
          )
          .timeout(const Duration(seconds: 30));
      final Map<String, dynamic> root = _decode(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(_text(root['message'], 'Unable to load rider wallet.'));
      }
      final Map<String, dynamic> details = _map(root['rider']);
      if (!mounted) return;
      setState(() {
        _rider = details.isEmpty ? rider : details;
        _metrics = _map(details['walletMetrics'] ?? root['walletMetrics']);
        _ledger = _list(
          details['lastTransactions'] ?? root['lastTransactions'],
        );
      });
    } on TimeoutException {
      _error = 'The server took too long to respond.';
    } on FormatException {
      _error = 'The server returned an invalid response.';
    } catch (error) {
      _error = error.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => _loadingRider = false);
    }
  }

  Future<void> _adjust(String action) async {
    if (_adjusting || _rider == null) return;
    final String id = _text(_rider!['_id'] ?? _rider!['id']);
    final TextEditingController amount = TextEditingController();
    final TextEditingController reason = TextEditingController();
    final TextEditingController note = TextEditingController();
    final Map<String, String>? input = await showDialog<Map<String, String>>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text('$action Rider Wallet'),
        content: SizedBox(
          width: 430,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
              TextField(
                key: const Key('rider-wallet-adjustment-amount'),
                controller: amount,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'Amount',
                  prefixText: '₦ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: reason,
                decoration: const InputDecoration(
                  labelText: 'Reason',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: note,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Admin note / reference',
                  border: OutlineInputBorder(),
                ),
              ),
            ]),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, <String, String>{
              'amount': amount.text.trim(),
              'reason': reason.text.trim(),
              'note': note.text.trim(),
            }),
            child: Text('$action Wallet'),
          ),
        ],
      ),
    );
    amount.dispose();
    reason.dispose();
    note.dispose();
    if (input == null) return;
    final double value = double.tryParse(input['amount'] ?? '') ?? 0;
    if (value <= 0) return _message('Enter an amount greater than zero.');
    if ((input['reason'] ?? '').isEmpty) {
      return _message('A reason is required for the audit trail.');
    }
    if (action == 'DEBIT' &&
        value > _number(_metrics['availableBalance'] ?? _metrics['balance'])) {
      return _message('Debit cannot exceed the rider available balance.');
    }
    if (!mounted) return;
    final bool confirmed = await showDialog<bool>(
          context: context,
          builder: (BuildContext context) => AlertDialog(
            title: Text('Confirm ${action.toLowerCase()}'),
            content: Text(
              '$action ${_money(value)}. This creates an immutable wallet ledger entry.',
            ),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Confirm'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed) return;
    setState(() => _adjusting = true);
    try {
      final String token = await _token();
      if (token.isEmpty) throw Exception('Admin login token was not found.');
      final http.Response response = await http
          .patch(
            Uri.parse('$_baseUrl/admin/riders/$id/wallet'),
            headers: _headers(token),
            body: jsonEncode(<String, dynamic>{
              'action': action,
              'amount': value,
              'reason': input['reason'],
              'note': input['note'],
            }),
          )
          .timeout(const Duration(seconds: 35));
      final Map<String, dynamic> root = _decode(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(_text(root['message'], 'Wallet adjustment failed.'));
      }
      _message(
        action == 'CREDIT'
            ? 'Rider wallet credited successfully.'
            : 'Rider wallet debited successfully.',
        error: false,
      );
      await _loadRider(_rider!);
    } catch (error) {
      _message(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _adjusting = false);
    }
  }

  Widget _metric(String label, dynamic value, IconData icon, Color color) {
    return Container(
      width: 158,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, color: color),
          const SizedBox(height: 8),
          Text(
            _money(value),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          Text(
            label,
            style: const TextStyle(fontSize: 11, color: Colors.black54),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('Rider Wallet Management'),
        backgroundColor: Colors.white,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          const Text(
            'Search riders, review wallet metrics and make audited adjustments.',
            style: TextStyle(color: Colors.black54),
          ),
          const SizedBox(height: 14),
          Row(children: <Widget>[
            Expanded(
              child: TextField(
                key: const Key('rider-wallet-search'),
                controller: _search,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _searchRiders(),
                decoration: const InputDecoration(
                  hintText: 'Name, phone, email or Rider ID',
                  prefixIcon: Icon(Icons.search_rounded),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 10),
            FilledButton(
              onPressed: _searching ? null : _searchRiders,
              child: _searching
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Search'),
            ),
          ]),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(_error, style: const TextStyle(color: Colors.red)),
            ),
          ..._results.map(
            (Map<String, dynamic> rider) => Card(
              child: ListTile(
                title: Text(_text(rider['fullName'], 'Delivery Rider')),
                subtitle: Text(
                  '${_text(rider['riderId'], 'No Rider ID')} • ${_text(rider['phone'], 'No phone')}',
                ),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => _loadRider(rider),
              ),
            ),
          ),
          if (_rider != null) ...<Widget>[
            const SizedBox(height: 18),
            Text(
              _text(_rider!['fullName'], 'Delivery Rider'),
              style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold),
            ),
            Text(
              '${_text(_rider!['riderId'], 'No Rider ID')} • ${_text(_rider!['phone'], 'No phone')} • ${_text(_rider!['status'], 'UNKNOWN')}',
            ),
            const SizedBox(height: 12),
            if (_loadingRider)
              const Center(child: CircularProgressIndicator())
            else ...<Widget>[
              Wrap(spacing: 10, runSpacing: 10, children: <Widget>[
                _metric('Total earned', _metrics['totalEarned'],
                    Icons.trending_up_rounded, _green),
                _metric('Available balance', _metrics['availableBalance'],
                    Icons.account_balance_wallet_rounded, Colors.blue),
                _metric('Pending withdrawal', _metrics['pendingWithdrawal'],
                    Icons.hourglass_top_rounded, Colors.orange),
                _metric('Total withdrawn', _metrics['totalWithdrawn'],
                    Icons.payments_rounded, Colors.deepPurple),
                _metric('Total credits', _metrics['totalCredits'],
                    Icons.add_circle_outline, Colors.green),
                _metric('Total debits', _metrics['totalDebits'],
                    Icons.remove_circle_outline, Colors.red),
              ]),
              const SizedBox(height: 14),
              Wrap(spacing: 10, children: <Widget>[
                FilledButton.icon(
                  key: const Key('credit-rider-wallet'),
                  onPressed: _adjusting ? null : () => _adjust('CREDIT'),
                  icon: const Icon(Icons.add_circle_outline),
                  label: const Text('Credit Rider Wallet'),
                ),
                OutlinedButton.icon(
                  key: const Key('debit-rider-wallet'),
                  onPressed: _adjusting ? null : () => _adjust('DEBIT'),
                  icon: const Icon(Icons.remove_circle_outline),
                  label: const Text('Debit Rider Wallet'),
                ),
              ]),
              const SizedBox(height: 20),
              const Text(
                'Recent wallet ledger',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
              ),
              if (_ledger.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('No recent wallet ledger entries found.'),
                  ),
                )
              else
                ..._ledger.take(10).map(
                      (Map<String, dynamic> entry) => Card(
                        child: ListTile(
                          title: Text(
                            _text(
                              entry['reason'] ??
                                  entry['narration'] ??
                                  entry['type'],
                              'Wallet transaction',
                            ),
                          ),
                          subtitle: Text(
                            _text(entry['reference'], 'No reference'),
                          ),
                          trailing: Text(
                            _money(entry['amount']),
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ),
                    ),
            ],
          ],
        ],
      ),
    );
  }
}
