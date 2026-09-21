import 'package:flutter/material.dart';
import 'edupay_api.dart';

class AcademicChildProfileScreen extends StatefulWidget {
  const AcademicChildProfileScreen({
    super.key,
    required this.api,
    required this.child,
  });

  final EduPayApi api;
  final Map child;

  @override
  State<AcademicChildProfileScreen> createState() =>
      _AcademicChildProfileScreenState();
}

class _AcademicChildProfileScreenState extends State<AcademicChildProfileScreen>
    with WidgetsBindingObserver {
  int tab = 0;
  bool loading = true;
  bool _loadingRequest = false;
  String? error;
  Map<String, dynamic> attendance = {};
  Map<String, dynamic> results = {};
  Map<String, dynamic> activities = {};
  Map<String, dynamic> timetable = {};

  String? get _authorizedChildId {
    for (final value in [widget.child['_id'], widget.child['id']]) {
      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) load();
  }

  Future<void> load() async {
    if (_loadingRequest) return;
    final id = _authorizedChildId;
    if (id == null) {
      setState(() {
        loading = false;
        error = 'This child does not have an authorized academic profile id.';
      });
      return;
    }
    _loadingRequest = true;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final values = await Future.wait([
        widget.api.academicAttendance(id),
        widget.api.academicResults(id),
        widget.api.academicActivities(id),
        widget.api.academicTimetable(id),
      ]);
      if (!mounted) return;
      setState(() {
        attendance = values[0];
        results = values[1];
        activities = values[2];
        timetable = values[3];
        loading = false;
      });
    } catch (e) {
      if (mounted)
        setState(() {
          loading = false;
          error = e.toString();
        });
    } finally {
      _loadingRequest = false;
    }
  }

  List<dynamic> _list(Map<String, dynamic> source, String key) =>
      source[key] is List ? source[key] as List : const [];

  String _date(dynamic value) => value?.toString().split('T').first ?? '';

  @override
  Widget build(BuildContext context) {
    final name = '${widget.child['fullName'] ?? 'Child'}';
    return Scaffold(
      backgroundColor: const Color(0xfff5f8f6),
      appBar: AppBar(
        title: Text(name),
        actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh))],
      ),
      body: loading
          ? const _ProfileSkeleton()
          : error != null
              ? _Failure(message: error!, retry: load)
              : IndexedStack(
                  index: tab,
                  children: [
                    _overview(name),
                    _attendance(),
                    _results(),
                    _fees(),
                    _activities(),
                    _timetable(),
                  ],
                ),
      bottomNavigationBar: _profileTabs(),
    );
  }

  Widget _profileTabs() {
    const tabs = <(String, IconData)>[
      ('Overview', Icons.person_outline),
      ('Attendance', Icons.fact_check_outlined),
      ('Results', Icons.school_outlined),
      ('Fees & Savings', Icons.savings_outlined),
      ('School Activities/Announcements', Icons.campaign_outlined),
      ('Timetable', Icons.calendar_month_outlined),
    ];
    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            children: [
              for (var index = 0; index < tabs.length; index++)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    avatar: Icon(tabs[index].$2, size: 17),
                    label: Text(tabs[index].$1),
                    selected: tab == index,
                    onSelected: (_) {
                      setState(() => tab = index);
                      if (index == 1) load();
                    },
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _overview(String name) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          CircleAvatar(
            radius: 34,
            backgroundColor: const Color(0xffdcefe8),
            child: Text(
              name.isEmpty ? '?' : name[0].toUpperCase(),
              style: const TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: Color(0xff0c6b51),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Center(
            child: Text(
              name,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(height: 4),
          Center(
            child: Text(
              _schoolName(),
              style: TextStyle(color: Colors.grey.shade700),
            ),
          ),
          const SizedBox(height: 24),
          _infoCard(
            'A clear school-day view',
            'Attendance, published results, fees and school updates in one dependable place.',
            Icons.visibility_outlined,
          ),
          _quick('Attendance', Icons.fact_check_outlined, 1),
          _quick('Published results', Icons.school_outlined, 2),
          _quick('Fees & Savings', Icons.savings_outlined, 3),
          _quick('School Activities/Announcements', Icons.campaign_outlined, 4),
          _quick('Timetable', Icons.calendar_month_outlined, 5),
        ],
      );

  String _schoolName() {
    final school = widget.child['school'];
    return school is Map
        ? '${school['name'] ?? 'School'}'
        : '${school ?? 'School'}';
  }

  Widget _quick(String title, IconData icon, int index) => Card(
        child: ListTile(
          leading: Icon(icon, color: const Color(0xff0c6b51)),
          title:
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => setState(() => tab = index),
        ),
      );

  Widget _infoCard(String title, String body, IconData icon) => Card(
        color: const Color(0xffe8f4ef),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: const Color(0xff0c6b51)),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 5),
                    Text(body),
                  ],
                ),
              ),
            ],
          ),
        ),
      );

  Widget _attendance() {
    final rows = _list(attendance, 'attendance');
    final sorted = [...rows]..sort(
        (a, b) => (_attendanceDate(b) ?? DateTime(1900)).compareTo(
          _attendanceDate(a) ?? DateTime(1900),
        ),
      );
    final counts = <String, int>{};
    for (final row in rows) {
      final status = '${row['status'] ?? ''}'.toUpperCase();
      counts[status] = (counts[status] ?? 0) + 1;
    }
    final marked = rows.length;
    final present = counts['PRESENT'] ?? 0;
    final rate = marked == 0 ? 0 : (present / marked * 100).round();
    final today = DateTime.now();
    final todayRow = rows.cast<Map>().where((row) {
      final date = _attendanceDate(row);
      return date != null &&
          date.year == today.year &&
          date.month == today.month &&
          date.day == today.day;
    }).toList();
    final todayStatus = todayRow.isEmpty
        ? 'Not marked'
        : _attendanceStatus(todayRow.last['status']);
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Today\'s Attendance',
            style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: Icon(
                _attendanceIcon(todayStatus),
                color: _attendanceColor(todayStatus),
              ),
              title: const Text('Today\'s status'),
              subtitle: Text(todayStatus),
            ),
          ),
          const SizedBox(height: 12),
          _metricGrid([
            _metric('Present', '${counts['PRESENT'] ?? 0}'),
            _metric('Absent', '${counts['ABSENT'] ?? 0}'),
            _metric('Late', '${counts['LATE'] ?? 0}'),
            _metric('Excused', '${counts['EXCUSED'] ?? 0}'),
          ]),
          const SizedBox(height: 12),
          _metric('Attendance rate', '$rate%'),
          const SizedBox(height: 20),
          const Text(
            'Attendance history',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          if (sorted.isEmpty)
            const _Empty(
              'No attendance records yet.',
              Icons.fact_check_outlined,
            ),
          if (sorted.isNotEmpty)
            Card(
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  const Padding(
                    padding: EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Date',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            'Status',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            'Class',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                  ),
                  for (final row in sorted)
                    ListTile(
                      dense: true,
                      title: Row(
                        children: [
                          Expanded(child: Text(_date(row['date']))),
                          Expanded(
                            child: Text(_attendanceStatus(row['status'])),
                          ),
                          Expanded(child: Text(_className(row))),
                        ],
                      ),
                      subtitle: _sessionTerm(row).isEmpty
                          ? null
                          : Text(_sessionTerm(row)),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  DateTime? _attendanceDate(dynamic row) =>
      row is Map ? DateTime.tryParse(_date(row['date'])) : null;

  String _attendanceStatus(dynamic value) {
    final status = '${value ?? ''}'.trim();
    if (status.isEmpty) return 'Not marked';
    return '${status[0].toUpperCase()}${status.substring(1).toLowerCase()}';
  }

  String _className(Map row) {
    final value = row['classLevel'] ?? row['class'] ?? row['className'];
    return value is Map
        ? '${value['name'] ?? value['label'] ?? ''}'
        : '${value ?? '—'}';
  }

  String _sessionTerm(Map row) {
    String value(dynamic v) =>
        v is Map ? '${v['name'] ?? v['label'] ?? ''}' : '${v ?? ''}';
    final session = value(row['session']);
    final term = value(row['term']);
    return [session, term].where((v) => v.isNotEmpty).join(' · ');
  }

  IconData _attendanceIcon(dynamic status) =>
      '${status ?? ''}'.toUpperCase() == 'PRESENT'
          ? Icons.check_circle_outline
          : Icons.info_outline;
  Color _attendanceColor(dynamic status) =>
      '${status ?? ''}'.toUpperCase() == 'PRESENT'
          ? const Color(0xff0c6b51)
          : Colors.orange.shade800;

  Widget _results() {
    final rows = _list(results, 'results');
    return _section('Published results', [
      const _Notice(
        'Only results published by the school are shown here. Draft and unapproved scores stay private.',
        Icons.lock_outline,
      ),
      if (rows.isEmpty)
        const _Empty(
          'No published results for this child yet.',
          Icons.school_outlined,
        ),
      ...rows.map((row) {
        final assessment =
            row['assessment'] is Map ? row['assessment'] as Map : {};
        return Card(
          child: ListTile(
            title: Text(
              '${assessment['title'] ?? 'Assessment'}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              '${assessment['subject'] is Map ? assessment['subject']['name'] ?? '' : assessment['subject'] ?? ''} · ${assessment['term'] is Map ? assessment['term']['name'] ?? '' : assessment['term'] ?? ''}',
            ),
            trailing: Text(
              '${row['grade'] ?? row['percentage'] ?? '—'}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
            ),
          ),
        );
      }),
    ]);
  }

  Widget _fees() => _section('Fees & Savings', [
        _infoCard(
          'Keep the plan moving',
          'Your child’s school-fee plans and payments remain in the main EduPay Plans tab.',
          Icons.savings_outlined,
        ),
        const SizedBox(height: 10),
        const _Notice(
          'Open My plans to see balances, contributions, settlement targets and receipts.',
          Icons.arrow_forward_outlined,
        ),
      ]);

  Widget _activities() {
    final rows = _list(activities, 'activities');
    return _section('School Activities/Announcements', [
      if (rows.isEmpty)
        const _Empty(
          'No published school updates yet.',
          Icons.campaign_outlined,
        ),
      ...rows.map(
        (row) => Card(
          child: ListTile(
            leading: const Icon(
              Icons.campaign_outlined,
              color: Color(0xff0c6b51),
            ),
            title: Text(
              '${row['title'] ?? row['name'] ?? 'School update'}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              '${row['description'] ?? row['body'] ?? ''}\n${_date(row['eventDate'] ?? row['createdAt'])}',
            ),
            isThreeLine: true,
          ),
        ),
      ),
    ]);
  }

  Widget _timetable() {
    final rows = _list(timetable, 'timetable');
    return _section('Timetable', [
      if (rows.isEmpty)
        const _Empty(
          'The school has not published a timetable yet.',
          Icons.calendar_month_outlined,
        ),
      ...rows.map(
        (row) => Card(
          child: ListTile(
            leading: const Icon(Icons.schedule, color: Color(0xff0c6b51)),
            title: Text(
              '${row['day'] ?? 'School day'}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text('${row['startsAt'] ?? ''} – ${row['endsAt'] ?? ''}'),
            trailing: Text(
              '${row['subject'] is Map ? row['subject']['name'] ?? '' : row['subject'] ?? ''}',
            ),
          ),
        ),
      ),
    ]);
  }

  Widget _section(String title, List<Widget> children) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      );

  Widget _metricGrid(List<Widget> children) => GridView.count(
        crossAxisCount: MediaQuery.sizeOf(context).width < 500 ? 2 : 4,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 1.4,
        children: children,
      );

  Widget _metric(String label, String value) => Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                label,
                style: TextStyle(color: Colors.grey.shade700, fontSize: 12),
              ),
              const SizedBox(height: 5),
              Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
            ],
          ),
        ),
      );
}

class _Notice extends StatelessWidget {
  const _Notice(this.text, this.icon);
  final String text;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Card(
        color: const Color(0xffe8f4ef),
        child: ListTile(
          leading: Icon(icon, color: const Color(0xff0c6b51)),
          title: Text(text),
        ),
      );
}

class _Empty extends StatelessWidget {
  const _Empty(this.text, this.icon);
  final String text;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 42),
        child: Column(
          children: [
            Icon(icon, size: 42, color: Colors.grey.shade500),
            const SizedBox(height: 12),
            Text(text, textAlign: TextAlign.center),
          ],
        ),
      );
}

class _Failure extends StatelessWidget {
  const _Failure({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, size: 42),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: retry, child: const Text('Try again')),
            ],
          ),
        ),
      );
}

class _ProfileSkeleton extends StatelessWidget {
  const _ProfileSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            height: 76,
            width: 76,
            decoration: const BoxDecoration(
              color: Color(0xffdce5e0),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(height: 20),
          for (var i = 0; i < 5; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Container(
                height: 64,
                decoration: BoxDecoration(
                  color: const Color(0xffe1e9e5),
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
        ],
      );
}
