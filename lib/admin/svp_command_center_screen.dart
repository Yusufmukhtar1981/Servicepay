import 'package:flutter/material.dart';

import 'svp_api_service.dart';
import 'svp_audit_screen.dart';
import 'svp_reports_screen.dart';

class SvpContract {
  static List<Map<String, dynamic>> transactionMetrics(
      Map<String, dynamic> data) {
    final rows = data['transactions'];
    return rows is List
        ? rows
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList()
        : const [];
  }

  static Map<String, dynamic> entities(Map<String, dynamic> data) {
    final value = data['entities'];
    return value is Map ? Map<String, dynamic>.from(value) : const {};
  }

  static String unavailableReason(dynamic value) =>
      value is Map && value['reason'] != null
          ? value['reason'].toString()
          : 'Unavailable in this scope.';

  static String operationValue(String label, dynamic value) {
    if (value is! Map) {
      return '$label · Unavailable in this scope.';
    }
    final item = Map<String, dynamic>.from(value);
    return item['available'] == true
        ? '$label · ${item['value'] ?? 0}'
        : '$label · ${unavailableReason(item)}';
  }

  static List<String> liveOperationLabels(Map<String, dynamic> data) {
    final transactions = data['transactions'] is Map
        ? Map<String, dynamic>.from(data['transactions'] as Map)
        : const <String, dynamic>{};
    return <String>[
      operationValue('Pending transactions', transactions['pending']),
      operationValue('Failed transactions', transactions['failed']),
      for (final entry in const <String, String>{
        'users': 'Users',
        'branches': 'Branches',
        'deliveries': 'Deliveries',
        'withdrawals': 'Withdrawals',
        'kyc': 'KYC',
        'pendingRiders': 'Pending riders',
        'unassignedDeliveries': 'Unassigned deliveries',
        'pendingEmpowerment': 'Empowerment',
        'branchIssues': 'Branch issues',
        'staffIssues': 'Staff issues',
        'solar': 'Solar',
        'financing': 'Phone financing',
        'marketplace': 'Marketplace',
      }.entries)
        operationValue(entry.value, data[entry.key]),
    ];
  }

  static String performanceTargetLabel(Map<dynamic, dynamic> row) {
    final raw = row['target'];
    if (raw is! Map) return 'Target — · Achievement —';
    final target = Map<String, dynamic>.from(raw);
    if (target['available'] != true) {
      return 'Target ${unavailableReason(target)}';
    }
    final achievement = target['achievement'];
    final achievementText = achievement is num
        ? '${(achievement * 100).toStringAsFixed(1)}%'
        : '—';
    return 'Target ${target['target'] ?? '—'} · Achievement $achievementText';
  }
}

class SvpCommandCenterScreen extends StatefulWidget {
  const SvpCommandCenterScreen({super.key});
  @override
  State<SvpCommandCenterScreen> createState() => _SvpCommandCenterScreenState();
}

class _SvpCommandCenterScreenState extends State<SvpCommandCenterScreen> {
  final api = SvpApiService();
  Map<String, dynamic>? metrics;
  Map<String, dynamic>? operations;
  List<dynamic> transactions = const [];
  List<dynamic> staffPerformance = const [];
  List<dynamic> branchPerformance = const [];
  final Map<String, String> transactionFilters = {};
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() {
      loading = true;
      error = null;
    });
    await Future.wait([
      _loadModule('/svp/me/metrics', (d) => metrics = d),
      _loadModule('/svp/me/live-operations', (d) => operations = d),
      _loadModule('/svp/me/transactions',
          (d) => transactions = (d['items'] as List?) ?? const []),
      _loadModule(
          '/svp/me/staff-performance', (d) => staffPerformance = _rows(d)),
      _loadModule(
          '/svp/me/branch-performance', (d) => branchPerformance = _rows(d)),
    ]);
    if (mounted) setState(() => loading = false);
  }

  List<dynamic> _rows(dynamic data) => data is List ? data : const [];

  Future<void> _loadModule(String path, void Function(dynamic) assign) async {
    try {
      final result = await api.request('GET', path,
          query: path.endsWith('transactions')
              ? {'page': '1', 'limit': '12', ...transactionFilters}
              : null);
      assign(result['data']);
    } catch (_) {
      // A 403 only makes this permitted module unavailable.
    }
  }

  @override
  Widget build(BuildContext context) {
    final teal = const Color(0xFF075E54);
    return Scaffold(
      backgroundColor: const Color(0xFFF3F7F5),
      appBar: AppBar(
        backgroundColor: teal,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('SVP Command Center',
            style: TextStyle(fontWeight: FontWeight.w800)),
        actions: [
          IconButton(
              onPressed: refresh,
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh'),
          PopupMenuButton<String>(
            onSelected: (value) {
              if (value == 'reports') {
                Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => const SvpReportsScreen()));
              }
              if (value == 'audit') {
                Navigator.push(context,
                    MaterialPageRoute(builder: (_) => const SvpAuditScreen()));
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'reports', child: Text('My reports')),
              PopupMenuItem(value: 'audit', child: Text('My audit')),
            ],
          ),
        ],
      ),
      body: loading
          ? const _SvpSkeleton()
          : error != null
              ? _ErrorState(message: error!, onRetry: refresh)
              : RefreshIndicator(
                  onRefresh: refresh,
                  child: ListView(padding: const EdgeInsets.all(16), children: [
                    const Text('EXECUTIVE VIEW',
                        style: TextStyle(
                            letterSpacing: 1.4,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: Color(0xFF71827D))),
                    const SizedBox(height: 10),
                    _metricGrid(metrics ?? const {}),
                    const SizedBox(height: 20),
                    _filters(),
                    _sectionTitle(
                        'Staff performance', 'Read-only activity by staff'),
                    _performance(staffPerformance,
                        'Staff performance unavailable for this account.'),
                    const SizedBox(height: 16),
                    _sectionTitle(
                        'Branch performance', 'Read-only activity by branch'),
                    _performance(branchPerformance,
                        'Branch performance unavailable for this account.'),
                    const SizedBox(height: 20),
                    _sectionTitle('Live operations', 'Current scope signals'),
                    _operations(operations ?? const {}),
                    const SizedBox(height: 20),
                    _sectionTitle('Transaction intelligence',
                        'Latest activity in your scope'),
                    if (transactions.isEmpty)
                      const _EmptyState(label: 'No transactions in this scope')
                    else
                      ...transactions.map((tx) => _transactionTile(tx as Map)),
                    const SizedBox(height: 16),
                    Row(children: [
                      Expanded(
                          child: OutlinedButton.icon(
                              onPressed: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                      builder: (_) =>
                                          const SvpReportsScreen())),
                              icon: const Icon(Icons.description_outlined),
                              label: const Text('Reports'))),
                      const SizedBox(width: 10),
                      Expanded(
                          child: OutlinedButton.icon(
                              onPressed: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                      builder: (_) => const SvpAuditScreen())),
                              icon: const Icon(Icons.history),
                              label: const Text('Audit trail'))),
                    ]),
                  ]),
                ),
    );
  }

  Widget _metricGrid(Map<String, dynamic> data) {
    final tx = SvpContract.transactionMetrics(data);
    final entities = SvpContract.entities(data);
    return Wrap(spacing: 10, runSpacing: 10, children: [
      for (final row in tx)
        SizedBox(
            width: 154,
            child: _metric('${row['status'] ?? 'Transactions'} volume',
                '${row['volume'] ?? 0}', Icons.receipt_long_outlined)),
      for (final key in const ['value', 'revenue', 'commissions'])
        if (tx.isNotEmpty)
          SizedBox(
              width: 154,
              child: _metric(
                  'Transaction $key',
                  '${tx.fold<num>(0, (sum, row) => sum + ((row[key] as num?) ?? 0))}',
                  Icons.insights_outlined)),
      for (final entry in entities.entries)
        SizedBox(width: 154, child: _entityMetric(entry.key, entry.value)),
    ]);
  }

  Widget _metric(String label, String value, IconData icon) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFDCE7E2))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: const Color(0xFF087E6A)),
          const SizedBox(height: 12),
          Text(value,
              style:
                  const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          Text(label,
              style: const TextStyle(fontSize: 12, color: Color(0xFF71827D)))
        ]),
      );
  Widget _entityMetric(String name, dynamic raw) {
    final entity = raw is Map ? Map<String, dynamic>.from(raw) : const {};
    final available = entity['available'] == true;
    return _metric(
        name,
        available
            ? '${entity['value'] ?? 0}'
            : SvpContract.unavailableReason(entity),
        available ? Icons.account_tree_outlined : Icons.lock_outline);
  }

  Widget _sectionTitle(String title, String subtitle) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        Text(subtitle, style: const TextStyle(color: Color(0xFF71827D)))
      ]);
  Widget _filters() => Wrap(spacing: 8, runSpacing: 8, children: [
        for (final key in const [
          'from',
          'to',
          'status',
          'serviceType',
          'branch',
          'staff',
          'rider',
          'customer',
          'reference'
        ])
          SizedBox(
              width: 145,
              child: TextField(
                  decoration: InputDecoration(labelText: key, isDense: true),
                  onChanged: (value) {
                    if (value.isEmpty) {
                      transactionFilters.remove(key);
                    } else {
                      transactionFilters[key] = value;
                    }
                    refresh();
                  }))
      ]);
  Widget _performance(List<dynamic> rows, String empty) => rows.isEmpty
      ? _EmptyState(label: empty)
      : Column(
          children: rows
              .take(8)
              .map((x) => Card(
                  elevation: 0,
                  child: ListTile(
                      title: Text(
                          '${x['fullName'] ?? x['name'] ?? x['code'] ?? 'Scoped record'}'),
                      subtitle: Text(
                          'Rank ${x['rank'] ?? '—'} · ${SvpContract.performanceTargetLabel(x as Map)}\n'
                          'Volume ${x['volume'] ?? '—'} · Value ${x['value'] ?? '—'} · Revenue ${x['revenue'] ?? '—'}\n'
                          'Activity ${x['lastActivity'] ?? '—'} · Pending ${x['pending'] ?? '—'}'),
                      isThreeLine: true)))
              .toList());
  Widget _operations(Map<String, dynamic> d) => Wrap(
      spacing: 10,
      runSpacing: 10,
      children: SvpContract.liveOperationLabels(d)
          .map((label) =>
              Chip(label: Text(label), backgroundColor: Colors.white))
          .toList());
  Widget _transactionTile(Map tx) => Card(
      elevation: 0,
      margin: const EdgeInsets.only(top: 8),
      child: ListTile(
          dense: true,
          title: Text('${tx['reference'] ?? 'Unreferenced transaction'}',
              style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle:
              Text('${tx['serviceType'] ?? '—'} · ${tx['provider'] ?? '—'}'),
          trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${tx['amount'] ?? '—'}',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                Text('${tx['status'] ?? '—'}',
                    style: const TextStyle(fontSize: 11))
              ])));
}

class _SvpSkeleton extends StatelessWidget {
  const _SvpSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
      padding: const EdgeInsets.all(16),
      children: List.generate(
          8,
          (_) => Container(
              height: 56,
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12)))));
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.label});
  final String label;
  @override
  Widget build(BuildContext c) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Center(
          child:
              Text(label, style: const TextStyle(color: Color(0xFF71827D)))));
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext c) => Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: onRetry, child: const Text('Retry'))
      ]));
}
