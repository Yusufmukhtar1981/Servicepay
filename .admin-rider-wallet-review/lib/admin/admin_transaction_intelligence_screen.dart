import 'dart:convert';

import 'package:flutter/material.dart';

import 'admin_transaction_intelligence_api.dart';
import 'admin_transaction_intelligence_models.dart';

class AdminTransactionIntelligenceScreen extends StatefulWidget {
  const AdminTransactionIntelligenceScreen({super.key});

  @override
  State<AdminTransactionIntelligenceScreen> createState() =>
      _AdminTransactionIntelligenceScreenState();
}

class _AdminTransactionIntelligenceScreenState
    extends State<AdminTransactionIntelligenceScreen> {
  final Map<String, TextEditingController> _fields =
      <String, TextEditingController>{
        'search': TextEditingController(),
        'service': TextEditingController(),
        'internal': TextEditingController(),
        'provider': TextEditingController(),
        'reconciliation': TextEditingController(),
        'min': TextEditingController(),
        'max': TextEditingController(),
        'from': TextEditingController(),
        'to': TextEditingController(),
      };
  TransactionFilters _filters = const TransactionFilters();
  TransactionIntelligenceSummary? _summary;
  TransactionSearchResult? _searchResult;
  ReconciliationQueue? _queue;
  List<ProviderHealth> _providers = <ProviderHealth>[];
  List<TransactionAlert> _alerts = <TransactionAlert>[];
  int _page = 1;
  bool _loading = true;
  bool _loadingMoreQueue = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadWorkspace();
  }

  @override
  void dispose() {
    for (final TextEditingController controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadWorkspace() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final TransactionIntelligenceSummary summary =
          await AdminTransactionIntelligenceApi.summary();
      final List<Future<dynamic>> requests = <Future<dynamic>>[
        AdminTransactionIntelligenceApi.transactions(_filters, page: _page),
        AdminTransactionIntelligenceApi.queue(_filters),
        AdminTransactionIntelligenceApi.alerts(),
      ];
      if (summary.capabilities.canViewProviderHealth) {
        requests.add(AdminTransactionIntelligenceApi.providers());
      }
      final List<dynamic> data = await Future.wait(requests);
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _searchResult = data[0] as TransactionSearchResult;
        _queue = data[1] as ReconciliationQueue;
        _alerts = data[2] as List<TransactionAlert>;
        _providers = data.length > 3
            ? data[3] as List<ProviderHealth>
            : <ProviderHealth>[];
      });
    } catch (error) {
      if (mounted) setState(() => _error = _clean(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  TransactionFilters _readFilters() => TransactionFilters(
    search: _fields['search']!.text,
    serviceType: _fields['service']!.text,
    internalStatus: _fields['internal']!.text,
    providerStatus: _fields['provider']!.text,
    reconciliationStatus: _fields['reconciliation']!.text,
    minAmount: _fields['min']!.text,
    maxAmount: _fields['max']!.text,
    from: _fields['from']!.text,
    to: _fields['to']!.text,
  );

  Future<void> _applyFilters() async {
    setState(() {
      _filters = _readFilters();
      _page = 1;
    });
    await _loadWorkspace();
  }

  Future<void> _goToPage(int page) async {
    if (page < 1 || _loading) return;
    setState(() => _page = page);
    await _loadWorkspace();
  }

  Future<void> _loadMoreQueue() async {
    final ReconciliationQueue? queue = _queue;
    if (_loadingMoreQueue || queue == null || !queue.hasMore) return;
    setState(() => _loadingMoreQueue = true);
    try {
      final ReconciliationQueue next =
          await AdminTransactionIntelligenceApi.queue(
            _filters,
            cursor: queue.nextCursor,
          );
      if (mounted) {
        setState(() {
          _queue = ReconciliationQueue(
            <IntelligenceTransaction>[
              ...queue.transactions,
              ...next.transactions,
            ],
            next.nextCursor,
            next.hasMore,
          );
        });
      }
    } catch (error) {
      _showMessage(_clean(error));
    } finally {
      if (mounted) setState(() => _loadingMoreQueue = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool dark = Theme.of(context).brightness == Brightness.dark;
    final Color canvas = dark
        ? const Color(0xFF0B2029)
        : const Color(0xFFF3F7F6);
    final Color ink = dark ? const Color(0xFFE3F0EC) : const Color(0xFF102D3A);
    return Scaffold(
      backgroundColor: canvas,
      appBar: AppBar(
        backgroundColor: dark
            ? const Color(0xFF102D3A)
            : const Color(0xFF102D3A),
        foregroundColor: Colors.white,
        title: const _TitleBlock(),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh intelligence',
            onPressed: _loading ? null : _loadWorkspace,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _error != null
          ? _FailureState(message: _error!, onRetry: _loadWorkspace)
          : _loading && _summary == null
          ? const _LoadingState()
          : RefreshIndicator(
              onRefresh: _loadWorkspace,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 36),
                children: <Widget>[
                  _workspaceHeading(ink),
                  const SizedBox(height: 16),
                  _metrics(dark),
                  const SizedBox(height: 18),
                  _filtersPanel(dark),
                  const SizedBox(height: 24),
                  _section(
                    'Reconciliation queue',
                    'Exceptions assembled from live evidence',
                  ),
                  _queueList(dark),
                  const SizedBox(height: 24),
                  _section(
                    'Transaction search',
                    '${_searchResult?.total ?? 'Bounded'} matching records',
                  ),
                  _searchList(dark),
                  _searchPagination(),
                  if (_alerts.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 24),
                    _section('Attention signals', 'Recent review indicators'),
                    ..._alerts.take(6).map(_alertTile),
                  ],
                  if (_providers.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 24),
                    _section(
                      'Provider observation',
                      'Observed outcomes over the trailing seven days',
                    ),
                    ..._providers.map(
                      (ProviderHealth health) => _providerTile(health, dark),
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _workspaceHeading(Color ink) => Row(
    children: <Widget>[
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              'OPERATIONS LEDGER',
              style: TextStyle(
                color: Color(0xFF007C78),
                fontWeight: FontWeight.w800,
                fontSize: 11,
                letterSpacing: 1.1,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Trace exceptions before they become incidents.',
              style: TextStyle(
                color: ink,
                fontSize: 19,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
      if (_summary?.capabilities.canExport == true)
        IconButton(
          onPressed: _export,
          tooltip: 'Export filtered CSV',
          icon: const Icon(
            Icons.file_download_outlined,
            color: Color(0xFF007C78),
          ),
        ),
    ],
  );

  Widget _metrics(bool dark) {
    final Map<String, dynamic> metrics =
        _summary?.metrics ?? <String, dynamic>{};
    final List<_Metric> data = <_Metric>[
      _Metric(
        'VALUE MOVED',
        _naira(metrics['value']),
        Icons.account_balance_outlined,
      ),
      _Metric(
        'SETTLED',
        '${metrics['successfulCount'] ?? 0}',
        Icons.check_circle_outline,
      ),
      _Metric(
        'IN REVIEW',
        '${metrics['reconciliationQueueCount'] ?? 0}',
        Icons.rule_folder_outlined,
      ),
    ];
    return LayoutBuilder(
      builder: (_, BoxConstraints constraints) => Wrap(
        spacing: 8,
        runSpacing: 8,
        children: data
            .map(
              (item) => SizedBox(
                width: constraints.maxWidth > 700
                    ? (constraints.maxWidth - 16) / 3
                    : constraints.maxWidth,
                child: _metricCard(item, dark),
              ),
            )
            .toList(),
      ),
    );
  }

  Widget _metricCard(_Metric metric, bool dark) => Container(
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: dark ? const Color(0xFF163946) : const Color(0xFF102D3A),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Row(
      children: <Widget>[
        Icon(metric.icon, color: const Color(0xFF73D3BF)),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              metric.label,
              style: const TextStyle(
                color: Color(0xFFAFC7C3),
                fontSize: 10,
                fontWeight: FontWeight.w800,
                letterSpacing: .7,
              ),
            ),
            Text(
              metric.value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _filtersPanel(bool dark) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: dark ? const Color(0xFF163039) : const Color(0xFFE8F0EE),
      border: Border.all(
        color: dark ? const Color(0xFF315560) : const Color(0xFFCFE0DC),
      ),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      children: <Widget>[
        TextField(
          controller: _fields['search'],
          onSubmitted: (_) => _applyFilters(),
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.search),
            hintText: 'Reference, provider, customer or amount',
          ),
        ),
        const SizedBox(height: 10),
        LayoutBuilder(
          builder: (_, BoxConstraints constraints) {
            final double width = constraints.maxWidth > 620
                ? (constraints.maxWidth - 16) / 3
                : constraints.maxWidth;
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                _field('service', 'Service type', width),
                _field('internal', 'Internal status', width),
                _field('provider', 'Provider status', width),
                _field('reconciliation', 'Reconciliation status', width),
                _field('from', 'From YYYY-MM-DD', width),
                _field('to', 'To YYYY-MM-DD', width),
                _field('min', 'Minimum amount', width, numeric: true),
                _field('max', 'Maximum amount', width, numeric: true),
              ],
            );
          },
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton.icon(
            onPressed: _loading ? null : _applyFilters,
            icon: const Icon(Icons.tune),
            label: const Text('Apply filters'),
          ),
        ),
      ],
    ),
  );

  Widget _field(
    String key,
    String label,
    double width, {
    bool numeric = false,
  }) => SizedBox(
    width: width,
    child: TextField(
      controller: _fields[key],
      keyboardType: numeric ? TextInputType.number : TextInputType.text,
      decoration: InputDecoration(labelText: label, isDense: true),
    ),
  );

  Widget _queueList(bool dark) {
    final List<IntelligenceTransaction> rows =
        _queue?.transactions ?? <IntelligenceTransaction>[];
    if (rows.isEmpty) {
      return const _EmptyState(
        title: 'No reconciliation exceptions',
        detail: 'The current filter set has no review-required records.',
      );
    }
    return Column(
      children: <Widget>[
        ...rows.map((item) => _transactionCard(item, dark)),
        if (_queue?.hasMore == true)
          TextButton.icon(
            onPressed: _loadingMoreQueue ? null : _loadMoreQueue,
            icon: _loadingMoreQueue
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.expand_more),
            label: const Text('Load more exceptions'),
          ),
      ],
    );
  }

  Widget _searchList(bool dark) {
    final List<IntelligenceTransaction> rows =
        _searchResult?.transactions ?? <IntelligenceTransaction>[];
    if (rows.isEmpty) {
      return const _EmptyState(
        title: 'No transactions found',
        detail: 'Adjust the search terms or clear a filter.',
      );
    }
    return Column(
      children: rows.map((item) => _transactionCard(item, dark)).toList(),
    );
  }

  Widget _transactionCard(IntelligenceTransaction item, bool dark) => Card(
    margin: const EdgeInsets.only(bottom: 8),
    child: InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => _openDetail(item),
      child: Padding(
        padding: const EdgeInsets.all(13),
        child: Row(
          children: <Widget>[
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: dark ? const Color(0xFF214A50) : const Color(0xFFE3F2EE),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.receipt_long_outlined,
                color: Color(0xFF007C78),
              ),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    item.reference,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  Text(
                    '${item.customer?['name'] ?? 'Customer'} · ${item.provider ?? 'No provider'}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12),
                  ),
                  const SizedBox(height: 5),
                  Wrap(
                    spacing: 5,
                    runSpacing: 4,
                    children: <Widget>[
                      _statusTag(item.internalStatus),
                      _statusTag(item.reconciliationStatus),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              _naira(item.amount),
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _statusTag(String value) {
    final bool clear = value == 'CLEAR' || value == 'SUCCESSFUL';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: clear ? const Color(0xFFDDF2E9) : const Color(0xFFFFEBC9),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(
        value.replaceAll('_', ' '),
        style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w800),
      ),
    );
  }

  Widget _searchPagination() => Padding(
    padding: const EdgeInsets.only(top: 4),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: <Widget>[
        Text(
          'Page $_page',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(width: 8),
        IconButton(
          tooltip: 'Previous page',
          onPressed: _page > 1 ? () => _goToPage(_page - 1) : null,
          icon: const Icon(Icons.chevron_left),
        ),
        IconButton(
          tooltip: 'Next page',
          onPressed: (_searchResult?.transactions.length ?? 0) >= 25
              ? () => _goToPage(_page + 1)
              : null,
          icon: const Icon(Icons.chevron_right),
        ),
      ],
    ),
  );

  Widget _section(String title, String helper) => Padding(
    padding: const EdgeInsets.only(bottom: 9),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
        Text(helper, style: const TextStyle(fontSize: 12)),
      ],
    ),
  );

  Widget _alertTile(TransactionAlert alert) => Card(
    margin: const EdgeInsets.only(bottom: 8),
    child: ListTile(
      leading: const Icon(
        Icons.warning_amber_rounded,
        color: Color(0xFFC77C18),
      ),
      title: Text(
        alert.title,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: Text(alert.detail),
    ),
  );

  Widget _providerTile(ProviderHealth health, bool dark) => Card(
    margin: const EdgeInsets.only(bottom: 8),
    child: ListTile(
      leading: const Icon(Icons.hub_outlined, color: Color(0xFF007C78)),
      title: Text(
        health.provider,
        style: const TextStyle(fontWeight: FontWeight.w800),
      ),
      subtitle: Text('${health.sampleSize} transactions sampled'),
      trailing: Text(
        '${(health.successRate ?? 0).toStringAsFixed(1)}%',
        style: TextStyle(
          color: dark ? const Color(0xFF8DE0CD) : const Color(0xFF007C78),
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
  );

  Future<void> _openDetail(IntelligenceTransaction transaction) async {
    try {
      final List<dynamic> result = await Future.wait(<Future<dynamic>>[
        AdminTransactionIntelligenceApi.detail(transaction.id),
        AdminTransactionIntelligenceApi.timeline(transaction.id),
      ]);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (BuildContext sheetContext) => _DetailSheet(
          transaction: transaction,
          detail: result[0] as TransactionDetail,
          timeline: result[1] as List<TimelineEvent>,
          onRequery: () => _confirmRequery(transaction, sheetContext),
        ),
      );
    } catch (error) {
      _showMessage(_clean(error));
    }
  }

  Future<void> _confirmRequery(
    IntelligenceTransaction transaction,
    BuildContext sheetContext,
  ) async {
    final bool? approved = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Confirm provider requery'),
        content: Text(
          'Request a fresh provider status for ${transaction.reference}. This audited request is protected with an idempotency key.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirm requery'),
          ),
        ],
      ),
    );
    if (approved != true) return;
    try {
      await AdminTransactionIntelligenceApi.requery(transaction.id);
      if (!mounted || !sheetContext.mounted) return;
      Navigator.pop(sheetContext);
      _showMessage('Provider requery submitted.');
      await _loadWorkspace();
    } catch (error) {
      _showMessage(_clean(error));
    }
  }

  Future<void> _export() async {
    try {
      await AdminTransactionIntelligenceApi.exportCsv(_filters);
      _showMessage('CSV export started.');
    } catch (error) {
      _showMessage(_clean(error));
    }
  }

  void _showMessage(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }
}

class _TitleBlock extends StatelessWidget {
  const _TitleBlock();
  @override
  Widget build(BuildContext context) => const Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Text(
        'Transaction Intelligence',
        style: TextStyle(fontWeight: FontWeight.w800),
      ),
      Text(
        'LIVE MONEY MOVEMENT · LAGOS TIME',
        style: TextStyle(fontSize: 10, letterSpacing: 1.1),
      ),
    ],
  );
}

class _DetailSheet extends StatelessWidget {
  const _DetailSheet({
    required this.transaction,
    required this.detail,
    required this.timeline,
    required this.onRequery,
  });
  final IntelligenceTransaction transaction;
  final TransactionDetail detail;
  final List<TimelineEvent> timeline;
  final VoidCallback onRequery;
  @override
  Widget build(BuildContext context) => DraggableScrollableSheet(
    expand: false,
    initialChildSize: .78,
    builder: (_, ScrollController controller) => ListView(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
      children: <Widget>[
        Text(
          transaction.reference,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 5),
        const Text(
          'Sanitized provider evidence · display only',
          style: TextStyle(fontSize: 12),
        ),
        const Divider(height: 28),
        ...detail.transaction.entries.map(
          (entry) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  entry.key
                      .replaceAll(RegExp(r'([A-Z])'), ' \$1')
                      .toUpperCase(),
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                SelectableText(
                  entry.value is Map || entry.value is List
                      ? const JsonEncoder.withIndent('  ').convert(entry.value)
                      : '${entry.value ?? '—'}',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Audit timeline',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        if (timeline.isEmpty) const Text('No timeline events were returned.'),
        ...timeline.map(
          (event) => ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(
              Icons.circle,
              size: 10,
              color: Color(0xFF007C78),
            ),
            title: Text(event.label),
            subtitle: Text('${event.type} · ${event.at}'),
          ),
        ),
        if (detail.capabilities.canRequery &&
            transaction.safeAction == 'REQUERY')
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: FilledButton.icon(
              onPressed: onRequery,
              icon: const Icon(Icons.sync),
              label: const Text('Requery provider status'),
            ),
          ),
      ],
    ),
  );
}

class _Metric {
  const _Metric(this.label, this.value, this.icon);
  final String label, value;
  final IconData icon;
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();
  @override
  Widget build(BuildContext context) => const Center(
    child: SizedBox(width: 32, height: 32, child: CircularProgressIndicator()),
  );
}

class _FailureState extends StatelessWidget {
  const _FailureState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: _EmptyState(
      title: 'Intelligence temporarily unavailable',
      detail: message,
      action: onRetry,
    ),
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, required this.detail, this.action});
  final String title, detail;
  final VoidCallback? action;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(26),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        const Icon(
          Icons.manage_search_outlined,
          color: Color(0xFF007C78),
          size: 34,
        ),
        const SizedBox(height: 8),
        Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(detail, textAlign: TextAlign.center),
        if (action != null)
          TextButton(onPressed: action, child: const Text('Retry')),
      ],
    ),
  );
}

String _naira(dynamic value) =>
    '₦${(value is num ? value : num.tryParse('$value') ?? 0).toStringAsFixed(2)}';
String _clean(Object error) => error.toString().replaceFirst('Exception: ', '');
