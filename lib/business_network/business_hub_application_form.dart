part of 'business_hub_screen.dart';

class _ApplicationForm extends StatefulWidget {
  const _ApplicationForm({
    required this.api,
    required this.kind,
    required this.onSaved,
    required this.customer,
    required this.categories,
    required this.supportedServices,
    this.existing,
  });
  final BusinessNetworkApi api;
  final String kind;
  final Map<String, dynamic>? existing;
  final Map<String, dynamic> customer;
  final List<String> categories;
  final List<String> supportedServices;
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
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
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
    _services.addAll(
      (details['preferredServices'] as List? ?? const [])
          .map((value) => value.toString())
          .where(widget.supportedServices.contains),
    );
  }

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save({required bool submit}) async {
    if (!_formKey.currentState!.validate()) return;
    if (_services.isEmpty) {
      setState(() => _error = widget.supportedServices.isEmpty
          ? 'Supported services are unavailable right now. Refresh and try again.'
          : 'Choose at least one preferred service.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final revision = (widget.existing?['revision'] as num?)?.toInt() ?? 0;
      final details = <String, dynamic>{
        for (final name in _names) name: _fields[name]!.text.trim(),
        'preferredServices': _services.toList(),
      };
      final saved = await widget.api.put(
        'applications/${widget.kind.toLowerCase()}',
        {...details, 'revision': revision},
      );
      final savedProfile = saved is Map && saved['profile'] is Map
          ? Map<String, dynamic>.from(saved['profile'] as Map)
          : saved is Map
              ? Map<String, dynamic>.from(saved)
              : const <String, dynamic>{};
      final nextRevision = savedProfile['revision'] is num
          ? (savedProfile['revision'] as num).toInt()
          : revision + 1;
      if (submit) {
        await widget.api.post(
          'applications/${widget.kind.toLowerCase()}/submit',
          {'revision': nextRevision},
        );
      }
      await widget.onSaved();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              submit ? 'Application submitted for review.' : 'Draft saved.',
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

  @override
  Widget build(BuildContext context) {
    final agent = widget.kind == 'AGENT';
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
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
          const SizedBox(height: 4),
          if (widget.supportedServices.isNotEmpty)
            Wrap(
              spacing: 6,
              children: widget.supportedServices
                  .map(
                    (service) => FilterChip(
                      label: Text(_supportedServiceLabel(service)),
                      selected: _services.contains(service),
                      onSelected: (selected) => setState(() {
                        if (selected) {
                          _services.add(service);
                        } else {
                          _services.remove(service);
                        }
                      }),
                    ),
                  )
                  .toList(),
            ),
          if (widget.supportedServices.isEmpty)
            const Text(
              'Service options are unavailable. Refresh to load the supported list.',
              style: TextStyle(color: Color(0xFF59685F), fontSize: 12),
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
