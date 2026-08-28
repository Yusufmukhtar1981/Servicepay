import 'package:flutter/material.dart';

import '../services/phone_financing_officer_api_service.dart';

const Color _officerGreen = Color(0xFF08783E);
const Color _officerInk = Color(0xFF17352B);

class PhoneFinancingOfficerDashboardScreen extends StatefulWidget {
  const PhoneFinancingOfficerDashboardScreen({super.key, this.api});
  final PhoneFinancingOfficerApiService? api;
  @override
  State<PhoneFinancingOfficerDashboardScreen> createState() =>
      _PhoneFinancingOfficerDashboardScreenState();
}

class _PhoneFinancingOfficerDashboardScreenState
    extends State<PhoneFinancingOfficerDashboardScreen> {
  late final PhoneFinancingOfficerApiService _api;
  bool _loading = true;
  String _error = '';
  int _tab = 0;
  Map<String, dynamic> _dashboard = <String, dynamic>{};
  List<Map<String, dynamic>> _applications = <Map<String, dynamic>>[];

  static const List<String> _tabs = <String>[
    'Assigned', 'Pending verification', 'Completed', 'Follow-up',
  ];

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? PhoneFinancingOfficerApiService();
    _load();
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map((Map value) => _map(value)).toList()
      : <Map<String, dynamic>>[];
  String _text(dynamic value, [String fallback = '—']) {
    final String text = value?.toString().trim() ?? '';
    return text.isEmpty || text == 'null' ? fallback : text;
  }
  String _id(Map<String, dynamic> value) =>
      _text(value['_id'] ?? value['id'], '');

  Future<void> _load() async {
    setState(() { _loading = true; _error = ''; });
    try {
      final Map<String, dynamic> result = await _api.applications();
      if (!mounted) return;
      setState(() {
        _applications = _list(result['applications']);
        _dashboard = <String, dynamic>{
          'assigned': _applications.length,
          'pendingVerification': _applications.where(_needsVerification).length,
          'completedVerification': _applications.where(_hasVerification).length,
        };
        _loading = false;
      });
    } on PhoneFinancingOfficerApiException catch (error) {
      if (mounted) setState(() { _loading = false; _error = error.message; });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Unable to load assigned phone-financing applications.';
        });
      }
    }
  }

  bool _hasVerification(Map<String, dynamic> item) =>
      _map(item['verification'] ?? item['verificationReport']).isNotEmpty ||
      _text(item['verificationStatus'], '').toUpperCase() == 'COMPLETED';
  bool _needsVerification(Map<String, dynamic> item) =>
      !_hasVerification(item) &&
      !<String>['REJECTED', 'CANCELLED'].contains(
        _text(item['status'], '').toUpperCase(),
      );
  bool _hasFollowUp(Map<String, dynamic> item) {
    final dynamic followUps = item['followUps'] ?? item['followups'];
    return followUps is List && followUps.isNotEmpty;
  }

  List<Map<String, dynamic>> get _visible {
    switch (_tab) {
      case 1: return _applications.where(_needsVerification).toList();
      case 2: return _applications.where(_hasVerification).toList();
      case 3: return _applications.where(_hasFollowUp).toList();
      default: return _applications;
    }
  }

  void _notice(String message, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(message), behavior: SnackBarBehavior.floating,
        backgroundColor: error ? const Color(0xFFB42318) : _officerGreen,
      ));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    key: const Key('phone-financing-officer-dashboard'),
    backgroundColor: const Color(0xFFF4F8F5),
    appBar: AppBar(
      title: const Text('Phone Financing Officer'),
      backgroundColor: _officerInk, foregroundColor: Colors.white,
      actions: <Widget>[IconButton(onPressed: _loading ? null : _load,
          tooltip: 'Refresh', icon: const Icon(Icons.refresh))],
    ),
    body: _loading ? const Center(child: CircularProgressIndicator(color: _officerGreen))
        : _error.isNotEmpty ? _errorView() : RefreshIndicator(
          onRefresh: _load,
          child: ListView(padding: const EdgeInsets.all(18), children: <Widget>[
            const Text('My assigned applications',
              style: TextStyle(fontSize: 23, fontWeight: FontWeight.w900, color: _officerInk)),
            const SizedBox(height: 5),
            const Text('Review customer details, submit field findings and record follow-ups.'),
            const SizedBox(height: 14),
            Wrap(spacing: 9, runSpacing: 9, children: <Widget>[
              _metric('Assigned', _dashboard['assigned'] ?? _applications.length),
              _metric('Pending', _dashboard['pendingVerification'] ?? _applications.where(_needsVerification).length),
              _metric('Completed', _dashboard['completedVerification'] ?? _applications.where(_hasVerification).length),
            ]),
            const SizedBox(height: 18),
            SingleChildScrollView(scrollDirection: Axis.horizontal,
              child: Row(children: List<Widget>.generate(_tabs.length, (int index) =>
                Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(
                  label: Text(_tabs[index]), selected: _tab == index,
                  selectedColor: const Color(0xFFDDF4E6),
                  onSelected: (_) => setState(() => _tab = index),
                ))))),
            const SizedBox(height: 12),
            if (_visible.isEmpty) const _OfficerEmpty('No applications in this group.')
            else ..._visible.map(_applicationCard),
          ]),
        ),
  );

  Widget _metric(String label, dynamic value) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
      Text('$value', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 21, color: _officerInk)),
      Text(label, style: const TextStyle(color: Colors.blueGrey)),
    ]),
  );

  Widget _applicationCard(Map<String, dynamic> item) {
    final Map<String, dynamic> customer = _map(item['customer']);
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.all(14),
        leading: const CircleAvatar(backgroundColor: Color(0xFFDDF4E6),
            child: Icon(Icons.person_outline, color: _officerGreen)),
        title: Text(_text(customer['fullName'], 'Assigned customer'),
            style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Padding(padding: const EdgeInsets.only(top: 5), child: Text(
          '${_text(item['reference'], 'Application')} • ${_text(item['status'], 'ASSIGNED')}\n'
          '${_text(customer['phone'])} • ${_text(customer['state'] ?? item['state'])}',
        )),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => _details(item),
      ),
    );
  }

  Future<void> _details(Map<String, dynamic> summary) async {
    Map<String, dynamic> item = summary;
    try {
      final String id = _id(summary);
      if (id.isNotEmpty) item = _map((await _api.application(id))['application'])..addAll(summary);
    } catch (_) {
      // The summary contains enough scoped information for an offline retry.
    }
    if (!mounted) return;
    final Map<String, dynamic> customer = _map(item['customer']);
    final Map<String, dynamic> kyc = _map(item['kycSnapshot']);
    final Map<String, dynamic> input = _map(item['applicationInput']);
    final List<Map<String, dynamic>> followUps = _list(item['followUps']);
    await showModalBottomSheet<void>(
      context: context, isScrollControlled: true,
      builder: (BuildContext context) => SafeArea(child: Padding(
        padding: const EdgeInsets.all(20),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
            Text(_text(customer['fullName'], 'Customer'),
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            _detail('Reference', _text(item['reference'])),
            _detail('Phone', _text(customer['phone'])),
            _detail('Address', _text(customer['address'] ?? item['address'])),
            _detail('KYC status', _text(kyc['status'])),
            _detail('Occupation', _text(input['occupation'])),
            _detail('Monthly income', _text(input['monthlyIncome'])),
            _detail('State / LGA', '${_text(input['state'])} / ${_text(input['lga'])}'),
            _detail('Requested term', '${_text(input['preferredDurationWeeks'])} weeks'),
            _detail('Product', _text(_map(item['product'])['name'] ?? _map(item['productSnapshot'])['name'])),
            _detail('Application status', _text(item['status'])),
            if (_map(item['verification'] ?? item['verificationReport'])
                .isNotEmpty)
              _detail(
                'Verification recommendation',
                _text(
                  _map(item['verification'] ?? item['verificationReport'])
                      ['recommendation'],
                ),
              ),
            if (followUps.isNotEmpty) ...<Widget>[
              const SizedBox(height: 6),
              const Text('Follow-up history',
                  style: TextStyle(fontWeight: FontWeight.w800)),
              ...followUps.map((Map<String, dynamic> followUp) => _detail(
                    '${_text(followUp['outcome'], 'Contacted / visited')} • ${_text(followUp['createdAt'])}',
                    '${_text(followUp['note'])} • Next: ${_text(followUp['nextFollowUpAt'])}',
                  )),
            ],
            const SizedBox(height: 12),
            if (_needsVerification(item)) FilledButton.icon(
              onPressed: () { Navigator.pop(context); _verificationForm(item); },
              icon: const Icon(Icons.fact_check_outlined), label: const Text('Submit verification'),
            ),
            TextButton.icon(
              onPressed: () { Navigator.pop(context); _followUpForm(item); },
              icon: const Icon(Icons.phone_in_talk_outlined), label: const Text('Record follow-up'),
            ),
          ])),
      )),
    );
  }

  Widget _detail(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 7),
    child: Text('$label: $value'),
  );

  Future<void> _verificationForm(Map<String, dynamic> item) async {
    final TextEditingController notes = TextEditingController();
    final TextEditingController income = TextEditingController();
    final TextEditingController guarantor = TextEditingController();
    String recommendation = 'NEED_MORE_INFORMATION';
    final Map<String, bool> checklist = <String, bool>{
      'identityConfirmed': false, 'phoneConfirmed': false,
      'addressConfirmed': false, 'occupationConfirmed': false,
      'incomeAssessed': false, 'customerContacted': false,
    };
    final bool? submit = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialog) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) => AlertDialog(
          title: const Text('Verification findings'),
          content: SizedBox(width: 520, child: SingleChildScrollView(child: Column(
            mainAxisSize: MainAxisSize.min, children: <Widget>[
              ...checklist.keys.map((String key) => CheckboxListTile(
                contentPadding: EdgeInsets.zero, value: checklist[key],
                title: Text(key.replaceAllMapped(RegExp(r'([A-Z])'), (Match m) => ' ${m.group(1)}')),
                onChanged: (bool? value) => setDialogState(() => checklist[key] = value == true),
              )),
              TextField(controller: income, decoration: const InputDecoration(labelText: 'Income assessment')),
              TextField(controller: guarantor, decoration: const InputDecoration(labelText: 'Guarantor details (optional)')),
              TextField(controller: notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Field notes')),
              DropdownButtonFormField<String>(
                value: recommendation, decoration: const InputDecoration(labelText: 'Recommendation'),
                items: const <String>['APPROVE', 'REJECT', 'NEED_MORE_INFORMATION']
                  .map((String value) => DropdownMenuItem(value: value, child: Text(value.replaceAll('_', ' ')))).toList(),
                onChanged: (String? value) => setDialogState(() => recommendation = value ?? recommendation),
              ),
            ],
          ))),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(dialog, true), child: const Text('Submit report')),
          ],
        ),
      ),
    );
    if (submit == true) {
      try {
        await _api.submitVerification(_id(item), <String, dynamic>{
          'decision': recommendation,
          'recommendation': recommendation,
          'checklist': checklist,
          'findings': <String, dynamic>{
            'incomeAssessment': income.text.trim(),
            'guarantorDetails': guarantor.text.trim(),
          },
          'notes': notes.text.trim(),
        });
        _notice('Verification report submitted for Head Office review.');
        await _load();
      } on PhoneFinancingOfficerApiException catch (error) {
        _notice(error.message, error: true);
      }
    }
    notes.dispose(); income.dispose(); guarantor.dispose();
  }

  Future<void> _followUpForm(Map<String, dynamic> item) async {
    final TextEditingController notes = TextEditingController();
    final TextEditingController nextFollowUpAt = TextEditingController();
    String outcome = 'CONTACTED';
    String method = 'PHONE';
    final bool? save = await showDialog<bool>(
      context: context, builder: (BuildContext dialog) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) => AlertDialog(
          title: const Text('Record follow-up'),
          content: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            DropdownButtonFormField<String>(
              value: method,
              decoration: const InputDecoration(labelText: 'Contacted / visited'),
              items: const <String>['PHONE', 'VISIT', 'SMS', 'WHATSAPP']
                  .map((String value) => DropdownMenuItem(
                      value: value, child: Text(value)))
                  .toList(),
              onChanged: (String? value) =>
                  setDialogState(() => method = value ?? method)),
            DropdownButtonFormField<String>(value: outcome,
              items: const <String>['CONTACTED', 'UNABLE_TO_CONTACT', 'MORE_INFORMATION_REQUIRED']
                .map((String value) => DropdownMenuItem(value: value, child: Text(value.replaceAll('_', ' ')))).toList(),
              onChanged: (String? value) => setDialogState(() => outcome = value ?? outcome)),
            TextField(controller: notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Follow-up notes')),
            TextField(
                controller: nextFollowUpAt,
                decoration: const InputDecoration(
                    labelText: 'Next follow-up (ISO date, optional)')),
          ]),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(dialog, true), child: const Text('Save follow-up')),
          ],
        ),
      ));
    if (save == true) {
      try {
        await _api.createFollowUp(_id(item), <String, dynamic>{
          'outcome': outcome, 'notes': notes.text.trim(),
          'contactMethod': method,
          if (nextFollowUpAt.text.trim().isNotEmpty)
            'nextFollowUpAt': nextFollowUpAt.text.trim(),
        });
        _notice('Follow-up saved.'); await _load();
      } on PhoneFinancingOfficerApiException catch (error) {
        _notice(error.message, error: true);
      }
    }
    notes.dispose();
    nextFollowUpAt.dispose();
  }

  Widget _errorView() => Center(child: Padding(padding: const EdgeInsets.all(24),
    child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
      Text(_error, textAlign: TextAlign.center), const SizedBox(height: 12),
      FilledButton(onPressed: _load, child: const Text('Try again')),
    ])));
}

class _OfficerEmpty extends StatelessWidget {
  const _OfficerEmpty(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(30),
    child: Center(child: Text(text, style: const TextStyle(color: Colors.blueGrey))),
  );
}