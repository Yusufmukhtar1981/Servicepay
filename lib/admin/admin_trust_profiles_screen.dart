import 'package:flutter/material.dart';

import '../trust/trust_api_service.dart';
import '../trust/trust_models.dart';
import '../trust/trust_profile_screen.dart';

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
            foregroundColor: Colors.white),
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
