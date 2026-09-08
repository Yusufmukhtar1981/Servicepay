import 'package:flutter/material.dart';

import 'trust_api_service.dart';
import 'trust_models.dart';

class TrustDealsScreen extends StatefulWidget {
  const TrustDealsScreen({super.key});
  @override
  State<TrustDealsScreen> createState() => _TrustDealsScreenState();
}

class _TrustDealsScreenState extends State<TrustDealsScreen> {
  List<TrustDeal> _deals = <TrustDeal>[];
  String? _error;
  bool _loading = true;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _deals = await TrustApiService.deals();
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
    }
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF5F7FA),
        appBar: AppBar(
            title: const Text('Protected deals'),
            backgroundColor: const Color(0xFF08783E),
            foregroundColor: Colors.white),
        floatingActionButton: FloatingActionButton.extended(
            backgroundColor: const Color(0xFF08783E),
            foregroundColor: Colors.white,
            onPressed: () async {
              await Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                      builder: (_) => const CreateTrustDealScreen()));
              if (mounted) _load();
            },
            icon: const Icon(Icons.add),
            label: const Text('Create deal')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? _Error(message: _error!, retry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _deals.isEmpty
                        ? ListView(children: const <Widget>[
                            SizedBox(height: 160),
                            Center(child: Text('No protected deals yet.'))
                          ])
                        : ListView.builder(
                            padding: const EdgeInsets.all(12),
                            itemCount: _deals.length,
                            itemBuilder: (_, i) {
                              final TrustDeal deal = _deals[i];
                              return Card(
                                  child: ListTile(
                                leading: const CircleAvatar(
                                    backgroundColor: Color(0xFFEAF7F0),
                                    child: Icon(Icons.shield_outlined,
                                        color: Color(0xFF08783E))),
                                title: Text(deal.title),
                                subtitle: Text(
                                    '${_money(deal)} • ${deal.status.replaceAll('_', ' ')}'),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => Navigator.push(
                                    context,
                                    MaterialPageRoute<void>(
                                        builder: (_) =>
                                            TrustDealDetailScreen(deal: deal))),
                              ));
                            })),
      );
}

class CreateTrustDealScreen extends StatefulWidget {
  const CreateTrustDealScreen({super.key});
  @override
  State<CreateTrustDealScreen> createState() => _CreateTrustDealScreenState();
}

class _CreateTrustDealScreenState extends State<CreateTrustDealScreen> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _party = TextEditingController();
  final _amount = TextEditingController();
  final _description = TextEditingController();
  bool _saving = false;
  @override
  void dispose() {
    _title.dispose();
    _party.dispose();
    _amount.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    try {
      final TrustDeal deal = await TrustApiService.createDeal(<String, dynamic>{
        'title': _title.text.trim(),
        'recipientServicePayId': _party.text.trim(),
        'amount': double.parse(_amount.text.trim()),
        'description': _description.text.trim(),
      });
      if (mounted) {
        Navigator.pushReplacement(
            context,
            MaterialPageRoute<void>(
                builder: (_) => TrustDealDetailScreen(deal: deal)));
      }
    } catch (e) {
      if (mounted) _notice(context, e.toString());
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
            title: const Text('Create protected deal'),
            backgroundColor: const Color(0xFF08783E),
            foregroundColor: Colors.white),
        body: Form(
            key: _form,
            child:
                ListView(padding: const EdgeInsets.all(20), children: <Widget>[
              const Text(
                  'Funds are held until the deal is completed or resolved.',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 18),
              _field(_title, 'What are you paying for?'),
              _field(_party, 'Counterparty ServicePay ID'),
              _field(_amount, 'Amount (NGN)', type: TextInputType.number),
              _field(_description, 'Deal details', required: false, lines: 3),
              const SizedBox(height: 12),
              FilledButton(
                  onPressed: _saving ? null : _submit,
                  style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF08783E),
                      padding: const EdgeInsets.all(15)),
                  child: Text(_saving ? 'Creating…' : 'Create protected deal')),
            ])),
      );
}

class TrustDealDetailScreen extends StatefulWidget {
  const TrustDealDetailScreen({super.key, required this.deal});
  final TrustDeal deal;
  @override
  State<TrustDealDetailScreen> createState() => _TrustDealDetailScreenState();
}

class _TrustDealDetailScreenState extends State<TrustDealDetailScreen> {
  late TrustDeal _deal;
  bool _working = false;
  @override
  void initState() {
    super.initState();
    _deal = widget.deal;
  }

  Future<void> _action(String action) async {
    final bool? approved = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
                title: Text(
                    '${action == 'release' ? 'Release funds' : 'Confirm action'}?'),
                content: const Text(
                    'This action will be recorded on this protected deal.'),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(c, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, true),
                      child: const Text('Confirm'))
                ]));
    if (approved != true) return;
    setState(() => _working = true);
    try {
      final TrustDeal value =
          await TrustApiService.dealAction(_deal.id, action);
      if (mounted) setState(() => _deal = value);
    } catch (e) {
      if (mounted) _notice(context, e.toString());
    }
    if (mounted) setState(() => _working = false);
  }

  Future<void> _release() async {
    final TextEditingController pin = TextEditingController();
    final bool? approved = await showDialog<bool>(
        context: context,
        builder: (BuildContext c) => AlertDialog(
              title: const Text('Release funds'),
              content: TextField(
                  controller: pin,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  decoration:
                      const InputDecoration(labelText: 'Transaction PIN')),
              actions: <Widget>[
                TextButton(
                    onPressed: () => Navigator.pop(c, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(c, true),
                    child: const Text('Release funds'))
              ],
            ));
    if (approved == true) {
      setState(() => _working = true);
      try {
        final TrustDeal value = await TrustApiService.dealAction(
            _deal.id, 'release',
            payload: <String, dynamic>{'transactionPin': pin.text});
        if (mounted) setState(() => _deal = value);
      } catch (e) {
        if (mounted) _notice(context, e.toString());
      }
      if (mounted) setState(() => _working = false);
    }
    pin.dispose();
  }

  Future<void> _fund() async {
    final TextEditingController pin = TextEditingController();
    final bool? approved = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
                title: const Text('Authorize funding'),
                content: TextField(
                    controller: pin,
                    obscureText: true,
                    keyboardType: TextInputType.number,
                    decoration:
                        const InputDecoration(labelText: 'Transaction PIN')),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(c, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, true),
                      child: const Text('Fund deal'))
                ]));
    if (approved == true) {
      setState(() => _working = true);
      try {
        final v = await TrustApiService.fundDeal(_deal.id, pin.text);
        if (mounted) setState(() => _deal = v);
      } catch (e) {
        if (mounted) _notice(context, e.toString());
      }
      if (mounted) setState(() => _working = false);
    }
    pin.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF5F7FA),
        appBar: AppBar(
            title: const Text('Protected deal'),
            backgroundColor: const Color(0xFF08783E),
            foregroundColor: Colors.white),
        body: ListView(padding: const EdgeInsets.all(16), children: <Widget>[
          Card(
              child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(_deal.title,
                            style: const TextStyle(
                                fontSize: 21, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 8),
                        Text(_money(_deal),
                            style: const TextStyle(
                                color: Color(0xFF08783E),
                                fontSize: 24,
                                fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Text('Status: ${_deal.status.replaceAll('_', ' ')}'),
                        if (_deal.description != null)
                          Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Text(_deal.description!)),
                      ]))),
          const SizedBox(height: 12),
          _record('Buyer', _deal.buyerName),
          _record('Seller', _deal.sellerName),
          if (_deal.fundingReference != null)
            _record('Funding reference', _deal.fundingReference!),
          if (_deal.dispute != null)
            _record('Dispute',
                '${_deal.dispute!.reason} (${_deal.dispute!.status})'),
          const SizedBox(height: 12),
          if (_deal.canFund)
            FilledButton(
                onPressed: _working ? null : _fund,
                style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF08783E)),
                child: const Text('Fund with PIN')),
          if (_deal.canSellerStart)
            FilledButton.tonal(
                onPressed: _working ? null : () => _action('start'),
                child: const Text('Start work')),
          if (_deal.canSellerMarkDelivered)
            FilledButton.tonal(
                onPressed: _working ? null : () => _action('delivered'),
                child: const Text('Mark delivered')),
          if (_deal.canBuyerRelease)
            FilledButton.tonal(
                onPressed: _working ? null : _release,
                child: const Text('Confirm delivery and release')),
          if (_deal.canRaiseDispute)
            OutlinedButton(
                onPressed: _working
                    ? null
                    : () async {
                        await Navigator.push(
                            context,
                            MaterialPageRoute<void>(
                                builder: (_) =>
                                    TrustDisputeFormScreen(dealId: _deal.id)));
                        if (mounted) {
                          final TrustDeal refreshed =
                              await TrustApiService.getDeal(_deal.id);
                          setState(() => _deal = refreshed);
                        }
                      },
                child: const Text('Raise a dispute')),
          const Padding(
              padding: EdgeInsets.only(top: 18),
              child: Text(
                  'Trust information helps you make a more informed decision. It is not a guarantee against fraud.',
                  style: TextStyle(color: Colors.black54, fontSize: 12))),
        ]),
      );
}

class TrustDisputeFormScreen extends StatefulWidget {
  const TrustDisputeFormScreen({super.key, required this.dealId});
  final String dealId;
  @override
  State<TrustDisputeFormScreen> createState() => _TrustDisputeFormScreenState();
}

class _TrustDisputeFormScreenState extends State<TrustDisputeFormScreen> {
  final _details = TextEditingController();
  String _reason = 'Item or service not delivered';
  bool _saving = false;
  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_details.text.trim().isEmpty) {
      _notice(context, 'Please describe the issue.');
      return;
    }
    setState(() => _saving = true);
    try {
      await TrustApiService.createDispute(widget.dealId, <String, dynamic>{
        'reason': _reason,
        'description': _details.text.trim()
      });
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) _notice(context, e.toString());
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(
          title: const Text('Raise a dispute'),
          backgroundColor: const Color(0xFF08783E),
          foregroundColor: Colors.white),
      body: ListView(padding: const EdgeInsets.all(20), children: <Widget>[
        const Text(
            'Explain what happened. Your funds remain protected while the dispute is reviewed.'),
        DropdownButtonFormField<String>(
            value: _reason,
            items: const [
              DropdownMenuItem(
                  value: 'Item or service not delivered',
                  child: Text('Item or service not delivered')),
              DropdownMenuItem(
                  value: 'Not as described', child: Text('Not as described')),
              DropdownMenuItem(value: 'Other', child: Text('Other'))
            ],
            onChanged: (v) => setState(() => _reason = v!)),
        TextField(
            controller: _details,
            maxLines: 5,
            decoration: const InputDecoration(labelText: 'Details')),
        const SizedBox(height: 18),
        FilledButton(
            onPressed: _saving ? null : _send,
            style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF08783E)),
            child: const Text('Submit dispute'))
      ]));
}

Widget _field(TextEditingController c, String label,
        {TextInputType? type, bool required = true, int lines = 1}) =>
    Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
            controller: c,
            keyboardType: type,
            maxLines: lines,
            decoration: InputDecoration(
                labelText: label, border: const OutlineInputBorder()),
            validator: required
                ? (v) => (v ?? '').trim().isEmpty ? '$label is required' : null
                : null));
Widget _record(String label, String value) =>
    Card(child: ListTile(title: Text(label), subtitle: Text(value)));
String _money(TrustDeal deal) =>
    '${deal.currency == 'NGN' ? '₦' : '${deal.currency} '}${deal.amount.toStringAsFixed(2)}';
void _notice(BuildContext c, Object error) =>
    ScaffoldMessenger.of(c).showSnackBar(SnackBar(
        content: Text(error.toString().replaceFirst('Exception: ', ''))));

class _Error extends StatelessWidget {
  const _Error({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext c) => Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
        Text(message, textAlign: TextAlign.center),
        TextButton(onPressed: retry, child: const Text('Try again'))
      ]));
}
