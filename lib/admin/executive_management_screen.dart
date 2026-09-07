import 'package:flutter/material.dart';

import 'svp_api_service.dart';
import 'svp_audit_screen.dart';
import 'svp_management_screen.dart';
import 'svp_reports_screen.dart';

class ExecutiveManagementScreen extends StatefulWidget {
  const ExecutiveManagementScreen({super.key, this.api});

  final SvpApiService? api;

  @override
  State<ExecutiveManagementScreen> createState() =>
      ExecutiveManagementScreenState();
}

class ExecutiveManagementScreenState extends State<ExecutiveManagementScreen> {
  late final SvpApiService api;
  int selected = 0;
  final GlobalKey<SvpManagementScreenState> managementKey =
      GlobalKey<SvpManagementScreenState>();
  bool loading = true;
  bool pendingCreate = false;
  String? error;
  List<dynamic> svps = const [];

  static const Color ink = Color(0xFF102C35);
  static const Color canvas = Color(0xFFF1F6F4);

  @override
  void initState() {
    super.initState();
    api = widget.api ?? SvpApiService();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = await api.request('GET', '/svp');
      if (!mounted) return;
      setState(() {
        svps = (result['data'] as List?) ?? const [];
        loading = false;
      });
      _openPendingCreate();
    } catch (e) {
      if (mounted) {
        setState(() {
          loading = false;
          error = 'Executive data is temporarily unavailable.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    return Scaffold(
      backgroundColor: canvas,
      appBar: AppBar(
        backgroundColor: ink,
        foregroundColor: Colors.white,
        elevation: 0,
        titleSpacing: wide ? 28 : 16,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Executive Management',
                style: TextStyle(fontWeight: FontWeight.w800)),
            Text('ServicePay Head Office',
                style: TextStyle(fontSize: 11, color: Color(0xFFB8D3CD))),
          ],
        ),
        actions: [
          IconButton(
            onPressed: _load,
            tooltip: 'Refresh executive data',
            icon: const Icon(Icons.refresh_rounded),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (wide) _Rail(selected: selected, onSelect: _select),
          Expanded(
            child: loading
                ? const _ExecutiveSkeleton()
                : error != null
                    ? _Failure(message: error!, retry: _load)
                    : IndexedStack(
                        index: selected,
                        children: [
                          _Overview(
                            svps: svps,
                            onSelect: _select,
                            onCreate: () {
                              setState(() => selected = 1);
                              managementKey.currentState?.openCreate();
                            },
                          ),
                          SvpManagementScreen(key: managementKey),
                          const SvpReportsScreen(headOffice: true),
                          const SvpAuditScreen(headOffice: true),
                        ],
                      ),
          ),
        ],
      ),
      bottomNavigationBar:
          wide ? null : _MobileBar(selected: selected, onSelect: _select),
    );
  }

  void _select(int value) => setState(() => selected = value);

  void openCreate() {
    setState(() => selected = 1);
    if (loading) {
      pendingCreate = true;
      return;
    }
    _showCreateForm();
  }

  void _openPendingCreate() {
    if (!pendingCreate) return;
    pendingCreate = false;
    _showCreateForm();
  }

  void _showCreateForm() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      managementKey.currentState?.openCreate();
    });
  }
}

class _Rail extends StatelessWidget {
  const _Rail({required this.selected, required this.onSelect});
  final int selected;
  final ValueChanged<int> onSelect;
  static const items = <({String label, IconData icon})>[
    (label: 'Executive Overview', icon: Icons.dashboard_customize_outlined),
    (label: 'SVP Management', icon: Icons.badge_outlined),
    (label: 'Reports', icon: Icons.description_outlined),
    (label: 'Audit Logs', icon: Icons.manage_history_outlined),
  ];

  @override
  Widget build(BuildContext context) => Container(
        width: 238,
        color: const Color(0xFFE6F0ED),
        padding: const EdgeInsets.fromLTRB(14, 24, 14, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(14, 0, 14, 18),
              child: Text('COMMAND DECK',
                  style: TextStyle(
                      fontSize: 11,
                      letterSpacing: 1.6,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF60847C))),
            ),
            ...List.generate(items.length, (index) {
              final item = items[index];
              return Padding(
                padding: const EdgeInsets.only(bottom: 5),
                child: ListTile(
                  selected: selected == index,
                  selectedTileColor: Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  leading: Icon(item.icon,
                      color: selected == index
                          ? const Color(0xFF087E6A)
                          : const Color(0xFF66817B)),
                  title: Text(item.label,
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: selected == index
                              ? FontWeight.w800
                              : FontWeight.w600)),
                  onTap: () => onSelect(index),
                ),
              );
            }),
          ],
        ),
      );
}

class _MobileBar extends StatelessWidget {
  const _MobileBar({required this.selected, required this.onSelect});
  final int selected;
  final ValueChanged<int> onSelect;
  @override
  Widget build(BuildContext context) => NavigationBar(
        selectedIndex: selected,
        onDestinationSelected: onSelect,
        height: 70,
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.dashboard_customize_outlined),
              label: 'Overview'),
          NavigationDestination(
              icon: Icon(Icons.badge_outlined), label: 'SVPs'),
          NavigationDestination(
              icon: Icon(Icons.description_outlined), label: 'Reports'),
          NavigationDestination(
              icon: Icon(Icons.manage_history_outlined), label: 'Audit'),
        ],
      );
}

class _Overview extends StatelessWidget {
  const _Overview(
      {required this.svps, required this.onSelect, required this.onCreate});
  final List<dynamic> svps;
  final ValueChanged<int> onSelect;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final active = svps.where((x) => '${x['status']}' == 'ACTIVE').length;
    final suspended = svps.where((x) => '${x['status']}' == 'SUSPENDED').length;
    return RefreshIndicator(
      onRefresh: () async {},
      child: ListView(
        padding: const EdgeInsets.all(22),
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            runSpacing: 12,
            children: [
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Executive Overview',
                      style: TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF102C35))),
                  SizedBox(height: 4),
                  Text('A clear read on leadership coverage and operations.',
                      style: TextStyle(color: Color(0xFF66817B))),
                ],
              ),
              FilledButton.icon(
                onPressed: onCreate,
                icon: const Icon(Icons.add),
                label: const Text('CREATE SVP'),
              ),
            ],
          ),
          const SizedBox(height: 22),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _Stat(
                  label: 'Total SVPs',
                  value: '${svps.length}',
                  icon: Icons.badge_outlined),
              _Stat(
                  label: 'Active SVPs',
                  value: '$active',
                  icon: Icons.verified_outlined),
              _Stat(
                  label: 'Suspended SVPs',
                  value: '$suspended',
                  icon: Icons.pause_circle_outline),
            ],
          ),
          const SizedBox(height: 24),
          const Text('OPERATING SURFACES',
              style: TextStyle(
                  letterSpacing: 1.5,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF66817B))),
          const SizedBox(height: 10),
          _SurfaceGrid(onSelect: onSelect),
        ],
      ),
    );
  }
}

class _SurfaceGrid extends StatelessWidget {
  const _SurfaceGrid({required this.onSelect});
  final ValueChanged<int> onSelect;
  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          _Surface(
              title: 'SVP Management',
              detail: 'Identity, access and account lifecycle',
              icon: Icons.badge_outlined,
              onTap: () => onSelect(1)),
          _Surface(
              title: 'SVP Performance',
              detail: 'Leadership outcomes and scorecards',
              icon: Icons.insights_outlined,
              onTap: () => onSelect(1)),
          _Surface(
              title: 'Transaction Intelligence',
              detail: 'Volume, value and exception signals',
              icon: Icons.receipt_long_outlined,
              onTap: () => onSelect(0)),
          _Surface(
              title: 'Staff Performance',
              detail: 'Activity across the operating team',
              icon: Icons.groups_outlined,
              onTap: () => onSelect(0)),
          _Surface(
              title: 'Branch Performance',
              detail: 'Coverage, throughput and momentum',
              icon: Icons.account_tree_outlined,
              onTap: () => onSelect(0)),
          _Surface(
              title: 'Live Operations',
              detail: 'Current queues and issue domains',
              icon: Icons.bolt_outlined,
              onTap: () => onSelect(0)),
          _Surface(
              title: 'Reports',
              detail: 'Review submitted executive reports',
              icon: Icons.description_outlined,
              onTap: () => onSelect(2)),
          _Surface(
              title: 'Audit Logs',
              detail: 'Trace privileged changes and access',
              icon: Icons.manage_history_outlined,
              onTap: () => onSelect(3)),
        ],
      );
}

class _Surface extends StatelessWidget {
  const _Surface(
      {required this.title,
      required this.detail,
      required this.icon,
      required this.onTap});
  final String title;
  final String detail;
  final IconData icon;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 270,
        child: Card(
          elevation: 0,
          color: Colors.white,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(14),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(icon, color: const Color(0xFF087E6A)),
                    const SizedBox(height: 18),
                    Text(title,
                        style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            color: Color(0xFF102C35))),
                    const SizedBox(height: 5),
                    Text(detail,
                        style: const TextStyle(
                            fontSize: 12, color: Color(0xFF66817B))),
                  ]),
            ),
          ),
        ),
      );
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.icon});
  final String label;
  final String value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Container(
        width: 175,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: const Color(0xFF087E6A)),
          const SizedBox(height: 12),
          Text(value,
              style: const TextStyle(
                  fontSize: 23,
                  fontWeight: FontWeight.w900,
                  color: Color(0xFF102C35))),
          Text(label,
              style: const TextStyle(fontSize: 12, color: Color(0xFF66817B))),
        ]),
      );
}

class _ExecutiveSkeleton extends StatelessWidget {
  const _ExecutiveSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(22),
        children: List.generate(
            7,
            (_) => Container(
                  height: 62,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14)),
                )),
      );
}

class _Failure extends StatelessWidget {
  const _Failure({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.cloud_off_outlined,
              size: 42, color: Color(0xFF66817B)),
          const SizedBox(height: 12),
          Text(message),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: retry, child: const Text('Retry')),
        ]),
      );
}
