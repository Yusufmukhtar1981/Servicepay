import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'services/session_store.dart';

String zonalPromotionIdempotencyKey(
  String accountId, {
  String targetRole = 'STATE_MANAGER',
}) => 'zonal-promotion-${accountId.trim()}-${targetRole.trim().toUpperCase()}';

int zonalOverviewCount(Map<String, dynamic> response, String key) {
  final raw = response['counts'] ?? response['overview'] ?? response;
  final value = raw is Map ? raw[key] : null;
  return value is num ? value.toInt() : int.tryParse('$value') ?? 0;
}

/// Zonal Manager's scoped management workspace. This deliberately uses the
/// zonal API rather than the legacy role endpoints.
class ZonalManagementScreen extends StatefulWidget {
  final String? initialSection;
  final http.Client client;

  ZonalManagementScreen({
    super.key,
    this.initialSection,
    http.Client? client,
  }) : client = client ?? _DefaultHttpClient();

  @override
  State<ZonalManagementScreen> createState() => _ZonalManagementScreenState();
}

class _ZonalManagementScreenState extends State<ZonalManagementScreen> {
  static const _baseUrl = 'https://api.servicepay.ng/api/management/zonal';
  static const _green = Color(0xFF08783E);
  static const _sections = <String, String>{
    'state-managers': 'State Managers',
    'aggregators': 'Aggregators',
    'customers': 'Customers',
    'delivery': 'Delivery',
    'edupay': 'EduPay',
    'empowerment': 'Empowerment',
    'organizations': 'Organizations',
  };

  String section = 'state-managers';
  String search = '';
  String state = '';
  String stateManagerId = '';
  int page = 1;
  bool loading = true;
  String error = '';
  List<Map<String, dynamic>> items = [];
  int total = 0;
  Map<String, dynamic> overview = {};
  http.Client get client => widget.client;

  @override
  void initState() {
    super.initState();
    section = _sections.containsKey(widget.initialSection)
        ? widget.initialSection!
        : section;
    loadOverview();
    loadItems();
  }

  Future<Map<String, dynamic>> request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    final token = await SessionStore.readToken();
    if (token == null || token.trim().isEmpty) {
      throw Exception('Session expired. Please log in again.');
    }
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
    };
    final uri = Uri.parse('$_baseUrl$path');
    final response = method == 'POST'
        ? await client.post(uri, headers: headers, body: jsonEncode(body))
        : await client.get(uri, headers: headers);
    Map<String, dynamic> data = {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) data = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode == 401) {
      throw Exception('Session expired. Please log in again.');
    }
    if (response.statusCode == 403) {
      throw Exception('You do not have permission to access this zonal data.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(data['message']?.toString() ?? 'Unable to load zonal data.');
    }
    return data;
  }

  Future<void> loadOverview() async {
    try {
      final data = await request('/overview');
      // zonalOversight.getOverview currently returns the counts at the
      // response root. Keep accepting an envelope for backwards-compatible
      // rollouts, but never manufacture fallback values.
      final rawOverview = <String, dynamic>{
        ...data,
        ..._map(data['counts'] ?? data['overview']),
      };
      if (mounted) setState(() => overview = rawOverview);
    } catch (e) {
      if (mounted && error.isEmpty) setState(() => error = _message(e));
    }
  }

  Future<void> loadItems() async {
    setState(() {
      loading = true;
      error = '';
    });
    try {
      final query = <String, String>{
        'page': '$page',
        'limit': '20',
        if (search.trim().isNotEmpty) 'search': search.trim(),
        if (state.trim().isNotEmpty) 'state': state.trim(),
        if (stateManagerId.trim().isNotEmpty) 'stateManagerId': stateManagerId.trim(),
      };
      final data = await request('/$section?${Uri(queryParameters: query).query}');
      final raw = data['items'] ?? data[section] ?? <dynamic>[];
      final loaded = raw is List
          ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
          : <Map<String, dynamic>>[];
      if (mounted) {
        setState(() {
          items = loaded;
          total = _number(data['total'], loaded.length);
          loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { error = _message(e); loading = false; });
    }
  }

  Future<void> openDetail(Map<String, dynamic> item) async {
    final id = item['id'] ?? item['_id'] ?? item['userId'];
    if (id == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ZonalDetailScreen(
          section: section,
          id: id.toString(),
          client: client,
        ),
      ),
    );
  }

  Future<void> promote(Map<String, dynamic> item) async {
    final id = item['id'] ?? item['_id'] ?? item['userId'];
    if (id == null) return;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Promote Aggregator?'),
        content: const Text('This will request promotion to State Manager within your zone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Confirm')),
        ],
      ),
    );
    if (accepted != true) return;
    try {
      await request('/aggregators/$id/promote', method: 'POST', body: {
        'targetRole': 'STATE_MANAGER',
        'state': item['state'],
        'stateManagerId': item['stateManagerId'],
        'idempotencyKey': zonalPromotionIdempotencyKey(id.toString()),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Promotion submitted.')));
        loadItems();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_message(e))));
    }
  }

  static Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  static int _number(dynamic value, [int fallback = 0]) =>
      value is num ? value.toInt() : int.tryParse('$value') ?? fallback;
  static String _message(Object e) => e.toString().replaceFirst('Exception: ', '');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Zonal Management')),
      body: RefreshIndicator(
        onRefresh: () async { await loadOverview(); await loadItems(); },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _overviewCards(),
            const SizedBox(height: 20),
            DropdownButtonFormField<String>(
              value: section,
              decoration: const InputDecoration(labelText: 'Management area', border: OutlineInputBorder()),
              items: _sections.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
              onChanged: (value) { if (value != null) { setState(() { section = value; page = 1; }); loadItems(); } },
            ),
            const SizedBox(height: 12),
            TextField(
              decoration: InputDecoration(
                labelText: 'Search ${_sections[section]}',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(icon: const Icon(Icons.clear), onPressed: () { setState(() => search = ''); loadItems(); }),
                border: const OutlineInputBorder(),
              ),
              onChanged: (value) => search = value,
              onSubmitted: (_) => loadItems(),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(
                decoration: const InputDecoration(labelText: 'State', border: OutlineInputBorder()),
                onChanged: (value) => state = value,
                onSubmitted: (_) => loadItems(),
              )),
              const SizedBox(width: 10),
              Expanded(child: TextField(
                decoration: const InputDecoration(labelText: 'State manager ID', border: OutlineInputBorder()),
                onChanged: (value) => stateManagerId = value,
                onSubmitted: (_) => loadItems(),
              )),
            ]),
            const SizedBox(height: 16),
            if (section == 'delivery') ...[
              _deliverySummary(),
              const SizedBox(height: 16),
            ],
            if (loading) const Center(child: Padding(padding: EdgeInsets.all(30), child: CircularProgressIndicator()))
            else if (error.isNotEmpty) _errorState()
            else if (items.isEmpty) const Padding(padding: EdgeInsets.all(30), child: Center(child: Text('No records found for this area.')))
            else ...items.map(_itemCard),
            if (!loading && total > 20) _pagination(),
          ],
        ),
      ),
    );
  }

  Widget _overviewCards() => Wrap(
    spacing: 8, runSpacing: 8,
    children: <String>[
      ..._sections.keys,
      'transactions',
    ].map((key) => Card(
      child: Padding(padding: const EdgeInsets.all(12), child: Column(
        children: [
          Text('${_number(overview[_overviewKey(key)])}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: _green)),
          Text(_sections[key] ?? 'Transactions', style: const TextStyle(fontSize: 11)),
        ],
      )),
    )).toList(),
  );

  Widget _deliverySummary() {
    final summary = _map(overview['deliverySummary']);
    final totalValue = _decimal(summary['totalValue']);
    final statuses = <String, dynamic>{
      'Total deliveries': summary['total'],
      'Pending': summary['pending'],
      'In progress': summary['inProgress'],
      'Completed': summary['completed'],
      'Failed': summary['failed'],
      'Cancelled': summary['cancelled'],
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Delivery overview',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 18,
              runSpacing: 12,
              children: statuses.entries.map((entry) => Semantics(
                label: '${entry.key}: ${_number(entry.value)}',
                child: SizedBox(
                  width: 125,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(entry.key, style: const TextStyle(color: Colors.black54)),
                      Text('${_number(entry.value)}',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              )).toList(),
            ),
            const SizedBox(height: 12),
            Semantics(
              label: 'Total delivery value: ${_money(totalValue)}',
              child: Text('Total value: ${_money(totalValue)}',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }

  static String _overviewKey(String key) {
    switch (key) {
      case 'delivery':
        return 'deliveries';
      case 'edupay':
        return 'edupaySchools';
      default:
        return key;
    }
  }

  Widget _itemCard(Map<String, dynamic> item) => Card(
    child: ListTile(
      onTap: () => openDetail(item),
      leading: const CircleAvatar(child: Icon(Icons.person_outline)),
      title: Text(_text(item['name'] ?? item['fullName'] ?? item['businessName'] ?? item['schoolName'] ?? 'Record')),
      subtitle: Text(_text(item['status'] ?? item['state'] ?? item['email'] ?? 'Details available')),
      trailing: section == 'aggregators'
          ? PopupMenuButton<String>(onSelected: (value) { if (value == 'promote') promote(item); }, itemBuilder: (_) => const [PopupMenuItem(value: 'promote', child: Text('Promote to State Manager'))])
          : const Icon(Icons.chevron_right),
    ),
  );

  Widget _errorState() => Card(
    color: Colors.red.shade50,
    child: ListTile(
      leading: const Icon(Icons.error_outline, color: Colors.red),
      title: Text(error),
      trailing: TextButton(onPressed: loadItems, child: const Text('Retry')),
    ),
  );

  Widget _pagination() => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
    IconButton(onPressed: page > 1 ? () { setState(() => page--); loadItems(); } : null, icon: const Icon(Icons.chevron_left)),
    Text('Page $page'),
    IconButton(onPressed: page * 20 < total ? () { setState(() => page++); loadItems(); } : null, icon: const Icon(Icons.chevron_right)),
  ]);

  static String _text(dynamic value) => value?.toString().trim().isNotEmpty == true ? value.toString() : '—';
  static double _decimal(dynamic value) => value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
  static String _money(double value) => '₦${value.toStringAsFixed(2)}';
}

class ZonalDetailScreen extends StatefulWidget {
  final String section;
  final String id;
  final http.Client client;
  ZonalDetailScreen({
    super.key,
    required this.section,
    required this.id,
    http.Client? client,
  }) : client = client ?? _DefaultHttpClient();
  @override
  State<ZonalDetailScreen> createState() => _ZonalDetailScreenState();
}

class _ZonalDetailScreenState extends State<ZonalDetailScreen> {
  Map<String, dynamic>? item;
  Map<String, dynamic> counts = {};
  String error = '';
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    try {
      final token = await SessionStore.readToken();
      if (token == null || token.isEmpty) throw Exception('Session expired. Please log in again.');
      final response = await widget.client.get(Uri.parse('https://api.servicepay.ng/api/management/zonal/${widget.section}/${widget.id}'), headers: {'Accept': 'application/json', 'Authorization': 'Bearer $token'});
      final data = jsonDecode(response.body) as Map;
      if (response.statusCode == 403) throw Exception('You do not have permission to view this record.');
      if (response.statusCode < 200 || response.statusCode >= 300) throw Exception(data['message'] ?? 'Unable to load details.');
      if (mounted) setState(() { item = _StateHelpers.map(data['item']); counts = _StateHelpers.map(data['counts'] ?? data['summary']); });
    } catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('${_StateHelpers.label(widget.section)} details')),
    body: error.isNotEmpty ? Center(child: Text(error)) : item == null ? const Center(child: CircularProgressIndicator()) : ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ...item!.entries.where((e) => e.value != null && e.value.toString().isNotEmpty).map((e) => ListTile(title: Text(e.key), subtitle: Text(e.value.toString()))),
        if (counts.isNotEmpty) const Divider(),
        ...counts.entries.map((e) => ListTile(title: Text(e.key), trailing: Text(e.value.toString()))),
        if (widget.section == 'customers') OutlinedButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _TransactionsScreen(id: widget.id, client: widget.client))), icon: const Icon(Icons.receipt_long), label: const Text('View transactions')),
      ],
    ),
  );
}

class _TransactionsScreen extends StatelessWidget {
  final String id;
  final http.Client client;
  _TransactionsScreen({
    required this.id,
    http.Client? client,
  }) : client = client ?? _DefaultHttpClient();
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Customer transactions')), body: FutureBuilder<Map<String, dynamic>>(
    future: _load(),
    builder: (context, snapshot) {
      if (snapshot.hasError) return Center(child: Text(snapshot.error.toString().replaceFirst('Exception: ', '')));
      if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
      final raw = snapshot.data!['items'];
      if (raw is! List || raw.isEmpty) return const Center(child: Text('No transactions found.'));
      return ListView(children: raw.whereType<Map>().map((e) => ListTile(title: Text('${e['serviceType'] ?? e['type'] ?? 'Transaction'}'), subtitle: Text('${e['status'] ?? '—'}'), trailing: Text('${e['amount'] ?? ''}'))).toList());
    },
  ));
  Future<Map<String, dynamic>> _load() async {
    final token = await SessionStore.readToken();
    if (token == null || token.isEmpty) throw Exception('Session expired. Please log in again.');
    final response = await client.get(Uri.parse('https://api.servicepay.ng/api/management/zonal/customers/$id/transactions'), headers: {'Authorization': 'Bearer $token', 'Accept': 'application/json'});
    final data = jsonDecode(response.body) as Map;
    if (response.statusCode < 200 || response.statusCode >= 300) throw Exception(data['message'] ?? 'Unable to load transactions.');
    return Map<String, dynamic>.from(data);
  }
}

class _DefaultHttpClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      http.Client().send(request);
}

class _StateHelpers {
  static Map<String, dynamic> map(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : {};
  static String label(String value) => value.split('-').map((e) => e.isEmpty ? e : '${e[0].toUpperCase()}${e.substring(1)}').join(' ');
}