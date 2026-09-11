import 'package:flutter/material.dart';
import 'organization_models.dart';
import 'organizations_api.dart';

class OrganizationsScreen extends StatefulWidget {
  const OrganizationsScreen({super.key, this.api});
  final OrganizationsApi? api;
  @override
  State<OrganizationsScreen> createState() => _OrganizationsScreenState();
}

class _OrganizationsScreenState extends State<OrganizationsScreen> {
  late final OrganizationsApi api;
  final search = TextEditingController();
  List<Organization> mine = [];
  List<Organization> explore = [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    api = widget.api ?? OrganizationsApi();
    _load();
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final results = await Future.wait([api.mine(), api.explore()]);
      if (mounted)
        setState(() {
          mine = results[0];
          explore = results[1];
          loading = false;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          error = e.toString().replaceFirst('Exception: ', '');
          loading = false;
        });
    }
  }

  Future<void> _search(String value) async {
    try {
      final items = await api.explore(query: value.trim());
      if (mounted) setState(() => explore = items);
    } catch (_) {}
  }

  void _open(Organization org) {
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) =>
            OrganizationProfileScreen(api: api, organization: org)));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF7F9F8),
        appBar: AppBar(
            title: const Text('Organizations'),
            backgroundColor: Colors.white,
            foregroundColor: const Color(0xFF15201B),
            elevation: 0),
        body: RefreshIndicator(
          onRefresh: _load,
          child: loading
              ? ListView(
                  padding: const EdgeInsets.all(16),
                  children: const [_Skeleton(), _Skeleton(), _Skeleton()])
              : error != null
                  ? _ErrorState(message: error!, retry: _load)
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
                      children: [
                          const Text('Your communities',
                              style: TextStyle(
                                  fontWeight: FontWeight.w900, fontSize: 21)),
                          const SizedBox(height: 4),
                          Text(
                              'Stay connected to the organizations that matter to you.',
                              style: TextStyle(color: Colors.grey.shade600)),
                          const SizedBox(height: 14),
                          if (mine.isEmpty)
                            const _Empty(
                                label:
                                    'You have not joined an organization yet.'),
                          for (final org in mine)
                            _OrganizationTile(
                                org: org, onTap: () => _open(org)),
                          const SizedBox(height: 24),
                          TextField(
                            controller: search,
                            onChanged: _search,
                            decoration: InputDecoration(
                              hintText: 'Explore organizations',
                              prefixIcon: const Icon(Icons.search_rounded),
                              suffixIcon: search.text.isNotEmpty
                                  ? IconButton(
                                      onPressed: () {
                                        search.clear();
                                        _search('');
                                        setState(() {});
                                      },
                                      icon: const Icon(Icons.clear))
                                  : null,
                              filled: true,
                              fillColor: Colors.white,
                              border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(16),
                                  borderSide: BorderSide.none),
                            ),
                          ),
                          const SizedBox(height: 18),
                          const Text('Discover',
                              style: TextStyle(
                                  fontWeight: FontWeight.w900, fontSize: 19)),
                          const SizedBox(height: 8),
                          if (explore.isEmpty)
                            const _Empty(
                                label:
                                    'No organizations found. Try another search.'),
                          for (final org in explore)
                            _OrganizationTile(
                                org: org, onTap: () => _open(org)),
                        ]),
        ),
      );
}

class OrganizationProfileScreen extends StatefulWidget {
  const OrganizationProfileScreen(
      {super.key, required this.api, required this.organization});
  final OrganizationsApi api;
  final Organization organization;
  @override
  State<OrganizationProfileScreen> createState() =>
      _OrganizationProfileScreenState();
}

class _OrganizationProfileScreenState extends State<OrganizationProfileScreen> {
  late Organization org;
  bool joining = false;
  @override
  void initState() {
    super.initState();
    org = widget.organization;
  }

  Future<void> _join() async {
    if (org.joinStatus?.toUpperCase() == 'PENDING' ||
        org.joinStatus?.toUpperCase() == 'ACTIVE') return;
    setState(() => joining = true);
    try {
      org = await widget.api.detail(org.id);
    } catch (_) {}
    if (!mounted) return;
    final fields = <String, dynamic>{};
    final ok = await showDialog<bool>(
            context: context,
            builder: (_) => _JoinDialog(org: org, values: fields)) ??
        false;
    if (!ok) {
      if (mounted) setState(() => joining = false);
      return;
    }
    try {
      final result = await widget.api.apply(
        org.id,
        {'applicationData': fields},
      );
      final application = result['application'] is Map
          ? Map<String, dynamic>.from(result['application'])
          : result['applicationData'] is Map
              ? Map<String, dynamic>.from(result['applicationData'])
              : <String, dynamic>{};
      final membership = result['membership'] is Map
          ? Map<String, dynamic>.from(result['membership'])
          : <String, dynamic>{};
      final candidate =
          result['status'] ?? membership['status'] ?? application['status'];
      final normalized = '${candidate ?? 'PENDING'}'.toUpperCase();
      final status = normalized == 'ACTIVE' ? 'ACTIVE' : 'PENDING';
      if (mounted)
        setState(() {
          org = Organization.fromJson({
            ..._orgJson(org),
            'joinStatus': status,
            'registrationDue': result['registrationDue'],
          });
          joining = false;
        });
    } catch (e) {
      if (mounted) {
        setState(() => joining = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    }
  }

  Map<String, dynamic> _orgJson(Organization o) => {
        'id': o.id,
        'name': o.name,
        'description': o.description,
        'category': o.category,
        'verified': o.verified,
        'membershipFee': o.fee,
        'joinStatus': o.joinStatus,
        'customFields': o.fields
            .map((f) => {
                  'key': f.key,
                  'label': f.label,
                  'required': f.required,
                  'type': f.type
                })
            .toList()
      };

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF7F9F8),
        appBar: AppBar(
            title: const Text('Organization profile'),
            backgroundColor: Colors.white,
            foregroundColor: const Color(0xFF15201B),
            elevation: 0),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                  color: const Color(0xFF0B6B3A),
                  borderRadius: BorderRadius.circular(24)),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                            radius: 29,
                            backgroundColor: Colors.white24,
                            child: Text(
                                org.name.isEmpty
                                    ? '?'
                                    : org.name[0].toUpperCase(),
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 24,
                                    fontWeight: FontWeight.bold))),
                        const SizedBox(width: 14),
                        Expanded(
                            child: Text(org.name,
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w900,
                                    fontSize: 22))),
                        if (org.verified)
                          const Icon(Icons.verified_rounded,
                              color: Colors.white)
                      ],
                    ),
                    if (org.category.isNotEmpty)
                      Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(org.category,
                              style: const TextStyle(color: Colors.white70))),
                  ])),
          const SizedBox(height: 18),
          Text(
              org.description.isEmpty
                  ? 'A verified ServicePay organization.'
                  : org.description,
              style: const TextStyle(fontSize: 16, height: 1.45)),
          const SizedBox(height: 18),
          Card(
              child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(children: [
                    _InfoRow(
                        icon: Icons.verified_user_outlined,
                        title: org.verified
                            ? 'Verified organization'
                            : 'Organization profile',
                        detail: 'Public information is shown safely.'),
                    const Divider(height: 24),
                    _InfoRow(
                        icon: Icons.payments_outlined,
                        title: 'Membership fee',
                        detail: org.fee > 0
                            ? '${org.currency} ${org.fee}'
                            : 'No fee listed'),
                  ]))),
          const SizedBox(height: 20),
          if (org.joinStatus?.toUpperCase() == 'PENDING')
            Column(children: [
              Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                      color: Colors.amber.shade50,
                      borderRadius: BorderRadius.circular(16)),
                  child: const Row(children: [
                    Icon(Icons.schedule_rounded, color: Colors.orange),
                    SizedBox(width: 10),
                    Expanded(
                        child: Text('Your application is pending review.',
                            style: TextStyle(fontWeight: FontWeight.w700)))
                  ])),
              if (org.registrationDue != null)
                Card(
                  color: Colors.orange.shade50,
                  child: ListTile(
                    leading: const Icon(Icons.payments_outlined),
                    title: const Text('Registration fee due'),
                    subtitle: Text(
                        '${org.registrationDue!['currency'] ?? org.currency} ${org.registrationDue!['amount'] ?? ''}'),
                    trailing: const Icon(Icons.arrow_forward),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(
                        builder: (_) => OrganizationPaymentsScreen(
                            api: widget.api, organization: org))),
                  ),
                ),
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => OrganizationPaymentsScreen(
                        api: widget.api, organization: org))),
                icon: const Icon(Icons.payments_outlined),
                label: const Text('Dues & payments'),
              ),
            ])
          else if (org.joinStatus?.toUpperCase() == 'ACTIVE')
            Column(children: [
              FilledButton.icon(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => OrganizationMemberScreen(
                          api: widget.api, organization: org))),
                  icon: const Icon(Icons.badge_outlined),
                  label: const Text('View membership card')),
              OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => OrganizationPaymentsScreen(
                          api: widget.api, organization: org))),
                  icon: const Icon(Icons.payments_outlined),
                  label: const Text('Dues & payments')),
            ])
          else
            FilledButton.icon(
                style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF08783E),
                    minimumSize: const Size.fromHeight(52)),
                onPressed: joining ? null : _join,
                icon: joining
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            color: Colors.white, strokeWidth: 2))
                    : const Icon(Icons.group_add_outlined),
                label:
                    Text(joining ? 'Sending application...' : 'Apply to join')),
          if (org.allowedToManage)
            OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => OrganizationOwnerDashboard(
                        api: widget.api, organization: org))),
                icon: const Icon(Icons.dashboard_outlined),
                label: const Text('Organization dashboard')),
        ]),
      );
}

class OrganizationMemberScreen extends StatelessWidget {
  const OrganizationMemberScreen(
      {super.key, required this.organization, required this.api});
  final Organization organization;
  final OrganizationsApi api;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Membership card')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Card(
            color: const Color(0xFF08783E),
            child: Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('SERVICEPAY MEMBERSHIP',
                          style: TextStyle(
                              color: Colors.white70,
                              letterSpacing: 1.2,
                              fontSize: 12)),
                      const SizedBox(height: 30),
                      Text(organization.name,
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 8),
                      Text(
                          organization.verified
                              ? 'Verified member • ${organization.joinStatus ?? 'ACTIVE'}'
                              : 'Member',
                          style: const TextStyle(color: Colors.white)),
                      const SizedBox(height: 24),
                      Container(
                          padding: const EdgeInsets.all(10),
                          color: Colors.white,
                          child: Text(
                              organization.verificationUrl.isNotEmpty
                                  ? organization.verificationUrl
                                  : 'Verification code: ${organization.membershipNumber.isEmpty ? organization.id : organization.membershipNumber}',
                              style: const TextStyle(
                                  fontFamily: 'monospace', fontSize: 11))),
                    ]))),
        if (organization.membershipNumber.isNotEmpty)
          Text('Membership number: ${organization.membershipNumber}',
              style: const TextStyle(fontWeight: FontWeight.w800)),
        const Text('Public verification details (not a QR code).',
            style: TextStyle(color: Colors.black54)),
        if (organization.expiryDate != null)
          Text(
              'Expiry: ${organization.expiryDate!.day}/${organization.expiryDate!.month}/${organization.expiryDate!.year}'),
        const Text(
            'Show this card when your organization requests membership verification. Private contact and wallet data are never displayed.',
            style: TextStyle(color: Colors.black54, height: 1.4)),
      ]));
}

class OrganizationOwnerDashboard extends StatefulWidget {
  const OrganizationOwnerDashboard(
      {super.key, required this.api, required this.organization});
  final OrganizationsApi api;
  final Organization organization;
  @override
  State<OrganizationOwnerDashboard> createState() =>
      _OrganizationOwnerDashboardState();
}

class _OrganizationOwnerDashboardState
    extends State<OrganizationOwnerDashboard> {
  Map<String, dynamic>? data;
  @override
  void initState() {
    super.initState();
    widget.api.dashboard(widget.organization.id).then((value) {
      if (mounted) setState(() => data = value);
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Organization dashboard')),
        body: data == null
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Text('Your organization overview',
                      style:
                          TextStyle(fontWeight: FontWeight.w900, fontSize: 20)),
                  for (final key in const [
                    'members',
                    'dues',
                    'announcements',
                    'branches',
                    'staff'
                  ])
                    if (data![key] != null)
                      Card(
                        child: ListTile(
                          title: Text(key[0].toUpperCase() + key.substring(1)),
                          subtitle: Text('${data![key]}'),
                        ),
                      ),
                  const ListTile(
                      leading: Icon(Icons.lock_outline),
                      title: Text('Withdrawals disabled'),
                      subtitle: Text(
                          'Organization funds cannot be withdrawn from the customer app.')),
                ],
              ),
      );
}

class OrganizationPaymentsScreen extends StatefulWidget {
  const OrganizationPaymentsScreen(
      {super.key, required this.api, required this.organization});
  final OrganizationsApi api;
  final Organization organization;
  @override
  State<OrganizationPaymentsScreen> createState() =>
      _OrganizationPaymentsScreenState();
}

class _OrganizationPaymentsScreenState
    extends State<OrganizationPaymentsScreen> {
  List<Map<String, dynamic>> dues = [];
  bool loading = true;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final value = await widget.api.dues(widget.organization.id);
      if (mounted)
        setState(() {
          dues = value;
          loading = false;
        });
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _pay(String dueId) async {
    final pin = TextEditingController();
    final ok = await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
                  title: const Text('Pay securely from wallet'),
                  content: TextField(
                      controller: pin,
                      obscureText: true,
                      maxLength: 4,
                      keyboardType: TextInputType.number,
                      decoration:
                          const InputDecoration(labelText: 'Transaction PIN')),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(c),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: () => Navigator.pop(c, true),
                        child: const Text('Pay'))
                  ],
                )) ??
        false;
    if (!ok || pin.text.trim().length != 4) {
      pin.dispose();
      return;
    }
    try {
      final result = await widget.api.pay(
          organizationId: widget.organization.id,
          dueId: dueId,
          pin: pin.text.trim());
      if (mounted)
        await showDialog<void>(
            context: context,
            builder: (c) => AlertDialog(
                  title: const Text('Payment received'),
                  content: Text(
                      'Status: ${result['status'] ?? (result['payment'] is Map ? result['payment']['status'] : 'PROCESSING')}\nReference: ${result['reference'] ?? result['paymentReference'] ?? 'Available in transactions'}'),
                  actions: [
                    FilledButton(
                        onPressed: () => Navigator.pop(c),
                        child: const Text('Done'))
                  ],
                ));
      _load();
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', ''))));
    }
    pin.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Dues & payments')),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(padding: const EdgeInsets.all(16), children: [
                if (dues.isEmpty) const _Empty(label: 'No outstanding dues.'),
                for (final due in dues)
                  Card(
                      child: ListTile(
                    title: Text(
                        '${due['title'] ?? due['name'] ?? 'Organization due'}'),
                    subtitle: Text(
                        '${due['currency'] ?? 'NGN'} ${due['amount'] ?? ''} • ${due['status'] ?? 'OUTSTANDING'}'),
                    trailing: IconButton(
                        onPressed: () =>
                            _pay('${due['id'] ?? due['_id'] ?? 'annual'}'),
                        icon: const Icon(Icons.lock_outline)),
                  )),
              ]),
      );
}

class _JoinDialog extends StatefulWidget {
  const _JoinDialog({required this.org, required this.values});
  final Organization org;
  final Map<String, dynamic> values;
  @override
  State<_JoinDialog> createState() => _JoinDialogState();
}

class _JoinDialogState extends State<_JoinDialog> {
  final form = GlobalKey<FormState>();
  final multi = <String, Set<String>>{};
  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('Join ${widget.org.name}'),
        content: SizedBox(
          width: 420,
          child: Form(
            key: form,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  Text('Your application will be reviewed by the organization.',
                      style: TextStyle(color: Colors.grey.shade700)),
                  _applicationField('fullName', 'Full name', required: true),
                  _applicationField('phone', 'Phone number', required: true),
                  _applicationField('email', 'Email address', required: true),
                  for (final field in widget.org.fields
                      .where((field) => field.type.toUpperCase() != 'FILE'))
                    _typedField(field),
                  if (widget.org.fields.any((field) =>
                      field.type.toUpperCase() == 'FILE' && !field.required))
                    const Padding(
                      padding: EdgeInsets.only(top: 12),
                      child: Text(
                          'Document fields require a secure verified upload flow and are not available in this application.',
                          style: TextStyle(color: Colors.black54)),
                    ),
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (form.currentState?.validate() ?? false) {
                form.currentState!.save();
                Navigator.pop(context, true);
              }
            },
            child: const Text('Submit application'),
          ),
        ],
      );

  Widget _typedField(OrganizationField field) {
    final type = field.type.toUpperCase();
    if (type == 'BOOLEAN') {
      return SwitchListTile(
        title: Text(field.label),
        value: widget.values[field.key] == 'true',
        onChanged: (value) =>
            setState(() => widget.values[field.key] = '$value'),
      );
    }
    if (type == 'SELECT') {
      final options = field.options;
      return DropdownButtonFormField<String>(
        decoration: InputDecoration(labelText: field.label),
        items: options
            .map((o) => DropdownMenuItem(value: o, child: Text(o)))
            .toList(),
        validator: field.required ? (v) => v == null ? 'Required' : null : null,
        onChanged: (v) => widget.values[field.key] = v ?? '',
      );
    }
    if (type == 'MULTISELECT') {
      final selectedValues = multi.putIfAbsent(field.key, () => <String>{});
      return FormField<void>(
        validator: (_) => field.required && selectedValues.isEmpty
            ? 'Select at least one'
            : null,
        builder: (state) =>
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(field.label),
          Wrap(
              children: field.options
                  .map((option) => FilterChip(
                        label: Text(option),
                        selected: selectedValues.contains(option),
                        onSelected: (selected) => setState(() {
                          if (selected) {
                            selectedValues.add(option);
                          } else {
                            selectedValues.remove(option);
                          }
                          widget.values[field.key] = selectedValues.toList();
                        }),
                      ))
                  .toList()),
          if (state.hasError)
            Text(state.errorText!, style: const TextStyle(color: Colors.red)),
        ]),
      );
    }
    if (type == 'DATE') {
      return TextFormField(
        readOnly: true,
        decoration: InputDecoration(
            labelText: field.label,
            suffixIcon: const Icon(Icons.calendar_today)),
        validator: field.required
            ? (v) =>
                (widget.values[field.key] ?? '').isEmpty ? 'Required' : null
            : null,
        onTap: () async {
          final date = await showDatePicker(
              context: context,
              firstDate: DateTime(1900),
              lastDate: DateTime(2200),
              initialDate: DateTime.now());
          if (date != null)
            widget.values[field.key] = date.toIso8601String().split('T').first;
        },
      );
    }
    final file = type == 'FILE';
    return TextFormField(
      decoration: InputDecoration(
        labelText: field.label,
        helperText:
            file ? 'Uploads are enabled once authorized storage exists.' : null,
      ),
      keyboardType: type == 'PHONE'
          ? TextInputType.phone
          : type == 'EMAIL'
              ? TextInputType.emailAddress
              : type == 'NUMBER'
                  ? TextInputType.number
                  : TextInputType.text,
      validator: (value) {
        final v = (value ?? '').trim();
        if (field.required && v.isEmpty) return 'Required';
        if (file && (v.contains('://') || v.startsWith('http')))
          return 'Do not enter a file URL';
        if (type == 'EMAIL' &&
            v.isNotEmpty &&
            !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v))
          return 'Enter a valid email';
        if (type == 'NUMBER' && v.isNotEmpty && num.tryParse(v) == null)
          return 'Enter a number';
        return null;
      },
      onSaved: (value) {
        if (file) {
          widget.values.remove(field.key);
        } else {
          widget.values[field.key] = (value ?? '').trim();
        }
      },
    );
  }

  Widget _applicationField(String key, String label,
          {required bool required}) =>
      Padding(
        padding: const EdgeInsets.only(top: 14),
        child: TextFormField(
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
          ),
          keyboardType:
              key == 'email' ? TextInputType.emailAddress : TextInputType.text,
          validator: (value) {
            if (required && (value ?? '').trim().isEmpty) return 'Required';
            if (key == 'email' &&
                !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                    .hasMatch((value ?? '').trim())) {
              return 'Enter a valid email';
            }
            return null;
          },
          onSaved: (value) => widget.values[key] = value?.trim() ?? '',
        ),
      );
}

class _OrganizationTile extends StatelessWidget {
  const _OrganizationTile({required this.org, required this.onTap});
  final Organization org;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 10),
        child: ListTile(
          onTap: onTap,
          contentPadding: const EdgeInsets.all(12),
          leading: CircleAvatar(
            backgroundColor: const Color(0xFFEAF7F0),
            backgroundImage:
                org.logoUrl != null && org.logoUrl!.startsWith('https://')
                    ? NetworkImage(org.logoUrl!)
                    : null,
            child: Text(
              org.name.isEmpty ? '?' : org.name[0].toUpperCase(),
              style: const TextStyle(
                color: Color(0xFF08783E),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          title: Row(
            children: [
              Expanded(
                  child: Text(org.name,
                      style: const TextStyle(fontWeight: FontWeight.w800))),
              if (org.verified)
                const Icon(Icons.verified_rounded,
                    size: 18, color: Color(0xFF08783E)),
            ],
          ),
          subtitle: Text(org.joinStatus == null
              ? (org.category.isEmpty ? 'Discover organization' : org.category)
              : org.joinStatus!.replaceAll('_', ' ')),
          trailing: const Icon(Icons.chevron_right_rounded),
        ),
      );
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(
      {required this.icon, required this.title, required this.detail});
  final IconData icon;
  final String title, detail;
  @override
  Widget build(BuildContext c) => Row(children: [
        Icon(icon, color: const Color(0xFF08783E)),
        const SizedBox(width: 12),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
          Text(detail, style: const TextStyle(color: Colors.black54))
        ]))
      ]);
}

class _Empty extends StatelessWidget {
  const _Empty({required this.label});
  final String label;
  @override
  Widget build(BuildContext c) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 22),
      child: Text(label, style: const TextStyle(color: Colors.black54)));
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext c) => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_rounded,
                size: 44, color: Colors.black38),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: retry, child: const Text('Try again'))
          ])));
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext c) => Container(
      height: 78,
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(16)));
}
