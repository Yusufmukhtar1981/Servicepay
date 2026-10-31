import 'package:flutter/material.dart';

import 'admin_staff_workspace_api.dart';

class OperationsManagerDashboard extends StatefulWidget {
  const OperationsManagerDashboard({super.key, this.api});

  final AdminStaffWorkspaceApi? api;

  @override
  State<OperationsManagerDashboard> createState() =>
      _OperationsManagerDashboardState();
}

class _OperationsManagerDashboardState
    extends State<OperationsManagerDashboard> {
  late final AdminStaffWorkspaceApi _api =
      widget.api ?? AdminStaffWorkspaceApi();
  Map<String, dynamic> _overview = <String, dynamic>{};
  List<Map<String, dynamic>> _transactions = <Map<String, dynamic>>[];
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    if (widget.api == null) _api.close();
    super.dispose();
  }

  List<Map<String, dynamic>> _rows(dynamic value) => value is List
      ? value
          .whereType<Map>()
          .map((Map row) => Map<String, dynamic>.from(row))
          .toList()
      : <Map<String, dynamic>>[];

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final Map<String, dynamic> result = await _api.overview();
      final Map<String, dynamic> data = result['data'] is Map
          ? Map<String, dynamic>.from(result['data'] as Map)
          : result;
      final Map<String, dynamic> transactionResult =
          await _api.transactions();
      final Map<String, dynamic> transactionData =
          transactionResult['data'] is Map
              ? Map<String, dynamic>.from(transactionResult['data'] as Map)
              : transactionResult;
      if (!mounted) return;
      setState(() {
        _overview = data;
        _transactions = _rows(transactionData['items']);
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _section(String title, List<Widget> children) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      )),
              const SizedBox(height: 8),
              ...children,
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic> transactions =
        _overview['transactions'] is Map
            ? Map<String, dynamic>.from(_overview['transactions'] as Map)
            : <String, dynamic>{};
    final Map<String, dynamic> tickets = _overview['tickets'] is Map
        ? Map<String, dynamic>.from(_overview['tickets'] as Map)
        : <String, dynamic>{};
    final dynamic todayTransactions = transactions['today'];
    final String todayCount = todayTransactions is List
        ? '${todayTransactions.length}'
        : '${todayTransactions ?? 0}';
    return Scaffold(
      appBar: AppBar(
        title: const Text('Operations overview'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading && _overview.isEmpty
          ? ListView(
              padding: const EdgeInsets.all(16),
              children: List<Widget>.generate(
                4,
                (_) => const Card(
                  child: SizedBox(height: 84, child: LinearProgressIndicator()),
                ),
              ),
            )
          : _error.isNotEmpty && _overview.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(_error, textAlign: TextAlign.center),
                      TextButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: <Widget>[
                      if (_error.isNotEmpty)
                        MaterialBanner(
                          content: Text(_error),
                          actions: <Widget>[
                            TextButton(
                              onPressed: _load,
                              child: const Text('Retry'),
                            ),
                          ],
                        ),
                      _section('Operations at a glance', <Widget>[
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Transactions today'),
                          trailing: Text(todayCount),
                        ),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Open support workload'),
                          trailing: Text('${tickets['open'] ?? 0}'),
                        ),
                      ]),
                      _section('Recent transaction records', <Widget>[
                        if (_transactions.isEmpty)
                          const Text('No transaction records are available.')
                        else
                          ..._transactions.take(20).map(
                                (Map<String, dynamic> row) => ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(
                                      Icons.receipt_long_outlined),
                                  title: Text(
                                      '${row['reference'] ?? row['id'] ?? 'Transaction'}'),
                                  subtitle: Text(
                                      '${row['type'] ?? ''} · ${row['status'] ?? ''}'),
                                  trailing: Text('${row['amount'] ?? ''}'),
                                ),
                              ),
                      ]),
                      _section('Visible branch activity', <Widget>[
                        if (_rows(_overview['branches']).isEmpty)
                          const Text('No branch records are available.')
                        else
                          ..._rows(_overview['branches']).map(
                            (Map<String, dynamic> row) => ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text('${row['name'] ?? 'Branch'}'),
                              subtitle: Text(
                                  'Today · ${row['count'] ?? 0} transactions'),
                              trailing: Text('${row['successful'] ?? 0} completed'),
                            ),
                          ),
                      ]),
                    ],
                  ),
                ),
    );
  }
}

class CustomerSupportDashboard extends StatefulWidget {
  const CustomerSupportDashboard({super.key, this.api});

  final AdminStaffWorkspaceApi? api;

  @override
  State<CustomerSupportDashboard> createState() =>
      _CustomerSupportDashboardState();
}

class _CustomerSupportDashboardState extends State<CustomerSupportDashboard> {
  late final AdminStaffWorkspaceApi _api =
      widget.api ?? AdminStaffWorkspaceApi();
  final TextEditingController _query = TextEditingController();
  List<Map<String, dynamic>> _customers = <Map<String, dynamic>>[];
  Map<String, dynamic>? _selectedCustomer;
  Map<String, dynamic> _profile = <String, dynamic>{};
  String _error = '';
  bool _loading = false;

  @override
  void dispose() {
    _query.dispose();
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Map<String, dynamic> _data(Map<String, dynamic> response) =>
      response['data'] is Map
          ? Map<String, dynamic>.from(response['data'] as Map)
          : response;

  Future<void> _search() async {
    setState(() {
      _loading = true;
      _error = '';
      _selectedCustomer = null;
    });
    try {
      final Map<String, dynamic> result =
          _data(await _api.customers(query: _query.text.trim()));
      final dynamic values = result['items'];
      if (!mounted) return;
      setState(() {
        _customers = values is List
            ? values
                .whereType<Map>()
                .map((Map row) => Map<String, dynamic>.from(row))
                .toList()
            : <Map<String, dynamic>>[];
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open(Map<String, dynamic> customer) async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final String id = '${customer['id'] ?? customer['_id'] ?? ''}';
      final Map<String, dynamic> result = _data(await _api.customer(id));
      if (!mounted) return;
      setState(() {
        _selectedCustomer = Map<String, dynamic>.from(
          result['customer'] is Map ? result['customer'] as Map : customer,
        );
        _profile = result;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createCase() async {
    final Map<String, dynamic>? customer = _selectedCustomer;
    if (customer == null) return;
    final TextEditingController subject = TextEditingController();
    final TextEditingController description = TextEditingController();
    String category = 'OTHER';
    String priority = 'NORMAL';
    final Map<String, dynamic>? form =
        await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter update) => AlertDialog(
          title: const Text('Create support case'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TextField(
                  controller: subject,
                  onChanged: (_) => update(() {}),
                  decoration: const InputDecoration(labelText: 'Subject'),
                ),
                TextField(
                  controller: description,
                  onChanged: (_) => update(() {}),
                  minLines: 3,
                  maxLines: 5,
                  decoration:
                      const InputDecoration(labelText: 'Description'),
                ),
                DropdownButtonFormField<String>(
                  value: category,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: const <String>[
                    'TRANSACTION',
                    'TRANSFER',
                    'WITHDRAWAL',
                    'AIRTIME_DATA',
                    'BILLS',
                    'DELIVERY',
                    'OTHER',
                  ]
                      .map((String value) => DropdownMenuItem<String>(
                            value: value,
                            child: Text(value.replaceAll('_', ' ')),
                          ))
                      .toList(),
                  onChanged: (String? value) =>
                      update(() => category = value ?? 'OTHER'),
                ),
                DropdownButtonFormField<String>(
                  value: priority,
                  decoration: const InputDecoration(labelText: 'Priority'),
                  items: const <String>['LOW', 'NORMAL', 'HIGH', 'URGENT']
                      .map((String value) => DropdownMenuItem<String>(
                            value: value,
                            child: Text(value),
                          ))
                      .toList(),
                  onChanged: (String? value) =>
                      update(() => priority = value ?? 'NORMAL'),
                ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: subject.text.trim().isEmpty ||
                      description.text.trim().isEmpty
                  ? null
                  : () => Navigator.pop(dialogContext, <String, dynamic>{
                        'subject': subject.text.trim(),
                        'description': description.text.trim(),
                      }),
              child: const Text('Create case'),
            ),
          ],
        ),
      ),
    );
    subject.dispose();
    description.dispose();
    if (form == null) return;
    try {
      await _api.createTicket(
        customerId: '${customer['id'] ?? customer['_id']}',
        subject: '${form['subject']}',
        description: '${form['description']}',
        category: category,
        priority: priority,
        idempotencyKey:
            '${DateTime.now().microsecondsSinceEpoch}-${customer['id'] ?? customer['_id']}',
      );
      if (mounted) await _open(customer);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Customer support desk')),
        body: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _query,
                onSubmitted: (_) => _search(),
                decoration: InputDecoration(
                  labelText: 'Find a customer',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(
                    tooltip: 'Search',
                    onPressed: _loading ? null : _search,
                    icon: const Icon(Icons.arrow_forward),
                  ),
                ),
              ),
            ),
            if (_loading) const LinearProgressIndicator(),
            if (_error.isNotEmpty)
              MaterialBanner(
                content: Text(_error),
                actions: <Widget>[
                  TextButton(onPressed: _search, child: const Text('Retry')),
                ],
              ),
            Expanded(
              child: _selectedCustomer == null
                  ? _customers.isEmpty
                      ? Center(
                          child: Text(_query.text.trim().isEmpty
                              ? 'Search securely to investigate a customer.'
                              : 'No customer matches this search.'),
                        )
                      : ListView(
                          children: _customers
                              .map(
                                (Map<String, dynamic> customer) => ListTile(
                                  leading: const CircleAvatar(
                                      child: Icon(Icons.person_outline)),
                                  title: Text(
                                      '${customer['fullName'] ?? 'Customer'}'),
                                  subtitle: Text(
                                      '${customer['phone'] ?? ''} · ${customer['email'] ?? ''}'),
                                  onTap: () => _open(customer),
                                ),
                              )
                              .toList(),
                        )
                  : ListView(
                      padding: const EdgeInsets.all(16),
                      children: <Widget>[
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                              '${_selectedCustomer?['fullName'] ?? 'Customer profile'}'),
                          subtitle: Text(
                              '${_selectedCustomer?['phone'] ?? ''} · ${_selectedCustomer?['email'] ?? ''}'),
                          trailing: TextButton(
                            onPressed: () =>
                                setState(() => _selectedCustomer = null),
                            child: const Text('Back to results'),
                          ),
                        ),
                        const Divider(),
                        Text('Recent transactions',
                            style: Theme.of(context).textTheme.titleMedium),
                        ..._listRows(_profile['transactions']).map(
                          (Map<String, dynamic> row) => ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                                '${row['reference'] ?? row['id'] ?? 'Transaction'}'),
                            subtitle: Text(
                                '${row['type'] ?? ''} · ${row['status'] ?? ''}'),
                            trailing: Text('${row['amount'] ?? ''}'),
                          ),
                        ),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: _loading ? null : _createCase,
                          icon: const Icon(Icons.add),
                          label: const Text('Create support case'),
                        ),
                      ],
                    ),
            ),
          ],
        ),
      );

  List<Map<String, dynamic>> _listRows(dynamic value) => value is List
      ? value
          .whereType<Map>()
          .map((Map row) => Map<String, dynamic>.from(row))
          .toList()
      : <Map<String, dynamic>>[];
}
