import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'dart:typed_data';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../servicepay_theme.dart';
import 'nigeria_locations.dart';
import 'organizations_api.dart';

Map<String, String> industrySectorPayload(
    String value, List<String> requestedFields, bool moreInformation) {
  if (!moreInformation) return {'industry': value};
  final result = <String, String>{};
  if (requestedFields.contains('industry')) result['industry'] = value;
  if (requestedFields.contains('sector')) result['sector'] = value;
  return result;
}

List<String> requiredOrganizationDocuments(
    String organizationType, String registrationStatus) {
  final type = organizationType.trim().toUpperCase();
  final registered = registrationStatus.trim().toUpperCase() == 'REGISTERED';
  if (type == 'COMPANY' && registered) {
    return const ['CERTIFICATE_OF_INCORPORATION'];
  }
  const governedTypes = {
    'NGO',
    'COOPERATIVE',
    'ASSOCIATION',
    'FOUNDATION',
    'SCHOOL',
    'RELIGIOUS',
    'GOVERNMENT',
    'COMMUNITY',
  };
  if (governedTypes.contains(type)) {
    return [registered ? 'REGISTRATION_CERTIFICATE' : 'GOVERNING_DOCUMENT'];
  }
  return const [];
}

class OrganizationOnboardingScreen extends StatefulWidget {
  const OrganizationOnboardingScreen(
      {super.key, required this.api, this.organizationId, this.initialValues});
  final OrganizationsApi api;
  final String? organizationId;
  final Map<String, dynamic>? initialValues;
  @override
  State<OrganizationOnboardingScreen> createState() =>
      _OrganizationOnboardingScreenState();
}

class _OrganizationOnboardingScreenState
    extends State<OrganizationOnboardingScreen> {
  final form = GlobalKey<FormState>();
  final values = <String, dynamic>{};
  final controllers = <String, TextEditingController>{};
  String? organizationId;
  int step = 0;
  bool saving = false, submitting = false, declaration = false;
  Map<String, dynamic> organization = {};
  List<Map<String, dynamic>> documents = [];
  final documentBytes = <String, Uint8List>{};
  final documentState = <String, String>{};
  final documentPdf = <String, bool>{};
  final documentUploading = <String, bool>{};
  String? submissionKey;
  String? error;

  static const titles = [
    'Organization details',
    'Office address',
    'Representative',
    'Documents',
    'Review & declaration'
  ];
  static const types = [
    'COMPANY',
    'NGO',
    'COOPERATIVE',
    'ASSOCIATION',
    'FOUNDATION',
    'CLUB',
    'OTHER',
    'SCHOOL',
    'RELIGIOUS',
    'GOVERNMENT',
    'COMMUNITY'
  ];
  static const statuses = ['REGISTERED', 'UNREGISTERED'];

  @override
  void initState() {
    super.initState();
    values.addAll(widget.initialValues ?? {});
    organizationId = widget.organizationId;
    if (organizationId != null) _load();
  }

  @override
  void dispose() {
    for (final c in controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  TextEditingController _controller(String key) => controllers.putIfAbsent(
      key, () => TextEditingController(text: '${values[key] ?? ''}'));
  Future<void> _load() async {
    try {
      final data = await widget.api.onboarding(organizationId!);
      final org = data['organization'] is Map
          ? Map<String, dynamic>.from(data['organization'])
          : <String, dynamic>{};
      setState(() {
        organization = org;
        values.addAll(org);
        values['organizationType'] =
            org['organizationType'] ?? org['type'] ?? '';
        values['registrationStatus'] = org['registrationStatus'] ?? '';
        final address = org['officeAddress'] is Map
            ? Map<String, dynamic>.from(org['officeAddress'])
            : <String, dynamic>{};
        values.addAll({
          'address': address['address'] ?? '',
          'state': address['state'] ?? '',
          'lga': address['lga'] ?? '',
          'city': address['city'] ?? '',
          'landmark': address['landmark'] ?? '',
        });
        final rep = org['representative'] is Map
            ? Map<String, dynamic>.from(org['representative'])
            : <String, dynamic>{};
        final residential = rep['residentialAddress'] is Map
            ? Map<String, dynamic>.from(rep['residentialAddress'])
            : <String, dynamic>{};
        values.addAll({
          'repName': rep['fullName'] ?? '',
          'repRole': rep['role'] ?? '',
          'repPhone': rep['phone'] ?? '',
          'repEmail': rep['email'] ?? '',
          'repNin': rep['nin'] ?? '',
          'repAddress': residential['address'] ?? '',
          'repState': residential['state'] ?? '',
          'repLga': residential['lga'] ?? '',
          'repCity': residential['city'] ?? '',
          'repLandmark': residential['landmark'] ?? '',
        });
        if ('${values['industry'] ?? ''}'.trim().isEmpty &&
            '${org['sector'] ?? ''}'.trim().isNotEmpty) {
          values['industry'] = org['sector'];
        }
        for (final entry in controllers.entries) {
          entry.value.text = _value(entry.key);
        }
        documents = _maps(org['documents']);
      });
      for (final doc in documents) {
        final id = '${doc['id'] ?? doc['_id'] ?? ''}';
        final type = '${doc['documentType'] ?? ''}'.toUpperCase();
        final mime = '${doc['mimeType'] ?? doc['mime'] ?? ''}'.toLowerCase();
        final url = '${doc['url'] ?? ''}';
        if (type.isNotEmpty) {
          documentPdf[type] = mime == 'application/pdf' ||
              url.toLowerCase().split('?').first.endsWith('.pdf');
          if (mounted) {
            setState(() {});
          }
        }
        if (id.isEmpty || doc['url'] is String) continue;
        try {
          final preview =
              await widget.api.organizationDocument(organizationId!, id);
          final value = preview['document'];
          if (value is Map && value['url'] is String && mounted) {
            setState(() {
              final index = documents.indexOf(doc);
              if (index >= 0) {
                documents[index] = {...documents[index], 'url': value['url']};
                final mime =
                    '${value['mimeType'] ?? value['mime'] ?? ''}'.toLowerCase();
                final url = '${value['url']}';
                documentPdf['${doc['documentType']}'.toUpperCase()] =
                    mime == 'application/pdf' ||
                        url.toLowerCase().split('?').first.endsWith('.pdf');
              }
            });
          }
        } catch (_) {
          // A private preview is optional while the document remains uploaded.
        }
      }
    } catch (e) {
      setState(() => error = _message(e));
    }
  }

  List<Map<String, dynamic>> _maps(dynamic v) => v is List
      ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : [];
  String _message(Object e) => e.toString().replaceFirst('Exception: ', '');
  String _value(String key) => '${values[key] ?? ''}';
  bool get _moreInfo =>
      '${organization['status']}'.toUpperCase() == 'MORE_INFORMATION_REQUIRED';
  List<String> get _requestedFields {
    final info = organization['requestedInformation'];
    return info is Map && info['fields'] is List
        ? (info['fields'] as List).map((e) => '$e').toList()
        : const [];
  }

  bool _editable(String key) {
    if (!_moreInfo) return true;
    final aliases = <String>[
      key,
      if (key == 'industry') 'sector',
      if (['address', 'state', 'lga', 'city', 'landmark'].contains(key))
        'officeAddress.$key',
      if (key == 'repName') 'representative.fullName',
      if (key == 'repRole') 'representative.role',
      if (key == 'repPhone') 'representative.phone',
      if (key == 'repEmail') 'representative.email',
      if (key == 'repNin') 'representative.nin',
      if (key == 'repAddress') 'representative.residentialAddress.address',
      if (key == 'repState') 'representative.residentialAddress.state',
      if (key == 'repLga') 'representative.residentialAddress.lga',
      if (key == 'repCity') 'representative.residentialAddress.city',
      if (key == 'repLandmark') 'representative.residentialAddress.landmark',
    ];
    return aliases.any((item) => _requestedFields.contains(item));
  }

  Map<String, dynamic> _payload() {
    final payload = <String, dynamic>{
      'name': _value('name'),
      'organizationType': _value('organizationType'),
      'registrationStatus': _value('registrationStatus'),
      'registrationNumber': _value('registrationNumber'),
      'description': _value('description'),
      'industry': _value('industry'),
      'website': _value('website'),
      if (_value('dateEstablished').isNotEmpty)
        'dateEstablished': _value('dateEstablished'),
      'organizationEmail': _value('organizationEmail'),
      'organizationPhone': _value('organizationPhone'),
      'officeAddress': {
        'address': _value('address'),
        'state': _value('state'),
        'lga': _value('lga'),
        'city': _value('city'),
        'landmark': _value('landmark')
      },
      'representative': {
        'fullName': _value('repName'),
        'role': _value('repRole'),
        'phone': _value('repPhone'),
        'email': _value('repEmail'),
        'nin': _value('repNin'),
        'residentialAddress': {
          'address': _value('repAddress'),
          'state': _value('repState'),
          'lga': _value('repLga'),
          'city': _value('repCity'),
          'landmark': _value('repLandmark')
        }
      },
    };
    if (!_moreInfo) return payload;
    final allowed = <String, dynamic>{};
    for (final key in [
      'name',
      'organizationType',
      'registrationStatus',
      'registrationNumber',
      'description',
      'dateEstablished',
      'organizationEmail',
      'organizationPhone',
      'website'
    ]) {
      if (_requestedFields.contains(key)) allowed[key] = payload[key];
    }
    allowed.addAll(
        industrySectorPayload(_value('industry'), _requestedFields, true));
    final office = <String, dynamic>{};
    for (final key in ['address', 'state', 'lga', 'city', 'landmark']) {
      if (_requestedFields.contains('officeAddress.$key')) {
        office[key] = payload['officeAddress'][key];
      }
    }
    if (office.isNotEmpty) allowed['officeAddress'] = office;
    final rep = <String, dynamic>{};
    for (final key in ['fullName', 'role', 'phone', 'email', 'nin']) {
      if (_requestedFields.contains('representative.$key')) {
        rep[key] = payload['representative'][key];
      }
    }
    final residential = <String, dynamic>{};
    if (_requestedFields
        .contains('representative.residentialAddress.address')) {
      residential['address'] = _value('repAddress');
    }
    if (_requestedFields.contains('representative.residentialAddress.state')) {
      residential['state'] = _value('repState');
    }
    if (_requestedFields.contains('representative.residentialAddress.lga')) {
      residential['lga'] = _value('repLga');
    }
    if (_requestedFields.contains('representative.residentialAddress.city')) {
      residential['city'] = _value('repCity');
    }
    if (_requestedFields
        .contains('representative.residentialAddress.landmark')) {
      residential['landmark'] = _value('repLandmark');
    }
    if (residential.isNotEmpty) rep['residentialAddress'] = residential;
    if (rep.isNotEmpty) allowed['representative'] = rep;
    return allowed;
  }

  Future<void> _save({bool create = false}) async {
    if (saving) return;
    setState(() => saving = true);
    try {
      if (create || organizationId == null) {
        final data = await widget.api.createOnboarding(_payload());
        final org = data['organization'] is Map
            ? Map<String, dynamic>.from(data['organization'])
            : <String, dynamic>{};
        organizationId = '${org['id'] ?? org['_id'] ?? data['id'] ?? ''}';
        organization = org;
      } else {
        final data =
            await widget.api.saveOnboarding(organizationId!, _payload());
        if (data['organization'] is Map) {
          organization = Map<String, dynamic>.from(data['organization']);
        }
      }
      if (mounted) setState(() => error = null);
    } catch (e) {
      if (mounted) setState(() => error = _message(e));
    }
    if (mounted) setState(() => saving = false);
  }

  Future<void> _continue() async {
    if (!(form.currentState?.validate() ?? true)) return;
    form.currentState?.save();
    await _save(create: organizationId == null);
    if (!mounted || error != null) return;
    if (step < 4) {
      setState(() => step++);
    } else {
      await _submit();
    }
  }

  Future<void> _submit() async {
    if (submitting || organizationId == null || !declaration) return;
    setState(() => submitting = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final key = 'organization_submission_$organizationId';
      submissionKey ??= prefs.getString(key);
      submissionKey ??= 'org-submit-${DateTime.now().microsecondsSinceEpoch}';
      await prefs.setString(key, submissionKey!);
      final result = await widget.api.submitOnboarding(
          organizationId!, {'declaration': true},
          idempotencyKey: submissionKey);
      await prefs.remove(key);
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (c) => AlertDialog(
                title: const Text('Organization submitted'),
                content: Text(
                    'Your organization has been submitted for review.\n\nPending Review\nReference: ${result['submission']?['organizationReference'] ?? organization['organizationReference'] ?? '—'}\nDate: ${DateTime.now().toLocal().toString().split(' ').first}'),
                actions: [
                  FilledButton(
                      onPressed: () {
                        Navigator.pop(c);
                        Navigator.pop(context, true);
                      },
                      child: const Text('View Organization'))
                ],
              ));
    } catch (e) {
      if (mounted) setState(() => error = _message(e));
    }
    if (mounted) setState(() => submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final content = Form(
        key: form,
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
              width > 720 ? 32 : 18, 8, width > 720 ? 32 : 18, 32),
          child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720), child: _step()),
        ));
    return Scaffold(
        backgroundColor: ServicePayColors.canvas,
        appBar: AppBar(
            title: const Text('Register an organization'),
            backgroundColor: ServicePayColors.brand,
            foregroundColor: Colors.white),
        body: SafeArea(
            child: Column(children: [
          Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 8),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Step ${step + 1} of 5',
                        style: const TextStyle(
                            color: ServicePayColors.brand,
                            fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    LinearProgressIndicator(
                        value: (step + 1) / 5,
                        minHeight: 7,
                        borderRadius: BorderRadius.circular(8),
                        color: ServicePayColors.brand),
                    const SizedBox(height: 18),
                    Text(titles[step],
                        style: const TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.w900,
                            color: ServicePayColors.ink)),
                    const SizedBox(height: 4),
                    Text('A clear, secure path to verifying your organization.',
                        style: TextStyle(color: ServicePayColors.muted)),
                  ])),
          if (error != null)
            Padding(
                padding: const EdgeInsets.symmetric(horizontal: 18),
                child: Material(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Row(children: [
                          const Icon(Icons.error_outline,
                              color: ServicePayColors.danger),
                          const SizedBox(width: 8),
                          Expanded(child: Text(error!)),
                          IconButton(
                              onPressed: () => setState(() => error = null),
                              icon: const Icon(Icons.close))
                        ])))),
          Expanded(
              child: Align(alignment: Alignment.topCenter, child: content)),
          Padding(
              padding: const EdgeInsets.all(18),
              child: Row(children: [
                if (step > 0)
                  Expanded(
                      child: OutlinedButton(
                          onPressed: saving || submitting
                              ? null
                              : () => setState(() => step--),
                          child: const Text('Back'))),
                if (step > 0) const SizedBox(width: 12),
                Expanded(
                    flex: 2,
                    child: FilledButton(
                        onPressed: saving || submitting ? null : _continue,
                        child: Text(step == 4
                            ? (submitting
                                ? 'Submitting...'
                                : 'Submit for review')
                            : (saving ? 'Saving...' : 'Continue')))),
              ])),
        ])));
  }

  Widget _step() => switch (step) {
        0 => _details(),
        1 => _address(),
        2 => _representative(),
        3 => _documents(),
        _ => _review()
      };
  InputDecoration _dec(String label, {String? hint}) => InputDecoration(
      labelText: label,
      hintText: hint,
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none));
  Widget _field(String key, String label,
          {bool required = true, TextInputType? keyboard, int maxLines = 1}) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: TextFormField(
              controller: _controller(key),
              readOnly: _moreInfo && !_editable(key),
              keyboardType: keyboard,
              maxLines: maxLines,
              decoration: _dec(label),
              validator: required && (!_moreInfo || _editable(key))
                  ? (v) =>
                      (v ?? '').trim().isEmpty ? '$label is required' : null
                  : null,
              onSaved: (v) => values[key] = v?.trim() ?? ''));

  Widget _dateField() => Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
          controller: _controller('dateEstablished'),
          readOnly: true,
          decoration: _dec('Date established',
              hint: 'Select the date your organization began'),
          validator: null,
          onTap: () async {
            if (_moreInfo && !_editable('dateEstablished')) return;
            final date = await showDatePicker(
                context: context,
                firstDate: DateTime(1900),
                lastDate: DateTime.now(),
                initialDate: DateTime.now());
            if (date != null) {
              final text = date.toIso8601String().split('T').first;
              values['dateEstablished'] = text;
              _controller('dateEstablished').text = text;
            }
          },
          onSaved: (v) => values['dateEstablished'] = v?.trim() ?? ''));
  Widget _select(String key, String label, List<String> items,
          {bool required = true, ValueChanged<String?>? onChanged}) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: DropdownButtonFormField<String>(
              value: items.contains(_value(key)) ? _value(key) : null,
              decoration: _dec(label),
              items: items
                  .map((e) => DropdownMenuItem(value: e, child: Text(e)))
                  .toList(),
              validator: required && (!_moreInfo || _editable(key))
                  ? (v) => v == null ? '$label is required' : null
                  : null,
              onChanged: _moreInfo && !_editable(key)
                  ? null
                  : (onChanged ??
                      ((v) => setState(() => values[key] = v ?? '')))));
  Widget _details() =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _field('name', 'Organization name'),
        _select('organizationType', 'Organization type', types),
        _select('registrationStatus', 'Registration status', statuses),
        if (_value('registrationStatus') == 'REGISTERED')
          _field('registrationNumber', 'Registration number'),
        _dateField(),
        _field('organizationEmail', 'Official email',
            keyboard: TextInputType.emailAddress),
        _field('organizationPhone', 'Official phone',
            keyboard: TextInputType.phone),
        _field('description', 'What does your organization do?',
            required: true, maxLines: 3),
        _field('industry', 'Industry or sector'),
      ]);
  Widget _address() {
    final state = _value('state');
    return Column(children: [
      _field('address', 'Office address'),
      _select('state', 'State', nigeriaLocations.keys.toList(),
          onChanged: (v) => setState(() {
                values['state'] = v ?? '';
                values['lga'] = '';
              })),
      _select('lga', 'LGA', nigeriaLocations[state] ?? const [],
          required: true),
      _field('city', 'City', required: false),
      _field('landmark', 'Landmark', required: false)
    ]);
  }

  Widget _representative() => Column(children: [
        _field('repName', 'Full name'),
        _field('repRole', 'Role in organization'),
        _field('repPhone', 'Phone number', keyboard: TextInputType.phone),
        _field('repEmail', 'Email address',
            keyboard: TextInputType.emailAddress),
        _field('repNin', 'Representative NIN'),
        _field('repAddress', 'Residential address'),
        _field('repState', 'Residential state', required: false),
        _field('repLga', 'Residential LGA', required: false),
        _field('repCity', 'Residential city'),
        _field('repLandmark', 'Residential landmark', required: false)
      ]);
  Widget _documents() {
    final required = requiredOrganizationDocuments(
        _value('organizationType'), _value('registrationStatus'));
    final requested = _organizationRequestedDocuments();
    final documentTypes = _moreInfo ? requested : required;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text(
          'Only the documents relevant to your organization are requested.',
          style: TextStyle(height: 1.4)),
      const SizedBox(height: 16),
      if (documentTypes.isNotEmpty)
        ...documentTypes.map(_documentCard)
      else
        const _Notice(
            text: 'No private document is required for this organization type.')
    ]);
  }

  Widget _documentCard(String type) {
    final doc = documents
        .where((d) => '${d['documentType']}'.toUpperCase() == type)
        .firstOrNull;
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(16),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(type.replaceAll('_', ' '),
                  style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(
                  documentState[type] ??
                      (doc == null
                          ? 'Upload a clear image or PDF, up to 8 MB.'
                          : 'Uploaded successfully'),
                  style: TextStyle(
                      color: doc == null
                          ? ServicePayColors.muted
                          : ServicePayColors.success)),
              if (documentUploading[type] == true)
                const Padding(
                    padding: EdgeInsets.only(top: 10),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          LinearProgressIndicator(),
                          SizedBox(height: 6),
                          Text('Uploading securely…')
                        ])),
              if (documentBytes[type] != null && documentPdf[type] != true)
                Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Image.memory(documentBytes[type]!,
                        height: 150, fit: BoxFit.cover)),
              if (documentPdf[type] == true)
                Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Row(children: [
                      const Expanded(
                          child: _Notice(
                              text:
                                  'PDF document uploaded. Open it to review.')),
                      TextButton(
                          onPressed:
                              documentUploading[type] == true || doc == null
                                  ? null
                                  : () => _openPdf(type, doc),
                          child: const Text('Open'))
                    ]))
              else if (documentBytes[type] == null && doc?['url'] is String)
                Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Image.network('${doc!['url']}',
                        height: 150,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const _Notice(
                            text: 'Preview unavailable for this document.'))),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                  onPressed: documentUploading[type] == true ||
                          (_moreInfo &&
                              !(_requestedFields.contains(type) ||
                                  (_organizationRequestedDocuments()
                                      .contains(type))))
                      ? null
                      : () async {
                          final result = await FilePicker.platform.pickFiles(
                              type: FileType.custom,
                              allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'],
                              withData: true);
                          final path = result?.files.single.path;
                          final bytes = result?.files.single.bytes;
                          if ((path == null && bytes == null) ||
                              organizationId == null) {
                            return;
                          }
                          final isPdf =
                              result!.files.single.extension?.toLowerCase() ==
                                  'pdf';
                          setState(() {
                            documentState[type] = 'Uploading...';
                            documentUploading[type] = true;
                            documentPdf[type] = isPdf;
                          });
                          try {
                            final data = await widget.api
                                .uploadOrganizationDocument(
                                    organizationId: organizationId!,
                                    documentType: type,
                                    filePath: path ?? '',
                                    bytes: bytes,
                                    name: result.files.single.name);
                            if (mounted) {
                              setState(() {
                                if (bytes != null && !isPdf) {
                                  documentBytes[type] = bytes;
                                }
                                documentState[type] = 'Uploaded successfully';
                                documentUploading[type] = false;
                                final uploaded = data['document'] is Map
                                    ? Map<String, dynamic>.from(
                                        data['document'])
                                    : <String, dynamic>{
                                        'id': data['documentId'] ??
                                            data['id'] ??
                                            '',
                                        'documentType': type,
                                      };
                                if ('${uploaded['id'] ?? ''}'.isEmpty &&
                                    '${uploaded['_id'] ?? ''}'.isEmpty &&
                                    '${uploaded['documentId'] ?? ''}'
                                        .isNotEmpty) {
                                  uploaded['id'] = uploaded['documentId'];
                                }
                                documents = [
                                  ...documents.where((d) =>
                                      '${d['documentType']}'.toUpperCase() !=
                                      type),
                                  if ('${uploaded['id'] ?? uploaded['_id'] ?? ''}'
                                      .isNotEmpty)
                                    uploaded
                                ];
                              });
                            }
                          } catch (e) {
                            if (mounted) {
                              setState(() {
                                documentState[type] =
                                    'Upload failed. Try again.';
                                documentUploading[type] = false;
                                error = _message(e);
                              });
                            }
                          }
                        },
                  icon:
                      Icon(doc == null ? Icons.upload_file : Icons.swap_horiz),
                  label: Text(
                      doc == null ? 'Choose image or PDF' : 'Replace document'))
            ])));
  }

  Future<void> _openPdf(String type, Map<String, dynamic> doc) async {
    var url = doc['url'] is String ? '${doc['url']}' : '';
    if (url.isEmpty && organizationId != null) {
      try {
        final preview = await widget.api.organizationDocument(organizationId!,
            '${doc['id'] ?? doc['_id'] ?? doc['documentId'] ?? ''}');
        final value = preview['document'];
        if (value is Map && value['url'] is String) {
          url = '${value['url']}';
          if (mounted) {
            setState(() {
              documents = documents
                  .map((item) => item == doc ? {...item, 'url': url} : item)
                  .toList();
              documentPdf[type] = true;
            });
          }
        }
      } catch (e) {
        if (mounted) setState(() => error = _message(e));
      }
    }
    if (url.isEmpty || !mounted) return;
    final launched =
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!launched && mounted) {
      setState(() => error = 'This PDF could not be opened on this device.');
    }
  }

  List<String> _organizationRequestedDocuments() {
    final info = organization['requestedInformation'];
    return info is Map && info['documents'] is List
        ? (info['documents'] as List).map((e) => '$e'.toUpperCase()).toList()
        : const [];
  }

  Widget _review() =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (organization['status'] == 'MORE_INFORMATION_REQUIRED')
          _Notice(
              text:
                  'More information requested: ${organization['requestedInformation']?['reason'] ?? organization['reviewReason'] ?? 'Please update the requested items.'}'),
        _reviewSection(
            'Organization details',
            [
              _value('name'),
              '${_value('organizationType')} • ${_value('registrationStatus')}',
              _value('organizationEmail')
            ],
            0),
        _reviewSection('Office address',
            [_value('address'), '${_value('state')} • ${_value('lga')}'], 1),
        _reviewSection('Representative',
            [_value('repName'), _value('repRole'), _value('repEmail')], 2),
        _reviewSection(
            'Documents',
            documents.map((d) => '${d['documentType'] ?? 'Document'}').toList(),
            3),
        CheckboxListTile(
            value: declaration,
            onChanged: (v) => setState(() => declaration = v ?? false),
            title: const Text(
                'I confirm these details are accurate and I am authorized to submit this organization for verification.'),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero)
      ]);
  Widget _reviewSection(String title, List<String> lines, int index) => Card(
      child: ListTile(
          title:
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text(lines.where((x) => x.trim().isNotEmpty).join('\n')),
          trailing: TextButton(
              onPressed: () => setState(() => step = index),
              child: const Text('Edit'))));
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: ServicePayColors.brandSoft,
          borderRadius: BorderRadius.circular(14)),
      child: Text(text, style: const TextStyle(height: 1.4)));
}
