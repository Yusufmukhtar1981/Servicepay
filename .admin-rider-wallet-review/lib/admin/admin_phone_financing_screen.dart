import 'package:flutter/material.dart';

import 'admin_phone_financing_api.dart';

const _green = Color(0xFF08783E);
const _ink = Color(0xFF17352B);
const _paper = Color(0xFFF4F8F3);

class AdminPhoneFinancingScreen extends StatefulWidget {
  const AdminPhoneFinancingScreen({super.key, this.api});
  final AdminPhoneFinancingApi? api;
  @override
  State<AdminPhoneFinancingScreen> createState() =>
      _AdminPhoneFinancingScreenState();
}

class _AdminPhoneFinancingScreenState extends State<AdminPhoneFinancingScreen>
    with SingleTickerProviderStateMixin {
  late final AdminPhoneFinancingApi _api;
  late final TabController _tabs;
  bool _loading = true;
  String _error = '';
  Map<String, dynamic> _metrics = {};
  List<Map<String, dynamic>> _products = [],
      _applications = [],
      _devices = [],
      _finance = [];
  List<Map<String, dynamic>> _officers = [];
  bool _officersLoading = false;
  final _search = TextEditingController();
  final _officerSearch = TextEditingController();
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? AdminPhoneFinancingApi();
    _tabs = TabController(length: 9, vsync: this)
      ..addListener(() {
        if (!_tabs.indexIsChanging) {
          setState(() => _tab = _tabs.index);
          if (_tab == 8) _loadOfficers();
        }
      });
    _load();
  }

  List<Map<String, dynamic>> _list(dynamic x) => x is List
      ? x.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : <Map<String, dynamic>>[];
  Map<String, dynamic> _map(dynamic x) =>
      x is Map ? Map<String, dynamic>.from(x) : {};
  String _id(Map<String, dynamic> x) => '${x['_id'] ?? x['id'] ?? ''}';
  String _s(dynamic x, [String fallback = '—']) {
    final v = '$x'.trim();
    return v.isEmpty || v == 'null' ? fallback : v;
  }

  String _money(dynamic x) {
    final n = x is num ? x : num.tryParse('$x') ?? 0;
    return '₦${n.toStringAsFixed(2)}';
  }

  Future<void> _load() async {
    if (!mounted) {
      return;
    }
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final values = await Future.wait([
        _api.dashboard(),
        _api.products(),
        _api.applications(),
        _api.devices(),
        _api.finance(),
      ]);
      if (!mounted) return;
      setState(() {
        _metrics = _map(values[0]['metrics']);
        _products = _list(values[1]['products']);
        _applications = _list(values[2]['applications']);
        _devices = _list(values[3]['devices']);
        _finance = _list(values[4]['finance']);
        _loading = false;
      });
    } on AdminPhoneFinancingException catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Unable to load phone-financing operations.';
        });
      }
    }
  }

  void _notice(String text, {bool error = false}) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(text),
      behavior: SnackBarBehavior.floating,
      backgroundColor: error ? const Color(0xFFB42318) : _green,
    ));
  }

  @override
  void dispose() {
    _tabs.dispose();
    _search.dispose();
    _officerSearch.dispose();
    _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _paper,
      appBar: AppBar(
        title: const Text('Phone Financing Control Room',
            style: TextStyle(fontWeight: FontWeight.w800, color: _ink)),
        backgroundColor: _paper,
        foregroundColor: _ink,
        elevation: 0,
        actions: [
          IconButton(
              onPressed: _load,
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh))
        ],
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          labelColor: _green,
          unselectedLabelColor: Colors.blueGrey,
          indicatorColor: _green,
          tabs: const [
            Tab(text: 'Overview'),
            Tab(text: 'Products'),
            Tab(text: 'Applications'),
            Tab(text: 'Inventory'),
            Tab(text: 'Active finance'),
            Tab(text: 'Overdue'),
            Tab(text: 'Repayments'),
            Tab(text: 'Completed'),
            Tab(text: 'Officers'),
          ],
        ),
      ),
      body: _loading
          ? const _Loading()
          : _error.isNotEmpty
              ? _ErrorState(message: _error, retry: _load)
              : TabBarView(controller: _tabs, children: [
                  _overview(),
                  _productsView(),
                  _applicationsView(),
                  _inventoryView(),
                  _financeView('ACTIVE'),
                  _financeView(true),
                  _repaymentsView(),
                  _completedView(),
                   _officersView(),
                ]),
      floatingActionButton: _tab == 1
          ? FloatingActionButton.extended(
              onPressed: () => _productDialog(),
              backgroundColor: _green,
              icon: const Icon(Icons.add),
              label: const Text('New product'))
          : _tab == 3
              ? FloatingActionButton.extended(
                  onPressed: _deviceDialog,
                  backgroundColor: _green,
                  icon: const Icon(Icons.qr_code_2),
                  label: const Text('Add device'))
          : _tab == 8
              ? FloatingActionButton.extended(
                  onPressed: _officerDialog,
                  backgroundColor: _green,
                  icon: const Icon(Icons.person_add_alt_1),
                  label: const Text('New officer'))
              : null,
    );
  }

  Widget _overview() {
    final cards = [
      [
        'Catalog products',
        _metrics['products'] ?? 0,
        Icons.phone_android_outlined
      ],
      [
        'Stock on hand',
        _metrics['availableStock'] ?? 0,
        Icons.inventory_2_outlined
      ],
      [
        'Pending review',
        _metrics['pendingReview'] ?? 0,
        Icons.assignment_outlined
      ],
      [
        'Awaiting deposit',
        _metrics['awaitingDeposit'] ?? 0,
        Icons.payments_outlined
      ],
      [
        'Active finance',
        _metrics['activeFinanced'] ?? 0,
        Icons.account_balance_wallet_outlined
      ],
      ['Overdue', _metrics['overdue'] ?? 0, Icons.warning_amber_outlined],
      ['Completed', _metrics['completed'] ?? 0, Icons.verified_outlined],
      [
        'Deposits',
        _money(_metrics['depositsCollected']),
        Icons.savings_outlined
      ],
      [
        'Repayments',
        _money(_metrics['repaymentsCollected']),
        Icons.receipt_long_outlined
      ],
      [
        'Outstanding',
        _money(_metrics['outstandingPortfolio']),
        Icons.pending_actions_outlined
      ],
    ];
    return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const _Banner(),
            const SizedBox(height: 18),
            Wrap(
                spacing: 12,
                runSpacing: 12,
                children: cards
                    .map((c) => _metric(c[0] as String, c[1], c[2] as IconData))
                    .toList()),
            const SizedBox(height: 24),
            _section('Operating posture', Icons.fact_check_outlined, [
              const ListTile(
                  leading: Icon(Icons.lock_outline, color: Colors.orange),
                  title: Text('Provider enforcement is disabled'),
                  subtitle: Text(
                      'Restriction and restore actions only record provider requests. A device is never claimed locked or restored.')),
              ListTile(
                  leading:
                      const Icon(Icons.inventory_2_outlined, color: _green),
                  title: const Text('Inventory on hand'),
                  subtitle: Text(
                      '${_devices.where((d) => _s(d['status']) == 'AVAILABLE').length} devices available for assignment')),
              ListTile(
                leading: const Icon(Icons.restart_alt, color: Colors.orange),
                title: const Text('Expired reservation recovery'),
                subtitle: const Text(
                    'Evaluate RESERVED devices whose reservation expiry has elapsed.'),
                trailing: OutlinedButton(
                  onPressed: _evaluateReservations,
                  child: const Text('Evaluate'),
                ),
              ),
            ]),
          ],
        ));
  }

  Widget _metric(String title, dynamic value, IconData icon) => Container(
        width: 180,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFDCE8DE))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: _green),
          const SizedBox(height: 14),
          Text('$value',
              style: const TextStyle(
                  fontSize: 26, fontWeight: FontWeight.w800, color: _ink)),
          Text(title, style: const TextStyle(color: Colors.blueGrey)),
        ]),
      );

  Widget _productsView() => _listPage(
        title: 'Phone products',
        count: _products.length,
        empty: 'No phone products yet. Add the first financed product.',
        children: _products
            .map((p) => _card(
                  title: '${_s(p['name'])}  •  ${_s(p['sku'])}',
                  subtitle:
                      '${_money(p['financedPrice'])} financed  ·  ${_s(p['weeklyInstallments'])} weekly instalments  ·  stock ${_s(p['stock'], '0')}'
                      '  ·  grace ${_s(p['graceDays'], '3')}d  ·  provider ${_s(p['restrictionProvider'], 'NONE')}'
                      '${p['restrictionEnabled'] == true ? ' · policy configured (enforcement disabled)' : ''}',
                  trailing: Switch(
                      value: p['active'] != false,
                      onChanged: (v) => _setProductActive(p, v),
                      activeColor: _green),
                  onTap: () => _productDialog(p),
                ))
            .toList(),
      );

  Widget _applicationsView() => _listPage(
        title: 'Applications & review',
        count: _applications.length,
        search: true,
        empty: 'No applications match the current queue.',
        children: _applications.map((a) {
          final customer = _map(a['customer']);
          final status = _s(a['status'], 'SUBMITTED');
          return _card(
            title:
                '${_s(a['reference'])}  ·  ${_s(customer['fullName'], 'Customer')}',
            subtitle:
                '${_s(_map(a['product'])['name'], 'Phone product')}  ·  $status',
            badge: status,
            onTap: () => _applicationDetails(a),
          );
        }).toList(),
      );

  Widget _inventoryView() => _listPage(
        title: 'IMEI inventory',
        count: _devices.length,
        search: true,
        empty: 'No devices have been received into inventory.',
        children: _devices
            .map((d) => _card(
                  title:
                      '${_s(d['reference'])}  ·  ${_s(_map(d['product'])['name'], 'Uncatalogued device')}',
                  subtitle:
                      'IMEI ${_s(d['imei1'])}  ·  S/N ${_s(d['serialNumber'])}',
                  badge: _s(d['status']),
                  onTap: () => _deviceDetails(d),
                ))
            .toList(),
      );

  Widget _financeView(Object status) {
    final overdue = status == true;
    final rows = _finance
        .where((f) => overdue
            ? ['OVERDUE', 'RESTRICTED'].contains(_s(f['status']))
            : _s(f['status']) == 'ACTIVE')
        .toList();
    return _listPage(
        title: overdue ? 'Overdue & restricted' : 'Active finance',
        count: rows.length,
        empty: overdue
            ? 'No overdue contracts require attention.'
            : 'No active finance contracts.',
        header: overdue
            ? OutlinedButton.icon(
                onPressed: _evaluate,
                icon: const Icon(Icons.playlist_add_check),
                label: const Text('Evaluate overdue'))
            : null,
        children: rows
            .map((f) => _card(
                  title:
                      '${_s(f['reference'])}  ·  ${_s(_map(f['customer'])['fullName'], 'Customer')}',
                  subtitle:
                      '${_money(f['outstandingBalance'])} outstanding  ·  ${_s(f['status'])}',
                  badge: _s(f['status']),
                  onTap: () => _financeDetails(f),
                ))
            .toList());
  }

  Widget _repaymentsView() {
    final rows = _finance.where((f) {
      final schedule = f['paymentSchedule'];
      return schedule is List &&
          schedule.any((row) => _s(_map(row)['status']) == 'PAID');
    }).toList();
    return _listPage(
      title: 'Repayments',
      count: rows.length,
      empty: 'No recorded repayments yet.',
      children: rows
          .map((f) => _card(
                title: _s(f['reference']),
                subtitle:
                    'Paid ${_money(f['amountPaid'])} · ${_s(_map(f['customer'])['fullName'], 'Customer')}',
                badge: 'PAYMENT RECORDED',
                onTap: () => _financeDetails(f),
              ))
          .toList(),
    );
  }

  Widget _completedView() {
    final rows = _finance.where((f) => _s(f['status']) == 'COMPLETED').toList();
    return _listPage(
      title: 'Completed finance',
      count: rows.length,
      empty: 'No completed finance contracts.',
      children: rows
          .map((f) => _card(
                title: _s(f['reference']),
                subtitle:
                    '${_s(_map(f['customer'])['fullName'], 'Customer')} · ${_money(f['amountPaid'])} paid',
                badge: 'COMPLETED',
                onTap: () => _financeDetails(f),
              ))
          .toList(),
    );
  }

  Future<void> _loadOfficers() async {
    if (mounted) setState(() => _officersLoading = true);
    try {
      final result = await _api.officers(search: _officerSearch.text);
      if (mounted) {
        setState(() {
          _officers = _list(result['officers']);
          _officersLoading = false;
        });
      }
    } on AdminPhoneFinancingException catch (error) {
      if (mounted) {
        setState(() => _officersLoading = false);
        _notice(error.message, error: true);
      }
    }
  }

  Widget _officersView() => RefreshIndicator(
        onRefresh: _loadOfficers,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          Row(children: [
            const Text('Phone Financing Officers',
                style: TextStyle(
                    fontSize: 22, fontWeight: FontWeight.w800, color: _ink)),
            const Spacer(),
            Chip(label: Text('${_officers.length}')),
          ]),
          const SizedBox(height: 12),
          TextField(
            controller: _officerSearch,
            onSubmitted: (_) => _loadOfficers(),
            decoration: InputDecoration(
              labelText: 'Search name, phone, email or state',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                  onPressed: _loadOfficers,
                  icon: const Icon(Icons.arrow_forward)),
              filled: true,
              fillColor: Colors.white,
              border:
                  OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
          const SizedBox(height: 14),
          if (_officersLoading)
            const Center(child: Padding(
                padding: EdgeInsets.all(28), child: CircularProgressIndicator()))
          else if (_officers.isEmpty)
            const _EmptyState(text: 'No Phone Financing Officers found.')
          else
            ..._officers.map((officer) {
              final status = _s(officer['status'], 'ACTIVE');
              final staffId = _s(officer['staffId'], 'No staff reference');
              return _card(
                title: '${_s(officer['fullName'])} · $staffId',
                subtitle:
                    '${_s(officer['phone'])} · ${_s(officer['email'])}\n${_s(officer['state'])} / ${_s(officer['lga'])} · ${_s(officer['assignedApplicationsCount'] ?? officer['assignedCount'], '0')} assigned · ${_s(officer['completedVerificationsCount'] ?? officer['completedVerificationCount'], '0')} completed verifications',
                badge: status,
                trailing: Switch(
                  value: status.toUpperCase() == 'ACTIVE',
                  activeColor: _green,
                  onChanged: (bool active) => _setOfficerStatus(
                      officer, active ? 'ACTIVE' : 'INACTIVE'),
                ),
              );
            }),
        ]),
      );

  Future<void> _setOfficerStatus(
      Map<String, dynamic> officer, String status) async {
    try {
      await _api.setOfficerStatus(_id(officer), status);
      _notice('Officer status changed to $status.');
      await _loadOfficers();
    } on AdminPhoneFinancingException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Future<void> _officerDialog() async {
    final fields = <String, TextEditingController>{
      for (final key in <String>[
        'fullName', 'phone', 'email', 'password', 'staffId', 'state', 'lga',
        'address'
      ])
        key: TextEditingController(),
    };
    final save = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Create Phone Financing Officer'),
        content: SizedBox(
          width: 500,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              for (final entry in fields.entries)
                _input(entry.value,
                    entry.key.replaceAll(RegExp(r'([A-Z])'), r' $1')),
            ]),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialog, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(dialog, true),
              child: const Text('Create officer')),
        ],
      ),
    );
    if (save == true) {
      try {
        await _api.createOfficer(<String, dynamic>{
          for (final entry in fields.entries) entry.key: entry.value.text.trim(),
        });
        _notice('Phone Financing Officer created.');
        await _loadOfficers();
      } on AdminPhoneFinancingException catch (error) {
        _notice(error.message, error: true);
      }
    }
    for (final controller in fields.values) {
      controller.dispose();
    }
  }

  Widget _input(TextEditingController controller, String label,
          {int lines = 1}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextField(
          controller: controller,
          maxLines: lines,
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
          ),
        ),
      );

  Widget _listPage(
          {required String title,
          required int count,
          bool search = false,
          required String empty,
          required List<Widget> children,
          Widget? header}) =>
      RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          Row(children: [
            Text(title,
                style: const TextStyle(
                    fontSize: 22, fontWeight: FontWeight.w800, color: _ink)),
            const SizedBox(width: 8),
            Chip(label: Text('$count')),
            ...[
              if (header != null) ...[const Spacer(), header]
            ]
          ]),
          if (search)
            Padding(
                padding: const EdgeInsets.only(top: 14),
                child: TextField(
                  controller: _search,
                  onSubmitted: (_) => _searchData(),
                  decoration: InputDecoration(
                      labelText: 'Search by reference, IMEI or customer',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: IconButton(
                          onPressed: _searchData,
                          icon: const Icon(Icons.arrow_forward)),
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12))),
                )),
          const SizedBox(height: 14),
          if (children.isEmpty) _EmptyState(text: empty) else ...children,
        ]),
      );

  Widget _card(
          {required String title,
          required String subtitle,
          String? badge,
          Widget? trailing,
          VoidCallback? onTap}) =>
      Card(
          color: Colors.white,
          elevation: 0,
          margin: const EdgeInsets.only(bottom: 10),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: Color(0xFFDCE8DE))),
          child: ListTile(
              onTap: onTap,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
              title: Text(title,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, color: _ink)),
              subtitle: Padding(
                  padding: const EdgeInsets.only(top: 5),
                  child: Text(subtitle)),
              trailing: trailing ??
                  (badge == null
                      ? const Icon(Icons.chevron_right)
                      : _badge(badge))));
  Widget _badge(String text) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
          color: text == 'OVERDUE' || text == 'RESTRICTED'
              ? const Color(0xFFFFE8E2)
              : const Color(0xFFE3F3E8),
          borderRadius: BorderRadius.circular(20)),
      child: Text(text.replaceAll('_', ' '),
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)));
  Widget _section(String title, IconData icon, List<Widget> children) => Card(
      color: Colors.white,
      elevation: 0,
      child: Column(children: [
        ListTile(
            leading: Icon(icon, color: _green),
            title: Text(title,
                style:
                    const TextStyle(fontWeight: FontWeight.w800, color: _ink))),
        ...children,
      ]));

  Future<void> _productDialog([Map<String, dynamic>? old]) async {
    final c = <String, TextEditingController>{
      for (final k in [
        'sku',
        'name',
        'brand',
        'cashPrice',
        'financedPrice',
        'depositPercent',
        'interestPercent',
        'weeklyInstallments'
      ])
        k: TextEditingController(text: old == null ? '' : '${old[k] ?? ''}')
    };
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title:
            Text(old == null ? 'Create phone product' : 'Edit phone product'),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ...c.entries.map((e) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: TextField(
                        controller: e.value,
                        keyboardType: ['name', 'sku', 'brand'].contains(e.key)
                            ? TextInputType.text
                            : const TextInputType.numberWithOptions(
                                decimal: true),
                        decoration: InputDecoration(
                          labelText: e.key == 'sku'
                              ? 'SKU'
                              : e.key.replaceAll(RegExp(r'([A-Z])'), r' $1'),
                        ),
                      ),
                    )),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(old == null ? 'Create' : 'Save'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final body = <String, dynamic>{
      for (final e in c.entries) e.key: _number(e.key, e.value.text)
    };
    body['restrictionProvider'] = old?['restrictionProvider'] ?? 'NONE';
    body['restrictionEnabled'] = false;
    body['graceDays'] = old?['graceDays'] ?? 3;
    if (body['sku'] == '' ||
        body['name'] == '' ||
        body['cashPrice'] == null ||
        body['financedPrice'] == null) {
      _notice('SKU, name and both prices are required.', error: true);
      return;
    }
    try {
      old == null
          ? await _api.createProduct(body)
          : await _api.updateProduct(_id(old), body);
      _notice('Product saved.');
      await _load();
    } on AdminPhoneFinancingException catch (e) {
      _notice(e.message, error: true);
    }
  }

  dynamic _number(String key, String value) =>
      ['sku', 'name', 'brand'].contains(key)
          ? value.trim()
          : num.tryParse(value.trim());
  Future<void> _setProductActive(Map<String, dynamic> p, bool active) async {
    try {
      final result = await _api.setProductActive(_id(p), active);
      if (!mounted) {
        return;
      }
      final serverProduct = _map(result['product']);
      final index = _products.indexWhere((item) => _id(item) == _id(p));
      if (index >= 0 && serverProduct.isNotEmpty) {
        setState(() => _products[index] = serverProduct);
      }
    } catch (e) {
      _notice('$e', error: true);
    }
  }

  Future<void> _deviceDialog() async {
    final c = {
      for (final k in ['imei1', 'imei2', 'serialNumber'])
        k: TextEditingController()
    };
    String? phoneProductId;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Receive device into inventory'),
          content: SizedBox(
            width: 480,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: phoneProductId,
                  decoration: const InputDecoration(labelText: 'Phone product'),
                  items: _products
                      .map((p) => DropdownMenuItem<String>(
                            value: _id(p),
                            child: Text(
                                '${_s(p['name'])} · stock ${_s(p['stock'], '0')}'),
                          ))
                      .toList(),
                  onChanged: (value) =>
                      setDialogState(() => phoneProductId = value),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: c['imei1'],
                  decoration: const InputDecoration(labelText: 'IMEI 1'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: c['imei2'],
                  decoration:
                      const InputDecoration(labelText: 'IMEI 2 (optional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: c['serialNumber'],
                  decoration: const InputDecoration(labelText: 'Serial number'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Add device')),
          ],
        ),
      ),
    );
    final selectedPhoneProductId = phoneProductId?.trim() ?? '';
    final imei1 = c['imei1']!.text.trim();
    final imei2 = c['imei2']!.text.trim();
    final serialNumber = c['serialNumber']!.text.trim();
    if (ok != true) return;
    if (selectedPhoneProductId.isEmpty) {
      _notice('Please select a phone product.', error: true);
      return;
    }
    if (imei1.isEmpty) {
      _notice('IMEI 1 is required.', error: true);
      return;
    }
    if (serialNumber.isEmpty) {
      _notice('Serial number is required.', error: true);
      return;
    }
    try {
      await _api.createDevice(
        phoneProductId: selectedPhoneProductId,
        imei1: imei1,
        imei2: imei2,
        serialNumber: serialNumber,
      );
      _notice('Device added to stock.');
      await _load();
    } catch (e) {
      _notice('$e', error: true);
    }
  }

  Future<void> _applicationActions(Map<String, dynamic> a) async {
    final status = _s(a['status']);
    final choices = <String>[
      if (status == 'SUBMITTED') 'UNDER_REVIEW',
      if (status == 'SUBMITTED' || status == 'UNDER_REVIEW') 'APPROVE',
      if (status == 'SUBMITTED' || status == 'UNDER_REVIEW')
        'MORE_INFORMATION_REQUIRED',
      if (status == 'SUBMITTED' || status == 'UNDER_REVIEW') 'REJECTED',
      if (status == 'DEPOSIT_PAID') 'ASSIGN_DEVICE',
      if (status == 'DEVICE_ASSIGNED') 'HANDOVER',
    ];
    if (choices.isEmpty) {
      _notice('No operational action is available for this status.');
      return;
    }
    final action = await showModalBottomSheet<String>(
        context: context,
        builder: (ctx) => SafeArea(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                ListTile(
                    title: Text(_s(a['reference']),
                        style: const TextStyle(fontWeight: FontWeight.w800))),
                ...choices.map((x) => ListTile(
                    leading: Icon(
                        x == 'REJECTED' ? Icons.block : Icons.arrow_forward,
                        color: _green),
                    title: Text(x.replaceAll('_', ' ')),
                    onTap: () => Navigator.pop(ctx, x))),
              ]),
            ));
    if (action == null) return;
    if (action == 'APPROVE') {
      final note = TextEditingController();
      final snapshot = _map(a['productSnapshot']);
      final product = _map(a['product']);
      final suggestedPrice =
          product['financedPrice'] ?? snapshot['financedPrice'] ?? '';
      final price = TextEditingController(text: '$suggestedPrice');
      if (!mounted) return;
      final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
                title: const Text('Approve application'),
                content: Column(mainAxisSize: MainAxisSize.min, children: [
                  TextField(
                      controller: price,
                      decoration:
                          const InputDecoration(labelText: 'Approved price')),
                  TextField(
                      controller: note,
                      decoration:
                          const InputDecoration(labelText: 'Approval note')),
                ]),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Approve'))
                ],
              ));
      if (confirmed == true) {
        try {
          await _api.approve(_id(a), price: price.text, note: note.text);
          _notice('Application approved.');
          await _load();
        } catch (e) {
          _notice('$e', error: true);
        }
      }
    } else if (action == 'ASSIGN_DEVICE') {
      final id = await _ask('Assign device', 'Enter the AVAILABLE device ID');
      if (id != null) {
        try {
          await _api.assignDevice(_id(a), id);
          _notice('Device assigned.');
          await _load();
        } catch (e) {
          _notice('$e', error: true);
        }
      }
    } else if (action == 'HANDOVER') {
      if (await _confirm(
          'Activate handover?', 'This starts the weekly finance contract.')) {
        try {
          await _api.handover(_id(a));
          _notice('Handover activated.');
          await _load();
        } catch (e) {
          _notice('$e', error: true);
        }
      }
    } else {
      final note = await _ask(
          'Move application', 'Admin note for ${action.replaceAll('_', ' ')}');
      if (note != null) {
        try {
          await _api.transition(_id(a), action, note);
          _notice('Application status updated.');
          await _load();
        } catch (e) {
          _notice('$e', error: true);
        }
      }
    }
  }

  Future<void> _applicationDetails(Map<String, dynamic> a) async {
    Map<String, dynamic> detail = a;
    try {
      final response = await _api.applicationDetail(_id(a));
      if (!mounted) return;
      detail = _map(response['application']);
    } catch (e) {
      _notice('$e', error: true);
      return;
    }
    final customer = _map(detail['customer']);
    final product = _map(detail['product']);
    final snapshot = _map(detail['productSnapshot']);
    final kyc = _map(detail['kycSnapshot']);
    final profile = _map(detail['profileSnapshot']);
    final input = _map(detail['applicationInput']);
    final officer = _map(detail['assignedOfficer']);
    final verification =
        _map(detail['verification'] ?? detail['verificationReport']);
    final history = detail['statusHistory'] is List
        ? detail['statusHistory'] as List
        : <dynamic>[];
    final action = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(_s(a['reference'], 'Application detail')),
        content: SizedBox(
          width: 650,
          child: SingleChildScrollView(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _detailSection('Customer & consent', [
                'Customer: ${_s(customer['fullName'], _s(profile['fullName']))}',
                'Phone / email: ${_s(customer['phone'], _s(profile['phone']))} · ${_s(customer['email'])}',
                'Occupation: ${_s(input['occupation'])} · income ${_money(input['monthlyIncome'])}',
                'Address: ${_s(input['residentialAddress'])}',
                'State / LGA: ${_s(input['state'])} / ${_s(input['lga'])}',
                'Employer: ${_s(input['employer'])}',
                'Preferred duration: ${_s(input['preferredDurationWeeks'])} weeks',
                'Consent: ${input['consent'] == true ? 'Recorded' : 'Not recorded'}',
              ]),
              _detailSection('KYC review', [
                'Status: ${_s(kyc['status'], 'No KYC snapshot')} · tier ${_s(kyc['level'])}',
                'Verification reference: ${_s(kyc['verificationReference'])}',
              ]),
              _detailSection('Product & pricing snapshot', [
                '${_s(product['name'], _s(snapshot['name']))} · SKU ${_s(product['sku'], _s(snapshot['sku']))}',
                'Cash ${_money(snapshot['cashPrice'])} · financed ${_money(snapshot['financedPrice'])}',
                'Deposit ${_s(snapshot['depositPercent'])}% · interest ${_s(snapshot['interestPercent'])}%',
                'Duration / instalments: ${_s(snapshot['durationOptionsWeeks'])} / ${_s(snapshot['weeklyInstallments'])}',
              ]),
              _detailSection('Assignment & finance', [
                'Officer: ${_s(officer['fullName'], _s(detail['assignedOfficer']))}',
                'Status: ${_s(detail['status'])} · deposit ${_money(detail['depositPaid'])}/${_money(detail['depositRequired'])}',
                'Device: ${_s(_map(detail['device'])['imei1'], 'Not assigned')}',
                'Reservation: ${_s(_map(detail['device'])['status'])} · expires ${_s(detail['reservationExpiresAt'], _s(_map(detail['device'])['reservationExpiresAt']))}',
                'Recovery required: ${_s(detail['reservationRecoveryRequiredAt'])}',
                'Refund evidence: ${_s(detail['refundPayment'])} · refunded ${_s(detail['refundedAt'])}',
                'Total payable ${_money(detail['totalPayable'])} · outstanding ${_money(detail['outstandingBalance'])}',
              ]),
              if (verification.isNotEmpty)
                _detailSection('Officer verification', [
                  'Recommendation: ${_s(verification['recommendation'])}',
                  'Income assessment: ${_s(verification['incomeAssessment'])}',
                  'Notes: ${_s(verification['notes'])}',
                  'Guarantor: ${_s(verification['guarantorDetails'])}',
                  'Verified: ${_s(verification['verifiedAt'])}',
                  'Checklist: ${_canonicalFindings(verification['checklist'] ?? verification['findings'])}',
                ]),
              _detailSection(
                  'Status timeline',
                  history.map((h) {
                    final row = _map(h);
                    return '${_s(row['status'])} · ${_s(row['note'])} · ${_s(row['changedAt'])}';
                  }).toList()),
            ]),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
          OutlinedButton(
              onPressed: () => Navigator.pop(ctx, 'OFFICER'),
              child: const Text('Assign officer')),
          if (_refundEligible(detail))
            FilledButton(
                onPressed: () => Navigator.pop(ctx, 'REFUND'),
                child: const Text('Refund deposit and cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, 'ACTIONS'),
              child: const Text('Review actions')),
        ],
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'REFUND') {
      await _refundReservation(detail);
    } else if (action == 'ACTIONS') {
      await _applicationActions(a);
    } else {
      final officerId = await _selectOfficer();
      if (!mounted || officerId == null || officerId.isEmpty) return;
      try {
        await _api.assignOfficer(_id(a), officerId);
        if (!mounted) return;
        _notice('Officer assignment recorded.');
        await _load();
      } catch (e) {
        if (mounted) _notice('$e', error: true);
      }
    }
  }

  String _canonicalFindings(dynamic value) {
    final findings = _map(value);
    if (findings.isEmpty) return 'Not recorded';
    return findings.entries.map((entry) {
      final label =
          entry.key.replaceAllMapped(
              RegExp(r'([A-Z])'), (Match match) => ' ${match.group(1)}');
      final result = entry.value == true
          ? 'Confirmed'
          : entry.value == false
              ? 'Not confirmed'
              : _s(entry.value);
      return '$label: $result';
    }).join(' · ');
  }

  Future<String?> _selectOfficer() async {
    List<Map<String, dynamic>> officers;
    try {
      officers = _list((await _api.officers())['officers'])
          .where((Map<String, dynamic> officer) =>
              _s(officer['status'], 'ACTIVE').toUpperCase() == 'ACTIVE')
          .toList();
    } catch (error) {
      if (!mounted) return null;
      _notice('$error', error: true);
      return null;
    }
    if (!mounted) return null;
    if (officers.isEmpty) {
      _notice('No active Phone Financing Officers are available.', error: true);
      return null;
    }
    String filter = '';
    return showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) {
          final visible = officers.where((Map<String, dynamic> officer) {
            final user = _map(officer['user']);
            final candidate = [
              user['fullName'], officer['fullName'], user['phone'],
              officer['phone'], officer['state'], officer['lga'],
              officer['staffId'],
            ].join(' ').toLowerCase();
            return candidate.contains(filter.toLowerCase());
          }).toList();
          return AlertDialog(
            title: const Text('Assign Phone Financing Officer'),
            content: SizedBox(
              width: 560,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                TextField(
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'Search name, phone, state or reference',
                    prefixIcon: Icon(Icons.search),
                  ),
                  onChanged: (String value) =>
                      setDialogState(() => filter = value),
                ),
                const SizedBox(height: 8),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: visible.map((Map<String, dynamic> officer) {
                      final user = _map(officer['user']);
                      final name = _s(user['fullName'], _s(officer['fullName']));
                      final phone = _s(user['phone'], _s(officer['phone']));
                      final reference = _s(officer['staffId']);
                      return ListTile(
                        leading: const CircleAvatar(child: Icon(Icons.badge_outlined)),
                        title: Text(name),
                        subtitle: Text('$phone • ${_s(officer['state'])} / ${_s(officer['lga'])}\n$reference'),
                        isThreeLine: true,
                        onTap: () => Navigator.pop(dialogContext, _id(officer)),
                      );
                    }).toList(),
                  ),
                ),
                if (visible.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(20),
                    child: Text('No active officers match that search.'),
                  ),
              ]),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Cancel'),
              ),
            ],
          );
        },
      ),
    );
  }

  bool _refundEligible(Map<String, dynamic> application) =>
      _s(application['status']) == 'DEPOSIT_PAID' &&
      application['reservationRecoveryRequiredAt'] != null &&
      _s(_map(application['device'])['status']) == 'RESERVED';

  Future<void> _refundReservation(Map<String, dynamic> application) async {
    final amount = _money(application['depositPaid']);
    final confirmed = await _confirm('Refund deposit and cancel?',
        'Refund exactly $amount to the customer wallet. This releases the reserved IMEI and restores product stock. This cannot be undone.');
    if (!mounted || !confirmed) return;
    final reason = await _ask('Refund recovery reason',
        'Explain why this expired reservation cannot be fulfilled');
    if (!mounted || reason == null || reason.isEmpty) return;
    try {
      final result = await _api.refundDeposit(_id(application),
          reason: reason,
          idempotencyKey: 'refund-${DateTime.now().millisecondsSinceEpoch}');
      if (!mounted) return;
      final payment = _map(result['payment']);
      _notice(
          'Refunded ${_money(payment['amount'])}. Reserved IMEI released and stock restored.');
      await _load();
    } catch (e) {
      _notice('$e', error: true);
    }
  }

  Widget _detailSection(String title, List<String> lines) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title,
              style:
                  const TextStyle(fontWeight: FontWeight.w800, color: _green)),
          const SizedBox(height: 5),
          ...lines.map((line) => Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text(line),
              )),
        ]),
      );

  Future<void> _deviceDetails(Map<String, dynamic> d) => showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
            title: Text(_s(d['reference'])),
            content: Text(
                'IMEI 1: ${_s(d['imei1'])}\nIMEI 2: ${_s(d['imei2'])}\nSerial number: ${_s(d['serialNumber'])}\nStatus: ${_s(d['status'])}'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Close'))
            ],
          ));

  Future<void> _financeActions(Map<String, dynamic> f) async {
    final action = await showModalBottomSheet<String>(
        context: context,
        builder: (ctx) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  title: Text(_s(f['reference']),
                      style: const TextStyle(fontWeight: FontWeight.w800))),
              ListTile(
                  leading: const Icon(Icons.lock_outline),
                  title: const Text('Request restriction'),
                  onTap: () => Navigator.pop(ctx, 'RESTRICT')),
              ListTile(
                  leading: const Icon(Icons.lock_open_outlined),
                  title: const Text('Request restore'),
                  onTap: () => Navigator.pop(ctx, 'RESTORE')),
            ])));
    if (action == null) return;
    if (!await _confirm('Record provider request?',
        'Enforcement is disabled. This will not lock or restore a device.')) {
      return;
    }
    try {
      await _api.providerRequest(_id(f), action,
          idempotencyKey: 'admin-${DateTime.now().millisecondsSinceEpoch}');
      _notice('Provider request recorded. No device action was performed.');
    } catch (e) {
      _notice('$e', error: true);
    }
  }

  Future<void> _financeDetails(Map<String, dynamic> f) async {
    final schedule = f['paymentSchedule'] is List
        ? f['paymentSchedule'] as List
        : <dynamic>[];
    final events =
        f['providerEvents'] is List ? f['providerEvents'] as List : <dynamic>[];
    final action = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(_s(f['reference'], 'Finance detail')),
        content: SizedBox(
          width: 600,
          child: SingleChildScrollView(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Customer: ${_s(_map(f['customer'])['fullName'])}'),
              Text(
                  'Status: ${_s(f['status'])} · outstanding ${_money(f['outstandingBalance'])}'),
              const SizedBox(height: 14),
              const Text('Repayment schedule',
                  style: TextStyle(fontWeight: FontWeight.w800, color: _green)),
              ...schedule.map((item) {
                final row = _map(item);
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(
                      'Instalment ${_s(row['installmentNumber'])} · ${_money(row['amount'])}'),
                  subtitle: Text(
                      'Due ${_s(row['dueDate'])} · paid ${_money(row['paidAmount'])} · ${_s(row['status'])}'),
                );
              }),
              const SizedBox(height: 10),
              const Text('Provider request evidence',
                  style: TextStyle(fontWeight: FontWeight.w800, color: _green)),
              Text(events.isEmpty
                  ? 'No provider request recorded.'
                  : events
                      .map((e) =>
                          '${_s(_map(e)['action'])} · ${_s(_map(e)['outcome'])}')
                      .join('\n')),
              const SizedBox(height: 6),
              const Text(
                  'Enforcement is DISABLED. These records do not mean the device was locked or restored.'),
            ]),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
          if (_s(f['status']) != 'COMPLETED')
            FilledButton(
                onPressed: () => Navigator.pop(ctx, 'PROVIDER'),
                child: const Text('Provider request')),
        ],
      ),
    );
    if (!mounted || action != 'PROVIDER') return;
    await _financeActions(f);
  }

  Future<void> _evaluate() async {
    if (!await _confirm('Evaluate overdue accounts?',
        'This checks grace periods and updates eligible contracts.')) {
      return;
    }
    try {
      final result = await _api.evaluateOverdue();
      _notice(
          'Evaluated ${result['evaluated'] ?? 0} contracts; ${result['overdueUpdated'] ?? 0} updated.');
      await _load();
    } catch (e) {
      _notice('$e', error: true);
    }
  }

  Future<void> _evaluateReservations() async {
    if (!await _confirm('Evaluate expired reservations?',
        'Paid RESERVED devices will be flagged for recovery; no funds are released automatically.')) {
      return;
    }
    if (!mounted) {
      return;
    }
    try {
      final result = await _api.evaluateExpiredReservations();
      if (!mounted) {
        return;
      }
      _notice(
          'Evaluated ${result['evaluated'] ?? 0} reservations; ${_list(result['expiredPaidReservations']).length} require recovery.');
      await _load();
    } catch (e) {
      _notice('$e', error: true);
    }
  }

  Future<String?> _ask(String title, String label) async {
    final c = TextEditingController();
    return showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: Text(title),
                content: TextField(
                    controller: c,
                    maxLines: 3,
                    decoration: InputDecoration(labelText: label)),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, c.text.trim()),
                      child: const Text('Continue'))
                ]));
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(
          context: context,
          builder: (ctx) =>
              AlertDialog(title: Text(title), content: Text(message), actions: [
                TextButton(
                    onPressed: () => Navigator.pop(ctx, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Confirm'))
              ])) ??
      false;
  Future<void> _searchData() async {
    try {
      final q = _search.text;
      if (_tab == 2) {
        _applications =
            _list((await _api.applications(search: q))['applications']);
      }
      if (_tab == 3) {
        _devices = _list((await _api.devices(search: q))['devices']);
      }
      if (_tab == 4 || _tab == 5) {
        _finance = _list((await _api.finance(search: q))['finance']);
      }
      if (mounted) setState(() {});
    } catch (e) {
      _notice('$e', error: true);
    }
  }
}

class _Banner extends StatelessWidget {
  const _Banner();
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
            color: const Color(0xFFDDEEE1),
            borderRadius: BorderRadius.circular(16)),
        child:
            const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(Icons.shield_outlined, color: _green, size: 28),
          SizedBox(width: 14),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text('Audited operations',
                    style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: _ink)),
                SizedBox(height: 4),
                Text('Provider enforcement is disabled',
                    style:
                        TextStyle(fontWeight: FontWeight.w800, color: _green)),
                SizedBox(height: 4),
                Text(
                    'Restriction and restore actions only record provider requests.',
                    style: TextStyle(color: _ink)),
                SizedBox(height: 4),
                Text(
                    'Review each decision, keep stock traceable, and treat provider enforcement as a request-only workflow. Provider enforcement is disabled.'),
              ])),
        ]),
      );
}

class _Loading extends StatelessWidget {
  const _Loading();
  @override
  Widget build(BuildContext context) => ListView(
      padding: const EdgeInsets.all(20),
      children: List.generate(
          6,
          (_) => Container(
              height: 74,
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12)))));
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined,
                size: 42, color: Colors.blueGrey),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            FilledButton.icon(
                onPressed: retry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry')),
          ])));
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(30),
      alignment: Alignment.center,
      child: Column(children: [
        const Icon(Icons.inbox_outlined, size: 38, color: Colors.blueGrey),
        const SizedBox(height: 10),
        Text(text, textAlign: TextAlign.center)
      ]));
}
