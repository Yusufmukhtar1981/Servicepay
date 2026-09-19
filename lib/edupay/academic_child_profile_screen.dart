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

class _AcademicChildProfileScreenState
    extends State<AcademicChildProfileScreen> {
  int tab = 0;
  bool loading = true;
  String? error;
  Map<String, dynamic> attendance = {};
  Map<String, dynamic> results = {};
  Map<String, dynamic> activities = {};
  Map<String, dynamic> timetable = {};

  String get childId =>
      '${widget.child['_id'] ?? widget.child['id'] ?? widget.child['studentId']}';

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final values = await Future.wait([
        widget.api.academicAttendance(childId),
        widget.api.academicResults(childId),
        widget.api.academicActivities(childId),
        widget.api.academicTimetable(childId),
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
      if (mounted) setState(() { loading = false; error = e.toString(); });
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
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (value) => setState(() => tab = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Overview'),
          NavigationDestination(icon: Icon(Icons.fact_check_outlined), label: 'Attendance'),
          NavigationDestination(icon: Icon(Icons.school_outlined), label: 'Results'),
          NavigationDestination(icon: Icon(Icons.savings_outlined), label: 'Fees'),
          NavigationDestination(icon: Icon(Icons.campaign_outlined), label: 'Updates'),
          NavigationDestination(icon: Icon(Icons.calendar_month_outlined), label: 'Timetable'),
        ],
      ),
    );
  }

  Widget _overview(String name) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          CircleAvatar(
            radius: 34,
            backgroundColor: const Color(0xffdcefe8),
            child: Text(name.isEmpty ? '?' : name[0].toUpperCase(),
                style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Color(0xff0c6b51))),
          ),
          const SizedBox(height: 14),
          Center(child: Text(name, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800))),
          const SizedBox(height: 4),
          Center(child: Text(_schoolName(), style: TextStyle(color: Colors.grey.shade700))),
          const SizedBox(height: 24),
          _infoCard('A clear school-day view', 'Attendance, published results, fees and school updates in one dependable place.', Icons.visibility_outlined),
          _quick('Attendance', Icons.fact_check_outlined, 1),
          _quick('Published results', Icons.school_outlined, 2),
          _quick('Fees & savings', Icons.savings_outlined, 3),
          _quick('School updates', Icons.campaign_outlined, 4),
          _quick('Timetable', Icons.calendar_month_outlined, 5),
        ],
      );

  String _schoolName() {
    final school = widget.child['school'];
    return school is Map ? '${school['name'] ?? 'School'}' : '${school ?? 'School'}';
  }

  Widget _quick(String title, IconData icon, int index) => Card(
        child: ListTile(
          leading: Icon(icon, color: const Color(0xff0c6b51)),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => setState(() => tab = index),
        ),
      );

  Widget _infoCard(String title, String body, IconData icon) => Card(
        color: const Color(0xffe8f4ef),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, color: const Color(0xff0c6b51)),
            const SizedBox(width: 14),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 5),
              Text(body),
            ])),
          ]),
        ),
      );

  Widget _attendance() {
    final rows = _list(attendance, 'attendance');
    final now = DateTime.now();
    int count(bool Function(DateTime) filter) =>
        rows.where((row) => filter(DateTime.tryParse(_date(row['date'])) ?? DateTime(1900))).length;
    final present = rows.where((row) => '${row['status']}'.toUpperCase() == 'PRESENT').length;
    final within = (int days) => count((date) => now.difference(date).inDays < days);
    return _section('Attendance', [
      _metricGrid([
        _metric('Today', '${within(1)} marked'),
        _metric('This week', '${within(7)} days'),
        _metric('This month', '${within(31)} days'),
        _metric('Present', '$present records'),
      ]),
      const SizedBox(height: 12),
      if (rows.isEmpty) const _Empty('Attendance has not been published yet.', Icons.fact_check_outlined),
      ...rows.map((row) => Card(child: ListTile(
        leading: Icon(_attendanceIcon(row['status']), color: _attendanceColor(row['status'])),
        title: Text('${row['status'] ?? 'Not marked'}', style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(_date(row['date'])),
      ))),
    ]);
  }

  IconData _attendanceIcon(dynamic status) =>
      '${status ?? ''}'.toUpperCase() == 'PRESENT' ? Icons.check_circle_outline : Icons.info_outline;
  Color _attendanceColor(dynamic status) =>
      '${status ?? ''}'.toUpperCase() == 'PRESENT' ? const Color(0xff0c6b51) : Colors.orange.shade800;

  Widget _results() {
    final rows = _list(results, 'results');
    return _section('Published results', [
      const _Notice('Only results published by the school are shown here. Draft and unapproved scores stay private.', Icons.lock_outline),
      if (rows.isEmpty) const _Empty('No published results for this child yet.', Icons.school_outlined),
      ...rows.map((row) {
        final assessment = row['assessment'] is Map ? row['assessment'] as Map : {};
        return Card(child: ListTile(
          title: Text('${assessment['title'] ?? 'Assessment'}', style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text('${assessment['subject'] is Map ? assessment['subject']['name'] ?? '' : assessment['subject'] ?? ''} · ${assessment['term'] is Map ? assessment['term']['name'] ?? '' : assessment['term'] ?? ''}'),
          trailing: Text('${row['grade'] ?? row['percentage'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        ));
      }),
    ]);
  }

  Widget _fees() => _section('Fees & savings', [
        _infoCard('Keep the plan moving', 'Your child’s school-fee plans and payments remain in the main EduPay Plans tab.', Icons.savings_outlined),
        const SizedBox(height: 10),
        const _Notice('Open My plans to see balances, contributions, settlement targets and receipts.', Icons.arrow_forward_outlined),
      ]);

  Widget _activities() {
    final rows = _list(activities, 'activities');
    return _section('School activities & announcements', [
      if (rows.isEmpty) const _Empty('No published school updates yet.', Icons.campaign_outlined),
      ...rows.map((row) => Card(child: ListTile(
        leading: const Icon(Icons.campaign_outlined, color: Color(0xff0c6b51)),
        title: Text('${row['title'] ?? row['name'] ?? 'School update'}', style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text('${row['description'] ?? row['body'] ?? ''}\n${_date(row['eventDate'] ?? row['createdAt'])}'),
        isThreeLine: true,
      ))),
    ]);
  }

  Widget _timetable() {
    final rows = _list(timetable, 'timetable');
    return _section('Timetable', [
      if (rows.isEmpty) const _Empty('The school has not published a timetable yet.', Icons.calendar_month_outlined),
      ...rows.map((row) => Card(child: ListTile(
        leading: const Icon(Icons.schedule, color: Color(0xff0c6b51)),
        title: Text('${row['day'] ?? 'School day'}', style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text('${row['startsAt'] ?? ''} – ${row['endsAt'] ?? ''}'),
        trailing: Text('${row['subject'] is Map ? row['subject']['name'] ?? '' : row['subject'] ?? ''}'),
      ))),
    ]);
  }

  Widget _section(String title, List<Widget> children) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(title, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
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
        child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(label, style: TextStyle(color: Colors.grey.shade700, fontSize: 12)),
          const SizedBox(height: 5),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
        ])),
      );
}

class _Notice extends StatelessWidget {
  const _Notice(this.text, this.icon);
  final String text;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Card(
        color: const Color(0xffe8f4ef),
        child: ListTile(leading: Icon(icon, color: const Color(0xff0c6b51)), title: Text(text)),
      );
}

class _Empty extends StatelessWidget {
  const _Empty(this.text, this.icon);
  final String text;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 42),
        child: Column(children: [Icon(icon, size: 42, color: Colors.grey.shade500), const SizedBox(height: 12), Text(text, textAlign: TextAlign.center)]),
      );
}

class _Failure extends StatelessWidget {
  const _Failure({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
    const Icon(Icons.cloud_off_outlined, size: 42),
    const SizedBox(height: 12),
    Text(message, textAlign: TextAlign.center),
    const SizedBox(height: 12),
    FilledButton(onPressed: retry, child: const Text('Try again')),
  ])));
}

class _ProfileSkeleton extends StatelessWidget {
  const _ProfileSkeleton();
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(20), children: [
    Container(height: 76, width: 76, decoration: const BoxDecoration(color: Color(0xffdce5e0), shape: BoxShape.circle)),
    const SizedBox(height: 20),
    for (var i = 0; i < 5; i++) Padding(padding: const EdgeInsets.only(bottom: 12), child: Container(height: 64, decoration: BoxDecoration(color: const Color(0xffe1e9e5), borderRadius: BorderRadius.circular(14)))),
  ]);
}