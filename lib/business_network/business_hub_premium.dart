part of 'business_hub_screen.dart';

class _BusinessPremiumTools extends StatefulWidget {
  const _BusinessPremiumTools({
    required this.api,
    required this.kind,
    required this.profileId,
  });

  final BusinessNetworkApi api;
  final String kind;
  final String profileId;

  @override
  State<_BusinessPremiumTools> createState() => _BusinessPremiumToolsState();
}

class _BusinessPremiumToolsState extends State<_BusinessPremiumTools> {
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String _period = 'month';
  Map<String, dynamic> _tools = {};
  Map<String, dynamic> _voucherStatus = {};
  List<dynamic> _directory = [];
  List<dynamic> _expenses = [];
  late String _expenseKey =
      'business-expense-${DateTime.now().microsecondsSinceEpoch}';

  Map<String, String> get _query => {'profileId': widget.profileId};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant _BusinessPremiumTools oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.kind != widget.kind ||
        oldWidget.profileId != widget.profileId) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        widget.api.get('tools/${widget.kind}', query: {
          ..._query,
          'period': _period,
        }),
        widget.api.get('directory/${widget.kind}', query: _query),
        widget.api.get('expenses/${widget.kind}', query: _query),
        widget.api.get('vouchers/${widget.kind}', query: _query),
      ]);
      if (!mounted) return;
      setState(() {
        _tools = Map<String, dynamic>.from(results[0] as Map);
        _directory = (results[1] as Map)['items'] as List? ?? [];
        _expenses = (results[2] as Map)['items'] as List? ?? [];
        _voucherStatus = Map<String, dynamic>.from(results[3] as Map);
        _loading = false;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _runAction(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _card({required String title, required Widget child}) => Card(
        color: Colors.white,
        elevation: 0,
        margin: const EdgeInsets.only(bottom: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Color(0xFFDCE7DF)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              child,
            ],
          ),
        ),
      );

  Widget _metric(String label, dynamic value) => SizedBox(
        width: 142,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: const TextStyle(fontSize: 12, color: Color(0xFF59685F))),
            const SizedBox(height: 2),
            Text('$value',
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          ],
        ),
      );

  Future<void> _addContact() async {
    var name = '';
    var phone = '';
    var email = '';
    var consent = false;
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialog) => AlertDialog(
          title: const Text('Add a consented customer'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(
                onChanged: (value) => setDialog(() => name = value),
                decoration: const InputDecoration(labelText: 'Customer name'),
              ),
              TextField(
                onChanged: (value) => phone = value,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Phone number'),
              ),
              TextField(
                onChanged: (value) => email = value,
                keyboardType: TextInputType.emailAddress,
                decoration:
                    const InputDecoration(labelText: 'Email (optional)'),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: consent,
                onChanged: (value) => setDialog(() => consent = value == true),
                title: const Text(
                    'I have permission to store this customer’s contact details.'),
              ),
            ]),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: consent && name.trim().isNotEmpty
                  ? () => Navigator.pop(dialogContext, true)
                  : null,
              child: const Text('Save contact'),
            ),
          ],
        ),
      ),
    );
    if (result != true) return;
    await _runAction(() async {
      await widget.api.post(
        'directory/${widget.kind}',
        {
          'name': name.trim(),
          'phone': phone.trim(),
          'email': email.trim(),
          'consentAcknowledged': true,
        },
        query: _query,
      );
      await _load();
    });
  }

  Future<void> _removeContact(Map<String, dynamic> contact) async {
    final id = contact['_id']?.toString();
    if (id == null || id.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove customer contact?'),
        content: const Text(
            'This removes the contact from your private business directory.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Keep contact')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Remove')),
        ],
      ),
    );
    if (confirmed != true) return;
    await _runAction(() async {
      await widget.api.delete(
        'directory/${widget.kind}/${Uri.encodeComponent(id)}',
        query: _query,
      );
      await _load();
    });
  }

  Future<void> _addExpense() async {
    var amount = '';
    var description = '';
    var reference = '';
    String? validation;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialog) => AlertDialog(
          title: const Text('Record a business expense'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(
                onChanged: (value) => amount = value,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount in naira'),
              ),
              TextField(
                onChanged: (value) => description = value,
                decoration: const InputDecoration(labelText: 'Description'),
              ),
              TextField(
                onChanged: (value) => reference = value,
                decoration: const InputDecoration(
                    labelText: 'Receipt reference (optional)'),
              ),
              if (validation != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(validation!,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.error)),
                ),
              const Padding(
                padding: EdgeInsets.only(top: 10),
                child: Text(
                  'Bookkeeping only. This does not debit your ServicePay wallet.',
                  style: TextStyle(fontSize: 12),
                ),
              ),
            ]),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                final parsed = double.tryParse(amount.trim());
                if (parsed == null ||
                    !parsed.isFinite ||
                    parsed <= 0 ||
                    (parsed * 100).roundToDouble() != parsed * 100 ||
                    description.trim().isEmpty) {
                  setDialog(() =>
                      validation = 'Enter a positive amount and description.');
                  return;
                }
                final amountKobo = (parsed * 100).round();
                try {
                  await widget.api.post(
                    'expenses/${widget.kind}',
                    {
                      'amountKobo': amountKobo,
                      'description': description.trim(),
                      'reference': reference.trim(),
                      'idempotencyKey': _expenseKey,
                    },
                    query: _query,
                  );
                  _expenseKey =
                      'business-expense-${DateTime.now().microsecondsSinceEpoch}';
                  if (dialogContext.mounted) {
                    Navigator.pop(dialogContext);
                  }
                  await _load();
                } catch (error) {
                  setDialog(() => validation = error.toString());
                }
              },
              child: const Text('Save expense'),
            ),
          ],
        ),
      ),
    );
  }

  Uri? get _publicProfileUri {
    final path = _tools['publicProfilePath']?.toString();
    if (path == null || path.isEmpty) return null;
    final origin = Uri.parse(widget.api.baseUrl).origin;
    return Uri.parse('$origin$path');
  }

  Future<void> _changePublication(bool enabled) async {
    if (enabled) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Publish an informational profile?'),
          content: const Text(
            'Your business name, category and general location will become public. Owner contact details, KYC and wallet information will not be shown. This is not a payment QR or payment request.',
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Not now')),
            FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('I consent')),
          ],
        ),
      );
      if (confirmed != true) return;
    } else {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Turn off public profile?'),
          content:
              const Text('The informational page will no longer be public.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('Turn off')),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    await _runAction(() async {
      await widget.api.post(
        'public-profile/${widget.kind}',
        {'enabled': enabled, 'consentAcknowledged': true},
        query: _query,
      );
      await _load();
    });
  }

  Widget _directoryCard() => _card(
        title: 'Customer directory',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Private owner-only contacts. Add a customer only with permission; staff accounts cannot access this directory.',
              style: TextStyle(height: 1.4),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: _busy ? null : _addContact,
                icon: const Icon(Icons.person_add_alt_1_outlined),
                label: const Text('Add contact'),
              ),
            ),
            if (_directory.isEmpty)
              const _EmptyState(
                  text: 'No consented customer contacts are saved.'),
            ..._directory.map((raw) {
              final contact = Map<String, dynamic>.from(raw as Map);
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(contact['name']?.toString() ?? 'Customer'),
                subtitle: Text(
                    '${contact['phone'] ?? ''}${contact['email']?.toString().isNotEmpty == true ? ' · ${contact['email']}' : ''}'),
                trailing: IconButton(
                  tooltip: 'Remove contact',
                  onPressed: _busy ? null : () => _removeContact(contact),
                  icon: const Icon(Icons.delete_outline),
                ),
              );
            }),
          ],
        ),
      );

  Widget _expenseCard() => _card(
        title: 'Business expenses',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Manual business bookkeeping only. Entries never change wallet balances or move money.',
              style: TextStyle(height: 1.4),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: _busy ? null : _addExpense,
                icon: const Icon(Icons.add),
                label: const Text('Record expense'),
              ),
            ),
            if (_expenses.isEmpty)
              const _EmptyState(text: 'No expense entries recorded.'),
            ..._expenses.map((raw) {
              final entry = Map<String, dynamic>.from(raw as Map);
              final metadata = entry['metadata'] is Map
                  ? Map<String, dynamic>.from(entry['metadata'] as Map)
                  : const <String, dynamic>{};
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(metadata['description']?.toString() ?? 'Expense'),
                subtitle: Text(
                    '${metadata['reference'] ?? 'No receipt reference'} · ${entry['createdAt'] ?? ''}'),
                trailing: Text(_naira(metadata['amountKobo'])),
              );
            }),
          ],
        ),
      );

  Widget _publicProfileCard() {
    final enabled = _tools['publicProfile'] == true;
    final uri = _publicProfileUri;
    return _card(
      title: 'Verified business profile',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'An informational profile only. It does not accept payments and is not a payment QR.',
            style: TextStyle(height: 1.4),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Share public profile'),
            subtitle:
                Text(enabled ? 'Public profile is on' : 'Currently private'),
            value: enabled,
            onChanged: _busy ? null : _changePublication,
          ),
          if (enabled && uri != null) ...[
            Center(
              child: QrImageView(
                data: uri.toString(),
                size: 156,
                backgroundColor: Colors.white,
                eyeStyle: const QrEyeStyle(
                  eyeShape: QrEyeShape.square,
                  color: Color(0xFF18372A),
                ),
                dataModuleStyle: const QrDataModuleStyle(
                  dataModuleShape: QrDataModuleShape.square,
                  color: Color(0xFF18372A),
                ),
                semanticsLabel: 'Informational ServicePay business profile QR',
              ),
            ),
            SelectableText(uri.toString()),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(
                        ClipboardData(text: uri.toString()));
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Profile link copied.')),
                      );
                    }
                  },
                  icon: const Icon(Icons.copy_outlined),
                  label: const Text('Copy link'),
                ),
                OutlinedButton.icon(
                  onPressed: () => SharePlus.instance.share(
                    ShareParams(text: 'ServicePay business profile: $uri'),
                  ),
                  icon: const Icon(Icons.share_outlined),
                  label: const Text('Share'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _capabilityNotice(
      String title, Map<String, dynamic> reasons, String capability) {
    final reason = reasons[capability]?.toString() ??
        'This capability is not enabled in the verified Business Network API.';
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.lock_outline, color: Color(0xFF59685F)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(reason),
    );
  }

  Widget _voucherCapability() {
    final contract = _voucherStatus['contract'] is Map
        ? Map<String, dynamic>.from(_voucherStatus['contract'] as Map)
        : const <String, dynamic>{};
    final airtime = contract['airtime'] is Map
        ? Map<String, dynamic>.from(contract['airtime'] as Map)
        : const <String, dynamic>{};
    final data = contract['data'] is Map
        ? Map<String, dynamic>.from(contract['data'] as Map)
        : const <String, dynamic>{};
    final prerequisites = contract['prerequisites'] as List? ?? const [];
    return _card(
      title: 'Voucher issuance readiness',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_voucherStatus['message']?.toString() ??
              'Voucher issuing remains disabled.'),
          const SizedBox(height: 8),
          const Text(
            'Telecom Abode publishes official airtime and data PIN request documentation. This customer app does not buy or print vouchers: pre-purchase price/availability, duplicate and timeout recovery, reference mapping, data catalogue/body consistency, dedicated encryption key, settlement admission, printer verification and redemption authority are still unverified.',
            style: TextStyle(height: 1.4),
          ),
          const SizedBox(height: 8),
          if (airtime['documentation'] != null)
            SelectableText(
                'Airtime PIN docs: ${airtime['documentation']} · endpoint ${airtime['issue'] ?? '/recharge_card'}'),
          if (data['documentation'] != null)
            SelectableText(
                'Data PIN docs: ${data['documentation']} · endpoint ${data['issue'] ?? '/data_card'}'),
          if (data['catalogueVerified'] == false)
            const Text(
              'Data PIN catalogue is not verified against the documented request body.',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          if (prerequisites.isNotEmpty) ...[
            const SizedBox(height: 6),
            const Text('Remaining verification prerequisites:',
                style: TextStyle(fontWeight: FontWeight.w700)),
            ...prerequisites.map((item) => Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Text('• ${item.toString()}'),
                )),
          ],
          if (_voucherStatus['enabled'] == true ||
              _voucherStatus['inventoryVerified'] == true)
            const Text(
              'The API reports an unexpected enabled or verified state; no purchase or PIN control is available in this screen.',
            ),
        ],
      ),
    );
  }

  Widget _referralAndCampaigns() {
    final code = _tools['referralCode']?.toString();
    final campaigns = _tools['campaigns'] as List? ?? const [];
    final goals = _tools['goals'] as List? ?? const [];
    final levels = _tools['levels'] as List? ?? const [];
    return Column(
      children: [
        _card(
          title: 'Referral programme',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(code?.isNotEmpty == true
                  ? 'Your existing ServicePay referral code: $code'
                  : 'No referral code is available on this account.'),
              const SizedBox(height: 5),
              Text(
                _tools['referralRewardAuthority']?.toString() ??
                    'Referral rewards remain controlled by the existing ServicePay programme.',
                style: const TextStyle(fontSize: 12),
              ),
              if (code?.isNotEmpty == true)
                TextButton.icon(
                  onPressed: () => SharePlus.instance.share(
                    ShareParams(text: ReferralLinkBuilder.build(code!)),
                  ),
                  icon: const Icon(Icons.share_outlined),
                  label: const Text('Share referral link'),
                ),
              TextButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const ReferralScreen(),
                  ),
                ),
                icon: const Icon(Icons.people_outline),
                label: const Text('View referral performance and rewards'),
              ),
            ],
          ),
        ),
        _card(
          title: 'Goals and progress',
          child: goals.isEmpty
              ? const _EmptyState(
                  text: 'No active business goals are configured.')
              : Column(
                  children: goals.map((raw) {
                    final goal = Map<String, dynamic>.from(raw as Map);
                    final current = goal['current'] is Map
                        ? Map<String, dynamic>.from(goal['current'] as Map)
                        : const <String, dynamic>{};
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(goal['title']?.toString() ?? 'Business goal'),
                      subtitle: Text(
                          '${goal['period']} · ${current['transactions'] ?? 0}/${goal['targetTransactions']} transactions · ${_naira(current['volumeKobo'])}/${_naira(goal['targetVolumeKobo'])}'),
                      trailing: Icon(
                        goal['completed'] == true
                            ? Icons.check_circle_outline
                            : Icons.trending_up,
                        color: const Color(0xFF08783E),
                      ),
                    );
                  }).toList(),
                ),
        ),
        if (widget.kind == 'AGENT')
          _card(
            title: 'Agent level qualification',
            child: levels.isEmpty
                ? const _EmptyState(
                    text: 'No levels are returned for this profile.')
                : Column(
                    children: levels.map((raw) {
                      final level = Map<String, dynamic>.from(raw as Map);
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(level['label']?.toString() ??
                            level['code']?.toString() ??
                            'Level'),
                        subtitle: Text(
                            level['assigned'] == true
                                ? 'Assigned level'
                                : level['qualified'] == true
                                    ? 'Qualification met; assignment is controlled by Head Office.'
                                    : 'Not qualified',
                            style: const TextStyle(fontSize: 12)),
                        trailing: level['qualified'] == true
                            ? const Icon(Icons.verified_outlined,
                                color: Color(0xFF08783E))
                            : null,
                      );
                    }).toList(),
                  ),
          ),
        _card(
          title: 'Current campaigns',
          child: campaigns.isEmpty
              ? const _EmptyState(
                  text:
                      'No active campaigns are available for this business type.')
              : Column(
                  children: campaigns.map((raw) {
                    final campaign = Map<String, dynamic>.from(raw as Map);
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(campaign['title']?.toString() ?? 'Campaign'),
                      subtitle: Text(campaign['description']?.toString() ?? ''),
                    );
                  }).toList(),
                ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _tools.isEmpty) {
      return _card(
        title: 'Owner business tools',
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _PremiumSkeletonLine(width: 210),
            SizedBox(height: 12),
            _PremiumSkeletonLine(width: 300),
            SizedBox(height: 12),
            _PremiumSkeletonLine(width: 160),
          ],
        ),
      );
    }
    if (_error != null && _tools.isEmpty) {
      return _card(
        title: 'Owner business tools',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_error!),
            TextButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );
    }
    final stats = _tools['stats'] is Map
        ? Map<String, dynamic>.from(_tools['stats'] as Map)
        : const <String, dynamic>{};
    final lifetime = _tools['lifetime'] is Map
        ? Map<String, dynamic>.from(_tools['lifetime'] as Map)
        : const <String, dynamic>{};
    final expenses = _tools['expenses'] is Map
        ? Map<String, dynamic>.from(_tools['expenses'] as Map)
        : const <String, dynamic>{};
    final transactionSummary = _tools['transactionSummary'] is Map
        ? Map<String, dynamic>.from(_tools['transactionSummary'] as Map)
        : const <String, dynamic>{};
    final ranking = _tools['ranking'] is Map
        ? Map<String, dynamic>.from(_tools['ranking'] as Map)
        : const <String, dynamic>{};
    final loyalty = _tools['loyalty'] is Map
        ? Map<String, dynamic>.from(_tools['loyalty'] as Map)
        : const <String, dynamic>{};
    final reasons = _tools['capabilityReasons'] is Map
        ? Map<String, dynamic>.from(_tools['capabilityReasons'] as Map)
        : const <String, dynamic>{};
    final features = _tools['features'] is Map
        ? Map<String, dynamic>.from(_tools['features'] as Map)
        : const <String, dynamic>{};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _card(
          title: 'Owner business tools',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Private owner tools remain separate from your customer wallet. Staff permissions do not grant access here.',
                style: TextStyle(height: 1.4),
              ),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'day', label: Text('Day')),
                  ButtonSegment(value: 'week', label: Text('Week')),
                  ButtonSegment(value: 'month', label: Text('Month')),
                ],
                selected: {_period},
                onSelectionChanged: (selection) {
                  setState(() => _period = selection.first);
                  _load();
                },
              ),
              if (_loading) const LinearProgressIndicator(),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error)),
                TextButton(onPressed: _load, child: const Text('Retry')),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 18,
                runSpacing: 12,
                children: [
                  _metric('Period transactions', stats['transactions'] ?? 0),
                  _metric('Period volume', _naira(stats['volumeKobo'])),
                  _metric(
                      'Lifetime transactions', lifetime['transactions'] ?? 0),
                  _metric('Lifetime volume', _naira(lifetime['volumeKobo'])),
                  _metric('Expense entries', expenses['count'] ?? 0),
                  _metric('Expenses', _naira(expenses['amountKobo'])),
                  _metric('Commission income',
                      _naira(_tools['commissionIncomeKobo'])),
                  _metric('Commission after expenses',
                      _naira(_tools['netCommissionAfterExpensesKobo'])),
                  _metric(
                      'Business sales revenue',
                      _tools['salesRevenueKobo'] == null
                          ? 'Not reported'
                          : _naira(_tools['salesRevenueKobo'])),
                ],
              ),
              if (_tools['revenueDescription'] != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_tools['revenueDescription'].toString(),
                      style: const TextStyle(fontSize: 12)),
                ),
              const SizedBox(height: 10),
              Text(
                'Verified activity · ${transactionSummary['successful'] ?? 0} successful · ${transactionSummary['pending'] ?? 0} pending · ${transactionSummary['failed'] ?? 0} failed · ${transactionSummary['refunded'] ?? 0} refunded · ${_naira(transactionSummary['volumeKobo'])} purchase volume',
                style: const TextStyle(fontSize: 12),
              ),
              if (ranking.isNotEmpty)
                Text(
                    'Verified rank ${ranking['rank'] ?? '—'} of ${ranking['participants'] ?? 0} · ${ranking['metric'] ?? ''} · ${ranking['period'] ?? ''}',
                    style: const TextStyle(fontSize: 12)),
              const SizedBox(height: 8),
              const Text('Best-selling verified services',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              ...(_tools['bestSellingServices'] as List? ?? const [])
                  .map((raw) {
                final service = Map<String, dynamic>.from(raw as Map);
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(service['service']?.toString() ?? 'Service'),
                  subtitle:
                      Text('${service['count'] ?? 0} verified transactions'),
                  trailing: Text(_naira(service['volumeKobo'])),
                );
              }),
            ],
          ),
        ),
        _card(
          title: 'Non-cash loyalty activity',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Points are not cash, cannot be redeemed here and never enter your wallet.',
                style: TextStyle(height: 1.4),
              ),
              Wrap(
                spacing: 18,
                runSpacing: 10,
                children: [
                  _metric('Earned', loyalty['earned'] ?? 0),
                  _metric('Reversed', loyalty['reversed'] ?? 0),
                  _metric('Available points', loyalty['available'] ?? 0),
                  _metric('Expired', loyalty['expired'] ?? 0),
                  _metric('Cash value', '₦0.00'),
                ],
              ),
              ...((loyalty['items'] as List? ?? const []).map((raw) {
                final event = Map<String, dynamic>.from(raw as Map);
                final metadata = event['metadata'] is Map
                    ? Map<String, dynamic>.from(event['metadata'] as Map)
                    : const <String, dynamic>{};
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    event['action']?.toString() == 'LOYALTY_REVERSED'
                        ? 'Points reversed'
                        : 'Points earned',
                  ),
                  subtitle: Text(event['createdAt']?.toString() ?? ''),
                  trailing: Text('${metadata['points'] ?? 0}'),
                );
              })),
            ],
          ),
        ),
        _directoryCard(),
        _expenseCard(),
        _publicProfileCard(),
        _referralAndCampaigns(),
        _voucherCapability(),
        _card(
          title: 'Unavailable purchase capabilities',
          child: Column(
            children: [
              _capabilityNotice(
                  'Airtime voucher PINs', reasons, 'rechargeVouchers'),
              _capabilityNotice('Data voucher PINs', reasons, 'dataVouchers'),
              _capabilityNotice('Discounted special purchase prices', reasons,
                  'specialPurchasePricing'),
              _capabilityNotice(
                  'Bulk airtime/data purchases', reasons, 'bulkPurchases'),
              _capabilityNotice('Business payment QR', reasons, 'merchantQr'),
              _capabilityNotice('Payment links', reasons, 'payByLink'),
              _capabilityNotice(
                  'Automatic payouts', reasons, 'automaticPayouts'),
              if (features['merchantQr'] == true ||
                  features['payByLink'] == true ||
                  features['automaticPayouts'] == true)
                const Text(
                  'A capability is reported enabled by the service, but this screen does not implement payments or payouts.',
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PremiumSkeletonLine extends StatelessWidget {
  const _PremiumSkeletonLine({required this.width});
  final double width;

  @override
  Widget build(BuildContext context) => Container(
        width: width,
        height: 13,
        decoration: BoxDecoration(
          color: const Color(0xFFE4ECE6),
          borderRadius: BorderRadius.circular(7),
        ),
      );
}
