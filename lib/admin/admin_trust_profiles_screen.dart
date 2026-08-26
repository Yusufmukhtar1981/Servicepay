import 'package:flutter/material.dart';

import '../trust/trust_api_service.dart';
import '../trust/trust_models.dart';
import '../trust/trust_profile_screen.dart';
import '../trust/trust_deals_screen.dart';

class AdminTrustProfilesScreen extends StatefulWidget {
  const AdminTrustProfilesScreen({super.key});
  @override
  State<AdminTrustProfilesScreen> createState() =>
      _AdminTrustProfilesScreenState();
}

class _AdminTrustProfilesScreenState extends State<AdminTrustProfilesScreen> {
  final TextEditingController _search = TextEditingController();
  List<TrustProfile> _profiles = <TrustProfile>[];
  String? _error;
  bool _loading = true;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<TrustProfile> result =
          await TrustApiService.adminProfiles(query: _search.text);
      if (mounted) {
        setState(() => _profiles = result);
      }
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF5F7FA),
        appBar: AppBar(
            title: const Text('Trust Profiles'),
            backgroundColor: const Color(0xFF08783E),
            foregroundColor: Colors.white,
            actions: <Widget>[
              IconButton(
                tooltip: 'Protected deals and disputes',
                icon: const Icon(Icons.account_balance_outlined),
                onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                        builder: (_) => const AdminTrustDealsScreen())),
              )
            ]),
        body: Column(children: <Widget>[
          Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _search,
                onSubmitted: (_) => _load(),
                decoration: InputDecoration(
                    hintText: 'Search profiles',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: IconButton(
                        onPressed: _load, icon: const Icon(Icons.search)),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide.none)),
              )),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.all(16),
                child:
                    Text(_error!, style: const TextStyle(color: Colors.red))),
          Expanded(
              child: !_loading && _profiles.isEmpty
                  ? const Center(child: Text('No trust profiles found.'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                          itemCount: _profiles.length,
                          itemBuilder: (_, int index) {
                            final TrustProfile p = _profiles[index];
                            return Card(
                                margin: const EdgeInsets.symmetric(
                                    horizontal: 16, vertical: 5),
                                child: ListTile(
                                  leading: CircleAvatar(
                                      backgroundColor: const Color(0xFFEAF7F0),
                                      child:
                                          Text(p.displayName.substring(0, 1))),
                                  title: Text(p.displayName),
                                  subtitle: Text(
                                      '${p.servicePayId} • ${p.trustLevel}'),
                                  trailing: p.restricted
                                      ? const Icon(Icons.warning_amber_rounded,
                                          color: Colors.orange)
                                      : const Icon(Icons.chevron_right),
                                  onTap: () => Navigator.push(
                                      context,
                                      MaterialPageRoute<void>(
                                          builder: (_) => TrustProfileScreen(
                                              servicePayId: p.servicePayId,
                                              isAdminView: true))),
                                ));
                          }),
                    )),
        ]),
      );
}

class AdminTrustDealsScreen extends StatefulWidget {
  const AdminTrustDealsScreen({super.key});
  @override
  State<AdminTrustDealsScreen> createState() => _AdminTrustDealsScreenState();
}

class _AdminTrustDealsScreenState extends State<AdminTrustDealsScreen> {
  List<TrustDeal> _deals = <TrustDeal>[];
  List<TrustDispute> _disputes = <TrustDispute>[];
  String? _error;
  bool _loading = true;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<dynamic> results =
          await Future.wait<dynamic>(<Future<dynamic>>[
        TrustApiService.adminDeals(),
        TrustApiService.adminDisputes(),
      ]);
      _deals = results[0] as List<TrustDeal>;
      _disputes = results[1] as List<TrustDispute>;
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _resolve(TrustDispute dispute, String resolution) async {
    final TextEditingController note = TextEditingController();
    final bool? ok = await showDialog<bool>(
        context: context,
        builder: (BuildContext c) => AlertDialog(
                title: Text(
                    '${resolution == 'RELEASE' ? 'Release' : 'Refund'} funds?'),
                content: TextField(
                    controller: note,
                    maxLines: 3,
                    decoration:
                        const InputDecoration(labelText: 'Resolution note')),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(c, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, true),
                      child:
                          Text(resolution == 'RELEASE' ? 'Release' : 'Refund'))
                ]));
    if (ok == true) {
      final String cleanNote = note.text.trim();
      if (cleanNote.length < 5) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text(
                  'Enter an internal resolution note of at least 5 characters.')));
        }
        note.dispose();
        return;
      }
      try {
        await TrustApiService.adminResolveDispute(
            dispute.id, resolution, cleanNote);
        if (mounted) _load();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(e.toString().replaceFirst('Exception: ', ''))));
        }
      }
    }
    note.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF5F7FA),
        appBar: AppBar(
            title: const Text('Trust deals & disputes'),
            backgroundColor: const Color(0xFF08783E),
            foregroundColor: Colors.white),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                        Text(_error!),
                        TextButton(
                            onPressed: _load, child: const Text('Try again'))
                      ]))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: <Widget>[
                          const Text('Protected deals',
                              style: TextStyle(
                                  fontSize: 19, fontWeight: FontWeight.bold)),
                          if (_deals.isEmpty)
                            const Padding(
                                padding: EdgeInsets.all(16),
                                child: Text('No protected deals found.')),
                          ..._deals.map((TrustDeal deal) => Card(
                                  child: ExpansionTile(
                                title: Text(deal.title),
                                subtitle: Text(
                                    '${deal.status.replaceAll('_', ' ')} • ₦${deal.amount.toStringAsFixed(2)}'),
                                children: <Widget>[
                                  ListTile(
                                      title: const Text('Participants'),
                                      subtitle: Text(
                                          '${deal.buyerName} / ${deal.sellerName}')),
                                  ListTile(
                                      title: const Text('Deal ID'),
                                      subtitle: Text(deal.id)),
                                  OverflowBar(children: <Widget>[
                                    TextButton(
                                        onPressed: () => Navigator.push(
                                            context,
                                            MaterialPageRoute<void>(
                                                builder: (_) =>
                                                    TrustDealDetailScreen(
                                                        deal: deal))),
                                        child: const Text('Inspect'))
                                  ])
                                ],
                              ))),
                          const SizedBox(height: 16),
                          const Text('Disputes',
                              style: TextStyle(
                                  fontSize: 19, fontWeight: FontWeight.bold)),
                          if (_disputes.isEmpty)
                            const Padding(
                                padding: EdgeInsets.all(16),
                                child: Text('No disputes found.')),
                          ..._disputes.map((TrustDispute d) => Card(
                                  child: ListTile(
                                leading: const Icon(Icons.report_outlined,
                                    color: Colors.orange),
                                title: Text(d.reason),
                                subtitle: Text(
                                    '${d.status} • ${d.details ?? 'No details provided'}'
                                    '${d.evidenceReferences.isEmpty ? '' : ' • ${d.evidenceReferences.length} evidence reference(s)'}'),
                                trailing: d.isOpen
                                    ? Wrap(spacing: 4, children: <Widget>[
                                        TextButton(
                                            onPressed: () =>
                                                _resolve(d, 'RELEASE'),
                                            child: const Text('Release')),
                                        TextButton(
                                            onPressed: () =>
                                                _resolve(d, 'REFUND'),
                                            child: const Text('Refund')),
                                      ])
                                    : Text(d.id),
                              ))),
                        ])),
      );
}
