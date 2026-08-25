import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/amana_api_service.dart';

class AdminAmanaScreen extends StatefulWidget {
  const AdminAmanaScreen({super.key});
  @override State<AdminAmanaScreen> createState() => _AdminAmanaScreenState();
}

class _AdminAmanaScreenState extends State<AdminAmanaScreen> {
  final AmanaApiService _api = AmanaApiService();
  final ImagePicker _picker = ImagePicker();
  bool _loading = true;
  String _error = '', _filter = 'ALL';
  List<Map<String, dynamic>> _items = <Map<String, dynamic>>[];
  @override void initState() { super.initState(); _load(); }
  String _id(Map<String, dynamic> o) => '${o['_id'] ?? o['id'] ?? ''}';
  String _text(dynamic v, [String fallback = '—']) => v?.toString().trim().isNotEmpty == true ? v.toString().trim() : fallback;
  Map<String, dynamic> _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
  List<Map<String, dynamic>> _list(Map<String, dynamic> b) { final dynamic v = b['orders'] ?? (b['data'] is Map ? b['data']['orders'] : null); return v is List ? v.whereType<Map>().map((Map x) => Map<String, dynamic>.from(x)).toList() : <Map<String, dynamic>>[]; }
  void _notice(String m, {bool error = false}) => ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(SnackBar(content: Text(m), backgroundColor: error ? const Color(0xFFB42318) : const Color(0xFF08766D)));
  Future<void> _load() async {
    setState(() { _loading = true; _error = ''; });
    try { final Map<String, dynamic> b = await _api.adminGet('', query: <String, String>{'limit': '100', if (_filter != 'ALL') 'status': _filter}); if (mounted) setState(() { _items = _list(b); _loading = false; }); }
    on AmanaApiException catch (e) { if (mounted) setState(() { _loading = false; _error = e.message; }); }
    catch (_) { if (mounted) setState(() { _loading = false; _error = 'Unable to load Amana requests.'; }); }
  }
  Future<String?> _input(String title, String label, {bool required = true, bool amount = false}) async {
    final TextEditingController c = TextEditingController();
    final String? result = await showDialog<String>(context: context, builder: (BuildContext d) => AlertDialog(title: Text(title), content: TextField(controller: c, keyboardType: amount ? const TextInputType.numberWithOptions(decimal: true) : null, maxLines: amount ? 1 : 3, decoration: InputDecoration(labelText: label, border: const OutlineInputBorder())), actions: <Widget>[TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')), FilledButton(onPressed: () { if (!required || c.text.trim().isNotEmpty) Navigator.pop(d, c.text.trim()); }, child: const Text('Continue'))]));
    c.dispose(); return result;
  }
  Future<void> _patch(Map<String, dynamic> o, String endpoint, Map<String, dynamic> body, String success) async {
    try { await _api.adminPatch('/${_id(o)}/$endpoint', body: body); _notice(success); await _load(); }
    on AmanaApiException catch (e) { _notice(e.message, error: true); }
  }
  Future<void> _noteAction(Map<String, dynamic> o, String endpoint, String title) async {
    final String? note = await _input(title, endpoint == 'request-information' ? 'Information needed' : 'Reason / admin note');
    if (note == null) return;
    final Map<String, dynamic> body = endpoint == 'reject'
        ? <String, dynamic>{'rejectionReason': note}
        : endpoint == 'cancel'
            ? <String, dynamic>{'cancellationReason': note}
            : <String, dynamic>{'note': note};
    await _patch(o, endpoint, body, '$title recorded.');
  }
  Future<void> _verification(Map<String, dynamic> o) async {
    final bool? verified = await showDialog<bool>(context: context, builder: (BuildContext d) => AlertDialog(title: const Text('Provider verification'), content: const Text('Verify the provider details, or reject the verification.'), actions: <Widget>[TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Reject')), FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Verify'))]));
    if (verified == null) return;
    final String? note = verified ? await _input('Provider verification', 'Verification note (optional)', required: false) : await _input('Reject provider verification', 'Rejection note');
    await _patch(o, 'provider-verification', <String, dynamic>{'decision': verified ? 'VERIFIED' : 'REJECTED', if (note != null && note.isNotEmpty) 'note': note}, verified ? 'Provider verified.' : 'Provider verification rejected.');
  }
  Future<void> _approve(Map<String, dynamic> o) async {
    final String? amount = await _input('Approve request', 'Approved amount (₦)', amount: true);
    if (amount == null) return;
    final String? note = await _input('Approve request', 'Approval note (optional)', required: false);
    await _patch(o, 'approve', <String, dynamic>{'approvedAmount': amount, if (note != null && note.isNotEmpty) 'note': note}, 'Request approved.');
  }
  Future<void> _provider(Map<String, dynamic> o) async {
    final List<TextEditingController> c = List<TextEditingController>.generate(8, (_) => TextEditingController());
    const List<String> labels = <String>['Provider type', 'Name', 'Phone', 'Account name', 'Account number', 'Bank name', 'Address', 'Additional information'];
    final bool? ok = await showDialog<bool>(context: context, builder: (BuildContext d) => AlertDialog(title: const Text('Provider verification details'), content: SizedBox(width: 420, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: List<Widget>.generate(8, (int i) => TextField(controller: c[i], maxLines: i > 5 ? 2 : 1, decoration: InputDecoration(labelText: labels[i])))))), actions: <Widget>[TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Save provider'))]));
    if (ok == true) await _patch(o, 'provider', <String, dynamic>{'type': c[0].text.trim(), 'name': c[1].text.trim(), 'phone': c[2].text.trim(), 'accountName': c[3].text.trim(), 'accountNumber': c[4].text.trim(), 'bankName': c[5].text.trim(), 'address': c[6].text.trim(), 'additionalInformation': c[7].text.trim()}, 'Provider updated.');
    for (final TextEditingController item in c) { item.dispose(); }
  }
  Future<void> _fund(Map<String, dynamic> o) async {
    final String? amount = await _input('Fund request', 'Amount (₦)', amount: true);
    if (amount == null) return;
    final String? source = await showDialog<String>(context: context, builder: (BuildContext d) => SimpleDialog(title: const Text('Controlled funding source'), children: <String>['HEAD_OFFICE', 'NGO', 'COMPANY', 'DONOR_RESERVED'].map((String value) => SimpleDialogOption(onPressed: () => Navigator.pop(d, value), child: Text(value.replaceAll('_', ' ')))).toList()));
    final String? reference = await _input('Fund request', 'Funding reference');
    final String? receiptReference = await _input('Fund request', 'Reconciliation / receipt reference');
    if (source == null || reference == null || receiptReference == null) return;
    final String key = 'amana-${_id(o)}-${DateTime.now().microsecondsSinceEpoch}';
    try { await _api.adminPost('/${_id(o)}/funding', body: <String, dynamic>{'amount': amount, 'sourceType': source, 'reference': reference, 'receiptReference': receiptReference, 'idempotencyKey': key}); _notice('Funding submitted.'); await _load(); }
    on AmanaApiException catch (e) { _notice(e.message, error: true); }
  }
  Future<void> _upload(Map<String, dynamic> o, {required bool payment}) async {
    final XFile? file = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (file == null) return;
    final String? amount = payment ? await _input('Provider payment', 'Amount (₦)', amount: true) : null;
    if (payment && amount == null) return;
    final String? reference = payment ? await _input('Provider payment', 'Payment reference') : null;
    if (payment && reference == null) return;
    final String? notes = !payment ? await _input('Fulfilment proof', 'Notes', required: false) : null;
    try {
      await _api.adminMultipart('/${_id(o)}/${payment ? 'provider-payment' : 'fulfilment-proof'}', files: <XFile>[file], fileField: payment ? 'paymentReceipt' : 'proof', fields: <String, dynamic>{
        if (payment) 'amount': amount!, if (payment) 'paymentReference': reference!, if (payment) 'idempotencyKey': 'amana-payment-${_id(o)}-${DateTime.now().microsecondsSinceEpoch}', if (!payment && notes != null) 'notes': notes,
      });
      _notice(payment ? 'Provider payment proof uploaded.' : 'Fulfilment proof uploaded.'); await _load();
    } on AmanaApiException catch (e) { _notice(e.message, error: true); }
  }
  Future<void> _detail(Map<String, dynamic> order) async {
    Map<String, dynamic> o = order;
    try { final Map<String, dynamic> b = await _api.adminGet('/${_id(order)}'); o = _map(b['order'] ?? (b['data'] is Map ? b['data']['order'] : null) ?? order); } catch (_) {}
    if (!mounted) return;
    final String status = _text(o['status'], '').toUpperCase(), id = _id(o);
    await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (BuildContext s) => SafeArea(child: Padding(padding: const EdgeInsets.all(20), child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: <Widget>[
      Text(_text(o['title'], 'Amana request'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)), const SizedBox(height: 12), _row('Reference', _text(o['reference'])), _row('Status', status), _row('Category', _text(o['category']).replaceAll('_', ' ')), _row('Amount', '₦${_text(o['amount'] ?? o['totalAmount'], '0')}'), _row('Description', _text(o['description'])), _row('ID', id),
      const SizedBox(height: 10), const Text('Protected actions', style: TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: <Widget>[
        if (<String>['SUBMITTED','UNDER_REVIEW','MORE_INFORMATION_REQUIRED'].contains(status)) OutlinedButton(onPressed: () { Navigator.pop(s); _noteAction(o, 'request-information', 'Request information'); }, child: const Text('Request info')),
        if (<String>['SUBMITTED','UNDER_REVIEW','MORE_INFORMATION_REQUIRED'].contains(status)) OutlinedButton(onPressed: () { Navigator.pop(s); _provider(o); }, child: const Text('Provider')),
        if (<String>['SUBMITTED','UNDER_REVIEW','MORE_INFORMATION_REQUIRED'].contains(status)) FilledButton(onPressed: () { Navigator.pop(s); _verification(o); }, child: const Text('Verify provider')),
        if (<String>['SUBMITTED','UNDER_REVIEW','MORE_INFORMATION_REQUIRED'].contains(status)) FilledButton(onPressed: () { Navigator.pop(s); _approve(o); }, child: const Text('Approve')),
        if (<String>['APPROVED','FUNDING_IN_PROGRESS'].contains(status)) OutlinedButton(onPressed: () { Navigator.pop(s); _fund(o); }, child: const Text('Fund')),
        if (status == 'FULLY_FUNDED') FilledButton(onPressed: () { Navigator.pop(s); _upload(o, payment: true); }, child: const Text('Provider payment')),
        if (status == 'PAID_TO_PROVIDER') OutlinedButton(onPressed: () { Navigator.pop(s); _upload(o, payment: false); }, child: const Text('Fulfilment proof')),
        if (status == 'FULFILLED') FilledButton(onPressed: () { Navigator.pop(s); _patch(o, 'complete', const <String, dynamic>{}, 'Request completed.'); }, child: const Text('Complete')),
        if (<String>['SUBMITTED','UNDER_REVIEW','MORE_INFORMATION_REQUIRED'].contains(status)) OutlinedButton(onPressed: () { Navigator.pop(s); _noteAction(o, 'reject', 'Reject request'); }, child: const Text('Reject')),
        if (<String>['SUBMITTED','MORE_INFORMATION_REQUIRED','UNDER_REVIEW','APPROVED'].contains(status)) OutlinedButton(onPressed: () { Navigator.pop(s); _noteAction(o, 'cancel', 'Cancel request'); }, child: const Text('Cancel')),
      ]),
    ])))));
  }
  Widget _row(String l, String v) => Padding(padding: const EdgeInsets.only(bottom: 8), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[SizedBox(width: 96, child: Text(l, style: const TextStyle(color: Color(0xFF667085))), Expanded(child: Text(v))]));
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Amana Management'), actions: <Widget>[IconButton(onPressed: _load, icon: const Icon(Icons.refresh))]), body: Column(children: <Widget>[
    Padding(padding: const EdgeInsets.all(12), child: DropdownButtonFormField<String>(value: _filter, decoration: const InputDecoration(labelText: 'Status filter', border: OutlineInputBorder()), items: const <String>['ALL','SUBMITTED','MORE_INFORMATION_REQUIRED','UNDER_REVIEW','APPROVED','FUNDING_IN_PROGRESS','FULLY_FUNDED','PAID_TO_PROVIDER','FULFILLED','COMPLETED','REJECTED','CANCELLED'].map((String x) => DropdownMenuItem(value: x, child: Text(x))).toList(), onChanged: (String? x) { if (x != null) { setState(() => _filter = x); _load(); } })),
    Expanded(child: _loading ? const Center(child: CircularProgressIndicator()) : _error.isNotEmpty ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[Text(_error), TextButton(onPressed: _load, child: const Text('Retry'))])) : _items.isEmpty ? const Center(child: Text('No Amana requests found.')) : RefreshIndicator(onRefresh: _load, child: ListView.builder(itemCount: _items.length, itemBuilder: (_, int i) { final Map<String, dynamic> o = _items[i]; return Card(child: ListTile(onTap: () => _detail(o), leading: const CircleAvatar(child: Icon(Icons.volunteer_activism_outlined)), title: Text(_text(o['title'], _text(o['reference'], 'Amana request'))), subtitle: Text('${_text(o['category']).replaceAll('_', ' ')} • ${_text(o['status'])}'), trailing: const Icon(Icons.chevron_right))); }))),
  ]));
}