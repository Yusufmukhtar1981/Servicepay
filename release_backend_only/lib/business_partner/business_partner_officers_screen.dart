import 'package:flutter/material.dart';

import '../services/business_partner_api_service.dart';
import 'business_partner_permissions.dart';

const Color _officerInk = Color(0xFF18332B);
const Color _officerMuted = Color(0xFF70807A);
const Color _officerGreen = Color(0xFF078B52);
const Color _officerSurface = Color(0xFFF3F7F5);
const Color _officerLine = Color(0xFFE1EAE5);

/// The field-team management surface. It deliberately renders a safe,
/// human-facing projection of the officer DTO rather than the response map.
class BusinessPartnerOfficersScreen extends StatefulWidget {
  const BusinessPartnerOfficersScreen({
    super.key,
    required this.api,
    this.profile = const <String, dynamic>{},
  });

  final BusinessPartnerApiService api;
  final Map<String, dynamic> profile;

  @override
  State<BusinessPartnerOfficersScreen> createState() =>
      _BusinessPartnerOfficersScreenState();
}

class _BusinessPartnerOfficersScreenState
    extends State<BusinessPartnerOfficersScreen> {
  bool _loading = true;
  String _error = '';
  String _filter = 'ALL';
  List<Map<String, dynamic>> _officers = <Map<String, dynamic>>[];

  bool get _canManage {
    // Officer management is derived from the partner's approved services.
    // Some live profiles have the service assignment permission without the
    // legacy OFFICER_MANAGEMENT catalog key, so this must not be the UI gate.
    return _allowedTypes.isNotEmpty;
  }

  List<String> get _allowedTypes {
    final dynamic raw = widget.profile['services'];
    final Set<String> services = raw is List
        ? raw
            .map((dynamic value) => value.toString().trim().toUpperCase())
            .map((String value) => value == 'PHONE_FINANCING' ? 'PHONE' : value)
            .toSet()
        : <String>{};
    return <String>[
      if (services.contains('SOLAR') &&
          businessPartnerHasPermission(widget.profile, 'SOLAR_ASSIGNMENT'))
        'SOLAR',
      if (services.contains('PHONE') &&
          businessPartnerHasPermission(widget.profile, 'PHONE_ASSIGNMENT'))
        'PHONE',
    ];
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = '';
      });
    }
    try {
      final Map<String, dynamic> response = await widget.api.officers();
      final dynamic grouped = response['officers'] ?? response;
      final List<Map<String, dynamic>> rows = <Map<String, dynamic>>[];
      if (grouped is Map) {
        for (final String key in <String>['solar', 'phone']) {
          final dynamic values = grouped[key];
          if (values is List) {
            rows.addAll(
                values.whereType<Map>().map((Map value) => <String, dynamic>{
                      ...Map<String, dynamic>.from(value),
                      'type': (value['type'] ?? key).toString().toUpperCase()
                    }));
          }
        }
      } else if (grouped is List) {
        rows.addAll(grouped
            .whereType<Map>()
            .map((Map value) => Map<String, dynamic>.from(value)));
      }
      if (!mounted) return;
      setState(() {
        _officers = rows;
        _loading = false;
      });
    } on BusinessPartnerApiException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'We could not load your field officers. Try again.';
          _loading = false;
        });
      }
    }
  }

  String _text(dynamic value, [String fallback = 'Not provided']) {
    final String result = value?.toString().trim() ?? '';
    return result.isEmpty || result == 'null' ? fallback : result;
  }

  List<Map<String, dynamic>> get _visible => _filter == 'ALL'
      ? _officers
      : _officers
          .where((Map<String, dynamic> row) =>
              _text(row['type'], '').toUpperCase() == _filter)
          .toList();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _officerSurface,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 34),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1180),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                _header(),
                const SizedBox(height: 18),
                if (_loading)
                  _loadingView()
                else if (_error.isNotEmpty)
                  _errorView()
                else if (_visible.isEmpty)
                  _emptyView()
                else
                  _sectionsView(),
              ]),
        ),
      ),
    );
  }

  Widget _header() => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          // The two explicit creation actions need a full-width row on tablet
          // widths as well; otherwise the title and actions compete for the
          // same narrow horizontal lane.
          final bool compact = constraints.maxWidth < 900;
          final List<Widget> actions = <Widget>[
            if (_allowedTypes.contains('SOLAR'))
              FilledButton.icon(
                  key: const Key('create-solar-officer'),
                  onPressed: () => _openForm(initialType: 'SOLAR'),
                  icon: const Icon(Icons.wb_sunny_outlined, size: 17),
                  label: const Text('Create Solar Officer')),
            if (_allowedTypes.contains('PHONE'))
              OutlinedButton.icon(
                  key: const Key('create-phone-financing-officer'),
                  onPressed: () => _openForm(initialType: 'PHONE'),
                  icon: const Icon(Icons.smartphone_outlined, size: 17),
                  label: const Text('Create Phone Financing Officer')),
          ];
          final Widget action = actions.isEmpty
              ? const SizedBox.shrink()
              : Wrap(spacing: 8, runSpacing: 8, children: actions);
          return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                if (compact)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      const Text('Officer Management',
                          style: TextStyle(
                              color: _officerInk,
                              fontSize: 25,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 5),
                      const Text('Your trusted field team, in one clear view.',
                          style: TextStyle(color: _officerMuted, fontSize: 13)),
                      const SizedBox(height: 13),
                      action,
                    ],
                  )
                else
                  Row(children: <Widget>[
                    const Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text('Officer Management',
                                style: TextStyle(
                                    color: _officerInk,
                                    fontSize: 25,
                                    fontWeight: FontWeight.w900)),
                            SizedBox(height: 5),
                            Text('Your trusted field team, in one clear view.',
                                style: TextStyle(
                                    color: _officerMuted, fontSize: 13)),
                          ]),
                    ),
                    action,
                  ]),
                const SizedBox(height: 18),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    _filterButton('ALL', 'All officers'),
                    _filterButton('SOLAR', 'Solar'),
                    _filterButton('PHONE', 'Phone'),
                    Padding(
                      padding: const EdgeInsets.only(left: 4),
                      child: Text('${_visible.length} shown',
                          style: const TextStyle(
                              color: _officerMuted,
                              fontSize: 12,
                              fontWeight: FontWeight.w700)),
                    ),
                  ],
                ),
              ]);
        },
      );

  Widget _filterButton(String value, String label) => ChoiceChip(
        label: Text(label),
        selected: _filter == value,
        onSelected: (_) => setState(() => _filter = value),
        selectedColor: const Color(0xFFD8F2E3),
        labelStyle: TextStyle(
            color: _filter == value ? _officerGreen : _officerMuted,
            fontSize: 12,
            fontWeight: FontWeight.w800),
        side: const BorderSide(color: _officerLine),
        backgroundColor: Colors.white,
      );

  Widget _list() =>
      LayoutBuilder(builder: (BuildContext context, BoxConstraints box) {
        final bool wide = box.maxWidth >= 760;
        final List<Widget> cards = _visible.map(_card).toList();
        return wide
            ? Wrap(
                spacing: 13,
                runSpacing: 13,
                children: cards
                    .map((Widget card) =>
                        SizedBox(width: (box.maxWidth - 13) / 2, child: card))
                    .toList())
            : Column(children: cards);
      });

  Widget _sectionsView() {
    final List<Widget> sections = <Widget>[];
    for (final String type in <String>['SOLAR', 'PHONE']) {
      final List<Map<String, dynamic>> rows = _visible
          .where((Map<String, dynamic> row) =>
              _text(row['type'], '').toUpperCase() == type)
          .toList();
      sections.add(Padding(
        padding: EdgeInsets.only(bottom: sections.isEmpty ? 16 : 12),
        child: Text(
            type == 'SOLAR' ? 'Solar Officers' : 'Phone Financing Officers',
            style: const TextStyle(
                color: _officerInk, fontSize: 16, fontWeight: FontWeight.w900)),
      ));
      sections.add(rows.isEmpty
          ? Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                  type == 'SOLAR'
                      ? 'No Solar Officers assigned yet.'
                      : 'No Phone Financing Officers assigned yet.',
                  style: const TextStyle(color: _officerMuted, fontSize: 12)),
            )
          : _cardsFor(rows));
    }
    return sections.isEmpty ? _emptyView() : Column(children: sections);
  }

  Widget _cardsFor(List<Map<String, dynamic>> rows) =>
      LayoutBuilder(builder: (BuildContext context, BoxConstraints box) {
        final List<Widget> cards = rows.map(_card).toList();
        if (box.maxWidth < 760) return Column(children: cards);
        return Wrap(
            spacing: 13,
            runSpacing: 13,
            children: cards
                .map((Widget card) =>
                    SizedBox(width: (box.maxWidth - 13) / 2, child: card))
                .toList());
      });

  Widget _card(Map<String, dynamic> row) {
    final String type = _text(row['type'], 'OFFICER').toUpperCase();
    final Map<String, dynamic> metrics = row['metrics'] is Map
        ? Map<String, dynamic>.from(row['metrics'] as Map)
        : <String, dynamic>{};
    final bool active =
        _text(row['status'], 'ACTIVE').toUpperCase() == 'ACTIVE';
    return Card(
      key: Key(
          'officer-${_text(row['id'], _text(row['officerCode'], 'record'))}'),
      margin: const EdgeInsets.only(bottom: 13),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(17),
          side: const BorderSide(color: _officerLine)),
      child: InkWell(
        borderRadius: BorderRadius.circular(17),
        onTap: () => _openDetail(row),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(children: <Widget>[
                  CircleAvatar(
                      backgroundColor: const Color(0xFFE4F5EC),
                      foregroundColor: _officerGreen,
                      child: Text(_initials(_text(row['fullName'], 'Officer')),
                          style: const TextStyle(fontWeight: FontWeight.w900))),
                  const SizedBox(width: 11),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                        Text(_text(row['fullName'], 'Officer'),
                            style: const TextStyle(
                                color: _officerInk,
                                fontSize: 15,
                                fontWeight: FontWeight.w900)),
                        const SizedBox(height: 3),
                        Text(
                            '${type == 'SOLAR' ? 'Solar' : 'Phone'} field officer'
                            '${row['officerCode'] == null ? '' : '  ·  ${_text(row['officerCode'])}'}',
                            style: const TextStyle(
                                color: _officerMuted, fontSize: 11)),
                      ])),
                  _status(active),
                ]),
                const SizedBox(height: 15),
                Wrap(spacing: 18, runSpacing: 8, children: <Widget>[
                  _detail(Icons.phone_outlined, _text(row['phone'])),
                  _detail(Icons.place_outlined,
                      _text(row['lga'], _text(row['state']))),
                ]),
                const Divider(height: 24, color: _officerLine),
                Wrap(spacing: 18, runSpacing: 8, children: <Widget>[
                  _metric('Applications', metrics['assignedApplications']),
                  _metric('Customers', metrics['assignedCustomers']),
                  _metric('Completed', metrics['completedWork']),
                  _metric('Commission', _money(metrics['commissionTotal'])),
                ]),
              ]),
        ),
      ),
    );
  }

  Widget _detail(IconData icon, String value) =>
      Row(mainAxisSize: MainAxisSize.min, children: <Widget>[
        Icon(icon, size: 15, color: _officerMuted),
        const SizedBox(width: 5),
        Text(value,
            style: const TextStyle(
                color: _officerMuted,
                fontSize: 12,
                fontWeight: FontWeight.w600))
      ]);

  Widget _metric(String label, dynamic value) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
        Text(_number(value),
            style: const TextStyle(
                color: _officerInk, fontSize: 13, fontWeight: FontWeight.w900)),
        Text(label, style: const TextStyle(color: _officerMuted, fontSize: 10)),
      ]);

  String _number(dynamic value) => value == null ? '0' : value.toString();
  String _money(dynamic value) => value == null ? '₦0' : '₦${value.toString()}';
  String _initials(String name) {
    final List<String> words =
        name.split(' ').where((String x) => x.isNotEmpty).toList();
    return words.take(2).map((String x) => x[0].toUpperCase()).join();
  }

  Widget _status(bool active) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
          color: active ? const Color(0xFFE4F5EC) : const Color(0xFFFFEEE9),
          borderRadius: BorderRadius.circular(20)),
      child: Text(active ? 'Active' : 'Suspended',
          style: TextStyle(
              color: active ? _officerGreen : const Color(0xFFB04C38),
              fontSize: 10,
              fontWeight: FontWeight.w900)));

  Widget _loadingView() => Column(children: <Widget>[
        for (int i = 0; i < 3; i++)
          Container(
              height: 150,
              margin: const EdgeInsets.only(bottom: 13),
              decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(17),
                  border: Border.all(color: _officerLine))),
      ]);
  Widget _errorView() => _message(
      Icons.cloud_off_outlined,
      'Officers are unavailable',
      'We could not reach your field team. Try again.',
      'Try again',
      _load);
  Widget _emptyView() => _message(
      Icons.groups_outlined,
      'No officers yet',
      'Create your first field officer to start routing work.',
      _allowedTypes.contains('SOLAR')
          ? 'Create Solar Officer'
          : 'Create Phone Financing Officer',
      _canManage
          ? () => _openForm(
              initialType: _allowedTypes.contains('SOLAR') ? 'SOLAR' : 'PHONE')
          : null);
  Widget _message(IconData icon, String title, String body, String action,
          VoidCallback? callback) =>
      Container(
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(17),
              border: Border.all(color: _officerLine)),
          child: Column(children: <Widget>[
            Icon(icon, color: _officerGreen, size: 34),
            const SizedBox(height: 10),
            Text(title,
                style: const TextStyle(
                    color: _officerInk,
                    fontWeight: FontWeight.w900,
                    fontSize: 16)),
            const SizedBox(height: 5),
            Text(body,
                textAlign: TextAlign.center,
                style: const TextStyle(color: _officerMuted)),
            if (callback != null) ...<Widget>[
              const SizedBox(height: 16),
              OutlinedButton(onPressed: callback, child: Text(action))
            ]
          ]));

  Future<void> _openDetail(Map<String, dynamic> row) async {
    final Map<String, dynamic> detail = Map<String, dynamic>.from(row);
    final String id = _text(row['id'], '');
    final String type = _text(row['type'], 'SOLAR').toUpperCase();
    if (id.isNotEmpty) {
      try {
        final Map<String, dynamic> response =
            await widget.api.getOfficer(type: type, id: id);
        final dynamic payload = response['officer'];
        detail.addAll(
            payload is Map ? Map<String, dynamic>.from(payload) : response);
      } catch (_) {}
    }
    if (!mounted) return;
    showDialog<void>(
        context: context, builder: (_) => _detailDialog(detail, type, id));
  }

  Widget _detailDialog(Map<String, dynamic> row, String type, String id) {
    final bool active =
        _text(row['status'], 'ACTIVE').toUpperCase() == 'ACTIVE';
    return AlertDialog(
      title: Text(_text(row['fullName'], 'Officer')),
      content: SingleChildScrollView(
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
            Text('${type == 'SOLAR' ? 'Solar' : 'Phone'} field officer',
                style: const TextStyle(color: _officerMuted)),
            const SizedBox(height: 14),
            _dialogLine('Phone', _text(row['phone'])),
            _dialogLine('Email', _text(row['email'])),
            _dialogLine(
                'Territory', '${_text(row['lga'])}, ${_text(row['state'])}'),
            _dialogLine('Address', _text(row['address'])),
          ])),
      actions: <Widget>[
        if (_canManage)
          TextButton(
              key: const Key('edit-officer'),
              onPressed: () async {
                Navigator.pop(context);
                await _afterDialogCloses();
                if (mounted) _openForm(existing: row);
              },
              child: const Text('Edit')),
        if (_canManage)
          TextButton(
              key: const Key('reset-access'),
              onPressed: () async {
                Navigator.pop(context);
                await _afterDialogCloses();
                if (mounted) _resetDialog(type, id);
              },
              child: const Text('Reset access')),
        if (_canManage)
          TextButton(
              key: const Key('toggle-officer-status'),
              onPressed: () async {
                Navigator.pop(context);
                await _afterDialogCloses();
                if (mounted) _confirmStatus(type, id, active);
              },
              child: Text(active ? 'Suspend' : 'Reactivate')),
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close')),
      ],
    );
  }

  Widget _dialogLine(String label, String value) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text('$label  $value',
          style: const TextStyle(color: _officerInk, fontSize: 13)));

  Future<void> _openForm(
      {Map<String, dynamic>? existing, String? initialType}) async {
    final bool editing = existing != null;
    final Map<String, TextEditingController> controllers =
        <String, TextEditingController>{
      for (final String key in <String>[
        'fullName',
        'phone',
        'email',
        'state',
        'lga',
        'address',
        'password',
      ])
        key: TextEditingController(text: _text(existing?[key], '')),
    };
    final List<String> allowedTypes = _allowedTypes;
    if (!editing && allowedTypes.isEmpty) return;
    String type = _text(
      existing?['type'] ?? initialType,
      allowedTypes.isEmpty ? 'SOLAR' : allowedTypes.first,
    ).toUpperCase();
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();

    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialog) {
          final List<Widget> fields = <Widget>[
            for (final String key in <String>[
              'fullName',
              'phone',
              'email',
              'state',
              'lga',
              'address',
            ])
              SizedBox(
                width: 245,
                child: TextFormField(
                  controller: controllers[key],
                  decoration: InputDecoration(labelText: _label(key)),
                  validator: (String? value) =>
                      value == null || value.trim().isEmpty ? 'Required' : null,
                ),
              ),
            if (!editing)
              SizedBox(
                width: 245,
                child: TextFormField(
                  controller: controllers['password'],
                  obscureText: true,
                  decoration:
                      const InputDecoration(labelText: 'Temporary password'),
                  validator: (String? value) => (value ?? '').length < 8
                      ? 'Use at least 8 characters'
                      : null,
                ),
              ),
          ];

          return AlertDialog(
            title: Text(editing
                ? 'Edit officer'
                : type == 'SOLAR'
                    ? 'Create Solar Officer'
                    : 'Create Phone Financing Officer'),
            content: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Wrap(
                    spacing: 12,
                    runSpacing: 2,
                    children: <Widget>[
                      ...fields,
                    ],
                  ),
                ),
              ),
            ),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Cancel'),
              ),
              FilledButton(
                key: const Key('save-officer'),
                onPressed: () async {
                  if (!(formKey.currentState?.validate() ?? false)) return;
                  final ScaffoldMessengerState messenger =
                      ScaffoldMessenger.of(dialogContext);
                  try {
                    if (editing) {
                      await widget.api.updateOfficer(
                        type: type,
                        id: _text(existing['id']),
                        fields: <String, dynamic>{
                          for (final String key in <String>[
                            'fullName',
                            'phone',
                            'email',
                            'state',
                            'lga',
                            'address',
                          ])
                            key: controllers[key]!.text.trim(),
                        },
                      );
                    } else {
                      await widget.api.createOfficer(
                        type: type,
                        fullName: controllers['fullName']!.text.trim(),
                        phone: controllers['phone']!.text.trim(),
                        email: controllers['email']!.text.trim(),
                        password: controllers['password']!.text,
                        state: controllers['state']!.text.trim(),
                        lga: controllers['lga']!.text.trim(),
                        address: controllers['address']!.text.trim(),
                      );
                    }
                    if (dialogContext.mounted) {
                      Navigator.pop(dialogContext);
                    }
                    if (mounted) {
                      messenger.showSnackBar(
                        SnackBar(
                          content: Text(
                            editing
                                ? 'Officer details updated.'
                                : 'Officer created successfully.',
                          ),
                        ),
                      );
                    }
                    await _load();
                  } on BusinessPartnerApiException catch (error) {
                    if (dialogContext.mounted) {
                      ScaffoldMessenger.of(dialogContext).showSnackBar(
                        SnackBar(content: Text(error.message)),
                      );
                    }
                  } catch (_) {
                    if (dialogContext.mounted) {
                      ScaffoldMessenger.of(dialogContext).showSnackBar(
                        const SnackBar(
                          content: Text('Could not save officer. Try again.'),
                        ),
                      );
                    }
                  }
                },
                child: Text(editing ? 'Save changes' : 'Create officer'),
              ),
            ],
          );
        },
      ),
    );
    await _afterDialogCloses();
    for (final TextEditingController controller in controllers.values) {
      controller.dispose();
    }
  }

  /// showDialog completes when the route is popped, before its overlay has
  /// finished updating. Waiting for the frame boundary prevents focus nodes,
  /// InputDecorators, and the next dialog from sharing the old overlay.
  Future<void> _afterDialogCloses() async {
    await Future<void>.delayed(Duration.zero);
    await WidgetsBinding.instance.endOfFrame;
  }

  String _label(String value) => switch (value) {
        'fullName' => 'Full Name',
        'phone' => 'Phone Number',
        'email' => 'Email',
        'state' => 'State',
        'lga' => 'LGA',
        'address' => 'Address',
        _ => value,
      };

  Future<void> _confirmStatus(String type, String id, bool active) async {
    final bool? confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
                title:
                    Text(active ? 'Suspend officer?' : 'Reactivate officer?'),
                content: Text(active
                    ? 'This officer will no longer receive new assignments.'
                    : 'This officer can receive assignments again.'),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      key: const Key('confirm-status'),
                      onPressed: () => Navigator.pop(context, true),
                      child: Text(active ? 'Suspend' : 'Reactivate'))
                ]));
    if (confirmed == true) {
      try {
        await widget.api.updateOfficerStatus(
            type: type, id: id, status: active ? 'SUSPENDED' : 'ACTIVE');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(
                  active ? 'Officer suspended.' : 'Officer reactivated.')));
        }
        await _load();
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Could not update officer status. Try again.')));
        }
      }
    }
  }

  Future<void> _resetDialog(String type, String id) async {
    final TextEditingController password = TextEditingController();
    final bool? confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
                title: const Text('Reset access'),
                content: TextField(
                    controller: password,
                    obscureText: true,
                    decoration:
                        const InputDecoration(labelText: 'New password')),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      key: const Key('confirm-reset'),
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Reset password'))
                ]));
    if (confirmed == true && password.text.length >= 8) {
      try {
        await widget.api
            .resetOfficerAccess(type: type, id: id, password: password.text);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Access credentials updated.')));
        }
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Could not reset access. Try again.')));
        }
      }
    }
    await _afterDialogCloses();
    password.dispose();
  }
}
