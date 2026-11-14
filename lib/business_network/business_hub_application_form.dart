part of 'business_hub_screen.dart';

class _ApplicationForm extends StatefulWidget {
  const _ApplicationForm({
    required this.api,
    required this.kind,
    required this.onSaved,
    required this.customer,
    required this.categories,
    required this.supportedServices,
    required this.serviceCatalogue,
    required this.hasServiceCatalogue,
    required this.onKindChanged,
    this.existing,
    this.onProfileSaved,
  });
  final BusinessNetworkApi api;
  final String kind;
  final Map<String, dynamic>? existing;
  final Map<String, dynamic> customer;
  final List<String> categories;
  final List<String> supportedServices;
  final List<Map<String, dynamic>> serviceCatalogue;
  final bool hasServiceCatalogue;
  final ValueChanged<String> onKindChanged;
  final ValueChanged<Map<String, dynamic>>? onProfileSaved;
  final Future<void> Function() onSaved;

  @override
  State<_ApplicationForm> createState() => _ApplicationFormState();
}

class _ApplicationFormState extends State<_ApplicationForm> {
  final _formKey = GlobalKey<FormState>();
  final _names = const [
    'businessName',
    'businessCategory',
    'ownerName',
    'phone',
    'email',
    'state',
    'lga',
    'address',
    'description',
    'registrationNumber'
  ];
  final _labels = const [
    'Business / shop name',
    'Business category',
    'Owner’s full name',
    'Phone number',
    'Email address',
    'State',
    'LGA',
    'Business address',
    'Business description',
    'Registration number (optional)'
  ];
  final Map<String, TextEditingController> _fields = {};
  final Set<String> _services = {};
  final Map<String, Set<String>> _servicesByKind = {};
  final Map<String, Map<String, String>> _fieldsByKind = {};
  bool _busy = false;
  String? _error;
  String? _servicesError;
  late int _revision;

  @override
  void initState() {
    super.initState();
    _revision = (widget.existing?['revision'] as num?)?.toInt() ?? 0;
    final details = widget.existing?['details'] is Map
        ? Map<String, dynamic>.from(widget.existing!['details'] as Map)
        : <String, dynamic>{};
    final identityDefaults = <String, dynamic>{
      'ownerName': widget.customer['fullName'],
      'phone': widget.customer['phone'],
      'email': widget.customer['email'],
    };
    for (final name in _names) {
      _fields[name] = TextEditingController(
        text: (details[name] ?? identityDefaults[name])?.toString() ?? '',
      );
    }
    _services.addAll((details['preferredServices'] as List? ?? const [])
        .map((value) => value.toString()));
    _servicesByKind[widget.kind] = Set<String>.from(_services);
  }

  @override
  void didUpdateWidget(covariant _ApplicationForm oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.kind != widget.kind) {
      _fieldsByKind[oldWidget.kind] = {
        for (final name in _names) name: _fields[name]!.text,
      };
      _servicesByKind[oldWidget.kind] = Set<String>.from(_services);
      final details = widget.existing?['details'] is Map
          ? Map<String, dynamic>.from(widget.existing!['details'] as Map)
          : const <String, dynamic>{};
      final previousFields = _fieldsByKind[widget.kind];
      if (previousFields != null || widget.existing != null) {
        for (final name in _names) {
          _fields[name]!.text =
              previousFields?[name] ?? details[name]?.toString() ?? '';
        }
      }
      _services
        ..clear()
        ..addAll(_servicesByKind[widget.kind] ??
            (details['preferredServices'] as List? ?? const [])
                .map((value) => value.toString()));
      _servicesByKind[widget.kind] = Set<String>.from(_services);
      _revision = (widget.existing?['revision'] as num?)?.toInt() ?? 0;
      _servicesError = null;
      _error = null;
    } else if (widget.existing?['revision'] is num) {
      _revision = (widget.existing!['revision'] as num).toInt();
    }
  }

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save({required bool submit}) async {
    if (submit) {
      final fieldsValid = _formKey.currentState!.validate();
      final servicesValid = _services.isNotEmpty &&
          _services.every((code) {
            final match = _availableServices.where(
              (service) => service['code']?.toString() == code,
            );
            return match.length == 1 &&
                match.single['preferencesEnabled'] != false;
          });
      setState(() {
        _servicesError = _services.isEmpty
            ? 'Choose at least one preferred service or business interest.'
            : servicesValid
                ? null
                : 'One or more selected services are unavailable. Remove them or refresh the current catalogue.';
      });
      if (!fieldsValid || !servicesValid) return;
    }
    setState(() {
      _busy = true;
      _error = null;
      if (submit) _servicesError = null;
    });
    String? networkId;
    try {
      final details = <String, dynamic>{
        for (final name in _names) name: _fields[name]!.text.trim(),
        'preferredServices': _services.toList(),
      };
      final saved = await widget.api.put(
        'applications/${widget.kind}',
        {...details, 'kind': widget.kind, 'revision': _revision},
      );
      final savedProfile = saved is Map && saved['profile'] is Map
          ? Map<String, dynamic>.from(saved['profile'] as Map)
          : saved is Map
              ? Map<String, dynamic>.from(saved)
              : const <String, dynamic>{};
      final nextRevision = savedProfile['revision'] is num
          ? (savedProfile['revision'] as num).toInt()
          : _revision + 1;
      _revision = nextRevision;
      final currentProfile = {
        ...savedProfile,
        'kind': widget.kind,
        'revision': nextRevision,
        'details':
            savedProfile['details'] is Map ? savedProfile['details'] : details,
      };
      networkId = currentProfile['networkId']?.toString();
      widget.onProfileSaved?.call(currentProfile);
      if (submit) {
        final submitted = await widget.api.post(
          'applications/${widget.kind}/submit',
          {'revision': nextRevision},
        );
        final submittedProfile = submitted is Map && submitted['profile'] is Map
            ? Map<String, dynamic>.from(submitted['profile'] as Map)
            : submitted is Map
                ? Map<String, dynamic>.from(submitted)
                : <String, dynamic>{};
        networkId = submittedProfile['networkId']?.toString() ?? networkId;
        widget.onProfileSaved?.call({
          ...currentProfile,
          ...submittedProfile,
          'kind': widget.kind,
          'revision': submittedProfile['revision'] ?? nextRevision,
        });
      }
      await widget.onSaved();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              submit
                  ? 'Application submitted for review${networkId?.isNotEmpty == true ? ' · $networkId' : ''}.'
                  : 'Draft saved.',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  List<Map<String, dynamic>> get _availableServices {
    if (widget.hasServiceCatalogue) return widget.serviceCatalogue;
    return widget.supportedServices
        .map((code) => {
              'code': code,
              'label': _supportedServiceLabel(code),
              'category': 'Service',
              'preferencesEnabled': true,
              'processable': true,
              'available': true,
            })
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final agent = widget.kind == 'AGENT';
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Text(
            'APPLICATION TYPE',
            style: TextStyle(
              color: Color(0xFF53645B),
              fontSize: 11,
              letterSpacing: 1,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _applicationTypeOption(
                  kind: 'AGENT',
                  label: 'Retail Agent',
                  icon: Icons.storefront_outlined,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _applicationTypeOption(
                  kind: 'MERCHANT',
                  label: 'SME Merchant',
                  icon: Icons.business_outlined,
                ),
              ),
            ],
          ),
          if (widget.existing != null)
            const Padding(
              padding: EdgeInsets.only(top: 7),
              child: Text(
                'This application type is locked to your saved application.',
                style: TextStyle(fontSize: 12, color: Color(0xFF59685F)),
              ),
            ),
          const SizedBox(height: 20),
          Text(
            agent ? 'Retail Agent application' : 'SME Merchant application',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            agent
                ? 'Your existing customer identity remains unchanged. Your Agent capability is separate and starts only after approval.'
                : 'Register your business as an independent capability on your existing customer account.',
            style: const TextStyle(height: 1.45, color: Color(0xFF53645B)),
          ),
          const SizedBox(height: 17),
          if (widget.existing != null) _applicationStatus(widget.existing!),
          if (widget.existing != null) const SizedBox(height: 14),
          ...List.generate(_names.length, (index) {
            final name = _names[index];
            if (agent && name == 'businessCategory') {
              return const SizedBox.shrink();
            }
            if (name == 'businessCategory') {
              final selectedCategory =
                  widget.categories.contains(_fields[name]!.text)
                      ? _fields[name]!.text
                      : null;
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: DropdownButtonFormField<String>(
                  value: selectedCategory,
                  decoration: InputDecoration(
                    labelText: _labels[index],
                    helperText: widget.categories.isEmpty
                        ? 'No merchant categories are configured yet.'
                        : null,
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(13),
                      borderSide: BorderSide.none,
                    ),
                  ),
                  items: widget.categories
                      .map((category) => DropdownMenuItem(
                            value: category,
                            child: Text(category),
                          ))
                      .toList(),
                  onChanged: widget.categories.isEmpty
                      ? null
                      : (value) =>
                          setState(() => _fields[name]!.text = value ?? ''),
                  validator: (value) =>
                      value == null || !widget.categories.contains(value)
                          ? 'Choose a configured business category'
                          : null,
                ),
              );
            }
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: TextFormField(
                controller: _fields[name],
                minLines: name == 'address' || name == 'description' ? 2 : 1,
                maxLines: name == 'address' || name == 'description' ? 3 : 1,
                keyboardType: name == 'email'
                    ? TextInputType.emailAddress
                    : name == 'phone'
                        ? TextInputType.phone
                        : TextInputType.text,
                decoration: InputDecoration(
                  labelText: _labels[index],
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(13),
                    borderSide: BorderSide.none,
                  ),
                ),
                validator: (value) {
                  final text = value?.trim() ?? '';
                  if (name == 'registrationNumber' && text.isEmpty) {
                    return null;
                  }
                  if (text.isEmpty) return 'This field is required';
                  if (name == 'email' &&
                      !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(text)) {
                    return 'Enter a valid email address';
                  }
                  if (name == 'phone' &&
                      text.replaceAll(RegExp(r'\D'), '').length < 10) {
                    return 'Enter a valid phone number';
                  }
                  return null;
                },
              ),
            );
          }),
          const Text(
            'Preferred services',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 5),
          const Text(
            'Choose at least one supported bill service or business product you are interested in. Product and logistics interests do not grant bill-payment or commission authority; Head Office approves processable services separately.',
            style: TextStyle(
              color: Color(0xFF59685F),
              fontSize: 12,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 6),
          if (_availableServices.isNotEmpty)
            ..._availableServices.map((service) {
              final code = service['code']?.toString() ?? '';
              final label =
                  service['label']?.toString().trim().isNotEmpty == true
                      ? service['label'].toString()
                      : _supportedServiceLabel(code);
              final available = service['available'] != false;
              final preferencesEnabled = service['preferencesEnabled'] != false;
              final processable = service['processable'] == true;
              final selected = _services.contains(code);
              final reason = !preferencesEnabled
                  ? (service['reason']?.toString().trim().isNotEmpty == true
                      ? service['reason'].toString()
                      : 'This service is not enabled for preferences.')
                  : !available
                      ? '${service['reason']?.toString().trim().isNotEmpty == true ? service['reason'] : 'Globally unavailable in ServicePay.'} You may record interest, but it cannot be processed now.'
                      : !processable
                          ? 'Interest only — processing is not enabled.'
                          : (service['category']?.toString() ?? '');
              return CheckboxListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                controlAffinity: ListTileControlAffinity.leading,
                value: selected,
                title: Text(label),
                subtitle: reason.isEmpty
                    ? null
                    : Text(
                        reason,
                        style: TextStyle(
                          color: available && preferencesEnabled
                              ? const Color(0xFF59685F)
                              : const Color(0xFF9A4F31),
                          fontSize: 12,
                        ),
                      ),
                onChanged: selected
                    ? (value) {
                        if (value != true) {
                          setState(() {
                            _services.remove(code);
                            _servicesError = null;
                          });
                        }
                      }
                    : preferencesEnabled
                        ? (value) {
                            setState(() {
                              if (value == true) _services.add(code);
                              _servicesError = null;
                            });
                          }
                        : null,
              );
            })
          else
            const Text(
              'Service options are unavailable for this application type. Refresh to load the current catalogue.',
              style: TextStyle(color: Color(0xFF59685F), fontSize: 12),
            ),
          if (_servicesError != null)
            Padding(
              padding: const EdgeInsets.only(top: 4, left: 12),
              child: Text(
                _servicesError!,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                  fontSize: 12,
                ),
              ),
            ),
          const SizedBox(height: 9),
          const Text(
            'Verification uses your existing ServicePay KYC. Do not upload identity documents here; eligibility is confirmed securely by ServicePay.',
            style: TextStyle(
              color: Color(0xFF59685F),
              fontSize: 12,
              height: 1.4,
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          const SizedBox(height: 18),
          OutlinedButton(
            onPressed: _busy ? null : () => _save(submit: false),
            child: const Text('Save draft'),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _busy ? null : () => _save(submit: true),
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Submit for review'),
          ),
        ],
      ),
    );
  }

  Widget _applicationTypeOption({
    required String kind,
    required String label,
    required IconData icon,
  }) {
    final selected = widget.kind == kind;
    final locked = widget.existing != null;
    return Semantics(
      button: true,
      selected: selected,
      child: OutlinedButton(
        onPressed: locked || selected
            ? null
            : () {
                _servicesByKind[widget.kind] = Set<String>.from(_services);
                widget.onKindChanged(kind);
              },
        style: OutlinedButton.styleFrom(
          backgroundColor: selected ? const Color(0xFFE1F0E6) : Colors.white,
          foregroundColor: const Color(0xFF18372A),
          disabledForegroundColor: const Color(0xFF18372A),
          disabledBackgroundColor:
              selected ? const Color(0xFFE1F0E6) : Colors.white,
          side: BorderSide(
            color: selected ? const Color(0xFF08783E) : const Color(0xFFD5E1D9),
            width: selected ? 1.6 : 1,
          ),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 19),
            const SizedBox(width: 7),
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            if (selected) ...[
              const SizedBox(width: 5),
              const Icon(Icons.check_circle, size: 17),
            ],
          ],
        ),
      ),
    );
  }
}

Widget _applicationStatus(Map<String, dynamic> profile) {
  final status = (profile['status'] ?? 'DRAFT').toString().toUpperCase();
  return Container(
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      color: const Color(0xFFE8F3EC),
      borderRadius: BorderRadius.circular(13),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(status.replaceAll('_', ' '),
            style: const TextStyle(fontWeight: FontWeight.w800)),
        if (profile['feedback'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(profile['feedback'].toString()),
          ),
      ],
    ),
  );
}
