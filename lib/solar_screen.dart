import 'package:flutter/material.dart';

import 'feature_transaction_pin_dialog.dart';
import 'services/solar_api_service.dart';

const Color _solarGreen = Color(0xFF08783E);

class SolarScreen extends StatefulWidget {
  const SolarScreen({
    super.key,
    this.api,
  });

  final SolarApiService? api;

  @override
  State<SolarScreen> createState() => _SolarScreenState();
}

class _SolarScreenState extends State<SolarScreen> {
  late final SolarApiService _api;
  int _tab = 0;
  int _applicationsRefreshToken = 0;
  late Future<Map<String, dynamic>> _packages;
  late Future<List<Map<String, dynamic>>> _existingPlans;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? SolarApiService();
    _packages = _api.getPackages();
    _existingPlans = _loadExistingPlans();
  }

  void _openApplications() => setState(() => _tab = 1);
  void _openFinance() => setState(() => _tab = 2);
  Future<List<Map<String, dynamic>>> _loadExistingPlans() =>
      Future.wait(<Future<Map<String, dynamic>>>[
        _api.getApplications(),
        _api.getFinance(),
      ]);

  void _handleApplicationSubmitted() {
    if (!mounted) return;
    setState(() {
      _tab = 1;
      _applicationsRefreshToken++;
      _existingPlans = _loadExistingPlans();
    });
  }

  void _reloadHome() => setState(() {
        _packages = _api.getPackages();
        _existingPlans = _loadExistingPlans();
      });

  @override
  Widget build(BuildContext context) {
    final List<Widget> pages = <Widget>[
      _SolarHome(
        api: _api,
        packages: _packages,
        existingPlans: _existingPlans,
        onRetry: _reloadHome,
        onApplications: _openApplications,
        onFinance: _openFinance,
        onApply: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => SolarPackageSelectionScreen(
              api: _api,
              packages: _packages,
              onSubmitted: _handleApplicationSubmitted,
            ),
          ),
        ),
        onApplicationSubmitted: _handleApplicationSubmitted,
      ),
      SolarApplicationsScreen(
        key: ValueKey<int>(_applicationsRefreshToken),
        api: _api,
      ),
      SolarFinanceScreen(api: _api),
    ];
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF8),
      body: SafeArea(child: pages[_tab]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        indicatorColor: const Color(0xFFDDF4E6),
        onDestinationSelected: (int value) => setState(() => _tab = value),
        destinations: const <Widget>[
          NavigationDestination(
              icon: Icon(Icons.wb_sunny_outlined),
              selectedIcon: Icon(Icons.wb_sunny),
              label: 'Solar'),
          NavigationDestination(
              icon: Icon(Icons.description_outlined),
              selectedIcon: Icon(Icons.description),
              label: 'Applications'),
          NavigationDestination(
              icon: Icon(Icons.account_balance_wallet_outlined),
              selectedIcon: Icon(Icons.account_balance_wallet),
              label: 'Finance'),
        ],
      ),
    );
  }
}

class _SolarHome extends StatelessWidget {
  const _SolarHome(
      {required this.api,
      required this.packages,
      required this.existingPlans,
      required this.onRetry,
      required this.onApplications,
      required this.onFinance,
      required this.onApply,
      required this.onApplicationSubmitted});
  final SolarApiService api;
  final Future<Map<String, dynamic>> packages;
  final Future<List<Map<String, dynamic>>> existingPlans;
  final VoidCallback onRetry;
  final VoidCallback onApplications;
  final VoidCallback onFinance;
  final VoidCallback onApply;
  final VoidCallback onApplicationSubmitted;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        color: _solarGreen,
        onRefresh: () async => onRetry(),
        child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
            children: <Widget>[
              Row(children: <Widget>[
                IconButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    icon: const Icon(Icons.arrow_back)),
                const SizedBox(width: 4),
                const Expanded(
                  child: Text(
                    'ServicePay Solar',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900),
                  ),
                )
              ]),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                    color: _solarGreen,
                    borderRadius: BorderRadius.circular(24)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Icon(Icons.solar_power_rounded,
                        color: Color(0xFFFFD565), size: 40),
                    const SizedBox(height: 14),
                    const Text('Power your home or business',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 25,
                            fontWeight: FontWeight.w900)),
                    const SizedBox(height: 7),
                    const Text(
                        'Choose a quality solar package and spread your payment with ServicePay finance.',
                        style:
                            TextStyle(color: Color(0xFFD9F1E2), height: 1.4)),
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: onApply,
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: _solarGreen,
                          minimumSize: const Size.fromHeight(50),
                        ),
                        icon: const Icon(Icons.assignment_rounded),
                        label: const Text('Apply for Solar'),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              Row(children: <Widget>[
                Expanded(
                    child: _QuickLink(
                        icon: Icons.description_outlined,
                        label: 'My applications',
                        onTap: onApplications)),
                const SizedBox(width: 12),
                Expanded(
                    child: _QuickLink(
                        icon: Icons.calendar_month_outlined,
                        label: 'Finance & payments',
                        onTap: onFinance)),
              ]),
              const SizedBox(height: 26),
              FutureBuilder<Map<String, dynamic>>(
                future: packages,
                builder: (BuildContext context,
                    AsyncSnapshot<Map<String, dynamic>> snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Padding(
                        padding: EdgeInsets.all(36),
                        child: Center(
                            child:
                                CircularProgressIndicator(color: _solarGreen)));
                  }
                  if (snapshot.hasError) {
                    return _StateCard(
                        message: snapshot.error.toString(),
                        action: 'Try again',
                        onTap: onRetry);
                  }
                  final List<Map<String, dynamic>> items =
                      _items(snapshot.data, const <String>['packages', 'data']);
                  return FutureBuilder<List<Map<String, dynamic>>>(
                    future: existingPlans,
                    builder: (BuildContext context,
                        AsyncSnapshot<List<Map<String, dynamic>>> plans) {
                      if (plans.connectionState != ConnectionState.done) {
                        return const Padding(
                            padding: EdgeInsets.all(24),
                            child: Center(
                                child: CircularProgressIndicator(
                                    color: _solarGreen)));
                      }
                      final List<Map<String, dynamic>> applications = _items(
                          plans.data?[0],
                          const <String>['applications', 'data']);
                      final List<Map<String, dynamic>> finance = _items(
                          plans.data?[1], const <String>['finance', 'data']);
                      final Map<String, dynamic>? currentApplication =
                          applications.cast<Map<String, dynamic>?>().firstWhere(
                                (Map<String, dynamic>? item) =>
                                    item != null &&
                                    !_terminalSolarStatus(item['status']),
                                orElse: () => null,
                              );
                      if (finance.isNotEmpty || currentApplication != null) {
                        return _ExistingSolarPlan(
                            application: currentApplication,
                            finance: finance.isEmpty ? null : finance.first,
                            onApplications: onApplications,
                            onFinance: onFinance);
                      }
                      if (items.isEmpty) {
                        return const _StateCard(
                            message:
                                'No solar packages are available right now.');
                      }
                      return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            const Text('Solar packages',
                                style: TextStyle(
                                    fontSize: 19, fontWeight: FontWeight.w900)),
                            const SizedBox(height: 4),
                            const Text(
                                'Select a package that fits your energy needs.',
                                style: TextStyle(color: Color(0xFF68776E))),
                            const SizedBox(height: 14),
                            ...items.map((Map<String, dynamic> item) => Padding(
                                padding: const EdgeInsets.only(bottom: 12),
                                child: _PackageCard(
                                  api: api,
                                  item: item,
                                  onSubmitted: onApplicationSubmitted,
                                )))
                          ]);
                    },
                  );
                },
              ),
            ]),
      );
}

class _ExistingSolarPlan extends StatelessWidget {
  const _ExistingSolarPlan({
    required this.application,
    required this.finance,
    required this.onApplications,
    required this.onFinance,
  });

  final Map<String, dynamic>? application;
  final Map<String, dynamic>? finance;
  final VoidCallback onApplications;
  final VoidCallback onFinance;

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic> plan = finance ?? application!;
    final String status = _text(plan, <String>['status'], 'In progress');
    final num? outstanding =
        _amount(plan, <String>['outstandingBalance', 'remainingQuote']);
    final num? nextPayment = finance == null ? null : solarFinanceDue(plan);
    return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFFBFE4CA))),
        child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(children: <Widget>[
                const Icon(Icons.account_balance_wallet_rounded,
                    color: _solarGreen),
                const SizedBox(width: 10),
                const Expanded(
                    child: Text('Your Solar plan',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900))),
                Chip(
                    label: Text(status.replaceAll('_', ' ')),
                    backgroundColor: const Color(0xFFDDF4E6))
              ]),
              const SizedBox(height: 10),
              Text(_packageName(plan, 'ServicePay Solar')),
              if (outstanding != null)
                Text('Outstanding: ${_money(outstanding)}',
                    style: const TextStyle(fontWeight: FontWeight.w800)),
              if (nextPayment != null)
                Text(
                    'Next installment: ${_money(nextPayment)} • Due ${solarFinanceDueDate(plan)}'),
              const SizedBox(height: 12),
              Wrap(spacing: 8, children: <Widget>[
                OutlinedButton(
                    onPressed: onApplications,
                    child: const Text('View application')),
                if (finance != null)
                  FilledButton(
                      style:
                          FilledButton.styleFrom(backgroundColor: _solarGreen),
                      onPressed: onFinance,
                      child: const Text('Open finance dashboard'))
              ])
            ]));
  }
}

bool _terminalSolarStatus(dynamic value) => <String>[
      'REJECTED',
      'CANCELLED',
      'COMPLETED',
      'RECOVERED'
    ].contains(value?.toString().toUpperCase());

class _PackageCard extends StatelessWidget {
  const _PackageCard({
    required this.api,
    required this.item,
    required this.onSubmitted,
  });
  final SolarApiService api;
  final Map<String, dynamic> item;
  final VoidCallback onSubmitted;
  @override
  Widget build(BuildContext context) {
    final String name = _packageName(item, 'Solar package');
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => SolarPackageDetailsScreen(
                api: api,
                package: item,
                onSubmitted: onSubmitted,
              ))),
      child: Ink(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFFE0EAE4))),
        child: Row(children: <Widget>[
          Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  color: const Color(0xFFEAF7F0),
                  borderRadius: BorderRadius.circular(14)),
              child: const Icon(Icons.solar_power_rounded, color: _solarGreen)),
          const SizedBox(width: 13),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                Text(name,
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 4),
                Text(
                    _text(item, <String>['description', 'capacity', 'summary'],
                        'Reliable solar power'),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: Color(0xFF68776E), fontSize: 12)),
                const SizedBox(height: 8),
                Text(
                    _money(
                        item['price'] ?? item['amount'] ?? item['cashPrice']),
                    style: const TextStyle(
                        color: _solarGreen, fontWeight: FontWeight.w900)),
              ])),
          const Icon(Icons.chevron_right_rounded, color: _solarGreen),
        ]),
      ),
    );
  }
}

class SolarPackageSelectionScreen extends StatelessWidget {
  const SolarPackageSelectionScreen({
    super.key,
    required this.api,
    required this.packages,
    required this.onSubmitted,
  });

  final SolarApiService api;
  final Future<Map<String, dynamic>> packages;
  final VoidCallback onSubmitted;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF7FAF8),
        appBar: AppBar(
          title: const Text('Choose a Solar package'),
          backgroundColor: const Color(0xFFF7FAF8),
          surfaceTintColor: Colors.transparent,
        ),
        body: FutureBuilder<Map<String, dynamic>>(
          future: packages,
          builder: (BuildContext context,
              AsyncSnapshot<Map<String, dynamic>> snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(
                  child: CircularProgressIndicator(color: _solarGreen));
            }
            if (snapshot.hasError) {
              return _StateCard(
                message: snapshot.error.toString(),
                action: 'Go back',
                onTap: () => Navigator.of(context).pop(),
              );
            }
            final List<Map<String, dynamic>> items = _items(
              snapshot.data,
              const <String>['packages', 'data'],
            );
            if (items.isEmpty) {
              return const _StateCard(
                message: 'No solar packages are available right now.',
              );
            }
            return ListView(
              padding: const EdgeInsets.all(20),
              children: <Widget>[
                const Text(
                  'Select the system that fits your needs',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 6),
                const Text(
                  'You can review the package details before completing your application.',
                  style: TextStyle(color: Color(0xFF68776E)),
                ),
                const SizedBox(height: 16),
                ...items.map(
                  (Map<String, dynamic> item) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _PackageCard(
                      api: api,
                      item: item,
                      onSubmitted: onSubmitted,
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      );
}

class SolarPackageDetailsScreen extends StatelessWidget {
  const SolarPackageDetailsScreen({
    super.key,
    required this.package,
    this.api,
    this.onSubmitted,
  });
  final Map<String, dynamic> package;
  final SolarApiService? api;
  final VoidCallback? onSubmitted;
  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic> specifications = package['specifications'] is Map
        ? Map<String, dynamic>.from(package['specifications'] as Map)
        : <String, dynamic>{};
    final Map<String, dynamic> terms = package['terms'] is Map
        ? Map<String, dynamic>.from(package['terms'] as Map)
        : <String, dynamic>{};
    final dynamic rawFeatures =
        package['features'] ?? package['benefits'] ?? const <dynamic>[];
    final List<dynamic> features =
        rawFeatures is List ? rawFeatures : const <dynamic>[];
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF8),
      appBar: AppBar(
          backgroundColor: const Color(0xFFF7FAF8),
          title: const Text('Package details'),
          surfaceTintColor: Colors.transparent),
      body: ListView(padding: const EdgeInsets.all(20), children: <Widget>[
        Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
                color: _solarGreen, borderRadius: BorderRadius.circular(24)),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Icon(Icons.solar_power_rounded,
                      color: Color(0xFFFFD565), size: 42),
                  const SizedBox(height: 15),
                  Text(_packageName(package, 'Solar package'),
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.w900)),
                  const SizedBox(height: 8),
                  Text(
                      _money(package['price'] ??
                          package['amount'] ??
                          package['cashPrice']),
                      style: const TextStyle(
                          color: Color(0xFFFFE19A),
                          fontSize: 20,
                          fontWeight: FontWeight.w800)),
                ])),
        const SizedBox(height: 22),
        Text(
            _text(package, <String>['description', 'summary'],
                'A dependable solar solution for your everyday power needs.'),
            style: const TextStyle(height: 1.5, color: Color(0xFF46554C))),
        const SizedBox(height: 20),
        const Text('Finance summary',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
        const SizedBox(height: 8),
        _PackageFinanceSummary(package: package),
        if (specifications.isNotEmpty) ...<Widget>[
          const SizedBox(height: 22),
          const Text('System specifications',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          ...specifications.entries
              .where((MapEntry<String, dynamic> item) =>
                  item.value?.toString().trim().isNotEmpty == true)
              .map((MapEntry<String, dynamic> item) => Padding(
                  padding: const EdgeInsets.only(top: 7),
                  child: Row(children: <Widget>[
                    Expanded(
                        child: Text(item.key
                            .replaceAllMapped(RegExp(r'([A-Z])'),
                                (Match match) => ' ${match.group(1)}')
                            .trim())),
                    Text(item.value.toString(),
                        style: const TextStyle(fontWeight: FontWeight.w800))
                  ])))
        ],
        if (_text(terms, <String>['includedItems']).isNotEmpty) ...<Widget>[
          const SizedBox(height: 22),
          const Text('Included items',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          const SizedBox(height: 7),
          Text(_text(terms, <String>['includedItems']),
              style: const TextStyle(height: 1.45)),
        ],
        if (features.isNotEmpty) ...<Widget>[
          const SizedBox(height: 22),
          const Text('What is included',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          ...features.map((dynamic feature) => Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Icon(Icons.check_circle,
                        color: _solarGreen, size: 20),
                    const SizedBox(width: 9),
                    Expanded(child: Text(feature.toString()))
                  ])))
        ],
      ]),
      bottomNavigationBar: SafeArea(
          child: Padding(
              padding: const EdgeInsets.all(16),
              child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                      backgroundColor: _solarGreen,
                      minimumSize: const Size.fromHeight(52)),
                  onPressed: () =>
                      Navigator.of(context).push(MaterialPageRoute<void>(
                          builder: (_) => SolarApplicationFormScreen(
                                package: package,
                                api: api,
                                onSubmitted: onSubmitted,
                              ))),
                  icon: const Icon(Icons.assignment_rounded),
                  label: const Text('Apply for this package')))),
    );
  }
}

class SolarApplicationFormScreen extends StatefulWidget {
  const SolarApplicationFormScreen({
    super.key,
    required this.package,
    this.api,
    this.onSubmitted,
  });
  final Map<String, dynamic> package;
  final SolarApiService? api;
  final VoidCallback? onSubmitted;
  @override
  State<SolarApplicationFormScreen> createState() =>
      _SolarApplicationFormScreenState();
}

class _SolarApplicationFormScreenState
    extends State<SolarApplicationFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final SolarApiService _api;
  final Map<String, TextEditingController> _fields =
      <String, TextEditingController>{
    for (final String key in <String>[
      'fullName',
      'phone',
      'email',
      'address',
      'state',
      'lga',
      'businessName',
      'businessType',
      'businessAddress',
      'businessState',
      'businessLga',
      'yearsInBusiness',
      'occupationBusiness',
      'preferredRepaymentPeriod',
      'purposeOfSolar',
      'guarantorName',
      'guarantorPhone',
      'guarantorRelationship',
      'guarantorAddress',
      'guarantorOccupation'
    ])
      key: TextEditingController()
  };
  static const List<String> _incomeRanges = <String>[
    'Below ₦50,000',
    '₦50,000 - ₦100,000',
    '₦100,001 - ₦250,000',
    '₦250,001 - ₦500,000',
    'Above ₦500,000',
  ];
  static const List<String> _upfrontPaymentOptions = <String>[
    'Standard package deposit',
    'Pay a larger upfront amount',
    'Pay in full upfront',
  ];
  String? _monthlyIncomeRange;
  String? _upfrontPaymentOption;
  bool _terms = false, _truth = false, _recovery = false, _submitting = false;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? SolarApiService();
  }

  @override
  void dispose() {
    for (final TextEditingController controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate() ||
        !_terms ||
        !_truth ||
        !_recovery) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Complete the required fields and declarations.')));
      return;
    }
    setState(() => _submitting = true);
    try {
      final Map<String, dynamic> response =
          await _api.submitApplication(<String, dynamic>{
        'packageId': widget.package['id'] ?? widget.package['_id'],
        'fullName': _fields['fullName']!.text.trim(),
        'phone': _fields['phone']!.text.trim(),
        'email': _fields['email']!.text.trim(),
        'residentialAddress': _fields['address']!.text.trim(),
        'state': _fields['state']!.text.trim(),
        'lga': _fields['lga']!.text.trim(),
        'customerProfile': _group(
            <String>['fullName', 'phone', 'email', 'address', 'state', 'lga']),
        ..._group(<String>[
          'businessName',
          'businessType',
          'businessAddress',
          'businessState',
          'businessLga',
          'yearsInBusiness',
          'occupationBusiness',
          'purposeOfSolar',
        ]),
        'business': <String, String>{
          ..._group(<String>[
            'businessName',
            'businessType',
            'businessAddress',
            'businessState',
            'businessLga',
            'yearsInBusiness',
            'occupationBusiness',
            'purposeOfSolar',
          ]),
          'monthlyIncomeRange': _monthlyIncomeRange ?? '',
          'preferredRepaymentPeriod':
              _fields['preferredRepaymentPeriod']!.text.trim(),
          'upfrontPaymentOption': _upfrontPaymentOption ?? '',
        },
        'guarantorFullName': _fields['guarantorName']!.text.trim(),
        ..._group(<String>[
          'guarantorPhone',
          'guarantorRelationship',
          'guarantorAddress',
          'guarantorOccupation',
        ]),
        'guarantor': <String, String>{
          'fullName': _fields['guarantorName']!.text.trim(),
          'phone': _fields['guarantorPhone']!.text.trim(),
          'relationship': _fields['guarantorRelationship']!.text.trim(),
          'address': _fields['guarantorAddress']!.text.trim(),
          'occupation': _fields['guarantorOccupation']!.text.trim(),
        },
        'applicationPreferences': <String, String>{
          'occupationBusiness': _fields['occupationBusiness']!.text.trim(),
          'monthlyIncomeRange': _monthlyIncomeRange ?? '',
          'preferredRepaymentPeriod':
              _fields['preferredRepaymentPeriod']!.text.trim(),
          'upfrontPaymentOption': _upfrontPaymentOption ?? '',
        },
        'declarations': <String, bool>{
          'termsAccepted': _terms,
          'informationAccurate': _truth,
          'recoveryAgreementAccepted': _recovery,
          'accepted': _terms && _truth && _recovery,
        },
        'informationAccurate': _truth,
        'termsAccepted': _terms,
        'recoveryAgreementAccepted': _recovery,
        'accepted': _terms && _truth && _recovery,
      });
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(response['message']?.toString() ??
              'Application submitted successfully.'),
          backgroundColor: _solarGreen));
      widget.onSubmitted?.call();
      Navigator.of(context).popUntil(
        (Route<dynamic> route) =>
            route.settings.name == '/solar' || route.isFirst,
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  Map<String, String> _group(List<String> names) => <String, String>{
        for (final String name in names) name: _fields[name]!.text.trim()
      };
  Widget _input(
    String key,
    String label, {
    bool required = true,
    TextInputType type = TextInputType.text,
    String? Function(String?)? validator,
  }) =>
      Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextFormField(
              controller: _fields[key],
              keyboardType: type,
              validator: validator ??
                  (required
                      ? (String? value) => value == null || value.trim().isEmpty
                          ? '$label is required.'
                          : null
                      : null),
              decoration: InputDecoration(
                  labelText: label,
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12)))));
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Solar application')),
      body: Form(
          key: _formKey,
          child: ListView(padding: const EdgeInsets.all(20), children: <Widget>[
            _section('Customer profile', <Widget>[
              _input('fullName', 'Full name'),
              _input('phone', 'Phone number', type: TextInputType.phone),
              _input('email', 'Email address',
                  required: false, type: TextInputType.emailAddress),
              _input('address', 'Residential / installation address'),
              _input('state', 'State'),
              _input('lga', 'Local government area')
            ]),
            _section('Business information', <Widget>[
              _input('occupationBusiness', 'Occupation / business'),
              _input('businessName', 'Business name', required: false),
              _input('businessType', 'Business type', required: false),
              _input('businessAddress', 'Business address', required: false),
              _input('businessState', 'Business state', required: false),
              _input('businessLga', 'Business local government area',
                  required: false),
              _input('yearsInBusiness', 'Years in business',
                  required: false, type: TextInputType.number),
              DropdownButtonFormField<String>(
                key: const Key('solar_income_range'),
                value: _monthlyIncomeRange,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Monthly income range',
                  border: OutlineInputBorder(),
                ),
                items: _incomeRanges
                    .map((String value) => DropdownMenuItem<String>(
                          value: value,
                          child: Text(value),
                        ))
                    .toList(),
                validator: (String? value) =>
                    value == null ? 'Monthly income range is required.' : null,
                onChanged: (String? value) =>
                    setState(() => _monthlyIncomeRange = value),
              ),
              const SizedBox(height: 12),
              _input(
                'preferredRepaymentPeriod',
                'Preferred repayment period (months)',
                type: TextInputType.number,
                validator: (String? value) {
                  final int? months = int.tryParse(value?.trim() ?? '');
                  if (months == null || months < 1 || months > 120) {
                    return 'Enter a repayment period from 1 to 120 months.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                key: const Key('solar_upfront_payment'),
                value: _upfrontPaymentOption,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Upfront payment option',
                  border: OutlineInputBorder(),
                ),
                items: _upfrontPaymentOptions
                    .map((String value) => DropdownMenuItem<String>(
                          value: value,
                          child: Text(value),
                        ))
                    .toList(),
                validator: (String? value) => value == null
                    ? 'Upfront payment option is required.'
                    : null,
                onChanged: (String? value) =>
                    setState(() => _upfrontPaymentOption = value),
              ),
              const SizedBox(height: 12),
              _input('purposeOfSolar', 'Purpose of solar', required: false)
            ]),
            _section('Guarantor', <Widget>[
              const Text(
                'Optional unless requested during review.',
                style: TextStyle(color: Color(0xFF68776E)),
              ),
              const SizedBox(height: 8),
              _input('guarantorName', 'Guarantor full name', required: false),
              _input('guarantorPhone', 'Guarantor phone',
                  required: false, type: TextInputType.phone),
              _input('guarantorRelationship', 'Relationship to guarantor',
                  required: false),
              _input('guarantorAddress', 'Guarantor address', required: false),
              _input('guarantorOccupation', 'Guarantor occupation / business',
                  required: false)
            ]),
            CheckboxListTile(
                key: const Key('solar_declaration_truth'),
                value: _truth,
                onChanged: (bool? value) =>
                    setState(() => _truth = value ?? false),
                contentPadding: EdgeInsets.zero,
                title: const Text(
                    'I confirm that the information supplied is accurate.')),
            CheckboxListTile(
                key: const Key('solar_declaration_terms'),
                value: _terms,
                onChanged: (bool? value) =>
                    setState(() => _terms = value ?? false),
                contentPadding: EdgeInsets.zero,
                title: const Text(
                    'I accept the Solar finance terms and consent to assessment.')),
            CheckboxListTile(
                key: const Key('solar_declaration_recovery'),
                value: _recovery,
                onChanged: (bool? value) =>
                    setState(() => _recovery = value ?? false),
                contentPadding: EdgeInsets.zero,
                title: const Text(
                    'I understand the equipment remains subject to the ServicePay recovery agreement until all obligations are completed.')),
            const SizedBox(height: 10),
            FilledButton(
                key: const Key('solar_submit_application'),
                onPressed: _submitting ? null : _submit,
                style: FilledButton.styleFrom(
                    backgroundColor: _solarGreen,
                    minimumSize: const Size.fromHeight(52)),
                child: _submitting
                    ? const CircularProgressIndicator(color: Colors.white)
                    : const Text('Submit application')),
          ])));
  Widget _section(String title, List<Widget> children) => Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title,
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
            const SizedBox(height: 12),
            ...children
          ]));
}

class SolarApplicationsScreen extends StatefulWidget {
  const SolarApplicationsScreen({super.key, required this.api});
  final SolarApiService api;
  @override
  State<SolarApplicationsScreen> createState() =>
      _SolarApplicationsScreenState();
}

class _SolarApplicationsScreenState extends State<SolarApplicationsScreen> {
  late Future<Map<String, dynamic>> _future;
  @override
  void initState() {
    super.initState();
    _future = widget.api.getApplications();
  }

  @override
  Widget build(BuildContext context) => _SolarListScaffold(
      title: 'My applications',
      future: _future,
      retry: () => setState(() => _future = widget.api.getApplications()),
      empty: 'You have not submitted a solar application yet.',
      builder: (Map<String, dynamic> item) => _ApplicationTile(
          item: item,
          api: widget.api,
          refresh: () =>
              setState(() => _future = widget.api.getApplications())));
}

class _ApplicationTile extends StatelessWidget {
  const _ApplicationTile(
      {required this.item, required this.api, required this.refresh});
  final Map<String, dynamic> item;
  final SolarApiService api;
  final VoidCallback refresh;
  @override
  Widget build(BuildContext context) {
    final String id = _text(item, <String>['id', '_id', 'applicationId']);
    final num? depositDue = solarDepositDue(item);
    final Map<String, dynamic> preferences =
        item['applicationPreferences'] is Map
            ? Map<String, dynamic>.from(item['applicationPreferences'] as Map)
            : <String, dynamic>{};
    final Map<String, dynamic> business = item['business'] is Map
        ? Map<String, dynamic>.from(item['business'] as Map)
        : <String, dynamic>{};
    final String occupation = _text(
      preferences,
      const <String>['occupationBusiness'],
      _text(business, const <String>['occupationBusiness']),
    );
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(_packageName(item, 'Solar application'),
                      style: const TextStyle(fontWeight: FontWeight.w900)),
                  const SizedBox(height: 6),
                  Text('Status: ${_text(item, <String>['status'], 'Pending')}'),
                  if (occupation.isNotEmpty) Text('Occupation: $occupation'),
                  if (preferences.isNotEmpty)
                    Text(
                      'Income: ${_text(preferences, const <String>[
                            'monthlyIncomeRange'
                          ], 'Not provided')} • '
                      'Preferred term: ${_text(preferences, const <String>[
                            'preferredRepaymentPeriod'
                          ], 'Not provided')} months',
                    ),
                  if (depositDue != null && depositDue > 0)
                    Text('Deposit due: ${_money(depositDue)}',
                        style: const TextStyle(
                            color: _solarGreen, fontWeight: FontWeight.w800)),
                  if (solarCanPayDeposit(item) &&
                      id.isNotEmpty &&
                      depositDue != null &&
                      depositDue > 0)
                    Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                            onPressed: () async {
                              try {
                                final num? amount =
                                    await showSolarPaymentAmountDialog(context,
                                        maximum: depositDue);
                                if (amount == null) {
                                  return;
                                }
                                if (!context.mounted) {
                                  return;
                                }
                                final String? pin =
                                    await showFeatureTransactionPinDialog(
                                        context,
                                        title: 'Confirm deposit',
                                        message:
                                            'Enter your transaction PIN to pay the solar deposit from your wallet.');
                                if (pin == null) {
                                  return;
                                }
                                final String operation = 'deposit_$id';
                                final String key =
                                    await api.beginMonetaryOperation(operation);
                                await api.payDeposit(
                                    applicationId: id,
                                    amount: amount,
                                    transactionPin: pin,
                                    idempotencyKey: key);
                                await api.completeMonetaryOperation(operation);
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                          content: Text(
                                              'Deposit payment submitted.'),
                                          backgroundColor: _solarGreen));
                                  refresh();
                                }
                              } catch (e) {
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text(e.toString())));
                                }
                              }
                            },
                            child: const Text('Pay deposit')))
                ])));
  }
}

class SolarFinanceScreen extends StatefulWidget {
  const SolarFinanceScreen({super.key, required this.api});
  final SolarApiService api;
  @override
  State<SolarFinanceScreen> createState() => _SolarFinanceScreenState();
}

class _SolarFinanceScreenState extends State<SolarFinanceScreen> {
  late Future<Map<String, dynamic>> _future;
  @override
  void initState() {
    super.initState();
    _future = widget.api.getFinance();
  }

  void _reload() => setState(() {
        _future = widget.api.getFinance();
      });
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Solar finance')),
      body: RefreshIndicator(
          onRefresh: () async => _reload(),
          child: ListView(padding: const EdgeInsets.all(20), children: <Widget>[
            const Text('Repayment schedule',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
            const SizedBox(height: 12),
            _AsyncList(
                future: _future,
                retry: _reload,
                empty: 'There is no active solar finance plan.',
                builder: (Map<String, dynamic> item) => _FinanceTile(
                    item: item, api: widget.api, refresh: _reload)),
          ])));
}

class _FinanceTile extends StatelessWidget {
  const _FinanceTile(
      {required this.item, required this.api, required this.refresh});
  final Map<String, dynamic> item;
  final SolarApiService api;
  final VoidCallback refresh;
  @override
  Widget build(BuildContext context) {
    final String id = _text(item, <String>['id', '_id', 'financeId']);
    final num? displayedDue = solarFinanceDue(item);
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(_packageName(item, 'Solar finance'),
                      style: const TextStyle(fontWeight: FontWeight.w900)),
                  const SizedBox(height: 7),
                  Text('Next payment: ${_money(displayedDue)}'),
                  Text('Due: ${solarFinanceDueDate(item)}'),
                  if (id.isNotEmpty) _FinanceActivity(financeId: id, api: api),
                  if (id.isNotEmpty)
                    Align(
                        alignment: Alignment.centerRight,
                        child: FilledButton(
                            onPressed: () async {
                              try {
                                final Map<String, dynamic> scheduleResponse =
                                    await api.getSchedule(id);
                                if (!context.mounted) {
                                  return;
                                }
                                final num? amount =
                                    await showSolarPaymentAmountDialog(context,
                                        maximum: solarFinanceDue(item,
                                            schedule: _items(
                                                scheduleResponse,
                                                const <String>[
                                                  'schedule',
                                                  'data'
                                                ])));
                                if (amount == null) {
                                  return;
                                }
                                if (!context.mounted) {
                                  return;
                                }
                                final String? pin =
                                    await showFeatureTransactionPinDialog(
                                        context,
                                        title: 'Confirm installment',
                                        message:
                                            'Enter your transaction PIN to pay the next solar installment from your wallet.');
                                if (pin == null) {
                                  return;
                                }
                                final String operation = 'installment_$id';
                                final String key =
                                    await api.beginMonetaryOperation(operation);
                                await api.payInstallment(
                                    financeId: id,
                                    amount: amount,
                                    transactionPin: pin,
                                    idempotencyKey: key);
                                await api.completeMonetaryOperation(operation);
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                          content: Text(
                                              'Installment payment submitted.'),
                                          backgroundColor: _solarGreen));
                                  refresh();
                                }
                              } catch (e) {
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text(e.toString())));
                                }
                              }
                            },
                            style: FilledButton.styleFrom(
                                backgroundColor: _solarGreen),
                            child: const Text('Pay installment')))
                ])));
  }
}

class _FinanceActivity extends StatelessWidget {
  const _FinanceActivity({required this.financeId, required this.api});
  final String financeId;
  final SolarApiService api;

  @override
  Widget build(BuildContext context) => ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: const Text('Schedule & payment history',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
          children: <Widget>[
            FutureBuilder<Map<String, dynamic>>(
                future: api.getSchedule(financeId),
                builder: (BuildContext context,
                    AsyncSnapshot<Map<String, dynamic>> snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Padding(
                        padding: EdgeInsets.all(12),
                        child: CircularProgressIndicator(color: _solarGreen));
                  }
                  if (snapshot.hasError) {
                    return Text('Schedule unavailable: ${snapshot.error}');
                  }
                  final List<Map<String, dynamic>> rows =
                      _items(snapshot.data, const <String>['schedule', 'data']);
                  return rows.isEmpty
                      ? const Text('No repayment schedule is available.')
                      : Column(
                          children: rows
                              .map((Map<String, dynamic> row) => ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(_text(
                                      row,
                                      <String>['dueDate', 'date'],
                                      'Installment')),
                                  trailing: Text(_money(
                                      row['amountDue'] ?? row['amount']))))
                              .toList());
                }),
            FutureBuilder<Map<String, dynamic>>(
                future: api.getPayments(financeId),
                builder: (BuildContext context,
                    AsyncSnapshot<Map<String, dynamic>> snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const SizedBox.shrink();
                  }
                  if (snapshot.hasError) {
                    return Text(
                        'Payment history unavailable: ${snapshot.error}');
                  }
                  final List<Map<String, dynamic>> rows =
                      _items(snapshot.data, const <String>['payments', 'data']);
                  return rows.isEmpty
                      ? const Text('No payments have been recorded.')
                      : Column(
                          children: rows
                              .map((Map<String, dynamic> row) => ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(
                                      Icons.check_circle_outline,
                                      color: _solarGreen),
                                  title: Text(_text(
                                      row,
                                      <String>['reference', 'type'],
                                      'Payment')),
                                  subtitle: Text(_text(row,
                                      <String>['paidAt', 'createdAt', 'date'])),
                                  trailing: Text(_money(row['amount']))))
                              .toList());
                }),
          ]);
}

class _PackageFinanceSummary extends StatelessWidget {
  const _PackageFinanceSummary({required this.package});
  final Map<String, dynamic> package;

  @override
  Widget build(BuildContext context) {
    final num? cashPrice = _amount(package, <String>['cashPrice']);
    final num? financedPrice =
        _amount(package, <String>['financedPrice']) ?? cashPrice;
    final num? depositPercent = _amount(package, <String>['depositPercent']);
    final num? deposit =
        _amount(package, <String>['calculatedDepositAmount']) ??
            (financedPrice != null && depositPercent != null
                ? financedPrice * depositPercent / 100
                : null);
    final num? installmentMonths =
        _amount(package, <String>['installmentMonths']);
    final num? estimatedInstallment =
        _amount(package, <String>['estimatedInstallmentAmount']) ??
            (financedPrice != null &&
                    deposit != null &&
                    installmentMonths != null &&
                    installmentMonths > 0
                ? (financedPrice - deposit) / installmentMonths
                : null);
    final List<List<String>> facts = <List<String>>[
      <String>['Cash price', _money(cashPrice)],
      <String>['Financed price', _money(financedPrice)],
      <String>[
        'Deposit',
        '${_money(deposit)} (${depositPercent?.toString() ?? '—'}%)'
      ],
      <String>[
        'Repayment',
        '${_text(package, <String>[
              'repaymentFrequency'
            ], '—')} • ${installmentMonths == null ? '—' : '${installmentMonths.toInt()} months'}'
      ],
      <String>['Estimated installment', _money(estimatedInstallment)],
      <String>[
        'Availability',
        package['available'] == false
            ? 'Out of stock'
            : '${_text(package, <String>['stockQuantity'], '0')} available'
      ],
    ];
    return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFE0EAE4))),
        child: Column(
            children: facts
                .map((List<String> fact) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(children: <Widget>[
                      Expanded(
                          child: Text(fact.first,
                              style:
                                  const TextStyle(color: Color(0xFF68776E)))),
                      Flexible(
                          child: Text(fact.last,
                              textAlign: TextAlign.end,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w800))),
                    ])))
                .toList()));
  }
}

Future<num?> showSolarPaymentAmountDialog(
  BuildContext context, {
  required num? maximum,
}) async {
  if (maximum == null || maximum <= 0) {
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('There is no payment amount due.')));
    return null;
  }
  final TextEditingController controller =
      TextEditingController(text: maximum.toStringAsFixed(2));
  final num? result = await showDialog<num>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
              title: const Text('Enter payment amount'),
              content: TextField(
                  controller: controller,
                  autofocus: true,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                      labelText: 'Amount (up to ${_money(maximum)})',
                      prefixText: '₦ ',
                      border: const OutlineInputBorder())),
              actions: <Widget>[
                TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () {
                      final num? amount = num.tryParse(
                          controller.text.trim().replaceAll(',', ''));
                      if (amount == null || amount <= 0 || amount > maximum) {
                        ScaffoldMessenger.of(dialogContext).showSnackBar(SnackBar(
                            content: Text(
                                'Enter an amount between ₦0.01 and ${_money(maximum)}.')));
                        return;
                      }
                      Navigator.of(dialogContext).pop(amount);
                    },
                    child: const Text('Continue')),
              ]));
  controller.dispose();
  return result;
}

class _SolarListScaffold extends StatelessWidget {
  const _SolarListScaffold(
      {required this.title,
      required this.future,
      required this.retry,
      required this.empty,
      required this.builder});
  final String title, empty;
  final Future<Map<String, dynamic>> future;
  final VoidCallback retry;
  final Widget Function(Map<String, dynamic>) builder;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: Text(title)),
      body: RefreshIndicator(
          onRefresh: () async => retry(),
          child: ListView(padding: const EdgeInsets.all(20), children: <Widget>[
            _AsyncList(
                future: future, retry: retry, empty: empty, builder: builder)
          ])));
}

class _AsyncList extends StatelessWidget {
  const _AsyncList(
      {required this.future,
      required this.retry,
      required this.empty,
      required this.builder});
  final Future<Map<String, dynamic>> future;
  final VoidCallback retry;
  final String empty;
  final Widget Function(Map<String, dynamic>) builder;
  @override
  Widget build(BuildContext context) => FutureBuilder<Map<String, dynamic>>(
      future: future,
      builder:
          (BuildContext context, AsyncSnapshot<Map<String, dynamic>> snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Padding(
              padding: EdgeInsets.all(32),
              child:
                  Center(child: CircularProgressIndicator(color: _solarGreen)));
        }
        if (snapshot.hasError) {
          return _StateCard(
              message: snapshot.error.toString(),
              action: 'Try again',
              onTap: retry);
        }
        final List<Map<String, dynamic>> entries = _items(snapshot.data,
            const <String>['applications', 'finance', 'payments', 'data']);
        if (entries.isEmpty) {
          return _StateCard(message: empty);
        }
        return Column(children: entries.map(builder).toList());
      });
}

class _QuickLink extends StatelessWidget {
  const _QuickLink(
      {required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Ink(
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFE0EAE4))),
          child: Column(children: <Widget>[
            Icon(icon, color: _solarGreen),
            const SizedBox(height: 8),
            Text(label,
                textAlign: TextAlign.center,
                style:
                    const TextStyle(fontSize: 12, fontWeight: FontWeight.w700))
          ])));
}

class _StateCard extends StatelessWidget {
  const _StateCard({required this.message, this.action, this.onTap});
  final String message;
  final String? action;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(24),
      alignment: Alignment.center,
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Column(children: <Widget>[
        const Icon(Icons.wb_sunny_outlined, color: _solarGreen, size: 32),
        const SizedBox(height: 10),
        Text(message, textAlign: TextAlign.center),
        if (action != null) TextButton(onPressed: onTap, child: Text(action!))
      ]));
}

List<Map<String, dynamic>> _items(
    Map<String, dynamic>? response, List<String> keys) {
  if (response == null) return const <Map<String, dynamic>>[];
  dynamic raw;
  for (final String key in keys) {
    if (response[key] != null) {
      raw = response[key];
      break;
    }
  }
  if (raw is Map) {
    for (final String key in keys) {
      if (raw[key] is List) {
        raw = raw[key];
        break;
      }
    }
  }
  return raw is List
      ? raw
          .whereType<Map>()
          .map((Map item) => Map<String, dynamic>.from(item))
          .toList()
      : const <Map<String, dynamic>>[];
}

String _text(Map<String, dynamic> map, List<String> keys,
    [String fallback = '']) {
  for (final String key in keys) {
    final String value = map[key]?.toString().trim() ?? '';
    if (value.isNotEmpty && value != 'null') return value;
  }
  return fallback;
}

num? _amount(Map<String, dynamic> map, List<String> keys) {
  for (final String key in keys) {
    final dynamic value = map[key];
    final num? amount =
        value is num ? value : num.tryParse(value?.toString() ?? '');
    if (amount != null) {
      return amount;
    }
  }
  return null;
}

bool solarCanPayDeposit(Map<String, dynamic> application) =>
    _text(application, <String>['status']).toUpperCase() ==
        'AWAITING_DEPOSIT' &&
    (solarDepositDue(application) ?? 0) > 0;

num? solarDepositDue(Map<String, dynamic> application) {
  final num? explicit = _amount(application, <String>['depositAmountDue']);
  if (explicit != null) {
    return explicit;
  }
  final num? required = _amount(application, <String>[
    'depositRequired',
    'calculatedDepositAmount',
  ]);
  final num paid = _amount(application, <String>['depositPaid']) ?? 0;
  if (required == null) {
    return null;
  }
  final num due = required - paid;
  return due > 0 ? due : 0;
}

num? solarFinanceDue(
  Map<String, dynamic> finance, {
  List<Map<String, dynamic>> schedule = const <Map<String, dynamic>>[],
}) {
  final num? next =
      _amount(finance, <String>['nextInstallmentAmount', 'installmentAmount']);
  if (next != null && next > 0) {
    return next;
  }
  final List<Map<String, dynamic>> embeddedSchedule = schedule.isNotEmpty
      ? schedule
      : _items(finance, const <String>['schedule']);
  for (final Map<String, dynamic> entry in embeddedSchedule) {
    final String status = _text(entry, <String>['status']).toUpperCase();
    if (status.isEmpty || status == 'PENDING' || status == 'DUE') {
      final num? due =
          _amount(entry, <String>['amountDue', 'installmentAmount', 'amount']);
      if (due != null && due > 0) {
        return due;
      }
    }
  }
  final num? outstanding = _amount(finance, <String>['outstandingBalance']);
  return outstanding != null && outstanding > 0 ? outstanding : null;
}

String solarFinanceDueDate(Map<String, dynamic> finance) => _text(finance,
    <String>['nextDueDate', 'nextPaymentDate', 'dueDate'], 'See your schedule');

String _packageName(Map<String, dynamic> item, String fallback) {
  final dynamic snapshot = item['packageSnapshot'];
  if (snapshot is Map) {
    final String name = _text(
        Map<String, dynamic>.from(snapshot), <String>['name', 'packageName']);
    if (name.isNotEmpty) {
      return name;
    }
  }
  return _text(
      item, <String>['packageName', 'package', 'name', 'title'], fallback);
}

String _money(dynamic value) {
  final double? amount = value is num
      ? value.toDouble()
      : double.tryParse(value?.toString() ?? '');
  if (amount == null) return 'Price on request';
  return '₦${amount.toStringAsFixed(2).replaceAllMapped(RegExp(r'(?<!^)(?=(\\d{3})+\\.)'), (Match match) => ',')}';
}
