part of 'branch_counter_screen.dart';

class BranchCounterScreen extends StatefulWidget {
  const BranchCounterScreen({
    super.key,
    this.api,
    this.pendingStore,
    this.receiptOpener,
    this.staffMode = false,
  });

  final BranchCounterApi? api;
  final CounterPendingIntentStore? pendingStore;
  final CounterReceiptOpener? receiptOpener;
  final bool staffMode;

  @override
  State<BranchCounterScreen> createState() => _BranchCounterScreenState();
}

class _BranchCounterScreenState extends State<BranchCounterScreen> {
  late final BranchCounterApi _api = widget.api ?? BranchCounterHttpApi();
  late final CounterPendingIntentStore _pending =
      widget.pendingStore ?? CounterPendingIntentStore();
  final TextEditingController _search = TextEditingController();
  Map<String, dynamic> _config = <String, dynamic>{};
  Map<String, dynamic> _stats = <String, dynamic>{};
  List<Map<String, dynamic>> _orders = <Map<String, dynamic>>[];
  String _status = 'ALL';
  String _query = '';
  bool _loading = true;
  String? _error;
  int _page = 1;
  int _total = 0;

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

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<dynamic> result = await Future.wait<dynamic>(<Future<dynamic>>[
        _api.loadConfig(),
        _api.listOrders(
            status: _status, search: _query, page: _page),
      ]);
      final Map<String, dynamic> list = _map(result[1]);
      if (!mounted) return;
      setState(() {
        _config = _map(result[0]);
        _stats = _map(list['stats']);
        _orders = _maps(list['orders']);
        _page = _int(list['page'], _page);
        _total = _int(list['total'], _orders.length);
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _filter(String value) async {
    setState(() {
      _status = value;
      _page = 1;
    });
    await _load();
  }

  Future<void> _searchOrders(String value) async {
    _query = value.trim();
    _page = 1;
    await _load();
  }

  Future<void> _create() async {
    final Map<String, dynamic>? order =
        await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute<Map<String, dynamic>>(
        builder: (_) => BranchCounterCreateScreen(
          api: _api,
          pendingStore: _pending,
          config: _config,
          receiptOpener: widget.receiptOpener,
        ),
      ),
    );
    if (order == null || !mounted) return;
    await _load();
    if (!mounted) return;
    await _openOrder(order);
  }

  Future<void> _openOrder(Map<String, dynamic> order) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => BranchCounterOrderScreen(
          api: _api,
          order: order,
          config: _config,
          receiptOpener: widget.receiptOpener,
        ),
      ),
    );
    if (mounted) _load();
  }

  Future<void> _logout() async {
    await SessionStore.clear();
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    for (final String key in <String>[
      'user_id',
      'user_name',
      'user_phone',
      'user_email',
      'user_role',
      'user_status',
      'wallet_balance',
      'branch_id',
      'branch_code',
      'branch_name',
      'branch_profile',
      'branch_manager_profile',
    ]) {
      await prefs.remove(key);
    }
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
      (Route<dynamic> route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool initialLoading = _loading && _config.isEmpty;
    return Scaffold(
      backgroundColor: _canvas,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: _ink,
        elevation: 0,
        title: const Text('Delivery & Logistics',
            style: TextStyle(fontWeight: FontWeight.w800)),
        actions: <Widget>[
          if (widget.staffMode)
            IconButton(
              key: const Key('branch-counter-staff-logout'),
              tooltip: 'Sign out',
              onPressed: _logout,
              icon: const Icon(Icons.logout_rounded),
            ),
          IconButton(
            tooltip: 'Refresh orders',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
          const SizedBox(width: 6),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('counter-create-order'),
        onPressed: _create,
        backgroundColor: _green,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text('New parcel'),
      ),
      body: initialLoading
          ? const _CounterSkeleton()
          : _error != null && _config.isEmpty
              ? _CounterError(message: _error!, retry: _load)
              : RefreshIndicator(
                  color: _green,
                  onRefresh: _load,
                  child: LayoutBuilder(
                    builder: (BuildContext context, BoxConstraints bounds) {
                      final bool wide = bounds.maxWidth >= 900;
                      return ListView(
                        padding: EdgeInsets.fromLTRB(
                            wide ? 30 : 16, 20, wide ? 30 : 16, 100),
                        children: <Widget>[
                          _CounterHeading(config: _config, wide: wide),
                          const SizedBox(height: 18),
                          _StatsGrid(stats: _stats, width: bounds.maxWidth),
                          const SizedBox(height: 22),
                          TextField(
                            controller: _search,
                            key: const Key('counter-search'),
                            onSubmitted: _searchOrders,
                            textInputAction: TextInputAction.search,
                            decoration: InputDecoration(
                              hintText: 'Tracking number, name or phone',
                              prefixIcon: const Icon(Icons.search_rounded),
                              suffixIcon: IconButton(
                                tooltip: 'Search orders',
                                onPressed: () => _searchOrders(_search.text),
                                icon: const Icon(Icons.arrow_forward_rounded),
                              ),
                              filled: true,
                              fillColor: Colors.white,
                              border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(14),
                                  borderSide: const BorderSide(
                                      color: Color(0xffe1e9e3))),
                              enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(14),
                                  borderSide: const BorderSide(
                                      color: Color(0xffe1e9e3))),
                            ),
                          ),
                          const SizedBox(height: 12),
                          SizedBox(
                            height: 42,
                            child: ListView(
                              scrollDirection: Axis.horizontal,
                              children: <String>[
                                'ALL',
                                'PENDING',
                                'IN_TRANSIT',
                                'DELIVERED',
                                'CANCELLED',
                              ].map((String value) {
                                final bool selected = _status == value;
                                return Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: ChoiceChip(
                                    key: Key('counter-status-$value'),
                                    label: Text(_human(value)),
                                    selected: selected,
                                    onSelected: (_) => _filter(value),
                                    selectedColor: _forest,
                                    backgroundColor: Colors.white,
                                    labelStyle: TextStyle(
                                      color: selected ? Colors.white : _ink,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 12,
                                    ),
                                    side: BorderSide(
                                        color: selected
                                            ? _forest
                                            : const Color(0xffdce6df)),
                                    shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(22)),
                                  ),
                                );
                              }).toList(),
                            ),
                          ),
                          const SizedBox(height: 12),
                          if (_error != null) _InlineError(_error!),
                          if (_loading)
                            const LinearProgressIndicator(minHeight: 2),
                          if (_orders.isEmpty && !_loading)
                            _CounterEmpty(onCreate: _create)
                          else
                            ..._orders.map((Map<String, dynamic> order) =>
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 9),
                                  child: _OrderTile(
                                    order: order,
                                    onTap: () => _openOrder(order),
                                  ),
                                )),
                          if (_total > _orders.length)
                            Align(
                              alignment: Alignment.center,
                              child: TextButton.icon(
                                onPressed: _page * 20 >= _total
                                    ? null
                                    : () {
                                        setState(() => _page++);
                                        _load();
                                      },
                                icon: const Icon(Icons.expand_more_rounded),
                                label: Text(
                                    'Load more · ${_orders.length} of $_total'),
                              ),
                            ),
                        ],
                      );
                    },
                  ),
                ),
    );
  }
}