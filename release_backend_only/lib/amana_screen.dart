import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'services/amana_api_service.dart';

class AmanaScreen extends StatefulWidget {
  const AmanaScreen({super.key});
  @override
  State<AmanaScreen> createState() => _AmanaScreenState();
}

class _AmanaScreenState extends State<AmanaScreen> {
  final AmanaApiService _api = AmanaApiService();
  final GlobalKey<FormState> _form = GlobalKey<FormState>();
  final Map<String, TextEditingController> _fields = <String, TextEditingController>{
    for (final String key in <String>['title', 'description', 'amount', 'beneficiaryName', 'beneficiaryPhone', 'relationship', 'state', 'lga', 'address', 'providerName', 'providerPhone', 'householdSize', 'foodItems', 'schoolName', 'studentName', 'classLevel', 'termSession', 'facilityName', 'patientName', 'treatmentDescription'])
      key: TextEditingController(),
  };
  bool _loading = true, _submitting = false, _formOpen = false;
  String _category = 'FOOD_PACKAGE', _error = '';
  AmanaUploadFile? _attachment;
  List<Map<String, dynamic>> _orders = <Map<String, dynamic>>[];

  static const List<Map<String, dynamic>> _categories = <Map<String, dynamic>>[
    <String, dynamic>{'id': 'FOOD_PACKAGE', 'name': 'Food Package', 'icon': Icons.shopping_basket_rounded, 'description': 'Verified food support for a loved one.'},
    <String, dynamic>{'id': 'SCHOOL_FEES', 'name': 'School Fees', 'icon': Icons.school_rounded, 'description': 'Direct school-fee support with proof.'},
    <String, dynamic>{'id': 'MEDICAL_SUPPORT', 'name': 'Medical Support', 'icon': Icons.local_hospital_rounded, 'description': 'Hospital or pharmacy bill support.'},
  ];
  @override void initState() { super.initState(); _load(); }
  @override void dispose() { for (final TextEditingController c in _fields.values) { c.dispose(); } super.dispose(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = ''; });
    try {
      final Map<String, dynamic> body = await _api.get('', query: const <String, String>{'page': '1', 'limit': '50'});
      dynamic data = body['orders'] ?? (body['data'] is Map ? body['data']['orders'] : null);
      if (mounted) setState(() { _orders = data is List ? data.whereType<Map>().map((Map e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[]; _loading = false; });
    } on AmanaApiException catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.message; });
    } catch (_) { if (mounted) setState(() { _loading = false; _error = 'Unable to load your Amana requests.'; }); }
  }
  String _value(String key) => _fields[key]!.text.trim();
  String _text(dynamic value, [String fallback = '—']) => value?.toString().trim().isNotEmpty == true ? value.toString().trim() : fallback;
  Map<String, dynamic> _map(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  String _categoryName(String id) => _categories.firstWhere((Map<String, dynamic> x) => x['id'] == id, orElse: () => <String, dynamic>{'name': id})['name'].toString();
  String? _required(String? value) => value == null || value.trim().isEmpty ? 'This field is required.' : null;
  void _notice(String message, {bool error = false}) => ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(SnackBar(content: Text(message), backgroundColor: error ? const Color(0xFFB42318) : const Color(0xFF08766D)));

  Future<void> _pickAttachment() async {
    final AmanaUploadFile? selected = await _chooseFile();
    if (selected != null && mounted) setState(() => _attachment = selected);
  }
  Widget _selectedEvidence() {
    final AmanaUploadFile? file = _attachment;
    if (file == null) {
      return OutlinedButton.icon(
        onPressed: _pickAttachment,
        icon: const Icon(Icons.attach_file),
        label: const Text('Attach evidence (PDF, JPG, JPEG or PNG)'),
      );
    }
    return Card(
      color: const Color(0xFFEFFAF8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (file.isImage)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.memory(file.bytes, height: 180, width: double.infinity, fit: BoxFit.cover),
            ),
          ListTile(
            leading: Icon(file.isPdf ? Icons.picture_as_pdf : Icons.image_outlined, color: const Color(0xFF08766D)),
            title: Text(file.name, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text(file.isPdf ? 'PDF document selected' : 'Image evidence selected'),
          ),
          Row(
            children: <Widget>[
              TextButton.icon(onPressed: _pickAttachment, icon: const Icon(Icons.sync), label: const Text('Replace')),
              TextButton.icon(onPressed: () => setState(() => _attachment = null), icon: const Icon(Icons.delete_outline), label: const Text('Remove')),
            ],
          ),
        ],
      ),
    );
  }
  Map<String, dynamic> _body() {
    final Map<String, dynamic> beneficiary = <String, dynamic>{
      'fullName': _value('beneficiaryName'), 'phone': _value('beneficiaryPhone'),
      'relationship': _value('relationship'), 'state': _value('state'),
      'lga': _value('lga'), 'address': _value('address'),
    };
    final Map<String, dynamic> body = <String, dynamic>{
      'category': _category, 'title': _value('title'), 'description': _value('description'),
      'amount': double.tryParse(_value('amount').replaceAll(',', '')) ?? _value('amount'),
      'beneficiary': beneficiary,
    };
    body['providerDetails'] = <String, dynamic>{'name': _value('providerName'), 'phone': _value('providerPhone')};
    if (_category == 'FOOD_PACKAGE') body['categoryDetails'] = <String, dynamic>{'householdSize': _value('householdSize'), 'foodItems': _value('foodItems')};
    if (_category == 'SCHOOL_FEES') body['categoryDetails'] = <String, dynamic>{'schoolName': _value('schoolName'), 'studentName': _value('studentName'), 'classLevel': _value('classLevel'), 'termSession': _value('termSession')};
    if (_category == 'MEDICAL_SUPPORT') body['categoryDetails'] = <String, dynamic>{'facilityName': _value('facilityName'), 'patientName': _value('patientName'), 'treatmentDescription': _value('treatmentDescription')};
    return body;
  }
  Future<void> _submit() async {
    if (_submitting || _form.currentState?.validate() != true) return;
    if (_attachment == null) {
      _notice('A supporting document or image is required.', error: true);
      return;
    }
    setState(() => _submitting = true);
    try {
      final Map<String, dynamic> response = await _api.postMultipart('', fields: _body(), attachment: _attachment, attachmentField: 'attachment');
      final Map<String, dynamic> order = _map(response['order'] ?? (response['data'] is Map ? response['data']['order'] : null));
      if (!mounted) return;
      setState(() { _submitting = false; _formOpen = false; _attachment = null; });
      for (final TextEditingController c in _fields.values) { c.clear(); }
      await _load();
      if (mounted) await _confirmation(order, response['message']?.toString());
    } on AmanaApiException catch (e) { if (mounted) { setState(() => _submitting = false); _notice(e.message, error: true); } }
    catch (_) { if (mounted) { setState(() => _submitting = false); _notice('Unable to submit your request.', error: true); } }
  }
  Future<void> _confirmation(Map<String, dynamic> order, String? message) => showDialog<void>(context: context, builder: (BuildContext c) => AlertDialog(
    icon: const Icon(Icons.check_circle_rounded, color: Color(0xFF08766D), size: 46), title: const Text('Request submitted'),
    content: Text('${message ?? 'Your Amana request has been received.'}\n\nReference: ${_text(order['reference'], 'Pending assignment')}'),
    actions: <Widget>[FilledButton(onPressed: () => Navigator.pop(c), child: const Text('View history'))],
  ));
  Future<void> _openLink(String link) async {
    final Uri uri = Uri.tryParse(link) ?? Uri();
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) _notice('Unable to open this receipt.', error: true);
  }
  Future<void> _cancel(Map<String, dynamic> order) async {
    final TextEditingController reason = TextEditingController();
    final bool? okay = await showDialog<bool>(context: context, builder: (BuildContext d) => AlertDialog(title: const Text('Cancel request'), content: TextField(controller: reason, maxLines: 3, decoration: const InputDecoration(labelText: 'Cancellation reason', border: OutlineInputBorder())), actions: <Widget>[TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep request')), FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Cancel request'))]));
    if (okay == true && reason.text.trim().isNotEmpty) {
      try { await _api.patch('/${_text(order['_id'] ?? order['id'], '')}/cancel', body: <String, dynamic>{'cancellationReason': reason.text.trim()}); _notice('Request cancelled.'); await _load(); }
      on AmanaApiException catch (e) { _notice(e.message, error: true); }
    }
    reason.dispose();
  }
  Future<void> _replyInformation(Map<String, dynamic> order) async {
    final String? note = await showDialog<String>(context: context, builder: (BuildContext d) { final TextEditingController c = TextEditingController(); return AlertDialog(title: const Text('Reply with information'), content: TextField(controller: c, maxLines: 3, decoration: const InputDecoration(labelText: 'Information / note', border: OutlineInputBorder())), actions: <Widget>[TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Attach document'))]); });
    if (note == null || note.isEmpty) return;
    final AmanaUploadFile? attachment = await _chooseFile();
    if (attachment == null) { _notice('Please attach the requested supporting document.', error: true); return; }
    try { await _api.postMultipart('/${_text(order['_id'] ?? order['id'], '')}/information', fields: <String, dynamic>{'note': note}, attachment: attachment); _notice('Information submitted.'); await _load(); }
    on AmanaApiException catch (e) { _notice(e.message, error: true); }
  }
  Future<AmanaUploadFile?> _chooseFile() async {
    final FilePickerResult? result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: <String>['pdf', 'jpg', 'jpeg', 'png'],
      withData: true,
    );
    final PlatformFile? file = result?.files.isNotEmpty == true ? result!.files.single : null;
    final Uint8List? bytes = file?.bytes;
    if (file == null || bytes == null || bytes.isEmpty) {
      if (file != null && mounted) _notice('Unable to read that file. Please choose another document.', error: true);
      return null;
    }
    return AmanaUploadFile(name: file.name, bytes: bytes, mimeType: amanaMimeTypeForName(file.name));
  }
  Future<void> _details(Map<String, dynamic> order) async {
    final String id = _text(order['_id'] ?? order['id'], '');
    Map<String, dynamic> item = order;
    try { final Map<String, dynamic> response = await _api.get('/$id'); item = _map(response['order'] ?? (response['data'] is Map ? response['data']['order'] : null) ?? order); } catch (_) {}
    if (!mounted) return;
    final Map<String, dynamic> beneficiary = _map(item['beneficiary']);
    final List<dynamic> timeline = item['timeline'] is List ? item['timeline'] as List : item['statusHistory'] is List ? item['statusHistory'] as List : <dynamic>[];
    final Map<String, dynamic> proof = _map(item['fulfilmentProof']);
    final Map<String, dynamic> proofReceipt = _map(proof['receipt']);
    final String receipt = _text(proofReceipt['url'] ?? proof['receiptUrl'] ?? item['receiptUrl'] ?? item['receipt'] ?? item['proofUrl'], '');
    final List<dynamic> proofDocuments = proof['documents'] is List ? proof['documents'] as List : <dynamic>[];
    final List<dynamic> evidenceDocuments = item['supportingDocuments'] is List ? item['supportingDocuments'] as List : <dynamic>[];
    final String status = _text(item['status'], '').toUpperCase();
    await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (BuildContext c) => SafeArea(child: Padding(padding: const EdgeInsets.all(20), child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: <Widget>[
      Text(_text(item['title'], 'Amana request'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
      const SizedBox(height: 12), _line('Reference', _text(item['reference'])), _line('Status', _text(item['status'])), _line('Amount', '₦${_text(item['amount'] ?? item['totalAmount'], '0')}'), _line('Beneficiary', _text(beneficiary['fullName'])),
      const SizedBox(height: 8), const Text('Status timeline', style: TextStyle(fontWeight: FontWeight.w800)),
      if (timeline.isEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Current status: ${_text(item['status'])}')) else ...timeline.whereType<Map>().map((Map event) => ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.check_circle_outline, color: Color(0xFF08766D)), title: Text(_text(event['status'] ?? event['title'])), subtitle: Text(_text(event['createdAt'] ?? event['date'] ?? event['note'], '')))),
      const SizedBox(height: 8), const Text('Supporting evidence', style: TextStyle(fontWeight: FontWeight.w800)),
      if (evidenceDocuments.isEmpty) const Padding(padding: EdgeInsets.only(top: 8), child: Text('No supporting evidence attached.')) else ...evidenceDocuments.map((dynamic document) => _evidenceLink(document)),
      if (receipt.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton.icon(onPressed: () => _openLink(receipt), icon: const Icon(Icons.receipt_long_outlined), label: const Text('Open receipt / proof'))),
      ...proofDocuments.map((dynamic document) {
        final String url = document is Map ? _text(document['url'] ?? document['documentUrl'], '') : _text(document, '');
        return url.isEmpty ? const SizedBox.shrink() : Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton.icon(onPressed: () => _openLink(url), icon: const Icon(Icons.description_outlined), label: const Text('Open fulfilment document')));
      }),
      if (status == 'MORE_INFORMATION_REQUIRED') Padding(padding: const EdgeInsets.only(top: 8), child: FilledButton.icon(onPressed: () { Navigator.pop(c); _replyInformation(item); }, icon: const Icon(Icons.reply_outlined), label: const Text('Reply with information'))),
      if (<String>['SUBMITTED','MORE_INFORMATION_REQUIRED','UNDER_REVIEW'].contains(status)) Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton.icon(onPressed: () { Navigator.pop(c); _cancel(item); }, icon: const Icon(Icons.cancel_outlined), label: const Text('Cancel request'))),
    ])))));
  }
  Widget _evidenceLink(dynamic value) {
    final Map<String, dynamic> document = _map(value);
    final String url = _text(document['url'] ?? document['documentUrl'], '');
    final String name = _text(document['originalName'], 'Supporting evidence');
    final String mimeType = _text(document['mimeType'], '');
    if (url.isEmpty) return ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.lock_outline), title: Text(name), subtitle: const Text('Secure link unavailable'));
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: OutlinedButton.icon(
        onPressed: () => _openLink(url),
        icon: Icon(mimeType == 'application/pdf' ? Icons.picture_as_pdf : Icons.image_outlined),
        label: SizedBox(width: 210, child: Text('Open $name', maxLines: 2, overflow: TextOverflow.ellipsis)),
      ),
    );
  }
  Widget _line(String label, String value) => Padding(padding: const EdgeInsets.only(bottom: 8), child: Row(children: <Widget>[SizedBox(width: 100, child: Text(label, style: const TextStyle(color: Color(0xFF667085)))), Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600)))]));
  Widget _field(String key, String label, {bool required = true, TextInputType? type, int lines = 1}) => Padding(padding: const EdgeInsets.only(bottom: 12), child: TextFormField(controller: _fields[key], validator: required ? _required : null, keyboardType: type, maxLines: lines, decoration: InputDecoration(labelText: label, border: const OutlineInputBorder())));
  List<Widget> _specificFields() {
    if (_category == 'SCHOOL_FEES') return <Widget>[_field('schoolName', 'School name'), _field('studentName', 'Student name'), _field('classLevel', 'Class level'), _field('termSession', 'Term / session')];
    if (_category == 'MEDICAL_SUPPORT') return <Widget>[_field('facilityName', 'Facility / pharmacy name'), _field('patientName', 'Patient name'), _field('treatmentDescription', 'Treatment description', lines: 3)];
    return <Widget>[_field('householdSize', 'Household size', type: TextInputType.number), _field('foodItems', 'Requested food items', lines: 2)];
  }
  @override Widget build(BuildContext context) => Scaffold(backgroundColor: const Color(0xFFF5F8F8), appBar: AppBar(title: const Text('ServicePay Amana'), actions: <Widget>[IconButton(onPressed: _load, icon: const Icon(Icons.refresh))]), body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: <Widget>[
    const Text('Support your loved ones', style: TextStyle(fontSize: 23, fontWeight: FontWeight.w800)), const SizedBox(height: 5), const Text('Choose a protected support category. You can track every request and receive proof when it is completed.'), const SizedBox(height: 16),
    ..._categories.map((Map<String, dynamic> item) => Card(child: ListTile(onTap: () => setState(() { _category = item['id'].toString(); _formOpen = true; _fields['title']!.text = item['name'].toString(); }), leading: CircleAvatar(backgroundColor: const Color(0xFFE4F5F2), child: Icon(item['icon'] as IconData, color: const Color(0xFF08766D))), title: Text(item['name'].toString()), subtitle: Text(item['description'].toString()), trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 16)))),
    if (_formOpen) Card(margin: const EdgeInsets.only(top: 16), child: Padding(padding: const EdgeInsets.all(16), child: Form(key: _form, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
      Text('Create ${_categoryName(_category)} request', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)), const SizedBox(height: 16),
      _field('title', 'Request title'), _field('description', 'Describe what is needed', lines: 3), _field('amount', 'Requested amount (₦)', type: const TextInputType.numberWithOptions(decimal: true)),
      const Text('Beneficiary', style: TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 8), _field('beneficiaryName', 'Full name'), _field('beneficiaryPhone', 'Phone number', type: TextInputType.phone), _field('relationship', 'Relationship'), _field('state', 'State'), _field('lga', 'LGA'), _field('address', 'Address'),
      const Text('Category details', style: TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 8), ..._specificFields(),
      _field('providerName', 'Preferred provider / vendor', required: false), _field('providerPhone', 'Provider phone', required: false, type: TextInputType.phone),
      _selectedEvidence(), const SizedBox(height: 12),
      SizedBox(width: double.infinity, child: FilledButton(onPressed: _submitting ? null : _submit, child: _submitting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Submit protected request'))),
    ])))),
    const SizedBox(height: 24), const Text('My request history', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)), const SizedBox(height: 8),
    if (_loading) const Padding(padding: EdgeInsets.all(28), child: Center(child: CircularProgressIndicator())) else if (_error.isNotEmpty) Center(child: Column(children: <Widget>[Text(_error), TextButton(onPressed: _load, child: const Text('Try again'))])) else if (_orders.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No Amana requests yet. Choose a category above to get started.'))) else ..._orders.map((Map<String, dynamic> order) => Card(child: ListTile(onTap: () => _details(order), title: Text(_text(order['title'], _categoryName(_text(order['category'], 'FOOD_PACKAGE')))), subtitle: Text('${_text(order['reference'])}\n${_text(order['status'])}'), isThreeLine: true, trailing: const Icon(Icons.receipt_long_outlined)))),
  ])));
}