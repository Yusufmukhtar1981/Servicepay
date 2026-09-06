import 'package:flutter/material.dart';

import 'admin_customer_360_api.dart';

class AdminCustomer360Screen extends StatefulWidget {
  const AdminCustomer360Screen({super.key, this.api});

  final AdminCustomer360Api? api;

  @override
  State<AdminCustomer360Screen> createState() => _AdminCustomer360ScreenState();
}

class _AdminCustomer360ScreenState extends State<AdminCustomer360Screen> {
  static const _ink = Color(0xff173b40);
  static const _teal = Color(0xff087f78);
  static const _mint = Color(0xffe7f4ef);
  static const _canvas = Color(0xfff3f7f5);
  late final AdminCustomer360Api _api = widget.api ?? AdminCustomer360Api();
  final _search = TextEditingController();
  final _transactionSearch = TextEditingController();
  final _from = TextEditingController();
  final _to = TextEditingController();
  String _transactionStatus = '';
  String _transactionService = '';
  List<Map<String, dynamic>> _results = [];
  Map<String, dynamic>? _customer;
  List<Map<String, dynamic>> _timeline = [];
  List<Map<String, dynamic>> _transactions = [];
  String? _error;
  bool _searching = false;
  bool _loading = false;
  String? _selectedId;
  int _timelinePage = 1;
  int _transactionPage = 1;
  Map<String, dynamic> _timelinePagination = {};
  Map<String, dynamic> _transactionPagination = {};

  @override
  void dispose() {
    _search.dispose();
    _transactionSearch.dispose();
    _from.dispose();
    _to.dispose();
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Future<void> _find() async {
    final query = _search.text.trim();
    if (query.isEmpty) return;
    setState(() {
      _searching = true;
      _error = null;
      _customer = null;
      _selectedId = null;
    });
    try {
      final results = await _api.search(query);
      if (mounted) setState(() => _results = results);
    } catch (e) {
      if (mounted) setState(() => _error = _cleanError(e));
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _select(Map<String, dynamic> item) async {
    final id = _text(item['id']);
    if (id.isEmpty) return;
    setState(() {
      _selectedId = id;
      _loading = true;
      _error = null;
      _customer = null;
      _timeline = [];
      _transactions = [];
    });
    try {
      _timelinePage = 1;
      _transactionPage = 1;
      final responses = await Future.wait<dynamic>([
        _api.overview(id),
        _api.timeline(id),
        _api.transactions(id),
      ]);
      final overview = responses[0] as Map<String, dynamic>;
      final timeline = responses[1] as AdminCustomer360Page;
      final transactions = responses[2] as AdminCustomer360Page;
      if (mounted) {
        setState(() {
          _customer = overview;
          _timeline = timeline.items;
          _transactions = transactions.items;
          _timelinePagination = timeline.pagination;
          _transactionPagination = transactions.pagination;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = _cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _cleanError(Object e) =>
      e.toString().replaceFirst('Exception: ', '').trim();
  String _text(dynamic value, [String fallback = '—']) {
    final text = value?.toString().trim() ?? '';
    return text.isEmpty ? fallback : text;
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : {};
  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map(Map<String, dynamic>.from).toList()
      : [];
  List<dynamic> _signals(dynamic value) => value is List ? value : const [];
  bool _cap(String key) {
    final capabilities = _map(_customer?['capabilities']);
    final value = capabilities[key];
    return value == true || value == 'true' || value == 'VIEW';
  }

  bool _pageFlag(Map<String, dynamic> pagination, String key, bool fallback) =>
      pagination[key] is bool ? pagination[key] as bool : fallback;
  bool _hasNext(Map<String, dynamic> p) => _pageFlag(
      p, 'hasNextPage', _pageValue(p, 'totalPages') > _pageValue(p, 'page'));
  bool _hasPrevious(Map<String, dynamic> p) =>
      _pageFlag(p, 'hasPreviousPage', _pageValue(p, 'page') > 1);
  int _pageValue(Map<String, dynamic> p, String key) {
    final value = p[key] ?? (key == 'page' ? p['currentPage'] : null);
    return value is num ? value.toInt() : int.tryParse('$value') ?? 0;
  }

  Future<void> _loadTimeline(int page) async {
    if (_selectedId == null) return;
    try {
      final result = await _api.timeline(_selectedId!, page: page);
      if (mounted) {
        setState(() {
          _timeline = result.items;
          _timelinePagination = result.pagination;
          _timelinePage = page;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = _cleanError(e));
    }
  }

  Future<void> _loadTransactions(int page) async {
    if (_selectedId == null) return;
    try {
      final result = await _api.transactions(_selectedId!,
          page: page,
          status: _transactionStatus,
          serviceType: _transactionService,
          search: _transactionSearch.text.trim(),
          from: _from.text.trim(),
          to: _to.text.trim());
      if (mounted) {
        setState(() {
          _transactions = result.items;
          _transactionPagination = result.pagination;
          _transactionPage = page;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = _cleanError(e));
    }
  }

  String _label(String value) => value
      .replaceAll('_', ' ')
      .toLowerCase()
      .split(' ')
      .map((word) =>
          word.isEmpty ? '' : '${word[0].toUpperCase()}${word.substring(1)}')
      .join(' ');
  String _date(dynamic value) {
    final date = DateTime.tryParse(_text(value, ''));
    if (date == null) return 'Date unavailable';
    final d = date.toLocal();
    return '${d.day.toString().padLeft(2, '0')} ${_months[d.month - 1]} ${d.year} · ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  static const _months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];
  String _money(dynamic value) {
    final amount = value is num ? value.toDouble() : double.tryParse('$value');
    if (amount == null) return '—';
    return '₦${amount.toStringAsFixed(2).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _canvas,
      appBar: AppBar(
        backgroundColor: _canvas,
        foregroundColor: _ink,
        elevation: 0,
        title: const Text('Customer 360',
            style: TextStyle(fontWeight: FontWeight.w800)),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16, top: 12, bottom: 12),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
                color: _mint, borderRadius: BorderRadius.circular(20)),
            child: const Row(children: [
              Icon(Icons.lock_outline, size: 14, color: _teal),
              SizedBox(width: 6),
              Text('READ ONLY',
                  style: TextStyle(
                      color: _teal, fontSize: 11, fontWeight: FontWeight.w800))
            ]),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _selectedId == null
            ? () async => _find()
            : () async => _select({'id': _selectedId}),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 40),
          children: [
            _intro(),
            const SizedBox(height: 16),
            _searchPanel(),
            if (_error != null) _errorPanel(),
            if (_searching) const _Skeleton(),
            if (!_searching && _results.isNotEmpty) _resultsPanel(),
            if (_loading) const _Skeleton(),
            if (!_loading && _customer != null) _workspace(),
            if (!_searching &&
                _results.isEmpty &&
                _customer == null &&
                _error == null)
              _emptyState(),
          ],
        ),
      ),
    );
  }

  Widget _intro() => Container(
        padding: const EdgeInsets.all(22),
        decoration:
            BoxDecoration(color: _ink, borderRadius: BorderRadius.circular(22)),
        child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('SERVICEPAY / OPERATIONS',
                  style: TextStyle(
                      color: Color(0xff8fd2c5),
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.5)),
              SizedBox(height: 12),
              Text('The customer, in context.',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      height: 1.05)),
              SizedBox(height: 8),
              Text(
                  'A live, permission-aware view across identity, money, usage and support.',
                  style: TextStyle(color: Color(0xffc0d8d3), height: 1.4)),
              SizedBox(height: 16),
              Row(children: [
                Icon(Icons.visibility_outlined,
                    color: Color(0xff8fd2c5), size: 17),
                SizedBox(width: 8),
                Text('Viewing only · no changes can be made here',
                    style: TextStyle(
                        color: Color(0xffdcebe7),
                        fontSize: 12,
                        fontWeight: FontWeight.w600))
              ]),
            ]),
      );

  Widget _searchPanel() => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xffdbe9e4))),
        child: TextField(
          controller: _search,
          onSubmitted: (_) => _find(),
          decoration: InputDecoration(
            hintText: 'Search name, ServicePay ID, phone, email, NIN or BVN',
            prefixIcon: const Icon(Icons.search, color: _teal),
            suffixIcon: IconButton(
                onPressed: _searching ? null : _find,
                icon: const Icon(Icons.arrow_forward_rounded)),
            filled: true,
            fillColor: const Color(0xfff7faf8),
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(13),
                borderSide: BorderSide.none),
          ),
        ),
      );

  Widget _resultsPanel() => _Card(
        title: 'Search results',
        trailing: Text('${_results.length} found',
            style: const TextStyle(color: Color(0xff708783), fontSize: 12)),
        child: Column(
            children: _results
                .map((item) => ListTile(
                      onTap: () => _select(item),
                      contentPadding: EdgeInsets.zero,
                      leading: CircleAvatar(
                          backgroundColor: _mint,
                          foregroundColor: _teal,
                          child: Text(_text(item['fullName'], '?')
                              .substring(0, 1)
                              .toUpperCase())),
                      title: Text(_text(item['fullName']),
                          style: const TextStyle(
                              fontWeight: FontWeight.w800, color: _ink)),
                      subtitle: Text(
                          '${_text(item['servicePayId'])}  ·  ${_text(item['phone'])}  ·  ${_text(item['email'])}',
                          style: const TextStyle(fontSize: 12)),
                      trailing: _Pill(_label(_text(item['status']))),
                    ))
                .toList()),
      );

  Widget _workspace() {
    final profile = _map(_customer!['profile']);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SizedBox(height: 18),
      _profileHeader(profile),
      const SizedBox(height: 14),
      if (_cap('financial'))
        _financial(_map(_customer!['financial']))
      else
        _limited('Financial context is not included for your current access.'),
      if (_cap('kyc'))
        _identity(_map(_customer!['identity']))
      else
        _limited('Identity context is not included for your current access.'),
      _usage(_list(_customer!['usage'])),
      if (_cap('support'))
        _support(_map(_customer!['support']))
      else
        _limited('Support context is not included for your current access.'),
      if (_cap('security'))
        _risk(_map(_customer!['risk']))
      else
        _limited('Risk context is not included for your current access.'),
      _timelineCard(),
      if (_cap('financial'))
        _transactionsCard()
      else
        _limited(
            'Transactions are not included for your current financial access.'),
    ]);
  }

  Widget _profileHeader(Map<String, dynamic> p) => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(20)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(
              radius: 27,
              backgroundColor: _teal,
              child: Text(
                  _text(p['fullName'], '?').substring(0, 1).toUpperCase(),
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 21,
                      fontWeight: FontWeight.w800))),
          const SizedBox(width: 14),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(_text(p['fullName']),
                    style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: _ink)),
                const SizedBox(height: 5),
                Text('${_text(p['servicePayId'])}  ·  ${_text(p['phone'])}',
                    style: const TextStyle(color: Color(0xff607773))),
                const SizedBox(height: 10),
                Wrap(spacing: 7, runSpacing: 6, children: [
                  _Pill(_label(_text(p['status']))),
                  _Pill('KYC ${_label(_text(p['kycStatus']))}')
                ]),
              ])),
        ]),
      );

  Widget _financial(Map<String, dynamic> f) => _Card(
      title: 'Financial snapshot',
      child: Wrap(spacing: 10, runSpacing: 10, children: [
        _Metric('Wallet balance', _money(f['walletBalance']), strong: true),
        _Metric('Held balance', _money(f['heldBalance'])),
        _Metric('Money in', _money(f['totalMoneyIn'])),
        _Metric('Money out', _money(f['totalMoneyOut'])),
        _Metric('Transactions', _text(f['totalTransactionCount'])),
        _Metric('Successful', _text(f['successfulTransactions'])),
        _Metric('Pending', _text(f['pendingTransactions'])),
        _Metric('Failed', _text(f['failedTransactions'])),
        _Metric('Withdrawals',
            '${_money(f['totalWithdrawals'])} · ${_text(f['withdrawalCount'])} count'),
        _Metric('ServicePay transfers', _text(f['totalServicePayTransfers'])),
      ]));
  Widget _identity(Map<String, dynamic> i) => _Card(
      title: 'Identity & verification',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 10, runSpacing: 10, children: [
          _Metric('Tier', _text(i['tier'])),
          _Metric('Status', _label(_text(i['status']))),
          _Metric('Match', _label(_text(i['identityMatchStatus']))),
          _Metric('NIN', _label(_text(_map(i['nin'])['status']))),
          _Metric('BVN', _label(_text(_map(i['bvn'])['status']))),
        ]),
        const SizedBox(height: 14),
        Text(
            'NIN  ${_text(_map(i['nin'])['masked'])}  ·  ${_label(_text(_map(i['nin'])['status']))}',
            style: const TextStyle(color: Color(0xff526c67))),
        const SizedBox(height: 6),
        Text(
            'BVN  ${_text(_map(i['bvn'])['masked'])}  ·  ${_label(_text(_map(i['bvn'])['status']))}',
            style: const TextStyle(color: Color(0xff526c67))),
        const SizedBox(height: 12),
        Text('Submitted documents',
            style: const TextStyle(fontWeight: FontWeight.w800, color: _ink)),
        const SizedBox(height: 6),
        ..._map(i['documents']).entries.map((entry) => _line(_label(entry.key),
            entry.value == true ? 'Submitted' : 'Not submitted')),
        if (_list(i['verificationHistory']).isNotEmpty) ...[
          const SizedBox(height: 8),
          const Text('Verification history',
              style: TextStyle(fontWeight: FontWeight.w800, color: _ink)),
          ..._list(i['verificationHistory']).map((entry) => _line(
              _label(_text(entry['status'])),
              _date(entry['createdAt'] ?? entry['occurredAt']))),
        ],
      ]));
  Widget _usage(List<Map<String, dynamic>> items) => _Card(
      title: 'Service usage',
      child: items.isEmpty
          ? const Text('No usage recorded.',
              style: TextStyle(color: Color(0xff708783)))
          : Column(
              children: items
                  .map((u) => _line(_label(_text(u['service'])),
                      '${_text(u['count'])} total · ${_text(u['successful'])} successful'))
                  .toList()));
  Widget _support(Map<String, dynamic> s) => _Card(
      title: 'Support',
      child: Wrap(spacing: 10, runSpacing: 10, children: [
        _Metric('Total', _text(s['total'])),
        _Metric('Open', _text(s['open'])),
        _Metric('Resolved', _text(s['resolved'])),
        _Metric('Latest', _date(s['latestAt']))
      ]));
  Widget _risk(Map<String, dynamic> r) => _Card(
      title: 'Risk signals',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _Pill(_label(_text(r['label']))),
        const SizedBox(height: 10),
        Text(
            'Failed logins (30d): ${_text(r['failedLogins30d'])}  ·  Failed transactions (30d): ${_text(r['failedTransactions30d'])}',
            style: const TextStyle(color: Color(0xff526c67))),
        const SizedBox(height: 8),
        if (_signals(r['signals']).isEmpty)
          const Text('No signal detail provided.',
              style: TextStyle(color: Color(0xff526c67)))
        else
          ..._signals(r['signals']).map((signal) {
            final map = _map(signal);
            return _line(
                _label(_text(map['type'] ?? map['label'], 'Signal')),
                map.isEmpty
                    ? _text(signal)
                    : _text(map['detail'] ?? map['description']));
          })
      ]));
  Widget _timelineCard() => _Card(
        title: 'Activity timeline',
        trailing: _pager(_timelinePagination, _timelinePage, _loadTimeline),
        child: _timeline.isEmpty
            ? const Text('No activity recorded.',
                style: TextStyle(color: Color(0xff708783)))
            : Column(
                children: _timeline
                    .map((e) => _line(
                        '${_label(_text(e['type']))} · ${_label(_text(e['status']))}',
                        '${_date(e['occurredAt'])}  ·  ${_text(e['reference'])}${e['amount'] == null ? '' : '  ·  ${_money(e['amount'])}'}'))
                    .toList()),
      );
  Widget _transactionsCard() => _Card(
      title: 'Transactions',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _transactionFilters(),
        const SizedBox(height: 10),
        _transactions.isEmpty
            ? const Text('No transactions recorded.',
                style: TextStyle(color: Color(0xff708783)))
            : Column(
                children: _transactions
                    .map((t) => _line(
                        '${_text(t['reference'])} · ${_label(_text(t['serviceType']))}',
                        '${_money(t['amount'])}  ·  ${_label(_text(t['status']))}  ·  ${_date(t['createdAt'])}'))
                    .toList()),
        _pager(_transactionPagination, _transactionPage, _loadTransactions),
      ]));
  Widget _transactionFilters() =>
      LayoutBuilder(builder: (context, constraints) {
        final width = constraints.maxWidth < 540
            ? constraints.maxWidth
            : (constraints.maxWidth - 12) / 2;
        InputDecoration decoration(String label) => InputDecoration(
            labelText: label,
            isDense: true,
            border:
                OutlineInputBorder(borderRadius: BorderRadius.circular(11)));
        return Wrap(spacing: 12, runSpacing: 10, children: [
          SizedBox(
              width: width,
              child: DropdownButtonFormField<String>(
                  value: _transactionStatus,
                  decoration: decoration('Status'),
                  items: const [
                    DropdownMenuItem(value: '', child: Text('All statuses')),
                    DropdownMenuItem(
                        value: 'SUCCESSFUL', child: Text('Successful')),
                    DropdownMenuItem(value: 'PENDING', child: Text('Pending')),
                    DropdownMenuItem(value: 'FAILED', child: Text('Failed')),
                  ],
                  onChanged: (value) =>
                      setState(() => _transactionStatus = value ?? ''))),
          SizedBox(
              width: width,
              child: DropdownButtonFormField<String>(
                  value: _transactionService,
                  decoration: decoration('Service type'),
                  items: const [
                    DropdownMenuItem(value: '', child: Text('All services')),
                    DropdownMenuItem(value: 'AIRTIME', child: Text('Airtime')),
                    DropdownMenuItem(value: 'DATA', child: Text('Data')),
                    DropdownMenuItem(
                        value: 'TRANSFER', child: Text('Transfer')),
                    DropdownMenuItem(
                        value: 'ELECTRICITY', child: Text('Electricity')),
                  ],
                  onChanged: (value) =>
                      setState(() => _transactionService = value ?? ''))),
          SizedBox(
              width: width,
              child: TextField(
                  controller: _transactionSearch,
                  decoration: decoration('Reference or transaction search'))),
          SizedBox(
              width: width,
              child: TextField(
                  controller: _from,
                  decoration: decoration('From date (YYYY-MM-DD)'))),
          SizedBox(
              width: width,
              child: TextField(
                  controller: _to,
                  decoration: decoration('To date (YYYY-MM-DD)'))),
          SizedBox(
              height: 42,
              child: FilledButton.icon(
                  onPressed: () {
                    _transactionPage = 1;
                    _loadTransactions(1);
                  },
                  icon: const Icon(Icons.filter_alt_outlined, size: 17),
                  label: const Text('Apply filters'))),
        ]);
      });

  Widget _pager(Map<String, dynamic> pagination, int page,
      Future<void> Function(int) load) {
    final previous = _hasPrevious(pagination);
    final next = _hasNext(pagination);
    final total = _pageValue(pagination, 'totalPages');
    return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
          Text(total > 0 ? 'Page $page of $total' : 'Page $page',
              style: const TextStyle(color: Color(0xff708783), fontSize: 12)),
          const SizedBox(width: 8),
          IconButton(
              tooltip: 'Previous page',
              onPressed: previous ? () => load(page - 1) : null,
              icon: const Icon(Icons.chevron_left)),
          IconButton(
              tooltip: 'Next page',
              onPressed: next ? () => load(page + 1) : null,
              icon: const Icon(Icons.chevron_right)),
        ]));
  }

  Widget _limited(String text) => Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: const Color(0xffeef3f1),
          borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        const Icon(Icons.lock_outline, size: 16, color: Color(0xff78918c)),
        const SizedBox(width: 9),
        Expanded(
            child: Text(text,
                style: const TextStyle(color: Color(0xff627b76), fontSize: 12)))
      ]));
  Widget _line(String title, String subtitle) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
            width: 7,
            height: 7,
            margin: const EdgeInsets.only(top: 5),
            decoration:
                const BoxDecoration(color: _teal, shape: BoxShape.circle)),
        const SizedBox(width: 10),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title,
              style: const TextStyle(color: _ink, fontWeight: FontWeight.w700)),
          const SizedBox(height: 3),
          Text(subtitle,
              style: const TextStyle(color: Color(0xff708783), fontSize: 12))
        ]))
      ]));
  Widget _errorPanel() => Container(
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
          color: const Color(0xfffff1ef),
          borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        const Icon(Icons.error_outline, color: Color(0xffbb4a3b)),
        const SizedBox(width: 10),
        Expanded(
            child: Text(_error!,
                style: const TextStyle(color: Color(0xff8d3d33)))),
        TextButton(onPressed: _find, child: const Text('Retry'))
      ]));
  Widget _emptyState() => const Padding(
      padding: EdgeInsets.only(top: 44),
      child: Column(children: [
        Icon(Icons.manage_search, size: 45, color: Color(0xff99b0aa)),
        SizedBox(height: 12),
        Text('Search for a customer to begin',
            style: TextStyle(
                color: _ink, fontWeight: FontWeight.w800, fontSize: 16)),
        SizedBox(height: 5),
        Text('Results are limited to the records your role can view.',
            style: TextStyle(color: Color(0xff708783)))
      ]));
}

class _Card extends StatelessWidget {
  const _Card({required this.title, required this.child, this.trailing});
  final String title;
  final Widget child;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xffdce9e5))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(title,
              style: const TextStyle(
                  color: _AdminCustomer360ScreenState._ink,
                  fontWeight: FontWeight.w800,
                  fontSize: 15)),
          const Spacer(),
          if (trailing != null) trailing!
        ]),
        const SizedBox(height: 13),
        child
      ]));
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value, {this.strong = false});
  final String label, value;
  final bool strong;
  @override
  Widget build(BuildContext context) => Container(
      width: 145,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: const Color(0xfff4f8f6),
          borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(color: Color(0xff708783), fontSize: 11)),
        const SizedBox(height: 5),
        Text(value,
            style: TextStyle(
                color: _AdminCustomer360ScreenState._ink,
                fontWeight: strong ? FontWeight.w900 : FontWeight.w700,
                fontSize: strong ? 17 : 14))
      ]));
}

class _Pill extends StatelessWidget {
  const _Pill(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
          color: const Color(0xffe7f4ef),
          borderRadius: BorderRadius.circular(20)),
      child: Text(text,
          style: const TextStyle(
              color: Color(0xff087f78),
              fontSize: 11,
              fontWeight: FontWeight.w800)));
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext context) => Container(
      height: 125,
      margin: const EdgeInsets.only(top: 14),
      decoration: BoxDecoration(
          color: const Color(0xffe4eeea),
          borderRadius: BorderRadius.circular(18)));
}
