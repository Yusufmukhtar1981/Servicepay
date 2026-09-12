import 'package:flutter/material.dart';
import 'organization_models.dart';
import 'organizations_api.dart';
import 'organization_owner_dashboard.dart';
import '../servicepay_theme.dart';

class OrganizationsScreen extends StatefulWidget {
  const OrganizationsScreen({super.key, this.api});
  final OrganizationsApi? api;
  @override
  State<OrganizationsScreen> createState() => _OrganizationsScreenState();
}

class _OrganizationsScreenState extends State<OrganizationsScreen> {
  late final OrganizationsApi api;
  final search = TextEditingController();
  final searchFocus = FocusNode();
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
    searchFocus.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final results = await Future.wait([api.mine(), api.explore()]);
      if (mounted) {
        setState(() {
          mine = results[0];
          explore = results[1];
          loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e.toString().replaceFirst('Exception: ', '');
          loading = false;
        });
      }
    }
  }

  Future<void> _search(String value) async {
    try {
      final items = await api.explore(query: value.trim());
      if (mounted) setState(() => explore = items);
    } catch (_) {}
  }

  void _open(Organization org) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OrganizationProfileScreen(api: api, organization: org),
      ),
    );
  }

  void _create() => Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => CreateOrganizationScreen(api: api, onSubmitted: _load),
    ),
  );

  void _message(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: ServicePayColors.canvas,
    appBar: AppBar(
      title: const Text(
        'Organizations',
        style: TextStyle(fontWeight: FontWeight.w900),
      ),
      backgroundColor: ServicePayColors.brand,
      foregroundColor: Colors.white,
      elevation: 0,
    ),
    body: RefreshIndicator(
      onRefresh: _load,
      child: loading
          ? ListView(
              padding: const EdgeInsets.all(16),
              children: const [_Skeleton(), _Skeleton(), _Skeleton()],
            )
          : error != null
          ? _ErrorState(message: error!, retry: _load)
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
              children: [
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0B6B3A),
                    borderRadius: BorderRadius.circular(26),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.account_balance_rounded,
                        color: Color(0xFFB9E5C9),
                        size: 30,
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Membership, made trustworthy.',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 25,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Keep your organizations, membership cards, dues and payments in one secure place.',
                        style: TextStyle(
                          color: Color(0xFFD9F2E1),
                          height: 1.4,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 18),
                      FilledButton.icon(
                        onPressed: _create,
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: const Color(0xFF0B6B3A),
                          minimumSize: const Size(0, 48),
                        ),
                        icon: const Icon(Icons.add_rounded),
                        label: const Text('Create Organization'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                const Text(
                  'Your organizations',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 21),
                ),
                const SizedBox(height: 4),
                Text(
                  'A clear view of the communities you belong to and manage.',
                  style: TextStyle(color: ServicePayColors.muted),
                ),
                const SizedBox(height: 14),
                if (mine.isEmpty) const _EmptyOrganization(),
                for (final org in mine)
                  _OrganizationTile(org: org, onTap: () => _open(org)),
                const SizedBox(height: 22),
                const Text(
                  'Quick access',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 19),
                ),
                const SizedBox(height: 10),
                _ActionGrid(
                  onCreate: _create,
                  onExplore: () =>
                      FocusScope.of(context).requestFocus(searchFocus),
                  onMine: () => _message(
                    mine.isEmpty
                        ? 'You have no organizations yet.'
                        : '${mine.length} organization${mine.length == 1 ? '' : 's'} in your account.',
                  ),
                  onPending: () =>
                      _message('No pending applications to review.'),
                  onCards: () => _message(
                    'Join an organization to access membership cards.',
                  ),
                  onPayments: () => _message(
                    'Choose an organization to view dues and payments.',
                  ),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: search,
                  focusNode: searchFocus,
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
                            icon: const Icon(Icons.clear),
                          )
                        : null,
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Join / explore organizations',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 19),
                ),
                const SizedBox(height: 8),
                if (explore.isEmpty)
                  const _Empty(
                    label: 'No organizations found. Try another search.',
                  ),
                for (final org in explore)
                  _OrganizationTile(org: org, onTap: () => _open(org)),
              ],
            ),
    ),
  );
}

class _EmptyOrganization extends StatelessWidget {
  const _EmptyOrganization();
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 4),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: const Color(0xFFD8E9DE)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.groups_2_outlined, color: Color(0xFF08783E), size: 32),
        const SizedBox(height: 12),
        const Text(
          'Create or join an organization',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18),
        ),
        const SizedBox(height: 6),
        const Text(
          'Create a trusted home for your association, cooperative, NGO, company, foundation, or club, or explore organizations you already belong to.',
          style: TextStyle(color: Colors.black54, height: 1.4),
        ),
      ],
    ),
  );
}

class _ActionGrid extends StatelessWidget {
  const _ActionGrid({
    required this.onCreate,
    required this.onExplore,
    required this.onMine,
    required this.onPending,
    required this.onCards,
    required this.onPayments,
  });
  final VoidCallback onCreate,
      onExplore,
      onMine,
      onPending,
      onCards,
      onPayments;
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 10,
    runSpacing: 10,
    children: [
      _Action(
        label: 'Create Organization',
        icon: Icons.add_business_outlined,
        onTap: onCreate,
      ),
      _Action(
        label: 'Join / Explore Organizations',
        icon: Icons.travel_explore_rounded,
        onTap: onExplore,
      ),
      _Action(
        label: 'My Organizations',
        icon: Icons.groups_outlined,
        onTap: onMine,
      ),
      _Action(
        label: 'Pending Applications',
        icon: Icons.pending_actions_rounded,
        onTap: onPending,
      ),
      _Action(
        label: 'Membership Cards',
        icon: Icons.badge_outlined,
        onTap: onCards,
      ),
      _Action(
        label: 'Payments & Dues',
        icon: Icons.payments_outlined,
        onTap: onPayments,
      ),
    ],
  );
}

class _Action extends StatelessWidget {
  const _Action({required this.label, required this.icon, required this.onTap});
  final String label;
  final IconData icon;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(16),
    child: Container(
      width: (MediaQuery.sizeOf(context).width - 42) / 2,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE0EBE4)),
      ),
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFF08783E), size: 21),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
            ),
          ),
        ],
      ),
    ),
  );
}

class CreateOrganizationScreen extends StatefulWidget {
  const CreateOrganizationScreen({
    super.key,
    required this.api,
    required this.onSubmitted,
  });
  final OrganizationsApi api;
  final Future<void> Function() onSubmitted;
  @override
  State<CreateOrganizationScreen> createState() =>
      _CreateOrganizationScreenState();
}

class _CreateOrganizationScreenState extends State<CreateOrganizationScreen> {
  final form = GlobalKey<FormState>();
  final values = <String, dynamic>{};
  final fields = <String, TextEditingController>{
    'name': TextEditingController(),
    'description': TextEditingController(),
    'registrationNumber': TextEditingController(),
    'officialEmail': TextEditingController(),
    'officialPhone': TextEditingController(),
    'contactName': TextEditingController(),
    'contactEmail': TextEditingController(),
    'contactPhone': TextEditingController(),
    'state': TextEditingController(),
    'lga': TextEditingController(),
    'address': TextEditingController(),
    'annualFee': TextEditingController(),
    'registrationFee': TextEditingController(text: '0'),
    'logoUrl': TextEditingController(),
  };
  int step = 0;
  bool submitting = false;
  String? draftId;
  final types = const [
    'ASSOCIATION',
    'COOPERATIVE',
    'NGO',
    'COMPANY',
    'FOUNDATION',
    'CLUB',
    'OTHER',
  ];
  @override
  void dispose() {
    for (final c in fields.values) c.dispose();
    super.dispose();
  }

  String get type => values['type'] as String? ?? types.first;

  Future<void> _submit() async {
    if (!(form.currentState?.validate() ?? false)) return;
    setState(() => submitting = true);
    if (draftId != null) {
      try {
        await widget.api.submit(draftId!);
        await widget.onSubmitted();
        if (!mounted) return;
        await _showSubmitted();
        if (mounted) Navigator.pop(context);
      } catch (e) {
        if (mounted)
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Draft saved. Submit again when ready: ${e.toString().replaceFirst('Exception: ', '')}',
              ),
            ),
          );
      } finally {
        if (mounted) setState(() => submitting = false);
      }
      return;
    }
    final payload = <String, dynamic>{
      'name': fields['name']!.text.trim(),
      'type': type,
      'description': fields['description']!.text.trim(),
      'registrationNumber': fields['registrationNumber']!.text.trim(),
      'contact': {
        'name': fields['contactName']!.text.trim(),
        'email': fields['contactEmail']!.text.trim(),
        'phone': fields['contactPhone']!.text.trim(),
        'address': fields['address']!.text.trim(),
        'officialEmail': fields['officialEmail']!.text.trim(),
        'officialPhone': fields['officialPhone']!.text.trim(),
      },
      'state': fields['state']!.text.trim(),
      'lga': fields['lga']!.text.trim(),
      'renewalCycle': values['renewalCycle'] ?? 'ANNUAL',
      'membershipMode': values['membershipMode'] ?? 'MANUAL',
    };
    final annualFee = _money(fields['annualFee']!.text);
    final registrationFee = _money(fields['registrationFee']!.text);
    if (annualFee > 0) payload['annualFee'] = annualFee;
    if (registrationFee > 0) payload['registrationFee'] = registrationFee;
    final logo = fields['logoUrl']!.text.trim();
    if (logo.isNotEmpty) {
      final mime = _logoMime(logo);
      if (mime == null) {
        if (mounted)
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Logo URL must end in .png, .jpg, .jpeg, or .webp.',
              ),
            ),
          );
        setState(() => submitting = false);
        return;
      }
      payload['logo'] = {'url': logo, 'mimeType': mime};
    }
    try {
      final result = await widget.api.create(payload);
      final raw = result['organization'] is Map
          ? result['organization']
          : result;
      final id = raw is Map ? '${raw['id'] ?? raw['_id'] ?? ''}' : '';
      if (id.isEmpty)
        throw Exception('Organization was created without an identifier.');
      draftId = id;
      await widget.onSubmitted();
      await widget.api.submit(id);
      if (!mounted) return;
      await _showSubmitted();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              draftId == null
                  ? e.toString().replaceFirst('Exception: ', '')
                  : 'Draft saved. Submit again when ready: ${e.toString().replaceFirst('Exception: ', '')}',
            ),
          ),
        );
    } finally {
      if (mounted) setState(() => submitting = false);
    }
  }

  Future<void> _showSubmitted() => showDialog<void>(
    context: context,
    builder: (_) => AlertDialog(
      icon: const Icon(
        Icons.check_circle_rounded,
        color: Color(0xFF08783E),
        size: 42,
      ),
      title: const Text('Organization submitted'),
      content: const Text(
        'Organization submitted successfully and is pending ServicePay verification.',
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Done'),
        ),
      ],
    ),
  );

  num _money(String value) => num.tryParse(value.trim()) ?? 0;
  String? _logoMime(String value) {
    if (!value.startsWith('https://')) return null;
    final path = Uri.tryParse(value)?.path.toLowerCase() ?? '';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.webp')) return 'image/webp';
    return null;
  }

  Widget _input(
    String key,
    String label, {
    bool required = false,
    TextInputType? keyboard,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextFormField(
      controller: fields[key],
      keyboardType: keyboard,
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: Colors.white,
      ),
      validator: (v) {
        if (required && (v == null || v.trim().isEmpty)) return 'Required';
        if (key == 'officialEmail' &&
            v != null &&
            v.trim().isNotEmpty &&
            !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v.trim()))
          return 'Enter a valid email';
        if (key == 'annualFee' || key == 'registrationFee') {
          if (v != null && v.trim().isNotEmpty) {
            final parsed = num.tryParse(v.trim());
            if (parsed == null ||
                parsed < 0 ||
                !RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(v.trim())) {
              return 'Enter a non-negative amount with up to 2 decimals';
            }
          }
        }
        if (key == 'logoUrl' &&
            v != null &&
            v.trim().isNotEmpty &&
            _logoMime(v.trim()) == null) {
          return 'Use a HTTPS URL ending in .png, .jpg, .jpeg, or .webp';
        }
        return null;
      },
    ),
  );

  Widget _stepBody() {
    if (step == 0)
      return Column(
        children: [
          _input('name', 'Organization name', required: true),
          DropdownButtonFormField<String>(
            value: type,
            decoration: const InputDecoration(labelText: 'Organization type'),
            items: types
                .map((e) => DropdownMenuItem(value: e, child: Text(e)))
                .toList(),
            onChanged: (v) => setState(() => values['type'] = v),
          ),
          const SizedBox(height: 14),
          _input('description', 'Description', required: true),
          _input('logoUrl', 'Logo URL (optional HTTPS)'),
        ],
      );
    if (step == 1)
      return Column(
        children: [
          _input('address', 'Official address', required: true),
          _input('state', 'State', required: true),
          _input('lga', 'Local government area', required: true),
          _input(
            'officialPhone',
            'Official phone',
            required: true,
            keyboard: TextInputType.phone,
          ),
          _input(
            'officialEmail',
            'Official email',
            required: true,
            keyboard: TextInputType.emailAddress,
          ),
          _input('contactName', 'Contact person name', required: true),
          _input(
            'contactPhone',
            'Contact person phone',
            required: true,
            keyboard: TextInputType.phone,
          ),
          _input(
            'contactEmail',
            'Contact person email',
            required: true,
            keyboard: TextInputType.emailAddress,
          ),
        ],
      );
    if (step == 2)
      return Column(
        children: [
          _input(
            'annualFee',
            'Annual membership fee',
            required: true,
            keyboard: TextInputType.number,
          ),
          _input(
            'registrationFee',
            'Registration fee',
            required: true,
            keyboard: TextInputType.number,
          ),
          DropdownButtonFormField<String>(
            value: values['renewalCycle'] ?? 'ANNUAL',
            decoration: const InputDecoration(labelText: 'Renewal cycle'),
            items: const [
              'ANNUAL',
              'MONTHLY',
              'NONE',
            ].map((e) => DropdownMenuItem(value: e, child: Text(e))).toList(),
            onChanged: (v) => setState(() => values['renewalCycle'] = v),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            value: values['membershipMode'] ?? 'MANUAL',
            decoration: const InputDecoration(labelText: 'Membership approval'),
            items: const ['MANUAL', 'AUTO']
                .map(
                  (e) => DropdownMenuItem(
                    value: e,
                    child: Text(
                      e == 'AUTO'
                          ? 'Automatic approval'
                          : 'Review applications',
                    ),
                  ),
                )
                .toList(),
            onChanged: (v) => setState(() => values['membershipMode'] = v),
          ),
        ],
      );
    if (step == 3)
      return Column(
        children: [
          _input('registrationNumber', 'Registration / CAC number (optional)'),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(15),
            decoration: BoxDecoration(
              color: const Color(0xFFEAF7F0),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Text(
              'Secure documents are not requested in this onboarding flow. ServicePay will verify your organization through its secure review process.',
              style: TextStyle(color: Color(0xFF145C38), height: 1.4),
            ),
          ),
        ],
      );
    return _Review(values: values, fields: fields, type: type);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F8F6),
    appBar: AppBar(
      title: const Text('Create organization'),
      backgroundColor: Colors.white,
    ),
    body: Form(
      key: form,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Step ${step + 1} of 5',
            style: const TextStyle(
              color: Color(0xFF08783E),
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(
            value: (step + 1) / 5,
            color: const Color(0xFF08783E),
          ),
          const SizedBox(height: 26),
          Text(
            [
              'Basic Information',
              'Location / Contact',
              'Membership Setup',
              'Verification',
              'Review & Submit',
            ][step],
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(
            [
              'Tell us who this organization is.',
              'Add official details members can trust.',
              'Set the dues and approval approach.',
              'Registration is optional; documents are not requested.',
              'Check everything before sending for verification.',
            ][step],
            style: const TextStyle(color: Colors.black54),
          ),
          const SizedBox(height: 22),
          _stepBody(),
          const SizedBox(height: 20),
          Row(
            children: [
              if (step > 0)
                Expanded(
                  child: OutlinedButton(
                    onPressed: submitting ? null : () => setState(() => step--),
                    child: const Text('Back'),
                  ),
                ),
              if (step > 0) const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: submitting
                      ? null
                      : () {
                          if (step < 4) {
                            if (form.currentState?.validate() ?? false)
                              setState(() => step++);
                          } else {
                            _submit();
                          }
                        },
                  child: submitting
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          step == 4 ? 'Submit for verification' : 'Continue',
                        ),
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}

class _Review extends StatelessWidget {
  const _Review({
    required this.values,
    required this.fields,
    required this.type,
  });
  final Map<String, dynamic> values;
  final Map<String, TextEditingController> fields;
  final String type;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _line('Organization', fields['name']!.text),
          _line('Type', type),
          _line('Contact', fields['officialEmail']!.text),
          _line('Location', '${fields['state']!.text}, ${fields['lga']!.text}'),
          _line('Annual fee', fields['annualFee']!.text),
          _line('Registration fee', fields['registrationFee']!.text),
          const SizedBox(height: 12),
          const Text(
            'No documents are requested. Your organization will be reviewed securely by ServicePay.',
            style: TextStyle(color: Colors.black54, height: 1.4),
          ),
        ],
      ),
    ),
  );
  Widget _line(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 110,
          child: Text(label, style: const TextStyle(color: Colors.black54)),
        ),
        Expanded(
          child: Text(
            value.isEmpty ? 'Not provided' : value,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
}

class OrganizationProfileScreen extends StatefulWidget {
  const OrganizationProfileScreen({
    super.key,
    required this.api,
    required this.organization,
  });
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
        org.joinStatus?.toUpperCase() == 'ACTIVE') {
      return;
    }
    setState(() => joining = true);
    try {
      org = await widget.api.detail(org.id);
    } catch (_) {}
    if (!mounted) return;
    final fields = <String, dynamic>{};
    final ok =
        await showDialog<bool>(
          context: context,
          builder: (_) => _JoinDialog(org: org, values: fields),
        ) ??
        false;
    if (!ok) {
      if (mounted) setState(() => joining = false);
      return;
    }
    try {
      final result = await widget.api.apply(org.id, {
        'applicationData': fields,
      });
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
      if (mounted) {
        setState(() {
          org = Organization.fromJson({
            ..._orgJson(org),
            'joinStatus': status,
            'registrationDue': result['registrationDue'],
          });
          joining = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => joining = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
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
        .map(
          (f) => {
            'key': f.key,
            'label': f.label,
            'required': f.required,
            'type': f.type,
          },
        )
        .toList(),
  };

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: ServicePayColors.canvas,
    appBar: AppBar(
      title: const Text('Organization profile'),
      backgroundColor: ServicePayColors.brand,
      foregroundColor: Colors.white,
      elevation: 0,
    ),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            color: const Color(0xFF0B6B3A),
            borderRadius: BorderRadius.circular(24),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 29,
                    backgroundColor: Colors.white24,
                    child: Text(
                      org.name.isEmpty ? '?' : org.name[0].toUpperCase(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      org.name,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 22,
                      ),
                    ),
                  ),
                  if (org.verified)
                    const Icon(Icons.verified_rounded, color: Colors.white),
                ],
              ),
              if (org.category.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    org.category,
                    style: const TextStyle(color: Colors.white70),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        Text(
          org.description.isEmpty
              ? 'A verified ServicePay organization.'
              : org.description,
          style: const TextStyle(fontSize: 16, height: 1.45),
        ),
        const SizedBox(height: 18),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _InfoRow(
                  icon: Icons.verified_user_outlined,
                  title: org.verified
                      ? 'Verified organization'
                      : 'Organization profile',
                  detail: 'Public information is shown safely.',
                ),
                const Divider(height: 24),
                _InfoRow(
                  icon: Icons.payments_outlined,
                  title: 'Membership fee',
                  detail: org.fee > 0
                      ? '${org.currency} ${org.fee}'
                      : 'No fee listed',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        if (org.joinStatus?.toUpperCase() == 'PENDING')
          Column(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.amber.shade50,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.schedule_rounded, color: Colors.orange),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Your application is pending review.',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
              if (org.registrationDue != null)
                Card(
                  color: Colors.orange.shade50,
                  child: ListTile(
                    leading: const Icon(Icons.payments_outlined),
                    title: const Text('Registration fee due'),
                    subtitle: Text(
                      '${org.registrationDue!['currency'] ?? org.currency} ${org.registrationDue!['amount'] ?? ''}',
                    ),
                    trailing: const Icon(Icons.arrow_forward),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => OrganizationPaymentsScreen(
                          api: widget.api,
                          organization: org,
                        ),
                      ),
                    ),
                  ),
                ),
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => OrganizationPaymentsScreen(
                      api: widget.api,
                      organization: org,
                    ),
                  ),
                ),
                icon: const Icon(Icons.payments_outlined),
                label: const Text('Dues & payments'),
              ),
            ],
          )
        else if (org.joinStatus?.toUpperCase() == 'ACTIVE')
          Column(
            children: [
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => OrganizationMemberScreen(
                      api: widget.api,
                      organization: org,
                    ),
                  ),
                ),
                icon: const Icon(Icons.badge_outlined),
                label: const Text('View membership card'),
              ),
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => OrganizationPaymentsScreen(
                      api: widget.api,
                      organization: org,
                    ),
                  ),
                ),
                icon: const Icon(Icons.payments_outlined),
                label: const Text('Dues & payments'),
              ),
            ],
          )
        else
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF08783E),
              minimumSize: const Size.fromHeight(52),
            ),
            onPressed: joining ? null : _join,
            icon: joining
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2,
                    ),
                  )
                : const Icon(Icons.group_add_outlined),
            label: Text(joining ? 'Sending application...' : 'Apply to join'),
          ),
        if (org.allowedToManage)
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => OrganizationOwnerDashboard(
                  api: widget.api,
                  organization: org,
                ),
              ),
            ),
            icon: const Icon(Icons.dashboard_outlined),
            label: const Text('Manage Organization'),
          ),
      ],
    ),
  );
}

class OrganizationMemberScreen extends StatefulWidget {
  const OrganizationMemberScreen({
    super.key,
    required this.organization,
    required this.api,
  });
  final Organization organization;
  final OrganizationsApi api;
  @override
  State<OrganizationMemberScreen> createState() =>
      _OrganizationMemberScreenState();
}

class _OrganizationMemberScreenState extends State<OrganizationMemberScreen> {
  late Future<Map<String, dynamic>> card;
  @override
  void initState() {
    super.initState();
    card = widget.api.card(widget.organization.id);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Membership card')),
    body: FutureBuilder<Map<String, dynamic>>(
      future: card,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          final unavailable =
              snapshot.error is OrganizationApiException &&
              (snapshot.error as OrganizationApiException).statusCode == 404;
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    unavailable ? Icons.badge_outlined : Icons.error_outline,
                    size: 48,
                    color: Colors.black38,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    unavailable
                        ? 'Membership card unavailable'
                        : 'Unable to load membership card',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    unavailable
                        ? 'A server-issued card is not available for this membership yet.'
                        : '${snapshot.error}'.replaceFirst('Exception: ', ''),
                    textAlign: TextAlign.center,
                  ),
                  if (!unavailable) ...[
                    const SizedBox(height: 14),
                    OutlinedButton(
                      onPressed: () => setState(
                        () => card = widget.api.card(widget.organization.id),
                      ),
                      child: const Text('Try again'),
                    ),
                  ],
                ],
              ),
            ),
          );
        }
        final response = snapshot.data ?? const <String, dynamic>{};
        final raw = response['card'] is Map
            ? response['card']
            : response['data'];
        if (raw is! Map || raw.isEmpty) {
          return const Center(child: Text('Membership card unavailable.'));
        }
        final serverCard = Map<String, dynamic>.from(raw);
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Card(
              color: const Color(0xFF08783E),
              child: Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'SERVICEPAY MEMBERSHIP',
                      style: TextStyle(
                        color: Colors.white70,
                        letterSpacing: 1.2,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 30),
                    Text(
                      '${serverCard['organizationName'] ?? 'Membership card'}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${serverCard['status'] ?? 'Issued'}',
                      style: const TextStyle(color: Colors.white),
                    ),
                    const SizedBox(height: 24),
                    Container(
                      padding: const EdgeInsets.all(10),
                      color: Colors.white,
                      child: Text(
                        '${serverCard['verificationUrl'] ?? serverCard['cardNumber'] ?? serverCard['membershipNumber'] ?? 'Card details issued by ServicePay'}',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (serverCard['membershipNumber'] != null)
              Text(
                'Membership number: ${serverCard['membershipNumber']}',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            const Text(
              'Public verification details (not a QR code).',
              style: TextStyle(color: Colors.black54),
            ),
            if (serverCard['expiryDate'] != null)
              Text('Expiry: ${serverCard['expiryDate']}'),
            const Text(
              'Show this card when your organization requests membership verification. Private contact and wallet data are never displayed.',
              style: TextStyle(color: Colors.black54, height: 1.4),
            ),
          ],
        );
      },
    ),
  );
}

class OrganizationPaymentsScreen extends StatefulWidget {
  const OrganizationPaymentsScreen({
    super.key,
    required this.api,
    required this.organization,
  });
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
      if (mounted) {
        setState(() {
          dues = value;
          loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _pay(String dueId) async {
    final pin = TextEditingController();
    final ok =
        await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
            title: const Text('Pay securely from wallet'),
            content: TextField(
              controller: pin,
              obscureText: true,
              maxLength: 4,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Transaction PIN'),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(c),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(c, true),
                child: const Text('Pay'),
              ),
            ],
          ),
        ) ??
        false;
    if (!ok || pin.text.trim().length != 4) {
      pin.dispose();
      return;
    }
    try {
      final result = await widget.api.pay(
        organizationId: widget.organization.id,
        dueId: dueId,
        pin: pin.text.trim(),
      );
      if (mounted) {
        await showDialog<void>(
          context: context,
          builder: (c) => AlertDialog(
            title: const Text('Payment received'),
            content: Text(
              'Status: ${result['status'] ?? (result['payment'] is Map ? result['payment']['status'] : 'PROCESSING')}\nReference: ${result['reference'] ?? result['paymentReference'] ?? 'Available in transactions'}',
            ),
            actions: [
              FilledButton(
                onPressed: () => Navigator.pop(c),
                child: const Text('Done'),
              ),
            ],
          ),
        );
      }
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
    pin.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Dues & payments')),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (dues.isEmpty) const _Empty(label: 'No outstanding dues.'),
              for (final due in dues)
                Card(
                  child: ListTile(
                    title: Text(
                      '${due['title'] ?? due['name'] ?? 'Organization due'}',
                    ),
                    subtitle: Text(
                      '${due['currency'] ?? 'NGN'} ${due['amount'] ?? ''} • ${due['status'] ?? 'OUTSTANDING'}',
                    ),
                    trailing: IconButton(
                      onPressed: () =>
                          _pay('${due['id'] ?? due['_id'] ?? 'annual'}'),
                      icon: const Icon(Icons.lock_outline),
                    ),
                  ),
                ),
            ],
          ),
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
              Text(
                'Your application will be reviewed by the organization.',
                style: TextStyle(color: Colors.grey.shade700),
              ),
              _applicationField('fullName', 'Full name', required: true),
              _applicationField('phone', 'Phone number', required: true),
              _applicationField('email', 'Email address', required: true),
              for (final field in widget.org.fields.where(
                (field) => field.type.toUpperCase() != 'FILE',
              ))
                _typedField(field),
              if (widget.org.fields.any(
                (field) =>
                    field.type.toUpperCase() == 'FILE' && !field.required,
              ))
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text(
                    'Document fields require a secure verified upload flow and are not available in this application.',
                    style: TextStyle(color: Colors.black54),
                  ),
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
        builder: (state) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(field.label),
            Wrap(
              children: field.options
                  .map(
                    (option) => FilterChip(
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
                    ),
                  )
                  .toList(),
            ),
            if (state.hasError)
              Text(state.errorText!, style: const TextStyle(color: Colors.red)),
          ],
        ),
      );
    }
    if (type == 'DATE') {
      return TextFormField(
        readOnly: true,
        decoration: InputDecoration(
          labelText: field.label,
          suffixIcon: const Icon(Icons.calendar_today),
        ),
        validator: field.required
            ? (v) =>
                  (widget.values[field.key] ?? '').isEmpty ? 'Required' : null
            : null,
        onTap: () async {
          final date = await showDatePicker(
            context: context,
            firstDate: DateTime(1900),
            lastDate: DateTime(2200),
            initialDate: DateTime.now(),
          );
          if (date != null) {
            widget.values[field.key] = date.toIso8601String().split('T').first;
          }
        },
      );
    }
    final file = type == 'FILE';
    return TextFormField(
      decoration: InputDecoration(
        labelText: field.label,
        helperText: file
            ? 'Uploads are enabled once authorized storage exists.'
            : null,
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
        if (file && (v.contains('://') || v.startsWith('http'))) {
          return 'Do not enter a file URL';
        }
        if (type == 'EMAIL' &&
            v.isNotEmpty &&
            !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v)) {
          return 'Enter a valid email';
        }
        if (type == 'NUMBER' && v.isNotEmpty && num.tryParse(v) == null) {
          return 'Enter a number';
        }
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

  Widget _applicationField(
    String key,
    String label, {
    required bool required,
  }) => Padding(
    padding: const EdgeInsets.only(top: 14),
    child: TextFormField(
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
      keyboardType: key == 'email'
          ? TextInputType.emailAddress
          : TextInputType.text,
      validator: (value) {
        if (required && (value ?? '').trim().isEmpty) return 'Required';
        if (key == 'email' &&
            !RegExp(
              r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
            ).hasMatch((value ?? '').trim())) {
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
            child: Text(
              org.name,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
          if (org.verified)
            const Icon(
              Icons.verified_rounded,
              size: 18,
              color: Color(0xFF08783E),
            ),
        ],
      ),
      subtitle: Text(
        org.joinStatus == null
            ? (org.category.isEmpty ? 'Discover organization' : org.category)
            : org.joinStatus!.replaceAll('_', ' ').toUpperCase(),
      ),
      trailing: const Icon(Icons.chevron_right_rounded),
    ),
  );
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.title,
    required this.detail,
  });
  final IconData icon;
  final String title, detail;
  @override
  Widget build(BuildContext c) => Row(
    children: [
      Icon(icon, color: const Color(0xFF08783E)),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
            Text(detail, style: const TextStyle(color: Colors.black54)),
          ],
        ),
      ),
    ],
  );
}

class _Empty extends StatelessWidget {
  const _Empty({required this.label});
  final String label;
  @override
  Widget build(BuildContext c) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 22),
    child: Text(label, style: const TextStyle(color: Colors.black54)),
  );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext c) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_rounded, size: 44, color: Colors.black38),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: retry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext c) => Container(
    height: 78,
    margin: const EdgeInsets.only(bottom: 12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
    ),
  );
}
