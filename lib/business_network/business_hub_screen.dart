import 'dart:convert';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../servicepay_theme.dart';
import '../airtime_screen.dart';
import '../cable_screen.dart';
import '../data_screen.dart';
import '../electricity_screen.dart';
import '../referral_screen.dart';
import '../referral_service.dart';
import '../services/receipt_download.dart';
import 'business_network_api.dart';
import 'business_feature_access_panel.dart';
import 'business_transaction_record_screen.dart';

part 'business_hub_application_form.dart';
part 'business_hub_premium.dart';

class BusinessHubScreen extends StatefulWidget {
  const BusinessHubScreen({super.key, this.api});
  final BusinessNetworkApi? api;

  @override
  State<BusinessHubScreen> createState() => _BusinessHubScreenState();
}

class _BusinessHubScreenState extends State<BusinessHubScreen>
    with WidgetsBindingObserver {
  late final BusinessNetworkApi _api = widget.api ?? BusinessNetworkApi();
  Map<String, dynamic>? _me;
  String? _error;
  bool _loading = true;
  int _meRevision = 0;
  String _view = 'hub';
  String _kind = 'AGENT';
  String? _selectedProfileId;
  Map<String, dynamic>? _selectedMembership;
  Timer? _approvalRefresh;
  int _meRequest = 0;
  Future<bool>? _meFuture;
  bool _foregroundRefreshRequired = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadMe();
  }

  @override
  void dispose() {
    _approvalRefresh?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    if (widget.api == null) _api.close();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      _approvalRefresh?.cancel();
      _approvalRefresh = null;
      if (!_foregroundRefreshRequired) _meRequest++;
      _foregroundRefreshRequired = true;
    }
    // An earlier request may still be waiting after backgrounding. A fresh
    // foreground read supersedes it; _meRequest prevents stale access restoring.
    if (state == AppLifecycleState.resumed &&
        mounted &&
        _foregroundRefreshRequired) {
      _foregroundRefreshRequired = false;
      _fetchMe(supersede: true);
    }
  }

  void _scheduleApprovalRefresh() {
    _approvalRefresh?.cancel();
    _approvalRefresh = null;
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    final applications = _me?['applications'];
    if (!mounted ||
        (lifecycle != null && lifecycle != AppLifecycleState.resumed) ||
        applications is! List ||
        !applications.any((row) => row is Map &&
            ['SUBMITTED', 'UNDER_REVIEW'].contains(row['status']))) {
      return;
    }
    _approvalRefresh = Timer(const Duration(seconds: 20), () {
      if (mounted && !_loading) _fetchMe();
    });
  }

  Future<void> _loadMe() async {
    await _fetchMe();
  }

  Future<bool> _fetchMe({bool supersede = false}) {
    if (!supersede && _meFuture != null) return _meFuture!;
    final future = _performMeFetch();
    _meFuture = future;
    future.whenComplete(() {
      if (identical(_meFuture, future)) _meFuture = null;
    });
    return future;
  }

  Future<bool> _performMeFetch() async {
    final request = ++_meRequest;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.get('me');
      if (mounted && request == _meRequest) {
        setState(() {
          _me = Map<String, dynamic>.from(data as Map);
          _meRevision++;
          if (_view == 'dashboard' && _selectedProfileId != null) {
            final refreshedCandidates = _dashboardCandidates(_kind).where(
                (candidate) => _profileId(candidate) == _selectedProfileId);
            final refreshedSelection =
                refreshedCandidates.isEmpty ? null : refreshedCandidates.first;
            if (refreshedSelection == null) {
              _view = 'hub';
              _selectedMembership = null;
              _selectedProfileId = null;
              _error = 'Selected business access is no longer available.';
            } else {
              _selectedMembership = refreshedSelection;
              _selectedProfileId = _profileId(refreshedSelection);
            }
          }
          _loading = false;
        });
        _scheduleApprovalRefresh();
      }
      return mounted && request == _meRequest;
    } catch (e) {
      if (mounted && request == _meRequest) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
        _scheduleApprovalRefresh();
      }
      return false;
    }
  }

  void _open(String view, {String? kind}) {
    setState(() {
      _view = view;
      if (view != 'dashboard') {
        _selectedMembership = null;
        _selectedProfileId = null;
      }
      if (kind != null) _kind = kind;
    });
  }

  @override
  Widget build(BuildContext context) {
    final title = _view == 'hub'
        ? 'Business Hub'
        : _view == 'application'
            ? 'Business application'
            : _view == 'dashboard'
                ? 'Business dashboard'
                : _view == 'support'
                    ? 'Business support'
                    : _view == 'applications'
                        ? 'My applications'
                        : 'Business';
    return Scaffold(
      backgroundColor: ServicePayColors.canvas,
      appBar: AppBar(
        backgroundColor: ServicePayColors.canvas,
        foregroundColor: ServicePayColors.accent,
        titleTextStyle: const TextStyle(
          color: ServicePayColors.accent,
          fontWeight: FontWeight.w800,
        ),
        iconTheme: const IconThemeData(color: ServicePayColors.accent),
        actionsIconTheme: const IconThemeData(color: ServicePayColors.accent),
        title: Text(
          title,
          style: const TextStyle(
            color: ServicePayColors.accent,
            fontWeight: FontWeight.w800,
          ),
        ),
        leading: _view == 'hub'
            ? null
            : IconButton(
                onPressed: () => _open('hub'),
                icon: const Icon(
                  Icons.arrow_back,
                  color: ServicePayColors.accent,
                )),
        actions: [
          IconButton(
              onPressed: _loadMe,
              tooltip: 'Refresh',
              icon: const Icon(
                Icons.refresh,
                color: ServicePayColors.accent,
              ))
        ],
      ),
      body: _loading && _me == null
          ? const _BusinessLoading()
          : _error != null && _me == null
              ? _BusinessError(message: _error!, retry: _loadMe)
              : _view == 'application'
                  ? _ApplicationForm(
                      api: _api,
                      kind: _kind,
                      existing: _application(_kind),
                      customer: _me?['customer'] is Map
                          ? Map<String, dynamic>.from(_me!['customer'] as Map)
                          : const {},
                      categories: (_me?['categories'] as List? ?? const [])
                          .map((value) => value.toString())
                          .toList(),
                      supportedServices:
                          (_me?['supportedServices'] as List? ?? const [])
                              .map((value) => value.toString())
                              .toList(),
                      serviceCatalogue: _servicesForKind(_kind),
                      hasServiceCatalogue: _me?['serviceCatalogue'] is Map,
                      onKindChanged: (kind) => setState(() => _kind = kind),
                      onProfileSaved: _rememberApplication,
                      onSaved: _loadMe,
                    )
                  : _view == 'dashboard'
                      ? _BusinessDashboard(
                          api: _api,
                          kind: _kind,
                          profile: _selectedMembership ?? _membership(_kind),
                          profileId: _profileId(
                              _selectedMembership ?? _membership(_kind)),
                          owner: _isOwner(
                              _selectedMembership ?? _membership(_kind)),
                          ownApprovedBusinessKind:
                              _ownApprovedBusinessKind(_kind),
                          meRevision: _meRevision,
                          lookupError: _error,
                          onRefreshMe: _fetchMe,
                        )
                      : _view == 'applications'
                          ? _ApplicationsView(
                              applications:
                                  (_me?['applications'] as List? ?? const [])
                                      .whereType<Map>()
                                      .toList())
                          : _view == 'support'
                              ? _SupportForm(api: _api)
                              : _hubBody(),
    );
  }

  Map<String, dynamic>? _application(String kind) {
    for (final raw in (_me?['applications'] as List? ?? const [])) {
      if (raw is Map && raw['kind']?.toString().toUpperCase() == kind) {
        return Map<String, dynamic>.from(raw);
      }
    }
    return null;
  }

  List<Map<String, dynamic>> _servicesForKind(String kind) {
    final catalogue = _me?['serviceCatalogue'];
    final services = catalogue is Map ? catalogue[kind] : null;
    if (services is! List) return const [];
    return services
        .whereType<Map>()
        .map((service) => Map<String, dynamic>.from(service))
        .toList();
  }

  void _rememberApplication(Map<String, dynamic> profile) {
    final kind = profile['kind']?.toString().toUpperCase() ?? _kind;
    final applications = (_me?['applications'] as List? ?? const [])
        .whereType<Map>()
        .map((application) => Map<String, dynamic>.from(application))
        .where((application) =>
            application['kind']?.toString().toUpperCase() != kind)
        .toList();
    applications.add({...profile, 'kind': kind});
    setState(() {
      _me = {
        ...?_me,
        'applications': applications,
      };
    });
  }

  Map<String, dynamic>? _membership(String kind) {
    final ownerApplication = _ownerApplication(kind);
    if (ownerApplication != null) return ownerApplication;
    final memberships = (_me?['memberships'] as List? ?? const [])
        .whereType<Map>()
        .map((raw) => Map<String, dynamic>.from(raw))
        .where((membership) => _membershipMatchesKind(membership, kind))
        .toList();
    for (final membership in memberships) {
      if (_isOwner(membership)) return membership;
    }
    if (memberships.isNotEmpty) return memberships.first;
    return null;
  }

  Map<String, dynamic>? _ownerApplication(String kind) {
    final application = _application(kind);
    if (application == null) return null;
    return {
      'kind': kind,
      'profileId': application['_id'] ?? application['id'],
      'profile': application,
      'status': application['status'],
      'isOwner': true,
    };
  }

  List<Map<String, dynamic>> _dashboardCandidates(String kind) {
    final candidates = <Map<String, dynamic>>[];
    final ownerApplication = _ownerApplication(kind);
    if (ownerApplication != null) candidates.add(ownerApplication);
    for (final raw in (_me?['memberships'] as List? ?? const [])) {
      if (raw is! Map) continue;
      final membership = Map<String, dynamic>.from(raw);
      if (!_membershipMatchesKind(membership, kind)) continue;
      final id = _profileId(membership);
      if (candidates
          .any((candidate) => id != null && _profileId(candidate) == id)) {
        continue;
      }
      candidates.add(membership);
    }
    candidates.sort((a, b) {
      final aIsOwner = _isOwner(a);
      final bIsOwner = _isOwner(b);
      if (aIsOwner == bIsOwner) return 0;
      return aIsOwner ? -1 : 1;
    });
    return candidates;
  }

  Future<void> _openDashboard(String kind) async {
    if (!await _fetchMe() || !mounted) return;
    final candidates = _dashboardCandidates(kind);
    Map<String, dynamic>? selected;
    if (candidates.length == 1) {
      selected = candidates.first;
    } else if (candidates.length > 1) {
      selected = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('Choose a business'),
          children: candidates.map((candidate) {
            final profile = candidate['profile'] is Map
                ? Map<String, dynamic>.from(candidate['profile'] as Map)
                : candidate;
            final details = profile['details'] is Map
                ? Map<String, dynamic>.from(profile['details'] as Map)
                : const <String, dynamic>{};
            final businessName = details['businessName']?.toString();
            final networkId = profile['networkId']?.toString();
            final label = businessName?.isNotEmpty == true
                ? businessName!
                : networkId?.isNotEmpty == true
                    ? networkId!
                    : _profileId(candidate) ?? '$kind business';
            return SimpleDialogOption(
              onPressed: () => Navigator.pop(context, candidate),
              child: Text(
                '${_isOwner(candidate) ? 'My business' : 'Staff access'} · $label',
              ),
            );
          }).toList(),
        ),
      );
      if (selected == null) return;
    }
    if (selected != null && _profileId(selected) == null) {
      if (mounted) {
        setState(() {
          _error = 'Business details could not be matched to a profile.';
        });
      }
      return;
    }
    if (!mounted) return;
    setState(() {
      _selectedMembership = selected;
      _selectedProfileId = _profileId(selected);
      _kind = kind;
      _view = 'dashboard';
    });
  }

  bool _membershipMatchesKind(Map<String, dynamic> membership, String kind) {
    final profile = membership['profile'] is Map
        ? Map<String, dynamic>.from(membership['profile'] as Map)
        : const <String, dynamic>{};
    final membershipKind =
        (membership['kind'] ?? profile['kind'])?.toString().toUpperCase();
    if (membershipKind != null && membershipKind.isNotEmpty) {
      return membershipKind == kind;
    }
    // GET /me returns Merchant Staff documents with a populated profile but
    // does not include a top-level kind or the profile's kind in that populate.
    return kind == 'MERCHANT' && profile.isNotEmpty;
  }

  String? _profileId(Map<String, dynamic>? membership) {
    if (membership == null) return null;
    final profile = membership['profile'] is Map
        ? Map<String, dynamic>.from(membership['profile'] as Map)
        : const <String, dynamic>{};
    final id = membership['profileId'] ??
        membership['businessProfileId'] ??
        profile['_id'];
    return id?.toString();
  }

  bool _isOwner(Map<String, dynamic>? membership) {
    if (membership == null) return false;
    final role = (membership['role'] ??
            membership['membershipRole'] ??
            membership['accessLevel'] ??
            '')
        .toString()
        .toUpperCase();
    if (membership['isOwner'] == false ||
        membership['owner'] == false ||
        const {
          'STAFF',
          'BRANCH_STAFF',
          'EMPLOYEE',
          'MEMBER',
        }.contains(role)) {
      return false;
    }
    if (membership['isOwner'] == true ||
        membership['owner'] == true ||
        role == 'OWNER' ||
        role == 'BUSINESS_OWNER') {
      return true;
    }
    final profile = membership['profile'] is Map
        ? Map<String, dynamic>.from(membership['profile'] as Map)
        : const <String, dynamic>{};
    final customer = _me?['customer'] is Map
        ? Map<String, dynamic>.from(_me!['customer'] as Map)
        : const <String, dynamic>{};
    final ownerId = profile['owner'] ?? membership['ownerId'];
    final customerId = customer['_id'] ?? customer['id'];
    return ownerId != null &&
        customerId != null &&
        ownerId.toString() == customerId.toString();
  }

  String? _ownApprovedBusinessKind(String currentKind) {
    for (final kind in [
      currentKind,
      ...const ['AGENT', 'MERCHANT']
    ]) {
      final ownerProfile = _application(kind);
      if (ownerProfile?['status']?.toString().toUpperCase() == 'APPROVED') {
        return kind;
      }
      final legacyOwner = (_me?['memberships'] as List? ?? const [])
          .whereType<Map>()
          .map((raw) => Map<String, dynamic>.from(raw))
          .where((membership) =>
              _membershipMatchesKind(membership, kind) &&
              _isOwner(membership) &&
              (membership['status'] ??
                          (membership['profile'] is Map
                              ? (membership['profile'] as Map)['status']
                              : null))
                      ?.toString()
                      .toUpperCase() ==
                  'APPROVED');
      if (legacyOwner.isNotEmpty) return kind;
    }
    return null;
  }

  Future<void> _openMerchantDashboard() async {
    await _openDashboard('MERCHANT');
  }

  Widget _hubBody() {
    final customer = _me?['customer'] is Map
        ? Map<String, dynamic>.from(_me!['customer'] as Map)
        : <String, dynamic>{};
    return RefreshIndicator(
      onRefresh: _loadMe,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
                color: ServicePayColors.brand,
                borderRadius: BorderRadius.circular(24)),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Your next chapter,\nbuilt on ServicePay.',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 25,
                      height: 1.12,
                      fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              Text(
                  'Apply as a retail Agent or register your business. Your customer account stays yours.',
                  style: TextStyle(
                      color: Colors.white.withValues(alpha: .82),
                      height: 1.45)),
              const SizedBox(height: 16),
              Text(customer['fullName']?.toString() ?? 'Customer account',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w700)),
            ]),
          ),
          const SizedBox(height: 20),
          const _SectionLabel('GET STARTED'),
          const SizedBox(height: 9),
          _HubAction(
              icon: Icons.storefront_outlined,
              title: 'Become an Agent',
              detail: 'Serve customers with supported bill payments',
              onTap: () => _open('application', kind: 'AGENT')),
          _HubAction(
              icon: Icons.business_outlined,
              title: 'Register as a Merchant',
              detail: 'Manage your business profile and branches',
              onTap: () => _open('application', kind: 'MERCHANT')),
          const SizedBox(height: 16),
          const _SectionLabel('YOUR NETWORK'),
          const SizedBox(height: 9),
          _HubAction(
              icon: Icons.receipt_long_outlined,
              title: 'My Agent Dashboard',
              detail: _statusLabel(_membership('AGENT')),
              onTap: () => _openDashboard('AGENT')),
          _HubAction(
              icon: Icons.analytics_outlined,
              title: 'My Business Dashboard',
              detail: _statusLabel(_membership('MERCHANT')),
              onTap: _openMerchantDashboard),
          _HubAction(
              icon: Icons.assignment_outlined,
              title: 'Business Applications',
              detail: 'Review status and administrator feedback',
              onTap: () => _open('applications')),
          _HubAction(
              icon: Icons.support_agent_outlined,
              title: 'Business Support',
              detail: 'Send a question to the ServicePay team',
              onTap: () => _open('support')),
          ..._staffInvitations(),
          if (_me?['featureAccess'] is List &&
              (_me!['featureAccess'] as List).isNotEmpty) ...[
            const SizedBox(height: 18),
            BusinessFeatureAccessPanel(
              featureAccess: _me!['featureAccess'] as List,
              kind: 'CUSTOMER',
              title: 'Service availability',
            ),
          ],
          if (_error != null)
            Padding(
                padding: const EdgeInsets.only(top: 12),
                child: _InlineError(message: _error!, retry: _loadMe)),
        ],
      ),
    );
  }

  String _statusLabel(Map<String, dynamic>? profile) {
    if (profile == null) return 'Apply to unlock your dashboard';
    return (profile['status'] ?? 'Application in progress')
        .toString()
        .replaceAll('_', ' ');
  }

  List<Widget> _staffInvitations() {
    final invitations = (_me?['memberships'] as List? ?? const [])
        .whereType<Map>()
        .map((value) => Map<String, dynamic>.from(value))
        .where((membership) =>
            membership['status']?.toString().toUpperCase() == 'INVITED')
        .toList();
    if (invitations.isEmpty) return const [];
    return [
      const SizedBox(height: 16),
      const _SectionLabel('STAFF INVITATIONS'),
      ...invitations.map((invite) => _StaffInvitation(
            api: _api,
            invitation: invite,
            onAccepted: _loadMe,
          )),
    ];
  }
}

class _BusinessDashboard extends StatefulWidget {
  const _BusinessDashboard({
    required this.api,
    required this.kind,
    required this.profileId,
    required this.owner,
    required this.meRevision,
    required this.onRefreshMe,
    this.lookupError,
    this.profile,
    this.ownApprovedBusinessKind,
  });
  final BusinessNetworkApi api;
  final String kind;
  final String? profileId;
  final bool owner;
  final int meRevision;
  final Future<bool> Function() onRefreshMe;
  final String? lookupError;
  final Map<String, dynamic>? profile;
  final String? ownApprovedBusinessKind;
  @override
  State<_BusinessDashboard> createState() => _BusinessDashboardState();
}

class _BusinessDashboardState extends State<_BusinessDashboard> {
  String _period = 'month';
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _dashboard;
  List<dynamic> _transactions = [];
  Map<String, dynamic>? _commissions;
  List<dynamic> _eligible = [];
  int _transactionPage = 1;
  int _transactionTotal = 0;
  String _transactionStatus = 'ALL';
  static const int _commissionLimit = 50;
  int _commissionPage = 1;
  int _commissionTotal = 0;
  bool _eligibleLoaded = false;
  bool _refreshingMe = false;
  int _loadGeneration = 0;

  List<String> get _membershipPermissions =>
      (widget.profile?['permissions'] as List? ?? const [])
          .map((permission) => permission.toString().toLowerCase())
          .toList();

  bool get _canViewReports =>
      widget.owner || _membershipPermissions.contains('reports');

  bool get _canUsePayments =>
      widget.owner || _membershipPermissions.contains('payments');

  Map<String, dynamic>? get _profileMetadata {
    final profile = widget.profile?['profile'];
    if (profile is Map) return Map<String, dynamic>.from(profile);
    return widget.profile;
  }

  @override
  void initState() {
    super.initState();
    final status = _profileMetadata?['status']?.toString().toUpperCase();
    if (status == 'APPROVED' || status == 'SUSPENDED') {
      _load();
    } else {
      _loading = false;
    }
  }

  @override
  void didUpdateWidget(covariant _BusinessDashboard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldStatus = oldWidget.profile?['profile'] is Map
        ? (oldWidget.profile!['profile'] as Map)['status']?.toString()
        : oldWidget.profile?['status']?.toString();
    final newStatus = widget.profile?['profile'] is Map
        ? (widget.profile!['profile'] as Map)['status']?.toString()
        : widget.profile?['status']?.toString();
    final changed = oldWidget.kind != widget.kind ||
        oldWidget.profileId != widget.profileId ||
        oldWidget.owner != widget.owner ||
        oldWidget.meRevision != widget.meRevision ||
        oldStatus != newStatus;
    if (!changed) return;
    _loadGeneration++;
    _dashboard = null;
    _transactions = [];
    _transactionTotal = 0;
    _commissions = null;
    _commissionTotal = 0;
    _error = null;
    _eligible = [];
    _eligibleLoaded = false;
    final status = newStatus?.toUpperCase();
    if (status == 'APPROVED' || status == 'SUSPENDED') {
      if (!_refreshingMe) _load();
    } else {
      _loading = false;
    }
  }

  Future<void> _refreshDashboard() async {
    _refreshingMe = true;
    final refreshed = await widget.onRefreshMe();
    if (!mounted) return;
    if (!refreshed) {
      _refreshingMe = false;
      setState(() {
        _error = 'Could not refresh business status. Please try again.';
        _loading = false;
      });
      return;
    }
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    _refreshingMe = false;
    await _load();
  }

  Future<void> _load() async {
    final generation = ++_loadGeneration;
    setState(() {
      _loading = true;
      _error = null;
    });
    final status = _profileMetadata?['status']?.toString().toUpperCase();
    if (status != 'APPROVED' && status != 'SUSPENDED') {
      if (mounted && generation == _loadGeneration) {
        setState(() {
          _dashboard = null;
          _transactions = [];
          _transactionTotal = 0;
          _commissions = null;
          _commissionTotal = 0;
          _loading = false;
        });
      }
      return;
    }
    if (!_canViewReports) {
      if (mounted && generation == _loadGeneration) {
        setState(() {
          _dashboard = null;
          _transactions = [];
          _transactionTotal = 0;
          _commissions = null;
          _commissionTotal = 0;
          _loading = false;
        });
      }
      return;
    }
    try {
      final kind = widget.kind.toLowerCase();
      final profileQuery = <String, String>{
        if (widget.profileId?.isNotEmpty == true)
          'profileId': widget.profileId!,
      };
      final dashboardAllowed = status == 'APPROVED';
      final requests = <Future<dynamic>>[];
      if (dashboardAllowed) {
        requests.add(widget.api.get('dashboard/$kind', query: {
          ...profileQuery,
          'period': _period,
        }));
      }
      requests.add(widget.api.get('transactions/$kind', query: {
        ...profileQuery,
        'page': '$_transactionPage',
        if (_transactionStatus != 'ALL') 'status': _transactionStatus,
      }));
      if (widget.owner) {
        requests.add(widget.api.get('commissions/$kind', query: {
          ...profileQuery,
          'page': '$_commissionPage',
          'limit': '$_commissionLimit',
        }));
      }
      final results = await Future.wait<dynamic>(requests);
      if (!mounted || generation != _loadGeneration) return;
      var resultIndex = 0;
      final commissionResult = widget.owner
          ? Map<String, dynamic>.from(
              results[dashboardAllowed ? 2 : 1] as Map,
            )
          : null;
      setState(() {
        _dashboard = dashboardAllowed
            ? Map<String, dynamic>.from(results[resultIndex++] as Map)
            : null;
        final transactionResult = results[resultIndex++] as Map;
        _transactions = transactionResult['items'] as List? ?? [];
        _transactionTotal = transactionResult['total'] is num
            ? (transactionResult['total'] as num).toInt()
            : _transactionTotal;
        _commissions = commissionResult;
        _commissionTotal = commissionResult?['total'] is num
            ? (commissionResult!['total'] as num).toInt()
            : 0;
        _loading = false;
      });
    } catch (e) {
      if (mounted && generation == _loadGeneration) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Widget _commissionHistory() {
    final totals = _commissions?['totals'] is Map
        ? Map<String, dynamic>.from(_commissions!['totals'] as Map)
        : const <String, dynamic>{};
    final rows = _commissions?['items'] as List? ?? const [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _CommissionCard(totals: totals),
        ...rows.map((raw) {
          final row = Map<String, dynamic>.from(raw as Map);
          final reference =
              (row['reference'] ?? row['publicReference'] ?? '').toString();
          return ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading:
                const Icon(Icons.account_balance_wallet_outlined, size: 20),
            title: Text(
              '${row['event'] ?? 'Commission'} · ${_naira(row['amountKobo'])}',
            ),
            subtitle: Text(
              '${reference.isEmpty ? 'Reference unavailable' : reference} · '
              '${row['serviceType'] ?? ''} · ${row['transactionStatus'] ?? ''}',
            ),
          );
        }),
        if (_commissionPage > 1 || _commissionTotal > _commissionLimit)
          Wrap(
            alignment: WrapAlignment.end,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 4,
            children: [
              TextButton(
                onPressed: _commissionPage > 1
                    ? () {
                        setState(() => _commissionPage--);
                        _load();
                      }
                    : null,
                child: const Text('Previous'),
              ),
              Text(
                'Page $_commissionPage · $_commissionTotal entries',
                style: const TextStyle(fontSize: 12),
              ),
              TextButton(
                onPressed: _commissionPage * _commissionLimit < _commissionTotal
                    ? () {
                        setState(() => _commissionPage++);
                        _load();
                      }
                    : null,
                child: const Text('Next'),
              ),
            ],
          ),
      ],
    );
  }

  Future<void> _export() async {
    try {
      final csv = await widget.api.getCsv(
        'reports/${widget.kind.toLowerCase()}',
        query: {
          'format': 'csv',
          if (widget.profileId?.isNotEmpty == true)
            'profileId': widget.profileId!,
        },
      );
      final fileName =
          'servicepay-${widget.kind.toLowerCase()}-${DateTime.now().toIso8601String().substring(0, 10)}.csv';
      await downloadReceiptBytes(
        Uint8List.fromList(utf8.encode(csv)),
        fileName,
        mimeType: 'text/csv;charset=utf-8',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('CSV report downloaded.')),
        );
      }
      try {
        await SharePlus.instance.share(ShareParams(
          text: 'ServicePay ${widget.kind.toLowerCase()} business report',
          files: <XFile>[
            XFile.fromData(
              Uint8List.fromList(utf8.encode(csv)),
              mimeType: 'text/csv',
              name: fileName,
            ),
          ],
        ));
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'The CSV was downloaded, but the system share sheet could not be opened.',
              ),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _loadEligible() async {
    if (!_canUsePayments) return;
    try {
      final data = await widget.api.get(
        'eligible-transactions/${widget.kind.toLowerCase()}',
        query: {
          if (widget.profileId?.isNotEmpty == true)
            'profileId': widget.profileId!,
        },
      );
      if (mounted) {
        setState(() {
          _eligible = (data as Map)['items'] as List? ?? [];
          _eligibleLoaded = true;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _attribute(Map item) async {
    if (!_canUsePayments) return;
    final id = (item['_id'] ?? '').toString();
    final consent = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('Confirm customer consent'),
              content: const Text(
                  'This links one of your own completed ServicePay purchases to your business activity. Confirm that the customer explicitly agreed. No payment will be made or changed.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('I have consent'))
              ],
            ));
    if (!mounted || consent != true) return;
    try {
      await widget.api.post('transactions/${widget.kind.toLowerCase()}', {
        'transactionId': id,
        'consentAcknowledged': true
      }, query: {
        if (widget.profileId?.isNotEmpty == true)
          'profileId': widget.profileId!,
      });
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Widget _paymentsOnlyView(
    Map<String, dynamic>? profile, {
    bool paymentToolsAvailable = true,
  }) =>
      RefreshIndicator(
        onRefresh: _refreshDashboard,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(18),
          children: [
            _StatusBanner(profile: profile ?? const {'status': 'APPROVED'}),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: ServicePayColors.brandSoft,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Text(
                'This staff membership does not include business reporting. '
                'Dashboards, commission statements, and business transaction '
                'history are unavailable.',
                style: TextStyle(height: 1.45),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Own-wallet purchase tools',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17),
            ),
            const SizedBox(height: 6),
            const Text(
              'Find eligible purchases from your own ServicePay account. '
              'Attribution records activity only and never changes a payment.',
              style: TextStyle(height: 1.45),
            ),
            if (paymentToolsAvailable && _canUsePayments) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _loadEligible,
                icon: const Icon(Icons.receipt_long_outlined),
                label: const Text('Find my eligible purchases'),
              ),
              if (_eligibleLoaded && _eligible.isEmpty)
                const _EmptyState(
                  text: 'No eligible own-account purchases were returned.',
                ),
              ..._eligible.map((raw) {
                final item = Map<String, dynamic>.from(raw as Map);
                return ListTile(
                  title: Text(item['reference']?.toString() ?? 'Purchase'),
                  subtitle: Text(item['serviceType']?.toString() ?? ''),
                  trailing: TextButton(
                    onPressed: () => _attribute(item),
                    child: const Text('Attribute'),
                  ),
                );
              }),
            ] else if (paymentToolsAvailable)
              const _EmptyState(
                text: 'No own-wallet payment permissions are assigned.',
              ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final profile = _dashboard?['profile'] is Map
        ? Map<String, dynamic>.from(_dashboard!['profile'] as Map)
        : _profileMetadata;
    final summary = _dashboard?['summary'] is Map
        ? Map<String, dynamic>.from(_dashboard!['summary'] as Map)
        : <String, dynamic>{};
    final status =
        profile?['status']?.toString().toUpperCase() ?? 'NOT_APPLIED';
    if (widget.lookupError != null) {
      return _BusinessError(
        message: widget.lookupError!,
        retry: _refreshDashboard,
      );
    }
    if (_loading && _dashboard == null) return const _BusinessLoading();
    if (_error != null && _dashboard == null) {
      return _BusinessError(message: _error!, retry: _load);
    }
    if (status == 'SUSPENDED') {
      if (!_canViewReports) {
        return _paymentsOnlyView(profile, paymentToolsAvailable: false);
      }
      return _suspendedView(profile);
    }
    if (status != 'APPROVED') {
      return RefreshIndicator(
        onRefresh: _refreshDashboard,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            _StatusBanner(profile: profile ?? {'status': status}),
            const SizedBox(height: 12),
            const Text(
                'Dashboard details are available after approval. Applications are reviewed by ServicePay; customer and staff identities do not change.',
                style: TextStyle(height: 1.5)),
            if (widget.kind == 'MERCHANT') ...[
              const SizedBox(height: 18),
              _FeatureNotice(
                features: profile?['features'] is Map
                    ? Map<String, dynamic>.from(profile!['features'] as Map)
                    : const <String, dynamic>{},
              ),
            ],
          ],
        ),
      );
    }
    if (!_canViewReports) return _paymentsOnlyView(profile);
    final features = _dashboard?['features'] is Map
        ? Map<String, dynamic>.from(_dashboard!['features'] as Map)
        : <String, dynamic>{};
    return RefreshIndicator(
        onRefresh: _refreshDashboard,
        child: ListView(padding: const EdgeInsets.all(18), children: [
          Row(children: [
            Expanded(
                child: Text(
                    widget.kind == 'AGENT'
                        ? 'Agent dashboard'
                        : 'Business dashboard',
                    style: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.w800))),
            IconButton(
                tooltip: 'Download and share CSV report',
                onPressed: _export,
                icon: const Icon(Icons.download_outlined))
          ]),
          if (_error != null)
            _InlineError(message: _error!, retry: _refreshDashboard),
          Text(
              '${profile?['details']?['businessName'] ?? 'Approved profile'}  ·  ${profile?['networkId'] ?? ''}',
              style: const TextStyle(color: ServicePayColors.muted)),
          const SizedBox(height: 12),
          SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'day', label: Text('Day')),
                ButtonSegment(value: 'week', label: Text('Week')),
                ButtonSegment(value: 'month', label: Text('Month'))
              ],
              selected: {
                _period
              },
              onSelectionChanged: (s) {
                setState(() => _period = s.first);
                _load();
              }),
          const SizedBox(height: 14),
          if (_loading) const LinearProgressIndicator(),
          Wrap(spacing: 9, runSpacing: 9, children: [
            _MetricBox(
                label: 'Transactions', value: '${summary['total'] ?? 0}'),
            _MetricBox(
                label: 'Successful', value: '${summary['successful'] ?? 0}'),
            _MetricBox(label: 'Pending', value: '${summary['pending'] ?? 0}'),
            _MetricBox(label: 'Failed', value: '${summary['failed'] ?? 0}'),
            _MetricBox(label: 'Volume', value: _naira(summary['volumeKobo'])),
          ]),
          const SizedBox(height: 14),
          if (widget.owner) _commissionHistory(),
          const SizedBox(height: 12),
          if (widget.owner)
            _BusinessPremiumTools(
              api: widget.api,
              kind: widget.kind,
              profileId: widget.profileId ?? profile?['_id']?.toString() ?? '',
              featureAccess: _dashboard?['featureAccess'] as List? ?? const [],
            ),
          if (_dashboard?['featureAccess'] is List &&
              (_dashboard!['featureAccess'] as List).isNotEmpty) ...[
            const SizedBox(height: 10),
            BusinessFeatureAccessPanel(
              featureAccess: _dashboard!['featureAccess'] as List,
              kind: widget.kind,
              title: 'Business feature status',
            ),
          ],
          if (_dashboard?['pricingContext'] is Map ||
              (_dashboard?['featureAccess'] is List &&
                  (_dashboard!['featureAccess'] as List).isNotEmpty))
            _PricingContextNotice(
              kind: widget.ownApprovedBusinessKind,
              pricingContext: _dashboard?['pricingContext'] is Map
                  ? Map<String, dynamic>.from(
                      _dashboard!['pricingContext'] as Map)
                  : const <String, dynamic>{},
            ),
          if (widget.kind == 'MERCHANT') _FeatureNotice(features: features),
          if (widget.kind == 'MERCHANT' && widget.owner)
            _MerchantManagement(
              api: widget.api,
              profileId: widget.profileId ?? profile?['_id']?.toString() ?? '',
              featureAccess: _dashboard?['featureAccess'] as List? ?? const [],
            ),
          if (widget.kind == 'MERCHANT' && !widget.owner)
            const _EmptyState(
              text:
                  'Branch staff cannot view the owner’s commission statements or manage business branches and staff.',
            ),
          const SizedBox(height: 14),
          Row(children: [
            const Expanded(
                child: Text('Transaction history',
                    style:
                        TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
            if (_canUsePayments)
              TextButton(
                  onPressed: _loadEligible,
                  child: const Text('Link own purchase'))
          ]),
          DropdownButtonFormField<String>(
            value: _transactionStatus,
            decoration: const InputDecoration(labelText: 'Filter transactions'),
            items: const ['ALL', 'SUCCESSFUL', 'PENDING', 'FAILED']
                .map((status) =>
                    DropdownMenuItem(value: status, child: Text(status)))
                .toList(),
            onChanged: (status) {
              setState(() {
                _transactionStatus = status ?? 'ALL';
                _transactionPage = 1;
              });
              _load();
            },
          ),
          if (_transactions.isEmpty)
            const _EmptyState(
                text: 'No business transactions have been recorded yet.'),
          ..._transactions.map((raw) {
            final item = Map<String, dynamic>.from(raw as Map);
            return _TransactionTile(
              item: item,
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) =>
                    BusinessTransactionRecordScreen(transaction: item),
              )),
            );
          }),
          if (_transactionTotal > _transactions.length)
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: _transactionPage > 1
                      ? () {
                          setState(() => _transactionPage--);
                          _load();
                        }
                      : null,
                  child: const Text('Previous'),
                ),
                Text('Page $_transactionPage'),
                TextButton(
                  onPressed: () {
                    setState(() => _transactionPage++);
                    _load();
                  },
                  child: const Text('Next'),
                ),
              ],
            ),
          if (_canUsePayments && _eligible.isNotEmpty) ...[
            const SizedBox(height: 8),
            const Text('Eligible purchases',
                style: TextStyle(fontWeight: FontWeight.w700)),
            ..._eligible.map((raw) {
              final item = Map<String, dynamic>.from(raw as Map);
              return ListTile(
                  title: Text(item['reference']?.toString() ?? 'Purchase'),
                  subtitle: Text(item['serviceType']?.toString() ?? ''),
                  trailing: TextButton(
                      onPressed: () => _attribute(item),
                      child: const Text('Attribute')));
            })
          ],
          if (widget.kind == 'AGENT' && _canUsePayments) ...[
            const SizedBox(height: 16),
            FilledButton.icon(
                onPressed: () => _openBillPayment(
                      context,
                      businessKind: widget.ownApprovedBusinessKind,
                    ),
                icon: const Icon(Icons.receipt_long_outlined),
                label: const Text('Pay a bill from my account')),
            const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                    'Use your own existing ServicePay wallet and bill-payment flow. Never use a customer’s wallet.',
                    style: TextStyle(fontSize: 12, color: ServicePayColors.muted))),
          ],
        ]));
  }

  Widget _suspendedView(Map<String, dynamic>? profile) {
    return RefreshIndicator(
      onRefresh: _refreshDashboard,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(18),
        children: [
          _StatusBanner(profile: profile ?? const {'status': 'SUSPENDED'}),
          const SizedBox(height: 10),
          const Text(
            'This profile is suspended. Existing transaction and owner commission history remains read-only; dashboard summaries, bill payment entry, and new transaction attribution are unavailable.',
            style: TextStyle(height: 1.45),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            _InlineError(message: _error!, retry: _load),
          ],
          if (widget.kind == 'MERCHANT')
            _FeatureNotice(
              features: profile?['features'] is Map
                  ? Map<String, dynamic>.from(profile!['features'] as Map)
                  : const <String, dynamic>{},
            ),
          if (widget.owner) ...[
            const SizedBox(height: 14),
            _commissionHistory(),
          ],
          const SizedBox(height: 12),
          const Text('Existing transaction history',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
          DropdownButtonFormField<String>(
            value: _transactionStatus,
            decoration: const InputDecoration(labelText: 'Filter transactions'),
            items: const ['ALL', 'SUCCESSFUL', 'PENDING', 'FAILED']
                .map((value) =>
                    DropdownMenuItem(value: value, child: Text(value)))
                .toList(),
            onChanged: (value) {
              setState(() {
                _transactionStatus = value ?? 'ALL';
                _transactionPage = 1;
              });
              _load();
            },
          ),
          if (_transactions.isEmpty)
            const _EmptyState(
                text: 'No existing transaction history returned.'),
          ..._transactions.map(_transactionRecordTile),
          if (_transactionTotal > _transactions.length)
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: _transactionPage > 1
                      ? () {
                          setState(() => _transactionPage--);
                          _load();
                        }
                      : null,
                  child: const Text('Previous'),
                ),
                Text('Page $_transactionPage'),
                TextButton(
                  onPressed: () {
                    setState(() => _transactionPage++);
                    _load();
                  },
                  child: const Text('Next'),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _transactionRecordTile(dynamic raw) {
    final item = Map<String, dynamic>.from(raw as Map);
    return _TransactionTile(
      item: item,
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => BusinessTransactionRecordScreen(transaction: item),
      )),
    );
  }
}

Future<void> _openBillPayment(
  BuildContext context, {
  String? businessKind,
}) async {
  final choice = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (context) => SafeArea(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Choose a bill payment',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              const Text(
                  'Payments continue through your existing ServicePay wallet and authorization flow.'),
              const SizedBox(height: 8),
              ...['Airtime', 'Data', 'Electricity', 'Cable TV'].map(
                (name) => ListTile(
                  enabled: businessKind == null || name == 'Airtime' || name == 'Data',
                  title: Text(name),
                  subtitle: businessKind != null && name != 'Airtime' && name != 'Data'
                      ? const Text('Business pricing is not integrated. Use Customer services for personal purchases.')
                      : null,
                  leading: const Icon(Icons.receipt_long_outlined),
                  onTap: businessKind != null && name != 'Airtime' && name != 'Data'
                      ? null
                      : () => Navigator.pop(context, name),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  if (!context.mounted || choice == null) return;
  final Widget? destination = switch (choice) {
    'Airtime' => AirtimeScreen(businessKind: businessKind),
    'Data' => DataScreen(businessKind: businessKind),
    'Electricity' => const ElectricityScreen(),
    'Cable TV' => const CableScreen(),
    _ => null,
  };
  if (destination != null) {
    await Navigator.of(context)
        .push(MaterialPageRoute<void>(builder: (_) => destination));
  }
}

class _MerchantManagement extends StatefulWidget {
  const _MerchantManagement({
    required this.api,
    required this.profileId,
    this.featureAccess = const [],
  });
  final BusinessNetworkApi api;
  final String profileId;
  final List<dynamic> featureAccess;
  @override
  State<_MerchantManagement> createState() => _MerchantManagementState();
}

class _MerchantManagementState extends State<_MerchantManagement> {
  List<dynamic> _branches = [];
  List<dynamic> _staff = [];
  bool _loaded = false;
  bool _started = false;
  String? _error;

  Map<String, dynamic>? _featureFor(List<String> keys) {
    final normalized = keys
        .map(
            (value) => value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), ''))
        .toSet();
    for (final raw in widget.featureAccess.whereType<Map>()) {
      final feature = Map<String, dynamic>.from(raw);
      final key = (feature['key'] ?? '').toString().toLowerCase().replaceAll(
            RegExp(r'[^a-z0-9]'),
            '',
          );
      if (normalized.contains(key)) return feature;
    }
    return null;
  }

  bool _canManage(List<String> keys) {
    final legacy = _featureFor(const ['merchantStaff']);
    if (legacy != null &&
        !businessFeatureAvailableForKind(legacy, 'MERCHANT')) {
      return false;
    }
    final feature = _featureFor(keys);
    return feature == null ||
        businessFeatureAvailableForKind(feature, 'MERCHANT');
  }

  String? _managementReason(List<String> keys) {
    final feature = _featureFor(keys);
    if (feature == null || _canManage(keys)) return null;
    final categories = feature['categories'];
    final category = categories is Map ? categories['MERCHANT'] : null;
    return category is Map && category['reason'] != null
        ? category['reason'].toString()
        : feature['reason']?.toString() ??
            'This management action is not enabled for this business.';
  }

  @override
  void initState() {
    super.initState();
    _started = true;
    _load();
  }

  Future<void> _load() async {
    if (widget.profileId.isEmpty) return;
    try {
      final r = await Future.wait([
        widget.api.get('profiles/${widget.profileId}/branches'),
        widget.api.get('profiles/${widget.profileId}/staff')
      ]);
      if (mounted) {
        setState(() {
          _branches = (r[0] as Map)['items'] as List? ?? [];
          _staff = (r[1] as Map)['items'] as List? ?? [];
          _loaded = true;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loaded = true;
        });
      }
    }
  }

  Future<void> _createBranch() async {
    if (!_canManage(const ['branchManagement', 'branches'])) return;
    final name = TextEditingController(), address = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
                title: const Text('Add business branch'),
                content: Column(mainAxisSize: MainAxisSize.min, children: [
                  TextField(
                      controller: name,
                      decoration:
                          const InputDecoration(labelText: 'Branch name')),
                  TextField(
                      controller: address,
                      decoration: const InputDecoration(labelText: 'Address'))
                ]),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Save'))
                ]));
    if (!mounted || ok != true) return;
    try {
      await widget.api.post('profiles/${widget.profileId}/branches',
          {'name': name.text.trim(), 'address': address.text.trim()});
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _inviteStaff() async {
    if (!_canManage(const ['staffManagement', 'staff'])) return;
    final user = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
                title: const Text('Invite authorized staff'),
                content: TextField(
                    controller: user,
                    decoration:
                        const InputDecoration(labelText: 'ServicePay user ID')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Continue'))
                ]));
    if (!mounted || ok != true) return;
    final branchId = await showDialog<String?>(
        context: context,
        builder: (context) => SimpleDialog(
            title: const Text('Choose branch'),
            children: _branches
                .map((b) => SimpleDialogOption(
                    onPressed: () =>
                        Navigator.pop(context, b['_id']?.toString()),
                    child: Text(b['name']?.toString() ?? 'Branch')))
                .toList()));
    if (!mounted || branchId == null) return;
    try {
      await widget.api.post('profiles/${widget.profileId}/staff', {
        'userId': user.text.trim(),
        'branchId': branchId,
        'permissions': ['reports.view']
      });
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _staffAction(Map staff) async {
    if (!_canManage(const ['staffManagement', 'staff'])) return;
    final id = (staff['_id'] ?? '').toString();
    try {
      await widget.api.patch('staff/$id', {'status': 'SUSPENDED'});
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _branchAction(Map<String, dynamic> branch) async {
    if (!_canManage(const ['branchManagement', 'branches'])) return;
    final branchId = (branch['_id'] ?? '').toString();
    if (branchId.isEmpty) return;
    final suspended =
        (branch['status'] ?? 'ACTIVE').toString().toUpperCase() == 'SUSPENDED';
    try {
      await widget.api.patch(
        'profiles/${widget.profileId}/branches/$branchId',
        {'status': suspended ? 'ACTIVE' : 'SUSPENDED'},
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _reinviteStaff(Map<String, dynamic> staff) async {
    if (!_canManage(const ['staffManagement', 'staff'])) return;
    final staffId = (staff['_id'] ?? '').toString();
    if (staffId.isEmpty || _branches.isEmpty) return;
    final currentBranch = staff['branchId'] is Map
        ? (staff['branchId'] as Map)['_id']?.toString()
        : staff['branchId']?.toString();
    String? branchId = _branches.any(
      (raw) => (raw as Map)['_id']?.toString() == currentBranch,
    )
        ? currentBranch
        : (_branches.first as Map)['_id']?.toString();
    final permissions = <String>{
      ...((staff['permissions'] as List? ?? const [])
          .map((permission) => permission.toString())
          .where((permission) =>
              permission == 'reports.view' || permission == 'payments.view')),
    };
    if (permissions.isEmpty) permissions.add('reports.view');
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Change or reinvite staff access'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              value: branchId,
              decoration: const InputDecoration(labelText: 'Branch'),
              items: _branches.map((raw) {
                final value = Map<String, dynamic>.from(raw as Map);
                return DropdownMenuItem<String>(
                  value: value['_id']?.toString(),
                  child: Text(value['name']?.toString() ?? 'Branch'),
                );
              }).toList(),
              onChanged: (value) => setDialogState(() => branchId = value),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('View reports'),
              value: permissions.contains('reports.view'),
              onChanged: (value) => setDialogState(() {
                if (value == true) {
                  permissions.add('reports.view');
                } else {
                  permissions.remove('reports.view');
                }
              }),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Use permitted payment features'),
              subtitle: const Text(
                'Does not grant finance approval or funds authority.',
              ),
              value: permissions.contains('payments.view'),
              onChanged: (value) => setDialogState(() {
                if (value == true) {
                  permissions.add('payments.view');
                } else {
                  permissions.remove('payments.view');
                }
              }),
            ),
            const Text(
              'The staff member must accept again after access changes. This does not activate membership.',
              style: TextStyle(fontSize: 12),
            ),
          ]),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Send invitation'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || confirmed != true) return;
    if (branchId == null || permissions.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content:
              Text('Choose a branch and at least one restricted permission.'),
        ),
      );
      return;
    }
    try {
      await widget.api.patch('staff/$staffId', {
        'status': 'INVITED',
        'branchId': branchId,
        'permissions': permissions.toList(),
      });
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content:
                Text('Invitation sent; staff acceptance is required again.'),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_started) {
      _started = true;
      _load();
    }
    if (!_loaded) return const LinearProgressIndicator();
    return Card(
        color: ServicePayColors.surface,
        child: Padding(
            padding: const EdgeInsets.all(14),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Branches & staff',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              if (_error != null)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_error!, style: const TextStyle(color: Color(0xFFF9928B))),
                    TextButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry')),
                  ],
                ),
              if (_branches.isEmpty) const Text('No branches added yet.'),
              if (_managementReason(const ['branchManagement', 'branches']) !=
                  null)
                Text(
                  _managementReason(const ['branchManagement', 'branches'])!,
                  style:
                      const TextStyle(fontSize: 12, color: ServicePayColors.muted),
                ),
              ..._branches.map((raw) {
                final branch = Map<String, dynamic>.from(raw as Map);
                final status =
                    (branch['status'] ?? 'ACTIVE').toString().toUpperCase();
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(branch['name']?.toString() ?? 'Branch'),
                  subtitle: Text(
                    '${branch['address'] ?? ''} · $status',
                  ),
                  trailing: TextButton(
                    onPressed:
                        _canManage(const ['branchManagement', 'branches'])
                            ? () => _branchAction(branch)
                            : null,
                    child: Text(status == 'SUSPENDED' ? 'Resume' : 'Pause'),
                  ),
                );
              }),
              ..._staff.map((raw) {
                final staff = Map<String, dynamic>.from(raw as Map);
                final status = (staff['status'] ?? '').toString().toUpperCase();
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(staff['name']?.toString() ??
                      staff['userId']?.toString() ??
                      'Staff invitation'),
                  subtitle: Text(
                    '$status · ${((staff['permissions'] as List?) ?? const []).join(', ')}',
                  ),
                  trailing: PopupMenuButton<String>(
                    tooltip: 'Staff access actions',
                    enabled: _canManage(const ['staffManagement', 'staff']),
                    onSelected: (action) {
                      if (action == 'reinvite') {
                        _reinviteStaff(staff);
                      } else if (action == 'suspend') {
                        _staffAction(staff);
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'reinvite',
                        child: Text('Reinvite / change access'),
                      ),
                      if (status != 'SUSPENDED')
                        const PopupMenuItem(
                          value: 'suspend',
                          child: Text('Suspend staff'),
                        ),
                    ],
                  ),
                );
              }),
              if (_managementReason(const ['staffManagement', 'staff']) != null)
                Text(
                  _managementReason(const ['staffManagement', 'staff'])!,
                  style:
                      const TextStyle(fontSize: 12, color: ServicePayColors.muted),
                ),
              Wrap(spacing: 8, children: [
                OutlinedButton.icon(
                    onPressed:
                        _canManage(const ['branchManagement', 'branches'])
                            ? _createBranch
                            : null,
                    icon: const Icon(Icons.add),
                    label: const Text('Add branch')),
                OutlinedButton.icon(
                    onPressed: _canManage(const ['staffManagement', 'staff'])
                        ? _inviteStaff
                        : null,
                    icon: const Icon(Icons.person_add_alt),
                    label: const Text('Invite staff'))
              ]),
              const Text(
                  'Pausing a branch revokes member access; resuming it does not restore suspended memberships. Staff must accept changed access again. Permissions do not grant finance approval or funds authority.',
                  style: TextStyle(fontSize: 11, color: ServicePayColors.muted)),
            ])));
  }
}

class _SupportForm extends StatefulWidget {
  const _SupportForm({required this.api});
  final BusinessNetworkApi api;
  @override
  State<_SupportForm> createState() => _SupportFormState();
}

class _SupportFormState extends State<_SupportForm> {
  final _form = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _message = TextEditingController();
  final _transactionReference = TextEditingController();
  String _kind = 'AGENT';
  String? _idempotencyKey;
  bool _busy = false;
  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
    _transactionReference.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!_form.currentState!.validate()) return;
    _idempotencyKey ??=
        'sp-support-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
    setState(() => _busy = true);
    try {
      await widget.api.post('support', {
        'subject': _subject.text.trim(),
        'message': _message.text.trim(),
        'kind': _kind,
        'idempotencyKey': _idempotencyKey,
        if (_transactionReference.text.trim().isNotEmpty)
          'transactionReference': _transactionReference.text.trim(),
      });
      _idempotencyKey = null;
      if (mounted) {
        _subject.clear();
        _message.clear();
        _transactionReference.clear();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Your message was sent.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.all(18), children: [
        const Text('Business Support',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
        const SizedBox(height: 12),
        Form(
            key: _form,
            child: Column(children: [
              DropdownButtonFormField<String>(
                  value: _kind,
                  decoration:
                      const InputDecoration(labelText: 'Business capability'),
                  items: const [
                    DropdownMenuItem(
                        value: 'AGENT', child: Text('Retail Agent')),
                    DropdownMenuItem(
                        value: 'MERCHANT', child: Text('SME Merchant'))
                  ],
                  onChanged: (v) => setState(() => _kind = v ?? 'AGENT')),
              TextFormField(
                  controller: _subject,
                  decoration: const InputDecoration(labelText: 'Subject'),
                  validator: (v) =>
                      (v?.trim().isEmpty ?? true) ? 'Enter a subject' : null),
              TextFormField(
                  controller: _message,
                  minLines: 4,
                  maxLines: 7,
                  decoration:
                      const InputDecoration(labelText: 'How can we help?'),
                  validator: (v) => (v?.trim().length ?? 0) < 10
                      ? 'Please add a little more detail'
                      : null),
              TextFormField(
                controller: _transactionReference,
                decoration: const InputDecoration(
                  labelText: 'Related receipt reference (optional)',
                  helperText:
                      'Use the human-readable reference from your own existing purchase.',
                ),
              ),
              const SizedBox(height: 16),
              FilledButton(
                  onPressed: _busy ? null : _send,
                  child: _busy
                      ? const CircularProgressIndicator()
                      : const Text('Send message'))
            ]))
      ]);
}

class _ApplicationsView extends StatelessWidget {
  const _ApplicationsView({required this.applications});
  final List<Map> applications;
  @override
  Widget build(BuildContext context) => applications.isEmpty
      ? const _EmptyState(
          text:
              'No applications yet. Start with an Agent or Merchant application.')
      : ListView(
          padding: const EdgeInsets.all(18),
          children: applications
              .map((a) => Card(
                  child: ListTile(
                      leading: const Icon(Icons.assignment_outlined),
                      title: Text('${a['kind'] ?? 'Business'} application'),
                      subtitle: Text(
                          '${(a['status'] ?? '').toString().replaceAll('_', ' ')}${a['feedback'] == null ? '' : '\\n${a['feedback']}'}'),
                      isThreeLine: a['feedback'] != null)))
              .toList());
}

class _StaffInvitation extends StatefulWidget {
  const _StaffInvitation({
    required this.api,
    required this.invitation,
    required this.onAccepted,
  });
  final BusinessNetworkApi api;
  final Map<String, dynamic> invitation;
  final Future<void> Function() onAccepted;
  @override
  State<_StaffInvitation> createState() => _StaffInvitationState();
}

class _StaffInvitationState extends State<_StaffInvitation> {
  bool _busy = false;
  Future<void> _accept() async {
    final accept = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Accept staff invitation?'),
        content: const Text(
          'Accepting grants only the business permissions assigned to this invitation. It does not change your ServicePay customer or staff identity.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Not now'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Accept invitation'),
          ),
        ],
      ),
    );
    if (!mounted || accept != true) return;
    final id = (widget.invitation['staffId'] ??
            widget.invitation['membershipId'] ??
            widget.invitation['_id'] ??
            '')
        .toString();
    if (id.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('This invitation is missing its reference.')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.api.post('staff/$id/accept', {});
      await widget.onAccepted();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Card(
        color: ServicePayColors.surface,
        child: ListTile(
          leading: const Icon(
            Icons.mail_outline,
            color: ServicePayColors.accent,
          ),
          title: Text(widget.invitation['businessName']?.toString() ??
              widget.invitation['profileName']?.toString() ??
              'Business staff invitation'),
          subtitle: const Text('Accept explicitly to join this business.'),
          trailing: _busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : TextButton(
                  onPressed: _accept,
                  child: const Text('Review'),
                ),
        ),
      );
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.profile});
  final Map<String, dynamic> profile;
  @override
  Widget build(BuildContext context) {
    final status = (profile['status'] ?? 'DRAFT').toString().toUpperCase();
    final colors = {
      'APPROVED': const Color(0xFF08783E),
      'REJECTED': const Color(0xFFB54708),
      'SUSPENDED': const Color(0xFFB42318)
    };
    return Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
            color: (colors[status] ?? const Color(0xFF66756D))
                .withValues(alpha: .09),
            borderRadius: BorderRadius.circular(13)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(status.replaceAll('_', ' '),
              style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: colors[status] ?? const Color(0xFF53645B))),
          if (profile['feedback'] != null)
            Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Text(profile['feedback'].toString()))
        ]));
  }
}

class _TransactionTile extends StatelessWidget {
  const _TransactionTile({required this.item, required this.onTap});
  final Map<String, dynamic> item;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => ListTile(
      onTap: onTap,
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.receipt_long_outlined),
      title: Text(item['serviceType']?.toString() ?? 'Bill payment'),
      subtitle: Text(
          '${item['reference'] ?? item['_id'] ?? ''} · ${item['createdAt'] ?? ''}'),
      trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(_naira(item['amountKobo']),
                style: const TextStyle(fontWeight: FontWeight.w700)),
            Text((item['status'] ?? '').toString(),
                style: const TextStyle(fontSize: 11))
          ]));
}

class _CommissionCard extends StatelessWidget {
  const _CommissionCard({required this.totals});
  final Map<String, dynamic> totals;
  @override
  Widget build(BuildContext context) => Card(
      color: ServicePayColors.brandSoft,
      child: Padding(
          padding: const EdgeInsets.all(14),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Commission statement',
                style: TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  'earnedKobo',
                  'pendingKobo',
                  'paidKobo',
                  'reversedKobo',
                  'recoveryKobo'
                ]
                    .map((k) => Text(
                        '${_commissionLabel(k)}  ${_naira(totals[k])}',
                        style: const TextStyle(fontSize: 12)))
                    .toList())
          ])));
}

class _PricingContextNotice extends StatelessWidget {
  const _PricingContextNotice({
    required this.kind,
    required this.pricingContext,
  });

  final String? kind;
  final Map<String, dynamic> pricingContext;

  @override
  Widget build(BuildContext context) {
    final category = kind?.toUpperCase() ?? 'CUSTOMER';
    final walletAuthority =
        pricingContext['walletAuthority']?.toString().toUpperCase();
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: ServicePayColors.brandSoft,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: ServicePayColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Purchase account · $category',
              style:
                  const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 5),
          const Text(
            'ServicePay resolves the purchase category on the server. An approved business purchase does not automatically inherit Customer pricing, and this dashboard does not promise a special-price discount.',
            style: TextStyle(height: 1.4, fontSize: 13),
          ),
          const SizedBox(height: 5),
          const Text(
            'Airtime provider cost and profit are unknown until an invoice is available.',
            style: TextStyle(height: 1.4, fontSize: 12),
          ),
          if (walletAuthority == 'AUTHENTICATED_CUSTOMER_ONLY')
            const Padding(
              padding: EdgeInsets.only(top: 5),
              child: Text(
                'Payments use the authenticated customer wallet and existing authorization flow.',
                style: TextStyle(height: 1.4, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}

class _FeatureNotice extends StatelessWidget {
  const _FeatureNotice({required this.features});
  final Map<String, dynamic> features;
  @override
  Widget build(BuildContext context) => Column(
        children: ['merchantQr', 'payByLink', 'automaticPayouts'].map((key) {
          final label = {
            'merchantQr': 'Merchant QR',
            'payByLink': 'Pay by link',
            'automaticPayouts': 'Automatic payouts',
          }[key]!;
          final enabled = features[key] == true;
          final unavailableText = key == 'automaticPayouts'
              ? 'No independently verified payout capability is configured.'
              : 'Provider collection verification is required before activation.';
          return ListTile(
            leading: Icon(
              enabled ? Icons.info_outline : Icons.lock_outline,
              color: ServicePayColors.muted,
            ),
            title: Text(label),
            subtitle: Text(enabled
                ? 'Reported enabled by the service, but this screen does not implement the payment capability.'
                : unavailableText),
          );
        }).toList(),
      );
}

class _MetricBox extends StatelessWidget {
  const _MetricBox({required this.label, required this.value});
  final String label, value;
  @override
  Widget build(BuildContext context) => Container(
      width: MediaQuery.sizeOf(context).width < 380 ? 145 : 160,
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
          color: ServicePayColors.surface, borderRadius: BorderRadius.circular(15)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(fontSize: 12, color: ServicePayColors.muted)),
        const SizedBox(height: 5),
        Text(value,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))
      ]));
}

class _HubAction extends StatelessWidget {
  const _HubAction(
      {required this.icon,
      required this.title,
      required this.detail,
      required this.onTap});
  final IconData icon;
  final String title, detail;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
      color: ServicePayColors.surface,
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
          onTap: onTap,
          leading: Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                  color: ServicePayColors.brandSoft,
                  borderRadius: BorderRadius.circular(13)),
              child: Icon(icon, color: ServicePayColors.accent)),
          title:
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(detail),
          trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 15)));
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Text(text,
      style: const TextStyle(
          letterSpacing: 1.1,
          fontWeight: FontWeight.w800,
          fontSize: 11,
          color: ServicePayColors.muted));
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
          color: ServicePayColors.surface, borderRadius: BorderRadius.circular(16)),
      child: Text(text,
          style: const TextStyle(color: ServicePayColors.muted, height: 1.4)));
}

class _BusinessLoading extends StatelessWidget {
  const _BusinessLoading();
  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.all(20), children: [
        Container(
            height: 130,
            decoration: BoxDecoration(
                color: ServicePayColors.surface,
                borderRadius: BorderRadius.circular(20))),
        const SizedBox(height: 16),
        ...List.generate(
            4,
            (_) => Container(
                height: 60,
                margin: const EdgeInsets.only(bottom: 10),
                decoration: BoxDecoration(
                    color: ServicePayColors.surface,
                    borderRadius: BorderRadius.circular(14))))
      ]);
}

class _BusinessError extends StatelessWidget {
  const _BusinessError({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined, size: 38),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: retry, child: const Text('Try again'))
          ])));
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Row(children: [
        Expanded(
            child: Text(message, style: const TextStyle(color: Color(0xFFF9928B)))),
        TextButton(onPressed: retry, child: const Text('Retry'))
      ]);
}

String _naira(dynamic kobo) {
  if (kobo == null) return '—';
  final parsed = kobo is num ? kobo.toDouble() : double.tryParse('$kobo');
  if (parsed == null) return '—';
  return '₦${(parsed / 100).toStringAsFixed(2)}';
}

String _commissionLabel(String key) =>
    {
      'earnedKobo': 'Earned',
      'pendingKobo': 'Pending',
      'paidKobo': 'Paid',
      'reversedKobo': 'Reversed',
      'recoveryKobo': 'Recovery'
    }[key] ??
    key;
String _supportedServiceLabel(String code) => switch (code) {
      'AIRTIME' => 'Airtime',
      'DATA' => 'Data',
      'ELECTRICITY' => 'Electricity',
      'CABLE' => 'Cable',
      'EXAM_PIN' => 'Exam PIN',
      _ => code,
    };
