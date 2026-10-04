part of 'branch_counter_screen.dart';

class BranchCounterOrderScreen extends StatefulWidget {
  const BranchCounterOrderScreen({
    super.key,
    required this.api,
    required this.order,
    required this.config,
    this.receiptOpener,
  });

  final BranchCounterApi api;
  final Map<String, dynamic> order;
  final Map<String, dynamic> config;
  final CounterReceiptOpener? receiptOpener;

  @override
  State<BranchCounterOrderScreen> createState() =>
      _BranchCounterOrderScreenState();
}

class _BranchCounterOrderScreenState extends State<BranchCounterOrderScreen> {
  late Map<String, dynamic> _order = widget.order;
  bool _loading = false;
  String? _error;

  String get _id => '${_order['_id'] ?? _order['id'] ?? ''}';
  String get _kind => '${_order['kind'] ?? 'DELIVERY'}';
  Map<String, dynamic> get _payment => _map(_order['payment']);
  bool get _wallet =>
      '${_payment['method'] ?? ''}'.toUpperCase() == 'WALLET';
  bool get _unpaid =>
      '${_order['paymentStatus'] ?? 'UNPAID'}'.toUpperCase() != 'PAID';
  bool get _managerCanConfirm =>
      _map(widget.config['branch']).isNotEmpty &&
      widget.config['canConfirmPayments'] == true;

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final Map<String, dynamic> result = await widget.api.getOrder(_kind, _id);
      if (mounted) setState(() => _order = _map(result['order']));
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _paymentAction({required bool confirm}) async {
    final TextEditingController reference =
        TextEditingController(text: '${_payment['reference'] ?? ''}');
    final TextEditingController note =
        TextEditingController(text: '${_payment['note'] ?? ''}');
    final bool? submit = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(confirm ? 'Approve payment' : 'Record payment evidence'),
        content: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
          if (confirm)
            const _Notice(
                icon: Icons.admin_panel_settings_outlined,
                text: 'Manager approval is final and audited.'),
          TextField(
              controller: reference,
              decoration: const InputDecoration(
                  labelText: 'Reference / receipt number')),
          TextField(
              controller: note,
              minLines: 1,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Note (optional)')),
        ]),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Back')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(confirm ? 'Approve payment' : 'Save evidence')),
        ],
      ),
    );
    if (submit != true) {
      reference.dispose();
      note.dispose();
      return;
    }
    if (_wallet) {
      _toast('Only the linked customer can authorize wallet payment.');
    } else {
      try {
        final Map<String, dynamic> result = confirm
            ? await widget.api.confirmPayment(_kind, _id,
                reference: reference.text.trim(), note: note.text.trim())
            : await widget.api.submitPaymentEvidence(_kind, _id,
                reference: reference.text.trim(), note: note.text.trim());
        if (mounted) {
          setState(() {
            _order = _map(result['order']);
            _error = null;
          });
          _toast(confirm
              ? 'Payment approved by manager.'
              : 'Evidence saved. Payment remains unpaid until approval.');
        }
      } catch (error) {
        if (mounted) _toast('$error');
      }
    }
    reference.dispose();
    note.dispose();
  }

  Future<void> _cancel() async {
    final bool? approved = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Cancel this order?'),
        content: const Text(
            'Only unpaid orders can be cancelled here. Paid orders require financial review.'),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Keep order')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Cancel order')),
        ],
      ),
    );
    if (approved != true) return;
    try {
      final Map<String, dynamic> result =
          await widget.api.cancelOrder(_kind, _id);
      if (mounted) setState(() => _order = _map(result['order']));
    } catch (error) {
      if (mounted) _toast('$error');
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Widget _receiptButton(String layout) => OutlinedButton.icon(
        onPressed: () {
          // Reserve synchronously inside the trusted click, before any network
          // operation can yield to the browser's popup blocker.
          final Object? popup = widget.receiptOpener == null
              ? reserveCounterReceiptPopup()
              : null;
          unawaited(_printReceipt(
            widget.api,
            _order,
            layout: layout,
            reprint: true,
            opener: widget.receiptOpener,
            popup: popup,
            context: context,
          ));
        },
        icon: const Icon(Icons.print_outlined),
        label: Text(layout == 'THERMAL' ? 'Thermal' : layout),
      );

  Widget _actions() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text(
              'Print requests are audited; they do not prove a physical print happened.',
              style: TextStyle(
                  color: Color(0xff65776d), fontSize: 11, height: 1.4)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: <Widget>[
            _receiptButton('A4'),
            _receiptButton('THERMAL'),
          ]),
          if (_unpaid && !_wallet) ...<Widget>[
            const SizedBox(height: 14),
            OutlinedButton.icon(
              key: const Key('counter-payment-evidence'),
              onPressed: () => _paymentAction(confirm: false),
              icon: const Icon(Icons.attach_file_rounded),
              label: const Text('Record payment evidence'),
            ),
            if (_managerCanConfirm) ...<Widget>[
              const SizedBox(height: 8),
              FilledButton.icon(
                key: const Key('counter-manager-approve-payment'),
                onPressed: () => _paymentAction(confirm: true),
                icon: const Icon(Icons.verified_outlined),
                label: const Text('Manager: approve payment'),
                style: FilledButton.styleFrom(backgroundColor: _green),
              ),
            ],
          ],
          if (_unpaid &&
              '${_order['status']}'.toUpperCase() != 'CANCELLED') ...<Widget>[
            const SizedBox(height: 8),
            TextButton.icon(
              key: const Key('counter-cancel-order'),
              onPressed: _cancel,
              icon: const Icon(Icons.cancel_outlined,
                  color: Color(0xffa33d31)),
              label: const Text('Cancel unpaid order',
                  style: TextStyle(color: Color(0xffa33d31))),
            ),
          ],
        ],
      );

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic> sender = _map(_order['sender']);
    final Map<String, dynamic> receiver = _map(_order['receiver']);
    final Map<String, dynamic> parcel = _map(_order['parcel']);
    final Map<String, dynamic> route = _map(_order['route']);
    final String status = '${_order['status'] ?? 'PENDING'}';
    final String paid = '${_order['paymentStatus'] ?? 'UNPAID'}'.toUpperCase();
    return Scaffold(
      backgroundColor: _canvas,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: _ink,
        title: const Text('Parcel details'),
        actions: <Widget>[
          IconButton(
              tooltip: 'Refresh order',
              onPressed: _loading ? null : _refresh,
              icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              _TrackingBlock(
                  tracking: '${_order['trackingNumber'] ?? '—'}',
                  receipt: '${_order['receiptNumber'] ?? '—'}'),
              const SizedBox(height: 12),
              _Panel(
                title: 'People & route',
                subtitle: 'Counter order contacts and destination.',
                child: Column(children: <Widget>[
                  _DetailLine('Sender', '${sender['name'] ?? '—'}'),
                  _DetailLine('Sender phone', '${sender['phone'] ?? '—'}'),
                  _DetailLine('Pickup', '${sender['address'] ?? '—'}'),
                  const Divider(),
                  _DetailLine('Recipient', '${receiver['name'] ?? '—'}'),
                  _DetailLine('Recipient phone', '${receiver['phone'] ?? '—'}'),
                  _DetailLine('Delivery', '${receiver['address'] ?? '—'}'),
                  _DetailLine('Locality',
                      '${receiver['lga'] ?? ''}, ${receiver['state'] ?? ''}'),
                  _DetailLine('Route',
                      '${route['originState'] ?? sender['state'] ?? '—'} → ${route['destinationState'] ?? receiver['state'] ?? '—'}'),
                ]),
              ),
              const SizedBox(height: 12),
              _Panel(
                title: 'Parcel',
                subtitle: 'Declared item information.',
                child: Column(children: <Widget>[
                  _DetailLine('Description', '${parcel['description'] ?? '—'}'),
                  _DetailLine('Category', '${parcel['category'] ?? '—'}'),
                  _DetailLine('Quantity', '${parcel['quantity'] ?? '—'}'),
                  if (parcel['weightKg'] != null)
                    _DetailLine('Weight', '${parcel['weightKg']} kg'),
                ]),
              ),
              const SizedBox(height: 12),
              _Panel(
                title: 'Payment',
                subtitle: 'Server-authoritative order amount and status.',
                child: Column(children: <Widget>[
                  if (_order['deliveryFee'] != null)
                    _DetailLine('Delivery fee',
                        '₦${_money(_order['deliveryFee'])}'),
                  ..._chargeDetails(_order['charges']),
                  const Divider(),
                  _DetailLine('Total', '₦${_money(_order['total'])}'),
                  _DetailLine('Method',
                      _human('${_payment['method'] ?? '—'}')),
                  _DetailLine('Status', paid),
                  if (_payment['reference'] != null)
                    _DetailLine('Evidence', '${_payment['reference']}'),
                  if (_payment['recordedByName'] != null)
                    _DetailLine('Recorded by',
                        '${_payment['recordedByName']}'),
                  if (_payment['approvedByName'] != null)
                    _DetailLine(
                        'Approved by', '${_payment['approvedByName']}'),
                  if (_wallet && _unpaid)
                    const _Notice(
                        icon: Icons.lock_outline_rounded,
                        text:
                            'Only the linked customer can authorize this wallet payment. Branch officers cannot debit or approve it.'),
                  if (_unpaid && !_wallet)
                    const _Notice(
                        icon: Icons.info_outline_rounded,
                        text:
                            'Recording evidence does not mark the receipt PAID. Manager approval is required.'),
                ]),
              ),
              const SizedBox(height: 12),
              _Panel(
                title: 'Order status',
                subtitle: 'Current delivery workflow state.',
                child: Row(children: <Widget>[
                  _StatusPill(status),
                  const SizedBox(width: 8),
                  _PaymentPill(paid),
                ]),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 10),
                _InlineError(_error!),
              ],
              if (_loading)
                const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: LinearProgressIndicator(minHeight: 2)),
              const SizedBox(height: 12),
              _Panel(
                title: 'Receipt & actions',
                subtitle: 'Secure print fetch and audited manager actions.',
                child: _actions(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}