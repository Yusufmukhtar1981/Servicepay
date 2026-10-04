part of 'branch_counter_screen.dart';

class BranchCounterCreateScreen extends StatefulWidget {
  const BranchCounterCreateScreen({
    super.key,
    required this.api,
    required this.pendingStore,
    required this.config,
    this.receiptOpener,
  });

  final BranchCounterApi api;
  final CounterPendingIntentStore pendingStore;
  final Map<String, dynamic> config;
  final CounterReceiptOpener? receiptOpener;

  @override
  State<BranchCounterCreateScreen> createState() =>
      _BranchCounterCreateScreenState();
}

class _BranchCounterCreateScreenState extends State<BranchCounterCreateScreen> {
  static const List<String> _keys = <String>[
    'senderName',
    'senderPhone',
    'senderEmail',
    'senderAddress',
    'senderLga',
    'receiverName',
    'receiverPhone',
    'receiverEmail',
    'receiverAddress',
    'receiverLga',
    'description',
    'quantity',
    'weightKg',
    'specialHandlingNote',
  ];

  final Map<String, TextEditingController> _fields =
      <String, TextEditingController>{};
  String _kind = 'DELIVERY';
  String _payment = 'CASH';
  String _category = 'PARCEL';
  String _routeId = '';
  bool _prohibitedItemsAcknowledged = false;
  bool _unusableWalletRetry = false;
  bool _busy = false;
  bool _recovering = false;
  String? _error;
  Map<String, dynamic>? _quote;
  Map<String, dynamic>? _created;

  @override
  void initState() {
    super.initState();
    for (final String key in _keys) {
      _fields[key] = TextEditingController(text: key == 'quantity' ? '1' : '');
    }
    _restorePending();
  }

  @override
  void dispose() {
    for (final TextEditingController controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  String _v(String key) => _fields[key]!.text.trim();
  String get _originState => '${_map(widget.config['branch'])['state'] ?? ''}';
  Map<String, dynamic> get _branch => _map(widget.config['branch']);

  List<Map<String, dynamic>> get _routes {
    final String branchId = '${_branch['_id'] ?? ''}';
    return _maps(widget.config['routes']).where((Map<String, dynamic> route) {
      final String routeBranch = '${route['originBranchId'] ?? ''}';
      final String routeState = '${route['originState'] ?? ''}';
      return (routeBranch.isEmpty ||
              branchId.isEmpty ||
              routeBranch == branchId) &&
          (routeState.isEmpty ||
              routeState.toLowerCase() == _originState.toLowerCase());
    }).toList();
  }

  Map<String, dynamic>? get _selectedRoute {
    for (final Map<String, dynamic> route in _routes) {
      if ('${route['_id']}' == _routeId) return route;
    }
    return null;
  }

  Future<void> _restorePending() async {
    final Map<String, dynamic>? pending = await widget.pendingStore.read();
    if (!mounted || pending == null) return;
    final Map<String, dynamic> draft = _map(pending['draft']);
    final Map<String, dynamic> sender = _map(draft['sender']);
    final Map<String, dynamic> receiver = _map(draft['receiver']);
    final Map<String, dynamic> parcel = _map(draft['parcel']);
    setState(() {
      _recovering = true;
      _kind = '${draft['kind'] ?? 'DELIVERY'}';
      _payment = '${draft['paymentMethod'] ?? 'CASH'}';
      _routeId = '${draft['routeId'] ?? ''}';
      _category = '${parcel['category'] ?? 'PARCEL'}';
      _prohibitedItemsAcknowledged =
          draft['prohibitedItemsAcknowledged'] == true;
      _unusableWalletRetry =
          '${draft['paymentMethod'] ?? ''}'.toUpperCase() == 'WALLET' &&
              '${draft['customerId'] ?? ''}'.trim().isEmpty;
      if (_unusableWalletRetry) {
        _error =
            'This saved wallet request has no linked customer ID. It was not submitted. Only a customer-authorized checkout with a customer account whose saved phone matches the sender can use wallet payment. Contact branch support to resolve this saved attempt.';
      }
      _fields['senderName']!.text = '${sender['name'] ?? ''}';
      _fields['senderPhone']!.text = '${sender['phone'] ?? ''}';
      _fields['senderEmail']!.text = '${sender['email'] ?? ''}';
      _fields['senderAddress']!.text = '${sender['address'] ?? ''}';
      _fields['senderLga']!.text = '${sender['lga'] ?? ''}';
      _fields['receiverName']!.text = '${receiver['name'] ?? ''}';
      _fields['receiverPhone']!.text = '${receiver['phone'] ?? ''}';
      _fields['receiverEmail']!.text = '${receiver['email'] ?? ''}';
      _fields['receiverAddress']!.text = '${receiver['address'] ?? ''}';
      _fields['receiverLga']!.text = '${receiver['lga'] ?? ''}';
      _fields['description']!.text = '${parcel['description'] ?? ''}';
      _fields['quantity']!.text = '${parcel['quantity'] ?? 1}';
      _fields['weightKg']!.text = '${parcel['weightKg'] ?? ''}';
      _fields['specialHandlingNote']!.text =
          '${parcel['specialHandlingNote'] ?? ''}';
      _quote = _map(pending['quote']);
    });
  }

  Map<String, dynamic> _draft() {
    final Map<String, dynamic> route = _selectedRoute ?? <String, dynamic>{};
    return <String, dynamic>{
      'kind': _kind,
      'sender': <String, dynamic>{
        'name': _v('senderName'),
        'phone': _v('senderPhone'),
        if (_v('senderEmail').isNotEmpty) 'email': _v('senderEmail'),
        'address': _v('senderAddress'),
        'state': _originState,
        'lga': _v('senderLga'),
      },
      'receiver': <String, dynamic>{
        'name': _v('receiverName'),
        'phone': _v('receiverPhone'),
        if (_v('receiverEmail').isNotEmpty) 'email': _v('receiverEmail'),
        'address': _v('receiverAddress'),
        'state': _kind == 'DELIVERY'
            ? _originState
            : '${route['destinationState'] ?? ''}',
        'lga': _kind == 'DELIVERY'
            ? _v('receiverLga')
            : '${route['destinationLga'] ?? ''}',
      },
      'parcel': <String, dynamic>{
        'description': _v('description'),
        'quantity': int.tryParse(_v('quantity')) ?? 1,
        'category': _category,
        if (_kind == 'INTERSTATE')
          'weightKg': num.tryParse(_v('weightKg')) ?? 0,
        if (_v('specialHandlingNote').isNotEmpty)
          'specialHandlingNote': _v('specialHandlingNote'),
      },
      if (_kind == 'INTERSTATE' && _routeId.isNotEmpty) 'routeId': _routeId,
      if (_kind == 'INTERSTATE')
        'prohibitedItemsAcknowledged': _prohibitedItemsAcknowledged,
      'paymentMethod': _payment,
    };
  }

  String? _validate() {
    final List<String> required = <String>[
      'senderName',
      'senderPhone',
      'senderAddress',
      'senderLga',
      'receiverName',
      'receiverPhone',
      'receiverAddress',
      'description',
      'quantity',
    ];
    for (final String key in required) {
      if (_v(key).isEmpty) return 'Complete all required parcel and contact fields.';
    }
    final int? quantity = int.tryParse(_v('quantity'));
    if (quantity == null || quantity < 1) return 'Quantity must be at least one.';
    if (_kind == 'INTERSTATE') {
      if (_selectedRoute == null) return 'Select a configured interstate route.';
      final num? weight = num.tryParse(_v('weightKg'));
      if (weight == null || weight <= 0) return 'Enter the parcel weight in kg.';
      if (!_prohibitedItemsAcknowledged) {
        return 'Acknowledge the prohibited-items declaration before quoting this interstate parcel.';
      }
    } else if (_v('receiverLga').isEmpty) {
      return 'Enter the destination LGA or city.';
    }
    return null;
  }

  Future<void> _getQuote() async {
    final String? validation = _validate();
    if (validation != null) {
      setState(() => _error = validation);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final Map<String, dynamic> response = await widget.api.quote(_draft());
      final Map<String, dynamic> quote = _map(response['quote']);
      if (quote['quoteToken'] == null || quote['total'] == null) {
        throw const CounterApiException('A complete server quote was not returned.');
      }
      if (mounted) setState(() => _quote = quote);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    if (_quote == null || _busy || _created != null) return;
    if (_unusableWalletRetry) return;
    final String? validation = _validate();
    if (validation != null) {
      setState(() => _error = validation);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final Map<String, dynamic>? pending = await widget.pendingStore.read();
      final bool resume = _recovering || pending != null;
      final Map<String, dynamic> draft =
          resume ? _map(pending?['draft']) : _draft();
      final String quoteToken = resume
          ? '${pending?['quoteToken'] ?? ''}'
          : '${_quote!['quoteToken']}';
      if (draft.isEmpty || quoteToken.isEmpty) {
        throw const CounterApiException(
            'Saved order details are incomplete. Contact branch support before creating another.');
      }
      final String fingerprint = jsonEncode(draft);
      final String requestKey;
      if (resume) {
        requestKey = '${pending?['idempotencyKey'] ?? ''}';
        if (requestKey.isEmpty || pending?['fingerprint'] != fingerprint) {
          throw const CounterApiException(
              'Saved request details do not match the retry record. Contact branch support.');
        }
      } else {
        requestKey =
            'counter-${DateTime.now().microsecondsSinceEpoch}-${DateTime.now().millisecondsSinceEpoch}';
        final bool saved = await widget.pendingStore.write(<String, dynamic>{
          'draft': draft,
          'quote': _quote,
          'quoteToken': quoteToken,
          'idempotencyKey': requestKey,
          'fingerprint': fingerprint,
          'createdAt': DateTime.now().toUtc().toIso8601String(),
        });
        if (!saved) {
          throw const CounterApiException(
              'Could not save a safe retry record. No order was submitted.');
        }
      }
      final Map<String, dynamic> response = await widget.api.createOrder(
        draft,
        quoteToken: quoteToken,
        idempotencyKey: requestKey,
      );
      final Map<String, dynamic> order = _map(response['order']);
      if (order.isEmpty) {
        throw const CounterApiException(
            'Order response was incomplete. Retry safely to confirm registration.');
      }
      if (!await widget.pendingStore.clear()) {
        throw const CounterApiException(
            'Order may be registered, but the retry record could not be cleared. Retry safely to confirm status.');
      }
      if (mounted) {
        setState(() {
          _created = order;
          _recovering = false;
        });
      }
    } catch (error) {
      // Keep the account-bound quote and idempotency key across ambiguous errors.
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _startAnother() {
    // This action is only reachable after a confirmed order and a cleared intent.
    setState(() {
      _created = null;
      _quote = null;
      _error = null;
      _kind = 'DELIVERY';
      _payment = 'CASH';
      _category = 'PARCEL';
      _routeId = '';
      _prohibitedItemsAcknowledged = false;
      _unusableWalletRetry = false;
      _recovering = false;
      for (final TextEditingController controller in _fields.values) {
        controller.clear();
      }
      _fields['quantity']!.text = '1';
    });
  }

  Widget _textField(String key, String label,
      {bool required = true, TextInputType? keyboard, int maxLines = 1}) {
    return TextField(
      key: Key('counter-field-$key'),
      controller: _fields[key],
      enabled: !_recovering,
      keyboardType: keyboard,
      maxLines: maxLines,
      onChanged: (_) {
        if (_quote != null) setState(() => _quote = null);
      },
      decoration: InputDecoration(
        labelText: required ? '$label *' : label,
        filled: true,
        fillColor: const Color(0xfff8faf8),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xffdfe8e1))),
      ),
    );
  }

  Widget _choiceRow(String title, Map<String, String> choices, String value,
      ValueChanged<String> onChanged) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title,
          style: const TextStyle(
              color: _ink, fontSize: 12, fontWeight: FontWeight.w800)),
      const SizedBox(height: 8),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: choices.entries
            .map((MapEntry<String, String> entry) => ChoiceChip(
                  key: Key('counter-choice-${entry.key}'),
                  label: Text(entry.value),
                  selected: value == entry.key,
                  onSelected: _recovering ? null : (_) => onChanged(entry.key),
                  selectedColor: _forest,
                  labelStyle: TextStyle(
                      color: value == entry.key ? Colors.white : _ink,
                      fontWeight: FontWeight.w700,
                      fontSize: 12),
                  side: const BorderSide(color: Color(0xffdfe8e1)),
                ))
            .toList(),
      ),
    ]);
  }

  Widget _formPage() {
    final List<Widget> fields = <Widget>[
      _textField('senderName', 'Sender name'),
      _textField('senderPhone', 'Sender phone', keyboard: TextInputType.phone),
      _textField('senderEmail', 'Sender email (optional)', required: false),
      _textField('senderAddress', 'Pickup address'),
      _textField('senderLga', 'Origin LGA / city'),
      _textField('receiverName', 'Recipient name'),
      _textField('receiverPhone', 'Recipient phone', keyboard: TextInputType.phone),
      _textField('receiverEmail', 'Recipient email (optional)', required: false),
      _textField('receiverAddress', 'Delivery address'),
      if (_kind == 'DELIVERY') _textField('receiverLga', 'Destination LGA / city'),
    ];
    return Scaffold(
      backgroundColor: _canvas,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: _ink,
        title: const Text('Register parcel',
            style: TextStyle(fontWeight: FontWeight.w800)),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 960),
          child: ListView(
            key: const Key('counter-create-form'),
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 38),
            children: <Widget>[
              _Panel(
                title: '${_branch['name'] ?? 'Branch'} · Delivery counter',
                subtitle:
                    'Create a delivery order from your assigned branch. Fees are quoted by ServicePay.',
                child: _choiceRow(
                  'Order type',
                  const <String, String>{
                    'DELIVERY': 'Within state',
                    'INTERSTATE': 'Interstate'
                  },
                  _kind,
                  (String value) => setState(() {
                    _kind = value;
                    _quote = null;
                    _error = null;
                  }),
                ),
              ),
              const SizedBox(height: 12),
              _Panel(
                title: 'Route & contacts',
                subtitle: 'Use the customer’s preferred reachable details.',
                child: Column(
                  children: <Widget>[
                    if (_kind == 'INTERSTATE') ...<Widget>[
                      DropdownButtonFormField<String>(
                        key: const Key('counter-route'),
                        value: _routes.any((route) => '${route['_id']}' == _routeId)
                            ? _routeId
                            : null,
                        decoration: const InputDecoration(
                            labelText: 'Configured route'),
                        items: _routes
                            .map((Map<String, dynamic> route) =>
                                DropdownMenuItem<String>(
                                  value: '${route['_id']}',
                                  child: Text(
                                      '${route['originState']} → ${route['destinationState']} · ${route['name'] ?? 'Route'}'),
                                ))
                            .toList(),
                        onChanged: _recovering
                            ? null
                            : (String? value) => setState(() {
                                  _routeId = value ?? '';
                                  _quote = null;
                                }),
                      ),
                      const SizedBox(height: 12),
                    ],
                    LayoutBuilder(builder: (context, bounds) {
                      final double width = bounds.maxWidth >= 700
                          ? (bounds.maxWidth - 12) / 2
                          : bounds.maxWidth;
                      return Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        children: fields
                            .map((Widget field) =>
                                SizedBox(width: width, child: field))
                            .toList(),
                      );
                    }),
                    if (_kind == 'INTERSTATE') ...<Widget>[
                      const SizedBox(height: 8),
                      _textField('weightKg', 'Weight (kg)',
                          keyboard: const TextInputType.numberWithOptions(
                              decimal: true)),
                      CheckboxListTile(
                        key: const Key('counter-prohibited-items-ack'),
                        value: _prohibitedItemsAcknowledged,
                        onChanged: _recovering
                            ? null
                            : (bool? value) => setState(() {
                                  _prohibitedItemsAcknowledged =
                                      value ?? false;
                                  _quote = null;
                                }),
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: EdgeInsets.zero,
                        title: const Text(
                            'I confirm this parcel contains no prohibited items.',
                            style: TextStyle(
                                color: _ink,
                                fontSize: 12,
                                fontWeight: FontWeight.w700)),
                        subtitle: const Text(
                            'Required for interstate dispatch. This declaration is recorded with the order.',
                            style: TextStyle(fontSize: 10)),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _Panel(
                title: 'Parcel details',
                subtitle: 'Be specific so the delivery team can identify the item.',
                child: Column(children: <Widget>[
                  _textField('description', 'What is being sent?'),
                  const SizedBox(height: 12),
                  LayoutBuilder(builder: (context, bounds) {
                    final double width =
                        bounds.maxWidth >= 600 ? (bounds.maxWidth - 12) / 2 : bounds.maxWidth;
                    return Wrap(spacing: 12, runSpacing: 12, children: [
                      SizedBox(
                        width: width,
                        child: _textField('quantity', 'Quantity',
                            keyboard: TextInputType.number),
                      ),
                      SizedBox(
                        width: width,
                        child: DropdownButtonFormField<String>(
                          value: _category,
                          decoration:
                              const InputDecoration(labelText: 'Parcel category'),
                          items: const <String>[
                            'PARCEL',
                            'DOCUMENT',
                            'FOOD',
                            'FRAGILE',
                            'ELECTRONICS',
                            'OTHER'
                          ]
                              .map((String item) => DropdownMenuItem<String>(
                                  value: item, child: Text(_human(item))))
                              .toList(),
                          onChanged: _recovering
                              ? null
                              : (String? value) => setState(() {
                                    _category = value ?? 'PARCEL';
                                    _quote = null;
                                  }),
                        ),
                      ),
                    ]);
                  }),
                  const SizedBox(height: 12),
                  _textField('specialHandlingNote',
                      'Special instructions (optional)',
                      required: false, maxLines: 2),
                ]),
              ),
              const SizedBox(height: 12),
              _Panel(
                title: 'Payment at counter',
                subtitle:
                    'Cash, POS and transfer remain UNPAID until manager approval.',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    _choiceRow(
                      'Collection method',
                      const <String, String>{
                        'CASH': 'Cash',
                        'POS': 'POS',
                        'BANK_TRANSFER': 'Transfer'
                      },
                      _payment,
                      (String value) => setState(() {
                        _payment = value;
                        _quote = null;
                      }),
                    ),
                    const SizedBox(height: 12),
                    const _Notice(
                      icon: Icons.lock_outline_rounded,
                      text:
                          'Wallet checkout is customer-authorized. The customer must complete payment in their authenticated ServicePay delivery checkout; this counter does not search customer accounts, link wallets, or debit balances.',
                    ),
                  ],
                ),
              ),
              if (_recovering) ...<Widget>[
                const SizedBox(height: 12),
                const _Notice(
                  icon: Icons.restore_rounded,
                  text:
                      'A saved order attempt is unresolved. The bound quote and request key are locked; retry this same order or leave it for branch support. No new parcel can replace it.',
                ),
              ],
              if (_error != null) ...<Widget>[
                const SizedBox(height: 12),
                _InlineError(_error!),
              ],
              if (_quote != null) ...<Widget>[
                const SizedBox(height: 12),
                _Panel(
                  title: 'Confirmed delivery quote',
                  subtitle:
                      'This amount was calculated by ServicePay and is bound to this order.',
                  child: Column(children: <Widget>[
                    if (_quote!['deliveryFee'] != null)
                      _DetailLine(
                          'Delivery fee', '₦${_money(_quote!['deliveryFee'])}'),
                    ..._chargeDetails(_quote!['charges']),
                    const Divider(),
                    _DetailLine(
                        'Total', '₦${_money(_quote!['total'])}'),
                    if (_quote!['expiresAt'] != null)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                            'Quote valid until ${_quote!['expiresAt']}',
                            style: const TextStyle(
                                color: Color(0xff718177), fontSize: 10)),
                      ),
                  ]),
                ),
              ],
              const SizedBox(height: 14),
              if (_quote == null)
                FilledButton.icon(
                  key: const Key('counter-get-quote'),
                  onPressed: _busy || _recovering ? null : _getQuote,
                  icon: _busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.calculate_outlined),
                  label: Text(_busy ? 'Getting authoritative quote…' : 'Get quote'),
                  style: FilledButton.styleFrom(
                      backgroundColor: _green,
                      minimumSize: const Size.fromHeight(50)),
                )
              else
                FilledButton.icon(
                  key: const Key('counter-submit-order'),
                  onPressed:
                      _busy || _unusableWalletRetry ? null : _submit,
                  icon: _busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.check_circle_outline_rounded),
                  label: Text(_busy
                      ? 'Submitting safely…'
                      : _unusableWalletRetry
                          ? 'Wallet request needs support'
                      : _recovering
                          ? 'Retry saved order'
                          : 'Register parcel'),
                  style: FilledButton.styleFrom(
                      backgroundColor: _green,
                      minimumSize: const Size.fromHeight(50)),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _successPage() {
    final Map<String, dynamic> order = _created!;
    final Map<String, dynamic> sender = _map(order['sender']);
    final Map<String, dynamic> receiver = _map(order['receiver']);
    return Scaffold(
      backgroundColor: _canvas,
      appBar: AppBar(
          backgroundColor: Colors.white,
          foregroundColor: _ink,
          title: const Text('Order registered')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: ListView(
            padding: const EdgeInsets.all(20),
            shrinkWrap: true,
            children: <Widget>[
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(color: const Color(0xffe2ebe4))),
                child: Column(children: <Widget>[
                  const Icon(Icons.check_circle_rounded,
                      color: _green, size: 50),
                  const SizedBox(height: 10),
                  const Text('Parcel registered',
                      style: TextStyle(
                          color: _ink,
                          fontSize: 23,
                          fontWeight: FontWeight.w900)),
                  const SizedBox(height: 5),
                  const Text(
                      'Your order is in the ServicePay delivery workflow.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Color(0xff65776d))),
                  const SizedBox(height: 18),
                  _TrackingBlock(
                    tracking: '${order['trackingNumber'] ?? 'Awaiting tracking'}',
                    receipt: '${order['receiptNumber'] ?? '—'}',
                  ),
                  const SizedBox(height: 12),
                  _DetailLine('Sender / recipient',
                      '${sender['name'] ?? 'Sender'} → ${receiver['name'] ?? 'Recipient'}'),
                  if (order['deliveryFee'] != null)
                    _DetailLine('Delivery fee',
                        '₦${_money(order['deliveryFee'])}'),
                  ..._chargeDetails(order['charges']),
                  _DetailLine('Total', '₦${_money(order['total'])}'),
                  const _Notice(
                      icon: Icons.pending_actions_outlined,
                      text:
                          'Payment is not marked paid by order registration. A manager must approve counter payment evidence.'),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () => Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (_) => BranchCounterOrderScreen(
                            api: widget.api,
                            order: order,
                            config: widget.config,
                            receiptOpener: widget.receiptOpener,
                          ),
                        ),
                      ),
                      icon: const Icon(Icons.open_in_new_rounded),
                      label: const Text('Open parcel details'),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: _startAnother,
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Create another parcel'),
                  ),
                ]),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) =>
      _created == null ? _formPage() : _successPage();
}