import 'package:flutter/material.dart';
import 'edupay_api.dart';

/// Read-only parent view. Student ids only enter this widget from the
/// authenticated parent's /parent/children response.
class StudentActivityCenter extends StatefulWidget {
  const StudentActivityCenter({
    super.key,
    required this.api,
    required this.children,
  });

  final EduPayApi api;
  final List<dynamic> children;

  @override
  State<StudentActivityCenter> createState() => _StudentActivityCenterState();
}

class _StudentActivityCenterState extends State<StudentActivityCenter> {
  late List<dynamic> linkedChildren;
  int selected = 0;
  bool loading = true;
  String? error;
  Map<String, dynamic> dashboard = {};
  Map<String, dynamic> timeline = {};
  Map<String, dynamic> attendanceData = {};
  Map<String, dynamic> resultsData = {};
  Map<String, dynamic> assignmentsData = {};
  Map<String, dynamic> activitiesData = {};
  Map<String, dynamic> announcementsData = {};
  Map<String, dynamic> conductData = {};
  String filter = 'All';
  int page = 1;

  Map<String, dynamic> get child =>
      (linkedChildren[selected] as Map?)?.cast<String, dynamic>() ?? {};
  String get studentId => '${child['_id'] ?? child['id'] ?? ''}';
  String get studentName =>
      '${child['fullName'] ?? child['name'] ?? 'Student'}';

  @override
  void initState() {
    super.initState();
    linkedChildren = List<dynamic>.from(widget.children);
    _load();
  }

  @override
  void didUpdateWidget(covariant StudentActivityCenter oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.children != widget.children) {
      linkedChildren = List<dynamic>.from(widget.children);
      selected = 0;
      _load();
    }
  }

  Future<void> _load() async {
    if (linkedChildren.isEmpty || studentId.isEmpty) {
      if (mounted) setState(() => loading = false);
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final results = await Future.wait<Map<String, dynamic>>([
        widget.api.parentStudentDashboard(studentId),
        widget.api.parentStudentTimeline(studentId, type: filter, page: page),
        widget.api.parentStudentAttendance(studentId),
        widget.api.parentStudentResults(studentId),
        widget.api.parentStudentAssignments(studentId),
        widget.api.parentStudentActivities(studentId),
        widget.api.parentStudentAnnouncements(studentId),
        widget.api.parentStudentConduct(studentId),
      ]);
      if (!mounted) return;
      setState(() {
        dashboard = results[0];
        timeline = results[1];
        attendanceData = results[2];
        resultsData = results[3];
        assignmentsData = results[4];
        activitiesData = results[5];
        announcementsData = results[6];
        conductData = results[7];
        loading = false;
      });
    } on EduPayException catch (e) {
      if (!mounted) return;
      setState(() {
        loading = false;
        error = e.statusCode == 401
            ? 'Your session has expired. Please sign in again.'
            : e.statusCode == 403 ||
                    e.code == 'FORBIDDEN' ||
                    e.code == 'EDUPAY_FORBIDDEN'
                ? 'This student is no longer linked to your account.'
                : e.toString();
      });
    } catch (e) {
      if (mounted)
        setState(() {
          loading = false;
          error = e.toString();
        });
    }
  }

  void _selectChild(int index) {
    if (index == selected) return;
    setState(() {
      selected = index;
      page = 1;
    });
    _load();
  }

  void _selectFilter(String value) {
    if (value == filter) return;
    setState(() {
      filter = value;
      page = 1;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Student Activity Center')),
      backgroundColor: const Color(0xfff5f8f6),
      body: RefreshIndicator(
        onRefresh: _load,
        child: linkedChildren.isEmpty
            ? _emptyBody()
            : ListView(
                padding: const EdgeInsets.all(18),
                children: [
                  _childSelector(),
                  const SizedBox(height: 14),
                  if (loading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 90),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (error != null)
                    _error()
                  else
                    ..._content(),
                ],
              ),
      ),
    );
  }

  Widget _childSelector() => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              DropdownButtonFormField<int>(
                value: selected,
                decoration: const InputDecoration(
                  labelText: 'My children',
                  prefixIcon: Icon(Icons.people_alt_outlined),
                  border: OutlineInputBorder(),
                ),
                items: [
                  for (var i = 0; i < linkedChildren.length; i++)
                    DropdownMenuItem(
                      value: i,
                      child: Text(_childLabel(linkedChildren[i])),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) _selectChild(value);
                },
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _acceptGuardianCode,
                  icon: const Icon(Icons.link, size: 18),
                  label: const Text('Link another child'),
                ),
              ),
            ],
          ),
        ),
      );

  Future<void> _acceptGuardianCode() async {
    var enteredCode = '';
    final code = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Link another child'),
        content: TextField(
          autofocus: true,
          autocorrect: false,
          enableSuggestions: false,
          textCapitalization: TextCapitalization.characters,
          onChanged: (value) => enteredCode = value,
          decoration: const InputDecoration(
            labelText: 'Guardian code',
            helperText: 'Enter the one-time code provided by the school.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final value = enteredCode.trim();
              if (value.isNotEmpty) Navigator.pop(dialogContext, value);
            },
            child: const Text('Link child'),
          ),
        ],
      ),
    );
    if (code == null || code.trim().isEmpty || !mounted) return;
    try {
      await widget.api.acceptGuardianLink(code);
      final refreshed = await widget.api.parentActivityChildren();
      if (!mounted) return;
      setState(() {
        linkedChildren = refreshed;
        selected = 0;
        error = null;
      });
      if (linkedChildren.isNotEmpty) {
        await _load();
      }
      _snack('Child linked successfully.');
    } on EduPayException catch (e) {
      if (!mounted) return;
      _snack(e.message ?? 'That guardian code is invalid or expired.');
    } catch (_) {
      if (mounted) _snack('Unable to link this child. Please try again.');
    }
  }

  List<Widget> _content() {
    final profile = _map(dashboard['child']);
    final attendance = _map(
      dashboard['attendance'] ?? attendanceData['attendance'],
    );
    final resultRows = _list(resultsData['results']);
    final rawResult = dashboard['latestResult'] ??
        (resultRows.isEmpty ? null : resultRows.first);
    final result =
        rawResult == null ? <String, dynamic>{} : _publicRecord(rawResult);
    final assignments = _records(assignmentsData);
    final activities = _records(activitiesData);
    final announcements = _records(announcementsData);
    final conduct = _records(conductData);
    final rows = _list(timeline['records']).map(_publicRecord).toList();
    return [
      _profile(profile.isEmpty ? child : profile),
      const SizedBox(height: 12),
      _section(
        'Today’s attendance',
        Icons.fact_check_outlined,
        _attendance(attendance),
      ),
      const SizedBox(height: 10),
      _section(
        'Latest published result',
        Icons.school_outlined,
        _result(result),
      ),
      const SizedBox(height: 10),
      _section(
        'Assignments',
        Icons.assignment_outlined,
        _items(assignments, empty: 'No assignments published yet.'),
      ),
      const SizedBox(height: 10),
      _section(
        'Recent activities',
        Icons.auto_awesome_outlined,
        _items(activities, empty: 'No activities published yet.'),
      ),
      const SizedBox(height: 10),
      _section(
        'School announcements',
        Icons.campaign_outlined,
        _items(announcements, empty: 'No announcements for this student.'),
      ),
      const SizedBox(height: 10),
      _section(
        'Conduct & achievements',
        Icons.emoji_events_outlined,
        _items(conduct, empty: 'No parent-visible conduct updates.'),
      ),
      const SizedBox(height: 10),
      _timeline(rows),
    ];
  }

  Widget _profile(Map<String, dynamic> p) {
    final school = _map(p['school']);
    return Card(
      color: const Color(0xff0c6b51),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          children: [
            CircleAvatar(
              radius: 30,
              backgroundColor: Colors.white24,
              backgroundImage: '${p['photoUrl'] ?? p['photo'] ?? ''}'.isEmpty
                  ? null
                  : NetworkImage('${p['photoUrl'] ?? p['photo']}'),
              child: '${p['photoUrl'] ?? p['photo'] ?? ''}'.isEmpty
                  ? const Icon(Icons.person, color: Colors.white, size: 30)
                  : null,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${p['fullName'] ?? p['name'] ?? studentName}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    '${school['name'] ?? p['schoolName'] ?? 'School not listed'}'
                    '${p['className'] == null ? '' : ' · ${p['className']}'}',
                    style: const TextStyle(color: Colors.white70),
                  ),
                  if (p['studentId'] != null || p['admissionNumber'] != null)
                    Text(
                      'ID: ${p['studentId'] ?? p['admissionNumber']}',
                      style: const TextStyle(color: Colors.white70),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _attendance(Map<String, dynamic> a) => Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          _stat('Status', a['today'] ?? a['status'] ?? 'Not recorded'),
          _stat('Present', a['presentDays'] ?? a['present'] ?? 0),
          _stat('Absent', a['absentDays'] ?? a['absent'] ?? 0),
          _stat(
              'Rate', '${a['percentage'] ?? a['attendancePercentage'] ?? 0}%'),
        ],
      );

  Widget _result(Map<String, dynamic> r) {
    if (r.isEmpty) return const Text('No published result yet.');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${r['term'] ?? 'Latest term'} · ${r['session'] ?? ''}',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text('Average: ${r['overallAverage'] ?? r['average'] ?? '—'}'),
        if (_list(r['subjects'] ?? r['scores']).isNotEmpty)
          ..._list(r['subjects'] ?? r['scores']).take(4).map((s) {
            final m = _map(s);
            return ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text('${m['subject'] ?? m['name'] ?? 'Subject'}'),
              trailing: Text(
                '${m['total'] ?? m['totalScore'] ?? m['grade'] ?? '—'}',
              ),
            );
          }),
      ],
    );
  }

  Widget _timeline(List<dynamic> rows) => Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Activity timeline',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final f in const [
                      'All',
                      'Attendance',
                      'Academics',
                      'Assignments',
                      'Activities',
                      'Announcements',
                    ])
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: ChoiceChip(
                          label: Text(f),
                          selected: filter == f,
                          onSelected: (_) => _selectFilter(f),
                        ),
                      ),
                  ],
                ),
              ),
              if (rows.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Text('No activity updates yet.'),
                )
              else
                ...rows.map((e) {
                  final m = _map(e);
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(
                      Icons.circle,
                      size: 10,
                      color: Color(0xff0c6b51),
                    ),
                    title: Text('${m['title'] ?? m['type'] ?? 'Update'}'),
                    subtitle: Text(
                      '${m['description'] ?? m['status'] ?? ''} ${m['date'] ?? m['createdAt'] ?? ''}',
                    ),
                  );
                }),
            ],
          ),
        ),
      );

  Widget _section(String title, IconData icon, Widget body) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: const Color(0xff0c6b51)),
                  const SizedBox(width: 8),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              body,
            ],
          ),
        ),
      );

  Widget _items(List<dynamic> values, {required String empty}) {
    if (values.isEmpty) return Text(empty);
    return Column(
      children: values.take(4).map((v) {
        final m = _map(v);
        return ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          title: Text('${m['title'] ?? m['name'] ?? m['subject'] ?? 'Update'}'),
          subtitle: Text(
            '${m['description'] ?? m['comment'] ?? m['dueDate'] ?? m['date'] ?? ''}',
          ),
        );
      }).toList(),
    );
  }

  List<dynamic> _records(Map<String, dynamic> envelope) =>
      _list(envelope['records']).map(_publicRecord).toList();

  /// Activity records contain audit, actor and tenancy fields. Keep the
  /// parent surface deliberately limited to the published payload contract.
  static Map<String, dynamic> _publicRecord(dynamic value) {
    final record = _map(value);
    final payload = _map(record['payload']);
    const allowed = {
      'title',
      'name',
      'subject',
      'description',
      'comment',
      'teacherComment',
      'status',
      'grade',
      'total',
      'totalScore',
      'ca',
      'exam',
      'dueDate',
      'date',
      'eventDate',
      'position',
      'average',
      'overallAverage',
    };
    final safe = <String, dynamic>{
      'type': record['recordType'],
      'date': record['eventDate'],
    };
    for (final key in allowed) {
      if (payload.containsKey(key)) safe[key] = payload[key];
      if (record.containsKey(key)) safe[key] = record[key];
    }
    return safe;
  }

  Widget _stat(String label, dynamic value) => Chip(
        label: Text('$label: $value'),
        backgroundColor: const Color(0xffe8f4ef),
      );

  Widget _error() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 70),
        child: Column(
          children: [
            const Icon(Icons.lock_outline, size: 44, color: Color(0xff0c6b51)),
            const SizedBox(height: 12),
            Text(error!, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            OutlinedButton(onPressed: _load, child: const Text('Try again')),
          ],
        ),
      );

  void _snack(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Widget _emptyBody() => ListView(
        padding: const EdgeInsets.all(28),
        children: [
          const SizedBox(height: 80),
          const Icon(Icons.link_outlined, size: 48, color: Color(0xff0c6b51)),
          const SizedBox(height: 14),
          const Text(
            'No linked students are available yet.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _acceptGuardianCode,
            icon: const Icon(Icons.link),
            label: const Text('Link another child'),
          ),
        ],
      );

  static String _childLabel(dynamic value) {
    final m = _map(value);
    return '${m['fullName'] ?? m['name'] ?? 'Student'}'
        '${m['school'] is Map ? ' · ${_map(m['school'])['name'] ?? ''}' : ''}';
  }

  static Map<String, dynamic> _map(dynamic value) =>
      value is Map ? value.cast<String, dynamic>() : <String, dynamic>{};
  static List<dynamic> _list(dynamic value) => value is List ? value : const [];
}
