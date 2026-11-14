import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../airtime_screen.dart';
import '../cable_screen.dart';
import '../data_screen.dart';
import '../electricity_screen.dart';
import '../services/receipt_download.dart';
import 'business_network_api.dart';
import 'business_transaction_record_screen.dart';

part 'business_hub_application_form.dart';

class BusinessHubScreen extends StatefulWidget {
  const BusinessHubScreen({super.key, this.api});
  final BusinessNetworkApi? api;

  @override
  State<BusinessHubScreen> createState() => _BusinessHubScreenState();
}

class _BusinessHubScreenState extends State<BusinessHubScreen> {
  late final BusinessNetworkApi _api = widget.api ?? BusinessNetworkApi();
  Map<String, dynamic>? _me;
  String? _error;
  bool _loading = true;
  String _view = 'hub';
  String _kind = 'AGENT';
  String? _selectedProfileId;
  Map<String, dynamic>? _selectedMembership;

  @override
  void initState() {
    super.initState();
    _loadMe();
  }

  @override
  void dispose() {
    if (widget.api == null) _api.close();
    super.dispose();
  }

  Future<void> _loadMe() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.get('me');
      if (mounted) {
        setState(() {
          _me = Map<String, dynamic>.from(data as Map);
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  void _open(String view, {String? kind}) {
    setState(() {
      _view = view;
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
      backgroundColor: const Color(0xFFF4F8F5),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF4F8F5),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        leading: _view == 'hub'
            ? null
            : IconButton(
                onPressed: () => _open('hub'),
                icon: const Icon(Icons.arrow_back)),
        actions: [
          IconButton(
              onPressed: _loadMe,
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh))
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
                      onSaved: _loadMe,
                    )
                  : _view == 'dashboard'
                      ? _BusinessDashboard(
                          api: _api,
                          kind: _kind,
                          profile: _selectedMembership ?? _membership(_kind),
                          profileId: _selectedProfileId ??
                              _profileId(_membership(_kind)),
                          owner: _isOwner(
                              _selectedMembership ?? _membership(_kind)),
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

  Map<String, dynamic>? _membership(String kind) {
    for (final raw in (_me?['memberships'] as List? ?? const [])) {
      if (raw is Map && raw['kind']?.toString().toUpperCase() == kind) {
        return Map<String, dynamic>.from(raw);
      }
    }
    return null;
  }

  String? _profileId(Map<String, dynamic>? membership) {
    if (membership == null) return null;
    final profile = membership['profile'] is Map
        ? Map<String, dynamic>.from(membership['profile'] as Map)
        : const <String, dynamic>{};
    final id = membership['profileId'] ??
        membership['businessProfileId'] ??
        profile['_id'] ??
        membership['_id'];
    return id?.toString();
  }

  bool _isOwner(Map<String, dynamic>? membership) {
    if (membership == null) return false;
    if (membership['kind']?.toString().toUpperCase() == 'AGENT') return true;
    final role = (membership['role'] ??
            membership['membershipRole'] ??
            membership['accessLevel'] ??
            '')
        .toString()
        .toUpperCase();
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

  Future<void> _openMerchantDashboard() async {
    final memberships = (_me?['memberships'] as List? ?? const [])
        .whereType<Map>()
        .map((value) => Map<String, dynamic>.from(value))
        .where((value) => value['kind']?.toString().toUpperCase() == 'MERCHANT')
        .toList();
    Map<String, dynamic>? selected;
    if (memberships.length == 1) {
      selected = memberships.first;
    } else if (memberships.length > 1) {
      selected = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('Choose a business'),
          children: memberships.map((membership) {
            final detail = membership['details'] is Map
                ? Map<String, dynamic>.from(membership['details'] as Map)
                : membership['profile'] is Map &&
                        (membership['profile'] as Map)['details'] is Map
                    ? Map<String, dynamic>.from(
                        (membership['profile'] as Map)['details'] as Map)
                    : <String, dynamic>{};
            return SimpleDialogOption(
              onPressed: () => Navigator.pop(context, membership),
              child: Text(detail['businessName']?.toString() ??
                  membership['profileId']?.toString() ??
                  'Merchant business'),
            );
          }).toList(),
        ),
      );
    } else {
      selected = _membership('MERCHANT');
    }
    if (!mounted) return;
    setState(() {
      _selectedMembership = selected;
      _selectedProfileId = _profileId(selected);
      _kind = 'MERCHANT';
      _view = 'dashboard';
    });
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
                color: const Color(0xFF0B6741),
                borderRadius: BorderRadius.circular(24)),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Your next chapter,\\nbuilt on ServicePay.',
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
              onTap: () => _open('dashboard', kind: 'AGENT')),
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
    this.profile,
  });
  final BusinessNetworkApi api;
  final String kind;
  final String? profileId;
  final bool owner;
  final Map<String, dynamic>? profile;
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

  @override
  void initState() {
    super.initState();
    final status = widget.profile?['status']?.toString().toUpperCase();
    if (status == 'APPROVED' || status == 'SUSPENDED') {
      _load();
    } else {
      _loading = false;
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final kind = widget.kind.toLowerCase();
      final profileQuery = <String, String>{
        if (widget.profileId?.isNotEmpty == true)
          'profileId': widget.profileId!,
      };
      final status = widget.profile?['status']?.toString().toUpperCase();
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
      if (!mounted) return;
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
      if (mounted) {
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
    try {
      final data = await widget.api
          .get('eligible-transactions/${widget.kind.toLowerCase()}');
      if (mounted) {
        setState(() {
          _eligible = (data as Map)['items'] as List? ?? [];
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
      await widget.api.post('transactions/${widget.kind.toLowerCase()}',
          {'transactionId': id, 'consentAcknowledged': true});
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = _dashboard?['profile'] is Map
        ? Map<String, dynamic>.from(_dashboard!['profile'] as Map)
        : widget.profile;
    final summary = _dashboard?['summary'] is Map
        ? Map<String, dynamic>.from(_dashboard!['summary'] as Map)
        : <String, dynamic>{};
    final status =
        profile?['status']?.toString().toUpperCase() ?? 'NOT_APPLIED';
    if (_loading && _dashboard == null) return const _BusinessLoading();
    if (_error != null && _dashboard == null) {
      return _BusinessError(message: _error!, retry: _load);
    }
    if (status == 'SUSPENDED') return _suspendedView(profile);
    if (status != 'APPROVED') {
      return ListView(padding: const EdgeInsets.all(20), children: [
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
      ]);
    }
    final features = _dashboard?['features'] is Map
        ? Map<String, dynamic>.from(_dashboard!['features'] as Map)
        : <String, dynamic>{};
    return RefreshIndicator(
        onRefresh: _load,
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
          Text(
              '${profile?['details']?['businessName'] ?? 'Approved profile'}  ·  ${profile?['networkId'] ?? ''}',
              style: const TextStyle(color: Color(0xFF53645B))),
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
          if (widget.kind == 'MERCHANT') _FeatureNotice(features: features),
          if (widget.kind == 'MERCHANT' && widget.owner)
            _MerchantManagement(
              api: widget.api,
              profileId: widget.profileId ?? profile?['_id']?.toString() ?? '',
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
          if (_eligible.isNotEmpty) ...[
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
          if (widget.kind == 'AGENT') ...[
            const SizedBox(height: 16),
            FilledButton.icon(
                onPressed: () => _openBillPayment(context),
                icon: const Icon(Icons.receipt_long_outlined),
                label: const Text('Pay a bill from my account')),
            const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                    'Use your own existing ServicePay wallet and bill-payment flow. Never use a customer’s wallet.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF59685F)))),
          ],
        ]));
  }

  Widget _suspendedView(Map<String, dynamic>? profile) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
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

Future<void> _openBillPayment(BuildContext context) async {
  final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
              child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Choose a bill payment',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  const Text(
                      'Payments continue through your existing ServicePay wallet and authorization flow.'),
                  const SizedBox(height: 8),
                  ...['Airtime', 'Data', 'Electricity', 'Cable TV'].map(
                      (name) => ListTile(
                          title: Text(name),
                          leading: const Icon(Icons.receipt_long_outlined),
                          onTap: () => Navigator.pop(context, name))),
                ]),
          )));
  if (!context.mounted || choice == null) return;
  final Widget? destination = switch (choice) {
    'Airtime' => const AirtimeScreen(),
    'Data' => const DataScreen(),
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
  const _MerchantManagement({required this.api, required this.profileId});
  final BusinessNetworkApi api;
  final String profileId;
  @override
  State<_MerchantManagement> createState() => _MerchantManagementState();
}

class _MerchantManagementState extends State<_MerchantManagement> {
  List<dynamic> _branches = [];
  List<dynamic> _staff = [];
  bool _loaded = false;
  bool _started = false;
  String? _error;
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
        color: Colors.white,
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
                    Text(_error!, style: const TextStyle(color: Colors.red)),
                    TextButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry')),
                  ],
                ),
              if (_branches.isEmpty) const Text('No branches added yet.'),
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
                    onPressed: () => _branchAction(branch),
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
              Wrap(spacing: 8, children: [
                OutlinedButton.icon(
                    onPressed: _createBranch,
                    icon: const Icon(Icons.add),
                    label: const Text('Add branch')),
                OutlinedButton.icon(
                    onPressed: _inviteStaff,
                    icon: const Icon(Icons.person_add_alt),
                    label: const Text('Invite staff'))
              ]),
              const Text(
                  'Pausing a branch revokes member access; resuming it does not restore suspended memberships. Staff must accept changed access again. Permissions do not grant finance approval or funds authority.',
                  style: TextStyle(fontSize: 11, color: Color(0xFF59685F))),
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
  String _kind = 'AGENT';
  String? _idempotencyKey;
  bool _busy = false;
  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
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
      });
      _idempotencyKey = null;
      if (mounted) {
        _subject.clear();
        _message.clear();
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
        color: Colors.white,
        child: ListTile(
          leading: const Icon(Icons.mail_outline, color: Color(0xFF08783E)),
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
      color: const Color(0xFFE8F3EC),
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
            enabled: enabled,
            leading:
                Icon(enabled ? Icons.check_circle_outline : Icons.lock_outline),
            title: Text(label),
            subtitle: Text(enabled ? 'Available' : unavailableText),
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
          color: Colors.white, borderRadius: BorderRadius.circular(15)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(fontSize: 12, color: Color(0xFF66756D))),
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
      color: Colors.white,
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
          onTap: onTap,
          leading: Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                  color: const Color(0xFFE8F3EC),
                  borderRadius: BorderRadius.circular(13)),
              child: Icon(icon, color: const Color(0xFF08783E))),
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
          color: Color(0xFF738178)));
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Text(text,
          style: const TextStyle(color: Color(0xFF53645B), height: 1.4)));
}

class _BusinessLoading extends StatelessWidget {
  const _BusinessLoading();
  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.all(20), children: [
        Container(
            height: 130,
            decoration: BoxDecoration(
                color: const Color(0xFFE5EEE8),
                borderRadius: BorderRadius.circular(20))),
        const SizedBox(height: 16),
        ...List.generate(
            4,
            (_) => Container(
                height: 60,
                margin: const EdgeInsets.only(bottom: 10),
                decoration: BoxDecoration(
                    color: const Color(0xFFE5EEE8),
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
            child: Text(message, style: const TextStyle(color: Colors.red))),
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
