import 'package:flutter/material.dart';
import 'svp_api_service.dart';

class SvpAuditScreen extends StatefulWidget {
  const SvpAuditScreen({super.key, this.headOffice = false});
  final bool headOffice;
  @override
  State<SvpAuditScreen> createState() => _SvpAuditScreenState();
}

class _SvpAuditScreenState extends State<SvpAuditScreen> {
  final api = SvpApiService();
  List<dynamic> logs = const [];
  bool loading = true;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final r = await api.request(
          'GET', widget.headOffice ? '/svp/audit' : '/svp/me/audit');
      if (mounted) {
        setState(() {
          logs = (r['data'] as List?) ?? const [];
          loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(
          title: Text(widget.headOffice ? 'SVP Audit Logs' : 'My Audit Trail'),
          actions: [
            IconButton(onPressed: load, icon: const Icon(Icons.refresh))
          ]),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : logs.isEmpty
              ? const Center(child: Text('No audit events in this view.'))
              : ListView(
                  children: logs
                      .map((x) => Card(
                          elevation: 0,
                          margin: const EdgeInsets.fromLTRB(16, 6, 16, 0),
                          child: ListTile(
                              leading: const Icon(Icons.history,
                                  color: Color(0xFF087E6A)),
                              title: Text('${x['action'] ?? 'Event'}',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w700)),
                              subtitle: Text(
                                  '${x['reason'] ?? ''}\n${x['requestPath'] ?? ''}'),
                              isThreeLine: true,
                              trailing: Text('${x['actorRole'] ?? ''}'))))
                      .toList()));
}
