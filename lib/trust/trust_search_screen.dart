import 'package:flutter/material.dart';

import 'trust_api_service.dart';
import 'trust_models.dart';
import 'trust_profile_screen.dart';

class TrustSearchScreen extends StatefulWidget {
  const TrustSearchScreen({super.key});
  @override
  State<TrustSearchScreen> createState() => _TrustSearchScreenState();
}

class _TrustSearchScreenState extends State<TrustSearchScreen> {
  final TextEditingController _controller = TextEditingController();
  String _kind = 'phone';
  List<TrustProfile> _profiles = <TrustProfile>[];
  String? _error;
  bool _loading = false;
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    if (_controller.text.trim().isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<TrustProfile> profiles = await TrustApiService.searchProfiles(
          query: _controller.text, kind: _kind);
      if (mounted) setState(() => _profiles = profiles);
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
          title: const Text('ServicePay Trust'),
          backgroundColor: const Color(0xFF08783E),
          foregroundColor: Colors.white,
          actions: <Widget>[
            IconButton(
              tooltip: 'My Trust Profile',
              icon: const Icon(Icons.person_outline_rounded),
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) => const TrustProfileScreen(isOwnProfile: true),
                ),
              ),
            ),
          ],
        ),
        body: Column(children: <Widget>[
          Padding(
              padding: const EdgeInsets.all(16),
              child: Column(children: <Widget>[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF7F0),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Verify Before You Pay',
                        style: TextStyle(
                          color: Color(0xFF08783E),
                          fontWeight: FontWeight.w800,
                          fontSize: 18,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Search a discoverable ServicePay member or business '
                        'before you decide who to pay.',
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                    controller: _controller,
                    onSubmitted: (_) => _search(),
                    decoration: InputDecoration(
                        hintText: 'Search by phone, Trust ID, or business name',
                        prefixIcon: const Icon(Icons.search),
                        suffixIcon: IconButton(
                            onPressed: _search,
                            icon: const Icon(Icons.arrow_forward)),
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: BorderSide.none))),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                    value: _kind,
                    decoration: const InputDecoration(labelText: 'Search by'),
                    items: const <DropdownMenuItem<String>>[
                      DropdownMenuItem(
                          value: 'phone', child: Text('Phone number')),
                      DropdownMenuItem(
                          value: 'servicepay_id', child: Text('ServicePay ID')),
                      DropdownMenuItem(
                          value: 'business_name', child: Text('Business name')),
                    ],
                    onChanged: (String? value) =>
                        setState(() => _kind = value!)),
              ])),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.all(16),
                child:
                    Text(_error!, style: const TextStyle(color: Colors.red))),
          Expanded(
              child: _profiles.isEmpty && !_loading
                  ? const Center(
                      child: Text('Search for a ServicePay Trust profile.'))
                  : ListView.builder(
                      itemCount: _profiles.length,
                      itemBuilder: (_, int index) {
                        final TrustProfile p = _profiles[index];
                        return Card(
                            margin: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 5),
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 14, vertical: 6),
                              leading: CircleAvatar(
                                backgroundColor: const Color(0xFFEAF7F0),
                                backgroundImage: p.profilePhotoUrl == null
                                    ? null
                                    : NetworkImage(p.profilePhotoUrl!),
                                child: p.profilePhotoUrl == null
                                    ? Text(p.displayName.substring(0, 1))
                                    : null,
                              ),
                              title: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  Text(p.displayName),
                                  const SizedBox(height: 3),
                                  Wrap(
                                    spacing: 6,
                                    runSpacing: 3,
                                    children: <Widget>[
                                      _levelBadge(p.trustLevel),
                                      if (p.identityVerified)
                                        _verificationBadge('Identity'),
                                      if (p.businessVerified)
                                        _verificationBadge('Business'),
                                    ],
                                  ),
                                ],
                              ),
                              subtitle: Padding(
                                padding: const EdgeInsets.only(top: 7),
                                child: Text(
                                  [
                                    if (p.businessName != null) p.businessName!,
                                    p.maskedPhone ?? p.servicePayId,
                                  ].join(' • '),
                                ),
                              ),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute<void>(
                                      builder: (_) => TrustProfileScreen(
                                          servicePayId: p.servicePayId))),
                            ));
                      })),
        ]),
      );

  Widget _levelBadge(String level) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF7F0),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          level.replaceAll('_', ' '),
          style: const TextStyle(
            color: Color(0xFF08783E),
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      );

  Widget _verificationBadge(String label) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color: Colors.green.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          '✓ $label',
          style: const TextStyle(
            color: Color(0xFF08783E),
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
}
