import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'edupay_api.dart';
import 'student_activity_center.dart';
import 'academic_child_profile_screen.dart';
import '../feature_transaction_pin_dialog.dart';
import '../services/session_store.dart';

bool _isPublishedEduPayAcademicRecord(dynamic value) {
  if (value is! Map) return false;
  final status = '${value['status'] ?? ''}'.trim().toUpperCase();
  return status == 'ACTIVE' || status == 'UPCOMING';
}

String _academicRecordId(dynamic value) {
  if (value is! Map) return '$value';
  return '${value['_id'] ?? value['id'] ?? ''}';
}

/// Returns only school-published sessions that a parent may select.
List<Map<String, dynamic>> eligibleEduPaySessions(dynamic sessions) {
  if (sessions is! List) return const [];
  final rows = sessions
      .where(_isPublishedEduPayAcademicRecord)
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
  rows.sort((a, b) {
    final aCurrent = a['isCurrent'] == true || a['isDefault'] == true;
    final bCurrent = b['isCurrent'] == true || b['isDefault'] == true;
    if (aCurrent != bCurrent) return aCurrent ? -1 : 1;
    return '${a['name'] ?? ''}'.compareTo('${b['name'] ?? ''}');
  });
  return rows;
}

/// Returns only terms belonging to [sessionId], never terms from another
/// school session. Closed/draft terms remain unavailable to parents.
List<Map<String, dynamic>> eligibleEduPayTerms(
  dynamic terms,
  String sessionId,
) {
  if (terms is! List || sessionId.isEmpty) return const [];
  return terms
      .where(_isPublishedEduPayAcademicRecord)
      .whereType<Map>()
      .where((term) {
        final relation = term['session'];
        final relatedId = relation is Map
            ? _academicRecordId(relation)
            : '${relation ?? term['sessionId'] ?? ''}';
        return relatedId == sessionId;
      })
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
}

Map<String, dynamic>? unambiguousCurrentEduPayOption(
  List<Map<String, dynamic>> options,
) {
  final current = options
      .where((row) => row['isCurrent'] == true || row['isDefault'] == true)
      .toList();
  return current.length == 1 ? current.single : null;
}

String _eduPayRelationId(dynamic value) {
  if (value is Map) {
    return '${value['_id'] ?? value['id'] ?? value['schoolId'] ?? value['classId'] ?? ''}'
        .trim();
  }
  return '${value ?? ''}'.trim();
}

String eduPayEnrollmentSchoolId(dynamic child) {
  if (child is! Map) return '';
  final enrollment = child['enrollment'] is Map
      ? child['enrollment'] as Map
      : child['academicEnrollment'] is Map
          ? child['academicEnrollment'] as Map
          : child['studentEnrollment'] is Map
              ? child['studentEnrollment'] as Map
              : const {};
  for (final value in [
    enrollment['school'],
    enrollment['schoolId'],
    child['schoolId'],
    child['school'],
  ]) {
    final id = _eduPayRelationId(value);
    if (id.isNotEmpty) return id;
  }
  return '';
}

String eduPayEnrollmentClassId(dynamic child) {
  if (child is! Map) return '';
  final enrollment = child['enrollment'] is Map
      ? child['enrollment'] as Map
      : child['academicEnrollment'] is Map
          ? child['academicEnrollment'] as Map
          : child['studentEnrollment'] is Map
              ? child['studentEnrollment'] as Map
              : const {};
  for (final value in [
    enrollment['classLevel'],
    enrollment['classLevelId'],
    enrollment['class'],
    enrollment['classId'],
    enrollment['enrolledClass'],
    child['classLevel'],
    child['classLevelId'],
  ]) {
    final id = _eduPayRelationId(value);
    if (id.isNotEmpty) return id;
  }
  return '';
}

Map<String, dynamic>? resolveEduPayEnrolledClass(
    dynamic child, dynamic classes) {
  final classId = eduPayEnrollmentClassId(child);
  if (classId.isEmpty || classes is! List) return null;
  for (final value in classes.whereType<Map>()) {
    if (_eduPayRelationId(value) == classId)
      return Map<String, dynamic>.from(value);
  }
  return null;
}

List<Map<String, dynamic>> mergeEduPayChildren(
    dynamic financeChildren, dynamic academicChildren) {
  if (financeChildren is! List) return const [];
  final financeRows = financeChildren
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
  final byKey = <String, Map<String, dynamic>>{};
  String keyFor(Map row) {
    final school = row['school'];
    final schoolId = school is Map ? school['_id'] ?? school['id'] : school;
    final resolvedSchoolId = schoolId ?? row['schoolId'];
    final admission =
        row['studentId'] ?? row['admissionNumber'] ?? row['student_id'];
    final normalizedAdmission =
        '${admission ?? ''}'.replaceAll(RegExp(r'\s+'), '').toUpperCase();
    if (resolvedSchoolId != null &&
        '$resolvedSchoolId'.trim().isNotEmpty &&
        normalizedAdmission.isNotEmpty) {
      return 'school:$resolvedSchoolId:student:$normalizedAdmission';
    }
    return 'id:${row['_id'] ?? row['id'] ?? row['studentId'] ?? row['student_id']}';
  }

  for (final row in financeRows) {
    byKey[keyFor(row)] = row;
  }
  if (academicChildren is List) {
    for (final academic in academicChildren.whereType<Map>()) {
      final finance = byKey[keyFor(academic)];
      if (finance == null) continue;
      final academicEnrollment = academic['enrollment'];
      if (academicEnrollment is Map) {
        final existing = finance['enrollment'];
        finance['enrollment'] = {
          if (existing is Map) ...existing,
          ...Map<String, dynamic>.from(academicEnrollment),
        };
      }
      for (final field in [
        'academicStudent',
        'academicStudentId',
        'classLevel',
        'classLevelId',
        'schoolId',
      ]) {
        if (finance[field] == null && academic[field] != null) {
          finance[field] = academic[field];
        }
      }
      if (finance['school'] == null && academic['school'] != null) {
        finance['school'] = academic['school'];
      }
    }
  }
  return financeRows;
}

class EduPayScreen extends StatefulWidget {
  const EduPayScreen({super.key, this.api});
  final EduPayApi? api;
  @override
  State<EduPayScreen> createState() => _EduPayScreenState();
}

class _EduPayScreenState extends State<EduPayScreen> {
  late final EduPayApi api;
  int tab = 0;
  bool loading = true;
  String? error;
  Map<String, dynamic> dash = {};
  List<dynamic> plans = [], children = [], repayments = [], schools = [];
  List<dynamic> activityChildren = [];
  Map<String, dynamic> history = {};

  @override
  void initState() {
    super.initState();
    api = widget.api ?? EduPayApi();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final values = await Future.wait([
        api.dashboard(),
        api.plans(),
        api.children(),
        api.repayments(),
        api.schools(),
        api.history(),
        api.parentActivityChildren(),
        api.academicChildren(),
      ]);
      if (!mounted) return;
      setState(() {
        dash = values[0] as Map<String, dynamic>;
        plans = values[1] as List;
        final financeChildren = values[2] as List;
        final academicChildren = values[7] as List;
        children = mergeEduPayChildren(financeChildren, academicChildren);
        repayments = values[3] as List;
        schools = values[4] as List;
        history = values[5] as Map<String, dynamic>;
        activityChildren = values[6] as List;
        loading = false;
      });
    } catch (e) {
      if (mounted)
        setState(() {
          loading = false;
          error = e.toString();
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xfff5f8f6),
      appBar: AppBar(
        title: const Text('EduPay'),
        actions: [
          IconButton(onPressed: load, icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: loading
          ? const _Skeleton()
          : error != null
              ? _Error(message: error!, retry: load)
              : IndexedStack(
                  index: tab,
                  children: [
                    _home(),
                    _plans(),
                    _children(),
                    _repayments(),
                    _history(),
                  ],
                ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (v) => setState(() => tab = v),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.space_dashboard_outlined),
            selectedIcon: Icon(Icons.space_dashboard),
            label: 'Overview',
          ),
          NavigationDestination(
            icon: Icon(Icons.savings_outlined),
            selectedIcon: Icon(Icons.savings),
            label: 'Plans',
          ),
          NavigationDestination(
            icon: Icon(Icons.child_care_outlined),
            selectedIcon: Icon(Icons.child_care),
            label: 'My Children',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: 'Repayments',
          ),
          NavigationDestination(
            icon: Icon(Icons.history_outlined),
            selectedIcon: Icon(Icons.history),
            label: 'History',
          ),
        ],
      ),
    );
  }

  Widget _home() {
    final s = (dash['summary'] as Map?)?.cast<String, dynamic>() ?? {};
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'School fees, made manageable.',
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 5),
          const Text(
            'Build steadily. See every naira. Stay ready for the term.',
            style: TextStyle(color: Color(0xff60736b)),
          ),
          const SizedBox(height: 22),
          const Text(
            'School Fees Savings',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          _heroCard(s),
          const SizedBox(height: 18),
          Row(
            children: [
              _metric(
                'Saved',
                _money(s['totalEducationSavings']),
                Icons.savings,
              ),
              _metric(
                'Children',
                '${s['totalChildren'] ?? 0}',
                Icons.child_care,
              ),
              _metric(
                'Active plans',
                '${s['activePlans'] ?? 0}',
                Icons.track_changes,
              ),
            ],
          ),
          const SizedBox(height: 18),
          _sectionTitle('Your next step'),
          _action(
            'Start a school-fee plan',
            'Choose an approved school and official fee.',
            Icons.add_circle_outline,
            () => _initiationGuard(_newPlan),
          ),
          _action(
            'Add money to a plan',
            'Keep a plan moving from your wallet.',
            Icons.account_balance_wallet_outlined,
            () => _initiationGuard(() => setState(() => tab = 1)),
          ),
          if (!_enabled)
            const _Notice(
              'New EduPay plans and contributions are temporarily paused.',
              warning: true,
            ),
          const SizedBox(height: 16),
          _sectionTitle('Trust, built in'),
          const _Notice(
            'Official fees come directly from approved schools. You always see the source before saving.',
            warning: false,
          ),
          if (s['upcomingSchoolFee'] is Map)
            _upcomingFee(s['upcomingSchoolFee'] as Map),
        ],
      ),
    );
  }

  Widget _heroCard(Map<String, dynamic> s) => Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: const Color(0xff0c6b51),
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Education savings',
              style: TextStyle(color: Color(0xffc8eee0)),
            ),
            const SizedBox(height: 8),
            Text(
              _money(s['totalEducationSavings']),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 32,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              '${s['activePlans'] ?? 0} active plans · ${s['outstandingRepayment'] == null ? 'No repayment due' : '${_money(s['outstandingRepayment'])} outstanding'}',
              style: const TextStyle(color: Colors.white70),
            ),
          ],
        ),
      );
  Widget _plans() => _listPage(
        'School Fees Savings',
        plans,
        'No plans yet',
        Icons.savings_outlined,
        (p) => _planDetail(p),
      );
  Widget _children() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (activityChildren.isNotEmpty) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _sectionTitle('Student Activity Center'),
                TextButton.icon(
                  onPressed: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => StudentActivityCenter(
                          api: api,
                          children: activityChildren,
                        ),
                      ),
                    );
                    if (mounted) load();
                  },
                  icon: const Icon(Icons.open_in_new, size: 18),
                  label: const Text('Open'),
                ),
              ],
            ),
            Card(
              color: const Color(0xffe8f4ef),
              child: ListTile(
                leading: const Icon(
                  Icons.insights_outlined,
                  color: Color(0xff0c6b51),
                ),
                title: const Text('School updates for your children'),
                subtitle: Text(
                  '${activityChildren.length} linked student${activityChildren.length == 1 ? '' : 's'} · attendance, results, assignments and activities',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () async {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => StudentActivityCenter(
                        api: api,
                        children: activityChildren,
                      ),
                    ),
                  );
                  if (mounted) load();
                },
              ),
            ),
            const SizedBox(height: 14),
          ],
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _sectionTitle('My children'),
              IconButton(
                onPressed: () => _initiationGuard(_newChild),
                icon: const Icon(Icons.add_circle, color: Color(0xff0c6b51)),
              ),
            ],
          ),
          Card(
            color: const Color(0xffeaf6f0),
            child: ListTile(
              leading:
                  const Icon(Icons.search_outlined, color: Color(0xff0c6b51)),
              title: const Text("Can't find your school?"),
              subtitle: const Text(
                'Tell Head Office which school you need. This does not start a plan.',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: _requestSchool,
            ),
          ),
          if (children.isEmpty)
            const _Empty(
              'No child has been linked to your EduPay account yet.',
              Icons.child_care_outlined,
            ),
          ...children.map((c) => _childTile(c as Map)),
        ],
      );
  Widget _repayments() => _listPage(
        'Repayments',
        repayments,
        'No repayments',
        Icons.receipt_long_outlined,
        (r) => _repaymentDetail(r),
      );
  Widget _history() {
    final nested = history['history'] is Map
        ? (history['history'] as Map).cast<String, dynamic>()
        : history;
    final rows = nested['savingHistory'] is List
        ? nested['savingHistory'] as List
        : const <dynamic>[];
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          'Saving History',
          style: Theme.of(
            context,
          ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        if (rows.isEmpty)
          const _Empty('No savings transactions yet', Icons.history),
        ...rows.map((row) => _historyRow(row as Map)),
      ],
    );
  }

  Widget _historyRow(Map row) {
    final child = row['child'] is Map
        ? row['child']['fullName']
        : row['childName'] ?? 'Linked child';
    final school = row['school'] is Map
        ? row['school']['name']
        : row['schoolName'] ?? 'School';
    final reference = row['businessReference'] ??
        row['receiptId'] ??
        row['reference'] ??
        row['transactionReference'];
    final date = row['createdAt'] ??
        row['date'] ??
        row['occurredAt'] ??
        'Date unavailable';
    return Card(
      child: ListTile(
        onTap: () => _receipt(row),
        leading: const CircleAvatar(child: Icon(Icons.savings_outlined)),
        title: Text(
            _money(row['amount'] ?? row['amountContributed'] ?? row['value'])),
        subtitle: Text(
          '$child · $school\n$date\nReference: ${reference ?? 'Pending'}',
        ),
        isThreeLine: true,
        trailing: Text(_statusLabel('${row['status'] ?? 'SUCCESSFUL'}')),
      ),
    );
  }

  Widget _upcomingFee(Map fee) => Card(
        margin: const EdgeInsets.only(top: 16),
        child: ListTile(
          leading: const Icon(Icons.event_available, color: Color(0xff0c6b51)),
          title: const Text('Upcoming school fee'),
          subtitle:
              Text('Settlement target · ${fee['targetDate'] ?? 'Not set'}'),
          trailing: Text(_money(fee['amount'])),
        ),
      );

  bool get _enabled => (dash['settings'] as Map?)?['enabled'] == true;

  void _initiationGuard(VoidCallback action) {
    if (!_enabled) {
      _snack(
        'EduPay initiation is temporarily paused. Your history and repayments remain available.',
      );
      return;
    }
    action();
  }

  Widget _listPage(
    String title,
    List<dynamic> data,
    String empty,
    IconData icon,
    void Function(Map) tap,
  ) =>
      ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          if (data.isEmpty) _Empty(empty, icon),
          ...data.map((x) => _planTile(x as Map, tap)),
        ],
      );
  Widget _planTile(Map p, void Function(Map) tap) {
    final child = (p['child'] is Map ? p['child']['fullName'] : null) ??
        'School-fee plan';
    final school = p['school'] is Map ? p['school']['name'] : '';
    final target = number(p['targetAmount']);
    final saved = number(p['amountSaved']);
    final remaining = number(p['remaining']);
    final progress = (number(p['progressPercent']) / 100).clamp(0.0, 1.0);
    return Card(
      child: InkWell(
        onTap: () => tap(p),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const CircleAvatar(
                    backgroundColor: Color(0xffdcefe8),
                    child: Icon(Icons.school, color: Color(0xff0c6b51)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '$child',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                  Text(_statusLabel(p['status']?.toString())),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                '${school ?? ''} · ${_money(saved)} saved of ${_money(target)}',
              ),
              const SizedBox(height: 8),
              LinearProgressIndicator(value: progress, minHeight: 7),
              const SizedBox(height: 5),
              Text(
                '${number(p['progressPercent']).round()}% · ${_money(remaining)} remaining',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _childTile(Map c) => Card(
        child: ListTile(
          onTap: () async {
            final id = [c['_id'], c['id']].firstWhere(
              (value) => value != null && value.toString().trim().isNotEmpty,
              orElse: () => null,
            );
            if (id == null) {
              _snack(
                  'This child does not have an authorized academic profile.');
              return;
            }
            await Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => AcademicChildProfileScreen(api: api, child: c),
              ),
            );
            if (mounted) load();
          },
          leading: const CircleAvatar(child: Icon(Icons.person_outline)),
          title: Text('${c['fullName'] ?? 'Child'}'),
          subtitle: Text(
            c['school'] is Map ? '${c['school']['name']}' : 'School not listed',
          ),
          trailing: const Icon(Icons.chevron_right),
        ),
      );
  Future<void> _newChild() async {
    final activeSchools = _activeSchools();
    if (activeSchools.isEmpty) {
      _snack('No active approved schools are available yet.');
      return;
    }
    final name = TextEditingController();
    final result = await _formDialog('Add a child', [
      TextField(
        controller: name,
        decoration: const InputDecoration(labelText: 'Full name'),
      ),
    ]);
    if (result == true && name.text.trim().isNotEmpty) {
      final school = await _selectOption(
        activeSchools,
        'Choose an active school',
        _nameOf,
      );
      if (school == null) return;
      try {
        await api.createChild({
          'fullName': name.text.trim(),
          'school': _idOf(school),
        });
        load();
      } catch (e) {
        _snack(e.toString());
      }
    }
  }

  Future<void> _requestSchool() async {
    final schoolName = TextEditingController();
    final location = TextEditingController();
    final contactPhone = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Request a school'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Can’t find your school? Send a request to ServicePay Head Office.',
              ),
              const SizedBox(height: 16),
              TextField(
                controller: schoolName,
                autofocus: true,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'School name',
                  hintText: 'e.g. Bright Future Academy',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: location,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Location',
                  hintText: 'City, state or area',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: contactPhone,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  labelText: 'School contact phone (optional)',
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (schoolName.text.trim().isEmpty ||
                  location.text.trim().isEmpty) {
                return;
              }
              Navigator.pop(dialogContext, true);
            },
            child: const Text('Request School'),
          ),
        ],
      ),
    );
    if (submitted != true) return;
    try {
      await api.requestSchool(
        schoolName: schoolName.text,
        location: location.text,
        contactPhone: contactPhone.text,
      );
      if (mounted) {
        _snack(
          'School request submitted. Head Office will review it before approval.',
        );
      }
    } catch (e) {
      if (mounted) _snack(e.toString());
    }
  }

  Future<void> _newPlan() async {
    if (children.isEmpty) {
      _snack('Add a child before starting a plan.');
      return;
    }
    final child = await _selectOption(children, 'Choose a child', _nameOf);
    if (child == null || !mounted) return;
    final activeSchools = _activeSchools();
    final childSchoolId = eduPayEnrollmentSchoolId(child);
    if (childSchoolId.isEmpty) {
      _snack('This child has no active approved school selected.');
      return;
    }
    final matchingSchools =
        activeSchools.where((s) => _idOf(s) == childSchoolId).toList();
    if (matchingSchools.isEmpty) {
      _snack('This child’s school is no longer active or approved.');
      return;
    }
    final school = matchingSchools.single;
    if (!mounted) return;
    Map<String, dynamic> catalogue;
    try {
      catalogue = await api.catalogue(_idOf(school));
    } catch (e) {
      _snack('The approved school-fee catalogue is unavailable. Try again.');
      return;
    }
    final availableSessions =
        eligibleEduPaySessions(_catalogueOptions(catalogue, 'sessions'));
    if (availableSessions.isEmpty) {
      _snack(
        'No published academic sessions are available for ${_nameOf(school)} yet.',
      );
      return;
    }
    final currentSession = unambiguousCurrentEduPayOption(availableSessions);
    final session = await _selectOption(
      availableSessions,
      'Choose a session',
      _nameOf,
      preferred: currentSession,
    );
    if (session == null || !mounted) return;
    final sessionId = _idOf(session);
    final availableTerms = eligibleEduPayTerms(
      _catalogueOptions(catalogue, 'terms'),
      sessionId,
    );
    if (availableTerms.isEmpty) {
      _snack(
        'This school has not published fees for another term in ${_nameOf(session)} yet.',
      );
      return;
    }
    final currentTerm = unambiguousCurrentEduPayOption(availableTerms);
    final term = await _selectOption(
      availableTerms,
      'Choose a term',
      _nameOf,
      preferred: currentTerm,
    );
    if (term == null || !mounted) return;
    final catalogueClasses =
        _catalogueOptions(catalogue, 'classes', fallbackKey: 'classLevels');
    final linkedClassId = eduPayEnrollmentClassId(child);
    final linkedClass = resolveEduPayEnrolledClass(child, catalogueClasses);
    if (linkedClassId.isNotEmpty && linkedClass == null) {
      _snack(
          'This child’s enrolled class is not available in the school catalogue. Please ask the school to update the enrollment.');
      return;
    }
    final classLevel = linkedClass ??
        await _selectOption(catalogueClasses, 'Choose a class level', _nameOf);
    if (classLevel == null || !mounted) return;
    final fees = await api.fees(
      '${school['_id'] ?? school['id']}',
      session: _idOf(session),
      term: _idOf(term),
      classLevel: _idOf(classLevel),
    );
    if (!mounted || fees.isEmpty) {
      _snack(
          'Your school has not published the school fee for this term yet. Please contact the school or try again later.');
      return;
    }
    final fee = await _selectOption(fees, 'Choose an approved fee', (v) {
      final m = v as Map;
      return '${_nameOf(m)} · ${_money(m['amount'] ?? m['officialFee'])}';
    });
    if (fee == null || !mounted) return;
    final officialFee = _number(fee['amount'] ?? fee['officialFee']);
    if (officialFee <= 0) {
      _snack('The approved school fee is not valid.');
      return;
    }
    final date = TextEditingController();
    final target = TextEditingController(text: officialFee.toStringAsFixed(2));
    final preferred = TextEditingController();
    String frequency = 'MONTHLY';
    String? validation;
    final details = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Create School Fees Savings plan'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Child: ${_nameOf(child)}'),
                Text('School: ${_nameOf(school)}'),
                const SizedBox(height: 8),
                Text('Official school fee: ${_money(officialFee)}',
                    style: const TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                TextField(
                  controller: date,
                  decoration: const InputDecoration(
                    labelText: 'Due date (YYYY-MM-DD)',
                  ),
                  keyboardType: TextInputType.datetime,
                ),
                TextField(
                  controller: target,
                  decoration: const InputDecoration(
                    labelText: 'Savings target',
                    prefixText: '₦ ',
                    helperText:
                        'Must be greater than zero and no more than the official fee.',
                  ),
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                ),
                TextField(
                  controller: preferred,
                  decoration: const InputDecoration(
                    labelText: 'Preferred contribution (optional)',
                    prefixText: '₦ ',
                  ),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                ),
                DropdownButtonFormField<String>(
                  value: frequency,
                  decoration: const InputDecoration(
                    labelText: 'Contribution frequency',
                  ),
                  items: const [
                    DropdownMenuItem(value: 'DAILY', child: Text('Daily')),
                    DropdownMenuItem(value: 'WEEKLY', child: Text('Weekly')),
                    DropdownMenuItem(value: 'MONTHLY', child: Text('Monthly')),
                    DropdownMenuItem(
                      value: 'FLEXIBLE',
                      child: Text('Flexible / manual'),
                    ),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => frequency = value ?? 'MONTHLY'),
                ),
                if (validation != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(validation!,
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.error)),
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final targetAmount = double.tryParse(target.text.trim());
                if (date.text.trim().isEmpty) {
                  setDialogState(() => validation = 'Enter a due date.');
                  return;
                }
                if (targetAmount == null ||
                    targetAmount <= 0 ||
                    targetAmount > officialFee) {
                  setDialogState(() => validation =
                      'Savings target must be greater than zero and no more than the official fee.');
                  return;
                }
                Navigator.pop(dialogContext, true);
              },
              child: const Text('Create plan'),
            ),
          ],
        ),
      ),
    );
    final dateValue = date.text.trim();
    final targetValue = double.tryParse(target.text.trim());
    final preferredValue = double.tryParse(preferred.text.trim());
    date.dispose();
    target.dispose();
    preferred.dispose();
    if (details == true && dateValue.isNotEmpty && targetValue != null) {
      try {
        final payload = <String, dynamic>{
          'child': _idOf(child),
          'school': _idOf(school),
          'session': _idOf(session),
          'term': _idOf(term),
          'classLevel': _idOf(classLevel),
          'feeStructure': fee['_id'],
          'targetDate': dateValue,
          'targetAmount': targetValue,
          'savingFrequency': frequency,
        };
        if (preferredValue != null && preferredValue > 0)
          payload['preferredContributionAmount'] = preferredValue;
        await api.createPlan(payload);
        load();
        _snack('Your EduPay plan is ready.');
      } catch (e) {
        _snack(e.toString());
      }
    }
  }

  List<dynamic> _activeSchools() => schools.where((s) {
        if (s is! Map) return false;
        final status = '${s['status'] ?? ''}'.toUpperCase();
        final verification = '${s['verificationStatus'] ?? ''}'.toUpperCase();
        return s['active'] != false &&
            s['approved'] != false &&
            status != 'INACTIVE' &&
            status != 'REJECTED' &&
            verification != 'REJECTED';
      }).toList();

  List<dynamic> _catalogueOptions(
    Map<String, dynamic> catalogue,
    String key, {
    String? fallbackKey,
  }) {
    final nested = catalogue['catalogue'];
    final value = catalogue[key] ??
        (nested is Map ? nested[key] : null) ??
        (fallbackKey == null
            ? null
            : catalogue[fallbackKey] ??
                (nested is Map ? nested[fallbackKey] : null));
    return value is List ? value : const [];
  }

  String _idOf(dynamic value) =>
      value is Map ? '${value['_id'] ?? value['id']}' : '$value';

  String _nameOf(dynamic value) {
    if (value is! Map) return '$value';
    return '${value['name'] ?? value['title'] ?? value['label'] ?? value['fullName'] ?? value['_id'] ?? value['id']}';
  }

  Future<dynamic> _selectOption(
      List<dynamic> options, String title, String Function(dynamic) label,
      {dynamic preferred}) {
    if (options.isEmpty) {
      _snack('$title is not available yet.');
      return Future.value(null);
    }
    if (preferred != null) {
      dynamic selected = preferred;
      return showDialog<dynamic>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (_, setDialogState) => AlertDialog(
            title: Text(title),
            content: SizedBox(
              width: double.maxFinite,
              child: ListView(
                shrinkWrap: true,
                children: options
                    .map(
                      (option) => RadioListTile<String>(
                        value: _idOf(option),
                        groupValue: _idOf(selected),
                        title: Text(label(option)),
                        subtitle: identical(option, preferred) ||
                                _idOf(option) == _idOf(preferred)
                            ? const Text('School current selection')
                            : null,
                        onChanged: (_) =>
                            setDialogState(() => selected = option),
                      ),
                    )
                    .toList(),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, selected),
                child: const Text('Continue'),
              ),
            ],
          ),
        ),
      );
    }
    return showDialog<dynamic>(
      context: context,
      builder: (_) => SimpleDialog(
        title: Text(title),
        children: options
            .map(
              (option) => SimpleDialogOption(
                onPressed: () => Navigator.pop(context, option),
                child: Text(label(option)),
              ),
            )
            .toList(),
      ),
    );
  }

  Future<void> _planDetail(Map p) async {
    final id = (p['_id'] ?? p['id']).toString();
    final d = await api.plan(id);
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => EduPayPlanDetail(
          api: api,
          data: d,
          onChanged: load,
          initiationEnabled: _enabled,
        ),
      ),
    );
  }

  Future<void> _repaymentDetail(Map r) async {
    final id = (r['_id'] ?? r['id']).toString();
    final amountController = TextEditingController(
      text: (r['amountRemaining'] ?? r['totalAmount'] ?? '').toString(),
    );
    final confirmed = await _formDialog('Make repayment', [
      TextField(
        controller: amountController,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: const InputDecoration(
          prefixText: '₦ ',
          labelText: 'Amount',
          helperText: 'You can pay part or all of the amount remaining.',
        ),
      ),
    ]);
    if (confirmed != true) {
      amountController.dispose();
      return;
    }
    final amount = double.tryParse(amountController.text);
    amountController.dispose();
    if (amount == null) return;
    final token = await SessionStore.readToken();
    if (token == null || token.isEmpty) return;
    final key = 'edupay-repay-${DateTime.now().microsecondsSinceEpoch}';
    final authorization = await authorizeFeatureTransaction(
      context,
      token: token,
      operation: 'EDUPAY_REPAYMENT',
      requestBody: <String, dynamic>{'amount': amount},
      idempotencyKey: key,
      title: 'Confirm repayment',
    );
    if (authorization == null) return;
    try {
      await api.repay(
        id,
        amount,
        authorization['transactionPin']?.toString() ?? '',
        idempotencyKey: key,
        biometricGrant: authorization['biometricGrant']?.toString(),
        deviceId: authorization['deviceId']?.toString(),
      );
      load();
      _snack('Payment submitted successfully.');
    } catch (e) {
      _snack(e.toString());
    }
  }

  Future<void> _receipt(Map row) async {
    final reference = (row['receiptId'] ??
            row['businessReference'] ??
            row['transactionReference'] ??
            row['reference'])
        ?.toString();
    if (reference == null || reference.isEmpty) {
      _snack('This transaction does not have a receipt reference yet.');
      return;
    }
    try {
      final result = await api.receipt(reference);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('EduPay receipt'),
          content: SelectableText('${result['receipt'] ?? result}'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Done'),
            ),
          ],
        ),
      );
    } catch (e) {
      _snack(e.toString());
    }
  }

  String _statusLabel(String? raw) {
    switch (raw?.toUpperCase()) {
      case 'SAVING':
        return 'Saving';
      case 'PARTIALLY_PAID':
        return 'Partially paid';
      case 'READY_FOR_SETTLEMENT':
        return 'Ready for settlement';
      case 'ADMIN_REVIEW':
        return 'Under review';
      case 'SETTLED':
        return 'Settled';
      case 'OVERDUE':
        return 'Overdue';
      case 'PAID':
        return 'Paid';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return raw?.replaceAll('_', ' ') ?? 'Active';
    }
  }

  Future<bool?> _formDialog(String title, List<Widget> fields) =>
      showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(title),
          content: Column(mainAxisSize: MainAxisSize.min, children: fields),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Continue'),
            ),
          ],
        ),
      );
  Future<String?> _pinDialog(String title) async {
    final c = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: c,
          obscureText: true,
          maxLength: 4,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Transaction PIN'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, c.text),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    c.dispose();
    return result;
  }

  void _snack(String s) {
    if (mounted)
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s)));
  }

  String _money(dynamic v) {
    if (v == null) return '₦0.00';
    final n = v is num ? v : double.tryParse(v.toString()) ?? 0;
    return '₦${n.toStringAsFixed(2)}';
  }

  double _number(dynamic v) =>
      v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

  double number(dynamic v) => _number(v);

  Widget _action(String a, String b, IconData i, VoidCallback tap) => Card(
        child: ListTile(
          onTap: tap,
          leading: Icon(i, color: const Color(0xff0c6b51)),
          title: Text(a, style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(b),
          trailing: const Icon(Icons.chevron_right),
        ),
      );
  Widget _sectionTitle(String s) => Text(
        s,
        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17),
      );
}

class EduPayPlanDetail extends StatefulWidget {
  const EduPayPlanDetail({
    super.key,
    required this.api,
    required this.data,
    required this.onChanged,
    required this.initiationEnabled,
  });
  final EduPayApi api;
  final Map<String, dynamic> data;
  final VoidCallback onChanged;
  final bool initiationEnabled;
  @override
  State<EduPayPlanDetail> createState() => _EduPayPlanDetailState();
}

class _EduPayPlanDetailState extends State<EduPayPlanDetail> {
  String _statusLabel(String? raw) {
    final value = (raw ?? 'ACTIVE').toUpperCase();
    final normalized = value == 'SAVING' || value == 'UPCOMING'
        ? 'ACTIVE'
        : value == 'READY_FOR_SETTLEMENT' ||
                value == 'APPROVED' ||
                value == 'PROCESSING'
            ? 'ACTIVE'
            : value == 'FAILED' || value == 'REVERSED' || value == 'DISPUTED'
                ? 'CANCELLED'
                : value;
    return normalized
        .toLowerCase()
        .split('_')
        .map(
          (word) => word.isEmpty
              ? word
              : '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }

  String money(dynamic v) {
    final n = v is num ? v : double.tryParse('$v') ?? 0;
    return '₦${n.toStringAsFixed(2)}';
  }

  double number(dynamic v) =>
      v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

  @override
  Widget build(BuildContext context) {
    final p = widget.data['plan'] as Map? ?? {};
    final child =
        p['child'] is Map ? p['child']['fullName'] : 'School-fee plan';
    final saved = number(p['amountSaved']);
    final remaining = number(p['remaining']);
    final progress = (number(p['progressPercent']) / 100).clamp(0.0, 1.0);
    return Scaffold(
      appBar: AppBar(title: Text('$child')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Plan overview',
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Official school fee',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  Text(
                    money(p['officialFee']),
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      color: Color(0xff0c6b51),
                    ),
                  ),
                  const Divider(height: 28),
                  Text('Status  ·  ${_statusLabel(p['status']?.toString())}'),
                  Text(
                    'Due date  ·  ${p['targetDate'] ?? p['dueDate'] ?? 'Not set'}',
                  ),
                  const SizedBox(height: 12),
                  LinearProgressIndicator(value: progress, minHeight: 8),
                  const SizedBox(height: 6),
                  Text(
                    '${number(p['progressPercent']).round()}% complete · ${money(saved)} saved · ${money(remaining)} remaining',
                  ),
                  if (p['nextContribution'] != null)
                    Text('Next contribution · ${money(p['nextContribution'])}'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Repayment summary',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 10),
                  _detailRow(
                    'Funded principal',
                    p['fundedPrincipal'] ?? p['principal'] ?? p['amountFunded'],
                  ),
                  _detailRow(
                    'Charge',
                    p['charge'] ?? p['serviceCharge'] ?? p['fee'],
                  ),
                  _detailRow(
                    'Total repayment',
                    p['totalRepayment'] ??
                        p['repaymentTotal'] ??
                        p['totalAmount'],
                  ),
                  _detailRow(
                    'Schedule',
                    p['savingFrequency'] ?? p['repaymentSchedule'] ?? 'Not set',
                  ),
                  _detailRow(
                    'Due date',
                    p['targetDate'] ?? p['dueDate'] ?? 'Not set',
                  ),
                  if (p['nextContribution'] != null)
                    Text('Next contribution · ${money(p['nextContribution'])}'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: widget.initiationEnabled
                ? () async {
                    final c = TextEditingController();
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (_) => AlertDialog(
                        title: const Text('Add to savings'),
                        content: TextField(
                          controller: c,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            prefixText: '₦ ',
                            labelText: 'Amount',
                          ),
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(context),
                            child: const Text('Cancel'),
                          ),
                          FilledButton(
                            onPressed: () => Navigator.pop(context, true),
                            child: const Text('Continue'),
                          ),
                        ],
                      ),
                    );
                    if (ok != true) {
                      c.dispose();
                      return;
                    }
                    final amount = double.tryParse(c.text.trim());
                    c.dispose();
                    if (amount == null || amount <= 0) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text(
                                  'Enter a contribution greater than zero.')),
                        );
                      }
                      return;
                    }
                    final token = await SessionStore.readToken();
                    if (token == null || token.isEmpty) return;
                    final id = '${p['_id'] ?? p['id']}';
                    final key =
                        'edupay-contribute-${DateTime.now().microsecondsSinceEpoch}';
                    final authorization = await authorizeFeatureTransaction(
                      context,
                      token: token,
                      operation: 'EDUPAY_CONTRIBUTION',
                      requestBody: <String, dynamic>{'amount': amount},
                      idempotencyKey: key,
                      title: 'Confirm contribution',
                    );
                    if (authorization != null) {
                      try {
                        await widget.api.contribute(
                          id,
                          amount,
                          authorization['transactionPin']?.toString() ?? '',
                          idempotencyKey: key,
                          biometricGrant:
                              authorization['biometricGrant']?.toString(),
                          deviceId: authorization['deviceId']?.toString(),
                        );
                        widget.onChanged();
                        if (mounted)
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Contribution submitted successfully.',
                              ),
                            ),
                          );
                      } catch (e) {
                        if (mounted)
                          ScaffoldMessenger.of(
                            context,
                          ).showSnackBar(SnackBar(content: Text(e.toString())));
                      }
                    }
                  }
                : () => ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'EduPay contributions are temporarily paused.',
                        ),
                      ),
                    ),
            icon: const Icon(Icons.add),
            label: const Text('Save Now'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () async {
              if (!widget.initiationEnabled) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'EduPay sponsor invitations are temporarily paused.',
                    ),
                  ),
                );
                return;
              }
              final n = TextEditingController();
              final ok = await showDialog<bool>(
                context: context,
                builder: (_) => AlertDialog(
                  title: const Text('Invite a sponsor'),
                  content: TextField(
                    controller: n,
                    decoration: const InputDecoration(
                      labelText: 'Sponsor name',
                    ),
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Create invite'),
                    ),
                  ],
                ),
              );
              if (ok == true) {
                final invite = await widget.api.invite(
                  '${p['_id'] ?? p['id']}',
                  n.text,
                );
                final link = invite['invite']?['link']?.toString() ?? '';
                if (link.isNotEmpty)
                  await Share.share('Help support $child’s EduPay plan: $link');
              }
            },
            icon: const Icon(Icons.share_outlined),
            label: const Text('Invite a sponsor'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () async {
              if (!widget.initiationEnabled) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('EduPay autosave is temporarily paused.'),
                  ),
                );
                return;
              }
              final enabled = p['autosave'] is Map
                  ? p['autosave']['enabled'] == true
                  : false;
              try {
                await widget.api.autosave('${p['_id'] ?? p['id']}', {
                  'enabled': !enabled,
                  if (!enabled) ...{
                    'amount': p['recommendedContribution'] ?? 0,
                    'frequency': p['savingFrequency'] ?? 'MONTHLY',
                  },
                });
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        enabled ? 'Autosave paused.' : 'Autosave resumed.',
                      ),
                    ),
                  );
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(
                    context,
                  ).showSnackBar(SnackBar(content: Text(e.toString())));
                }
              }
            },
            icon: const Icon(Icons.autorenew_rounded),
            label: Text(
              p['autosave'] is Map && p['autosave']['enabled'] == true
                  ? 'Pause autosave'
                  : 'Resume autosave',
            ),
          ),
          if (widget.data['repayment'] is Map) ...[
            const SizedBox(height: 18),
            Card(
              child: ListTile(
                leading: const Icon(
                  Icons.receipt_long_outlined,
                  color: Color(0xff0c6b51),
                ),
                title: const Text('Repayment status'),
                subtitle: Text(
                  '${_statusLabel((widget.data['repayment'] as Map)['status']?.toString())}'
                  ' · ${money((widget.data['repayment'] as Map)['amountRemaining'])} remaining',
                ),
                trailing: IconButton(
                  tooltip: 'View receipt',
                  icon: const Icon(Icons.chevron_right),
                  onPressed: () async {
                    final repayment = widget.data['repayment'] as Map;
                    final id = (repayment['_id'] ?? repayment['id']).toString();
                    try {
                      final result = await widget.api.receipt(id);
                      if (!mounted) return;
                      await showDialog<void>(
                        context: context,
                        builder: (_) => AlertDialog(
                          title: const Text('EduPay receipt'),
                          content: SelectableText(
                            '${result['receipt'] ?? result}',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(context),
                              child: const Text('Done'),
                            ),
                          ],
                        ),
                      );
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(
                          context,
                        ).showSnackBar(SnackBar(content: Text(e.toString())));
                      }
                    }
                  },
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _detailRow(String label, dynamic value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(color: Color(0xff60736b))),
            const SizedBox(width: 12),
            Flexible(
              child: Text(
                value is num ||
                        (value != null && double.tryParse('$value') != null)
                    ? money(value)
                    : '${value ?? 'Not set'}',
                textAlign: TextAlign.end,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      );
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext c) => ListView(
        padding: const EdgeInsets.all(20),
        children: List.generate(
          6,
          (i) => Container(
            height: i == 0 ? 130 : 64,
            margin: const EdgeInsets.only(bottom: 14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
            ),
          ),
        ),
      );
}

class _Error extends StatelessWidget {
  const _Error({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext c) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.cloud_off_outlined,
                size: 48,
                color: Color(0xff0c6b51),
              ),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 14),
              FilledButton(onPressed: retry, child: const Text('Try again')),
            ],
          ),
        ),
      );
}

class _Empty extends StatelessWidget {
  const _Empty(this.text, this.icon);
  final String text;
  final IconData icon;
  @override
  Widget build(BuildContext c) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 70),
        child: Column(
          children: [
            Icon(icon, size: 50, color: const Color(0xff94b5a8)),
            const SizedBox(height: 14),
            Text(
              text,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xff60736b)),
            ),
          ],
        ),
      );
}

class _Notice extends StatelessWidget {
  const _Notice(this.text, {required this.warning});
  final String text;
  final bool warning;
  @override
  Widget build(BuildContext c) => Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: warning ? const Color(0xfffff5df) : const Color(0xffe8f4ef),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Icon(
              warning ? Icons.info_outline : Icons.verified_outlined,
              color: const Color(0xff0c6b51),
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(text)),
          ],
        ),
      );
}

Widget _metric(String label, String value, IconData icon) => Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 20, color: const Color(0xff0c6b51)),
              const SizedBox(height: 7),
              Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
              Text(
                label,
                style: const TextStyle(fontSize: 11, color: Color(0xff60736b)),
              ),
            ],
          ),
        ),
      ),
    );
