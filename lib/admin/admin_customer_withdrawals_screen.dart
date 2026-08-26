import 'package:flutter/material.dart';

import 'admin_customer_withdrawals_api.dart';

class AdminCustomerWithdrawalsScreen extends StatefulWidget {
  const AdminCustomerWithdrawalsScreen({super.key});

  @override
  State<AdminCustomerWithdrawalsScreen> createState() =>
      _AdminCustomerWithdrawalsScreenState();
}

class _AdminCustomerWithdrawalsScreenState
    extends State<AdminCustomerWithdrawalsScreen> {
  final AdminCustomerWithdrawalsApi _api = AdminCustomerWithdrawalsApi();
  List<Map<String, dynamic>> _withdrawals = <Map<String, dynamic>>[];
  String _status = 'PENDING';
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final items = await _api.list(
        status: _status == 'ALL' ? '' : _status,
      );
      if (!mounted) return;
      setState(() {
        _withdrawals = items;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<String?> _ask({
    required String title,
    required String label,
    bool required = false,
  }) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 180,
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final value = controller.text.trim();
              if (required && value.isEmpty) {
                ScaffoldMessenger.of(dialogContext).showSnackBar(
                  SnackBar(content: Text('$label is required.')),
                );
                return;
              }
              Navigator.pop(dialogContext, value);
            },
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  Future<void> _approve(Map<String, dynamic> item) async {
    final payoutReference = await _ask(
      title: 'Approve withdrawal',
      label: 'Bank payout reference',
      required: true,
    );
    if (payoutReference == null || !mounted) return;

    await _runAction(() {
      return _api.approve(
        item['_id'].toString(),
        payoutReference: payoutReference,
      );
    });
  }

  Future<void> _reject(Map<String, dynamic> item) async {
    final reason = await _ask(
      title: 'Reject withdrawal',
      label: 'Reason for rejection',
      required: true,
    );
    if (reason == null || !mounted) return;

    await _runAction(() {
      return _api.reject(
        item['_id'].toString(),
        reason: reason,
      );
    });
  }

  Future<void> _runAction(
    Future<Map<String, dynamic>> Function() action,
  ) async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final response = await action();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            response['message']?.toString() ?? 'Withdrawal updated.',
          ),
        ),
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  String _money(dynamic value) {
    final amount = (value as num?)?.toDouble() ?? 0;
    return '₦${amount.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Customer Withdrawals'),
        actions: [
          IconButton(
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: DropdownButtonFormField<String>(
              value: _status,
              decoration: const InputDecoration(
                labelText: 'Queue status',
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(value: 'PENDING', child: Text('Pending')),
                DropdownMenuItem(value: 'APPROVED', child: Text('Approved')),
                DropdownMenuItem(value: 'REJECTED', child: Text('Rejected')),
                DropdownMenuItem(value: 'ALL', child: Text('All')),
              ],
              onChanged: _loading
                  ? null
                  : (value) {
                      if (value == null) return;
                      _status = value;
                      _load();
                    },
            ),
          ),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: MaterialBanner(
                content: Text(_error),
                actions: [
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            ),
          if (_loading) const LinearProgressIndicator(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _withdrawals.isEmpty && !_loading
                  ? ListView(
                      children: const [
                        SizedBox(height: 120),
                        Center(child: Text('No withdrawal requests found.')),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _withdrawals.length,
                      itemBuilder: (context, index) {
                        final item = _withdrawals[index];
                        final user = item['user'] is Map
                            ? Map<String, dynamic>.from(item['user'] as Map)
                            : <String, dynamic>{};
                        final status = item['status']?.toString() ?? 'PENDING';
                        final pending = status == 'PENDING';
                        return Card(
                          margin: const EdgeInsets.only(bottom: 12),
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${user['fullName'] ?? 'Customer'} • ${_money(item['amount'])}',
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  '${user['phone'] ?? '-'}\n'
                                  '${item['bankName'] ?? '-'} • '
                                  '${item['accountNumber'] ?? '-'}\n'
                                  '${item['accountName'] ?? '-'}\n'
                                  '${item['reference'] ?? '-'}',
                                ),
                                const SizedBox(height: 8),
                                Chip(label: Text(status)),
                                if (pending)
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [
                                      OutlinedButton(
                                        onPressed: _loading
                                            ? null
                                            : () => _reject(item),
                                        child: const Text('Reject'),
                                      ),
                                      const SizedBox(width: 8),
                                      FilledButton(
                                        onPressed: _loading
                                            ? null
                                            : () => _approve(item),
                                        child: const Text('Approve'),
                                      ),
                                    ],
                                  ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
