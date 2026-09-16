import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'edupay_api.dart';

class EduPayScreen extends StatefulWidget {
  const EduPayScreen({super.key});
  @override
  State<EduPayScreen> createState() => _EduPayScreenState();
}

class _EduPayScreenState extends State<EduPayScreen> {
  final api = EduPayApi();
  int tab = 0;
  bool loading = true;
  String? error;
  Map<String, dynamic> dash = {};
  List<dynamic> plans = [], children = [], repayments = [], schools = [];

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
        api.dashboard(),
        api.plans(),
        api.children(),
        api.repayments(),
        api.schools(),
      ]);
      if (!mounted) return;
      setState(() {
        dash = values[0] as Map<String, dynamic>;
        plans = values[1] as List;
        children = values[2] as List;
        repayments = values[3] as List;
        schools = values[4] as List;
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
                  children: [_home(), _plans(), _children(), _repayments()],
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
            label: 'Children',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: 'Repayments',
          ),
        ],
      ),
    );
  }

  Widget _home() {
    final s = (dash['summary'] as Map?)?.cast<String, dynamic>() ?? {};
    final settings = (dash['settings'] as Map?)?.cast<String, dynamic>() ?? {};
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
            () => _newPlan(),
          ),
          _action(
            'Add money to a plan',
            'Keep a plan moving from your wallet.',
            Icons.account_balance_wallet_outlined,
            () => setState(() => tab = 1),
          ),
          if (settings['enabled'] == false)
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
        'My plans',
        plans,
        'No plans yet',
        Icons.savings_outlined,
        (p) => _planDetail(p),
      );
  Widget _children() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _sectionTitle('My children'),
              IconButton(
                onPressed: _newChild,
                icon: const Icon(Icons.add_circle, color: Color(0xff0c6b51)),
              ),
            ],
          ),
          if (children.isEmpty)
            const _Empty(
              'Add a child when you are ready to build their school-fee plan.',
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
    return Card(
      child: ListTile(
        onTap: () => tap(p),
        leading: const CircleAvatar(
          backgroundColor: Color(0xffdcefe8),
          child: Icon(Icons.school, color: Color(0xff0c6b51)),
        ),
        title: Text('$child'),
        subtitle: Text('${school ?? ''}\n${p['status'] ?? 'ACTIVE'}'),
        isThreeLine: true,
        trailing: Text(
          _money(p['officialFee'] ?? p['amountRemaining'] ?? p['totalAmount']),
        ),
      ),
    );
  }

  Widget _childTile(Map c) => Card(
        child: ListTile(
          leading: const CircleAvatar(child: Icon(Icons.person_outline)),
          title: Text('${c['fullName'] ?? 'Child'}'),
          subtitle: Text(
            c['school'] is Map ? '${c['school']['name']}' : 'School not listed',
          ),
        ),
      );
  Future<void> _newChild() async {
    final name = TextEditingController();
    final result = await _formDialog('Add a child', [
      TextField(
        controller: name,
        decoration: const InputDecoration(labelText: 'Full name'),
      ),
    ]);
    if (result == true && name.text.trim().isNotEmpty) {
      try {
        await api.createChild({
          'fullName': name.text.trim(),
          'school': schools.isNotEmpty ? schools.first['_id'] : '',
        });
        load();
      } catch (e) {
        _snack(e.toString());
      }
    }
  }

  Future<void> _newPlan() async {
    if (schools.isEmpty) {
      _snack('No approved schools are available yet.');
      return;
    }
    final child = children.isNotEmpty ? children.first : null;
    if (child == null) {
      _snack('Add a child before starting a plan.');
      return;
    }
    final school = schools.first as Map;
    final fees = await api.fees('${school['_id']}');
    if (!mounted || fees.isEmpty) {
      _snack('This school has no approved fee for the selected cycle.');
      return;
    }
    final fee = fees.first as Map;
    final date = TextEditingController();
    final ok = await _formDialog('Settle by', [
      TextField(
        controller: date,
        decoration: const InputDecoration(
          labelText: 'Target date (YYYY-MM-DD)',
        ),
        keyboardType: TextInputType.datetime,
      ),
    ]);
    if (ok == true && date.text.isNotEmpty) {
      try {
        await api.createPlan({
          'child': child['_id'],
          'school': school['_id'],
          'session':
              fee['session'] is Map ? fee['session']['_id'] : fee['session'],
          'term': fee['term'] is Map ? fee['term']['_id'] : fee['term'],
          'classLevel': fee['classLevel'] is Map
              ? fee['classLevel']['_id']
              : fee['classLevel'],
          'feeStructure': fee['_id'],
          'targetDate': date.text,
          'savingFrequency': 'MONTHLY',
        });
        load();
        _snack('Your EduPay plan is ready.');
      } catch (e) {
        _snack(e.toString());
      }
    }
  }

  Future<void> _planDetail(Map p) async {
    final id = (p['_id'] ?? p['id']).toString();
    final d = await api.plan(id);
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => EduPayPlanDetail(api: api, data: d, onChanged: load),
      ),
    );
  }

  Future<void> _repaymentDetail(Map r) async {
    final id = (r['_id'] ?? r['id']).toString();
    final pin = await _pinDialog('Pay repayment');
    if (pin == null) return;
    final amount = double.tryParse(
      (r['amountRemaining'] ?? r['totalAmount'] ?? 0).toString(),
    );
    if (amount == null) return;
    try {
      await api.repay(id, amount, pin);
      load();
      _snack('Payment submitted successfully.');
    } catch (e) {
      _snack(e.toString());
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
    return showDialog<String>(
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
  });
  final EduPayApi api;
  final Map<String, dynamic> data;
  final VoidCallback onChanged;
  @override
  State<EduPayPlanDetail> createState() => _EduPayPlanDetailState();
}

class _EduPayPlanDetailState extends State<EduPayPlanDetail> {
  String money(dynamic v) {
    final n = v is num ? v : double.tryParse('$v') ?? 0;
    return '₦${n.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.data['plan'] as Map? ?? {};
    final child =
        p['child'] is Map ? p['child']['fullName'] : 'School-fee plan';
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
                  Text('Status  ·  ${p['status'] ?? 'ACTIVE'}'),
                  Text('Target date  ·  ${p['targetDate'] ?? 'Not set'}'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: () async {
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
              if (ok != true) return;
              final pin = await showDialog<String>(
                context: context,
                builder: (_) {
                  final p = TextEditingController();
                  return AlertDialog(
                    title: const Text('Confirm contribution'),
                    content: TextField(
                      controller: p,
                      obscureText: true,
                      maxLength: 4,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Transaction PIN',
                      ),
                    ),
                    actions: [
                      FilledButton(
                        onPressed: () => Navigator.pop(context, p.text),
                        child: const Text('Confirm'),
                      ),
                    ],
                  );
                },
              );
              final amount = double.tryParse(c.text);
              if (pin != null && amount != null) {
                try {
                  await widget.api.contribute(
                    '${p['_id'] ?? p['id']}',
                    amount,
                    pin,
                  );
                  widget.onChanged();
                  if (mounted)
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Contribution submitted successfully.'),
                      ),
                    );
                } catch (e) {
                  if (mounted)
                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(SnackBar(content: Text(e.toString())));
                }
              }
            },
            icon: const Icon(Icons.add),
            label: const Text('Add money from wallet'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () async {
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
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                    content: Text(
                        enabled ? 'Autosave paused.' : 'Autosave resumed.'),
                  ));
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context)
                      .showSnackBar(SnackBar(content: Text(e.toString())));
                }
              }
            },
            icon: const Icon(Icons.autorenew_rounded),
            label: Text(p['autosave'] is Map && p['autosave']['enabled'] == true
                ? 'Pause autosave'
                : 'Resume autosave'),
          ),
        ],
      ),
    );
  }
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
