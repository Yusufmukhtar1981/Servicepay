import 'package:flutter/material.dart';

import 'trust_api_service.dart';
import 'trust_models.dart';
import 'trust_deals_screen.dart';

class TrustProfileScreen extends StatefulWidget {
  const TrustProfileScreen({
    super.key,
    this.servicePayId,
    this.isOwnProfile = false,
    this.isAdminView = false,
    this.initialProfile,
  });

  final String? servicePayId;
  final bool isOwnProfile;
  final bool isAdminView;
  final TrustProfile? initialProfile;

  @override
  State<TrustProfileScreen> createState() => _TrustProfileScreenState();
}

class _TrustProfileScreenState extends State<TrustProfileScreen> {
  TrustProfile? _profile;
  String? _error;
  bool _loading = true;
  bool _savingDiscoverability = false;
  static const Color _green = Color(0xFF08783E);

  @override
  void initState() {
    super.initState();
    if (widget.initialProfile != null) {
      _profile = widget.initialProfile;
      _loading = false;
    } else {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final TrustProfile profile;
      if (widget.isOwnProfile) {
        profile = await TrustApiService.getMyProfile();
      } else if (widget.isAdminView) {
        profile = await TrustApiService.adminProfile(widget.servicePayId!);
      } else {
        profile = await TrustApiService.getProfile(widget.servicePayId!);
      }
      if (mounted) {
        setState(() => _profile = profile);
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

  Future<void> _setDiscoverable(bool value) async {
    setState(() => _savingDiscoverability = true);
    try {
      final TrustProfile updated =
          await TrustApiService.updateDiscoverability(value);
      if (mounted) setState(() => _profile = updated);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(error.toString().replaceFirst('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted) setState(() => _savingDiscoverability = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final TrustProfile? profile = _profile;
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: Text(widget.isOwnProfile ? 'My Trust Profile' : 'Trust Profile'),
        backgroundColor: _green,
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _errorView()
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: <Widget>[
                        _hero(profile!),
                        const SizedBox(height: 16),
                        _verificationCard(profile),
                        const SizedBox(height: 16),
                        _statsCard(profile),
                        if (widget.isAdminView) ...<Widget>[
                          const SizedBox(height: 16),
                          _adminReviewCard(profile),
                        ],
                        if (widget.isOwnProfile) ...<Widget>[
                          const SizedBox(height: 16),
                          _discoverabilityCard(profile),
                        ],
                        const SizedBox(height: 20),
                        SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              style: FilledButton.styleFrom(
                                  backgroundColor: _green,
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 15)),
                              onPressed: () => Navigator.push(
                                  context,
                                  MaterialPageRoute<void>(
                                      builder: (_) =>
                                          const TrustDealsScreen())),
                              icon: const Icon(Icons.handshake_outlined),
                              label: const Text('VIEW PROTECTED DEALS'),
                            )),
                        const SizedBox(height: 12),
                        const Text(
                            'Trust information helps you make a more informed decision. It is not a guarantee against fraud.',
                            style:
                                TextStyle(color: Colors.black54, fontSize: 12)),
                      ]),
                ),
    );
  }

  Widget _errorView() => Center(
          child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
          const Icon(Icons.error_outline, size: 42, color: Colors.redAccent),
          const SizedBox(height: 12),
          Text(_error!, textAlign: TextAlign.center),
          const SizedBox(height: 14),
          OutlinedButton(onPressed: _load, child: const Text('Try Again')),
        ]),
      ));

  Widget _hero(TrustProfile p) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
            color: _green, borderRadius: BorderRadius.circular(20)),
        child: Column(children: <Widget>[
          CircleAvatar(
              radius: 36,
              backgroundColor: Colors.white24,
              backgroundImage: p.profilePhotoUrl == null
                  ? null
                  : NetworkImage(p.profilePhotoUrl!),
              child: p.profilePhotoUrl == null
                  ? Text(p.displayName.substring(0, 1).toUpperCase(),
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 28,
                          fontWeight: FontWeight.bold))
                  : null),
          const SizedBox(height: 10),
          Text(p.displayName,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 21,
                  fontWeight: FontWeight.bold)),
          if (p.businessName != null)
            Text(p.businessName!,
                style: const TextStyle(color: Colors.white70)),
          const SizedBox(height: 7),
          Text(p.servicePayId,
              style: const TextStyle(
                  color: Colors.white70, fontWeight: FontWeight.w600)),
          const SizedBox(height: 14),
          Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
              decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .16),
                  borderRadius: BorderRadius.circular(20)),
              child: Text(
                  '${p.trustLevel} • Trust score ${p.trustScore.toStringAsFixed(0)}',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w700))),
          if (p.restricted) ...<Widget>[
            const SizedBox(height: 10),
            const Text('This profile has restrictions.',
                style: TextStyle(color: Color(0xFFFFE0E0))),
          ],
        ]),
      );

  Widget _verificationCard(TrustProfile p) => _card(
      'Verification',
      Column(children: <Widget>[
        _check('Identity verified', p.identityVerified),
        _check('Business verified', p.businessVerified),
        _check('Account ownership verified', p.accountOwnershipVerified),
        if (p.maskedPhone != null) _detail('Phone', p.maskedPhone!),
        if (p.memberSince != null)
          _detail('Member since',
              '${p.memberSince!.day}/${p.memberSince!.month}/${p.memberSince!.year}'),
      ]));
  Widget _statsCard(TrustProfile p) => _card(
      'Protected activity',
      Column(children: <Widget>[
        _detail('Protected transactions', '${p.protectedTransactionsCount}'),
        _detail('Protected trade volume',
            '₦${p.protectedTradeVolume.toStringAsFixed(2)}'),
        _detail('Completion rate', '${p.completionRate.toStringAsFixed(1)}%'),
        _detail('Disputes resolved',
            '${p.resolvedDisputesCount} of ${p.disputesCount}'),
      ]));
  Widget _discoverabilityCard(TrustProfile p) => _card(
      'Profile discoverability',
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        activeTrackColor: _green,
        title: const Text('Appear in Trust search',
            style: TextStyle(fontWeight: FontWeight.w700)),
        subtitle: const Text('Let people find your ServicePay Trust profile.'),
        value: p.discoverable,
        onChanged: _savingDiscoverability ? null : _setDiscoverable,
      ));
  Widget _adminReviewCard(TrustProfile p) => _card(
      'Admin review',
      Column(children: <Widget>[
        _detail('Discoverability', p.discoverable ? 'Discoverable' : 'Hidden'),
        _detail('Account status', p.accountStatus ?? 'Unknown'),
        _detail(
            'Last score calculation',
            p.lastCalculatedAt == null
                ? 'Not calculated'
                : '${p.lastCalculatedAt!.day}/${p.lastCalculatedAt!.month}/'
                    '${p.lastCalculatedAt!.year}'),
        _detail(
            'Account active', _scoreInputBool(p.scoreInputs['accountActive'])),
        _detail(
            'Account age', '${p.scoreInputs['accountAgeMonths'] ?? 0} months'),
        _detail('KYC verified', _scoreInputBool(p.scoreInputs['kycVerified'])),
        _detail('KYC tier', '${p.scoreInputs['kycTier'] ?? 'Not available'}'),
        _detail('Successful identity checks',
            '${p.scoreInputs['successfulIdentityVerifications'] ?? 0}'),
        if (p.restricted)
          _detail('Restriction reason',
              p.restrictionReason ?? 'No reason was provided'),
      ]));
  String _scoreInputBool(dynamic value) => value == true ? 'Yes' : 'No';
  Widget _card(String title, Widget child) => Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title,
                style:
                    const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
            const SizedBox(height: 10),
            child,
          ]));
  Widget _check(String label, bool value) => ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Icon(value ? Icons.verified_rounded : Icons.cancel_outlined,
          color: value ? _green : Colors.grey),
      title: Text(label),
      trailing: Text(value ? 'Verified' : 'Not verified',
          style: TextStyle(color: value ? _green : Colors.grey)));
  Widget _detail(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(children: <Widget>[
        Expanded(
            child: Text(label, style: const TextStyle(color: Colors.black54))),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w700))
      ]));
}
