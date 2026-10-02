import 'package:flutter/material.dart';
import '../services/api_service.dart';

typedef BeneficiaryLoader = Future<List<Map<String, dynamic>>> Function();
typedef BeneficiarySaver = Future<Map<String, dynamic>> Function({
  required String phone,
  required String name,
  required String network,
  required String serviceType,
});
typedef BeneficiaryUpdater = Future<Map<String, dynamic>> Function({
  required String id,
  required String name,
});
typedef BeneficiaryDeleter = Future<Map<String, dynamic>> Function(String id);

class SavedBeneficiaries extends StatefulWidget {
  const SavedBeneficiaries({
    super.key,
    required this.phoneController,
    required this.serviceType,
    required this.network,
    this.loadBeneficiaries,
    this.saveBeneficiary,
    this.updateBeneficiary,
    this.deleteBeneficiary,
  });

  final TextEditingController phoneController;
  final String serviceType;
  final String network;
  final BeneficiaryLoader? loadBeneficiaries;
  final BeneficiarySaver? saveBeneficiary;
  final BeneficiaryUpdater? updateBeneficiary;
  final BeneficiaryDeleter? deleteBeneficiary;

  static final Set<VoidCallback> _reloadListeners = <VoidCallback>{};

  static Future<void> offerSave({
    required BuildContext context,
    required String phone,
    required String network,
    required String serviceType,
  }) async {
    final controller = TextEditingController();
    final route = DialogRoute<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Save this number'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 80,
          decoration: const InputDecoration(
            labelText: 'Nickname (optional)',
            hintText: 'Mum, Office, My MTN',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Not now'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    final name = await Navigator.of(context).push(route);
    await route.completed;
    controller.dispose();
    if (name == null || !context.mounted || phone.trim().isEmpty) return;
    try {
      final result = await ApiService.saveBeneficiary(
        phone: phone.trim(),
        name: name.trim(),
        network: network,
        serviceType: serviceType,
      );
      if (result['success'] == false) {
        throw Exception(result['message']?.toString() ?? 'Could not save this number.');
      }
      _notifyReloadListeners();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(result['message']?.toString() ?? 'Number saved.')),
        );
      }
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_message(error))),
        );
      }
    }
  }

  /// Refreshes mounted instances after a save performed outside the widget.
  static void notifySaved() => _notifyReloadListeners();

  static void _notifyReloadListeners() {
    for (final listener in List<VoidCallback>.of(_reloadListeners)) {
      listener();
    }
  }

  @override
  State<SavedBeneficiaries> createState() => _SavedBeneficiariesState();
}

class _SavedBeneficiariesState extends State<SavedBeneficiaries> {
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _nicknameController = TextEditingController();
  List<Map<String, dynamic>> _items = <Map<String, dynamic>>[];
  bool _loading = true;
  bool _writing = false;
  String? _loadError;
  String? _mutationError;
  int _loadGeneration = 0;

  BeneficiaryLoader get _loader =>
      widget.loadBeneficiaries ?? ApiService.getBeneficiaries;
  BeneficiarySaver get _saver =>
      widget.saveBeneficiary ?? ApiService.saveBeneficiary;
  BeneficiaryUpdater get _updater =>
      widget.updateBeneficiary ?? ApiService.updateBeneficiary;
  BeneficiaryDeleter get _deleter =>
      widget.deleteBeneficiary ?? ApiService.deleteBeneficiary;

  @override
  void initState() {
    super.initState();
    SavedBeneficiaries._reloadListeners.add(_reloadFromExternalSave);
    _load();
  }

  @override
  void dispose() {
    SavedBeneficiaries._reloadListeners.remove(_reloadFromExternalSave);
    _searchController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  void _reloadFromExternalSave() {
    if (mounted) _load();
  }

  Future<void> _load() async {
    final generation = ++_loadGeneration;
    if (mounted) {
      setState(() {
        _loading = true;
        _loadError = null;
      });
    }
    try {
      final result = await _loader();
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _items = result.map((item) => Map<String, dynamic>.from(item)).toList();
        _loading = false;
        _loadError = null;
      });
    } catch (error) {
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _loading = false;
        _loadError = _message(error);
      });
    }
  }

  List<Map<String, dynamic>> get _visibleItems {
    final query = _searchController.text.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items.where((item) {
      final name = (item['name'] ?? '').toString().toLowerCase();
      final phone = (item['phone'] ?? '').toString().toLowerCase();
      return name.contains(query) || phone.contains(query);
    }).toList();
  }

  Future<void> _saveCurrentNumber() async {
    final phone = widget.phoneController.text.trim();
    if (phone.isEmpty) {
      setState(() => _mutationError = 'Enter a phone number before saving.');
      return;
    }
    await _performWrite(() async {
      final result = await _saver(
        phone: phone,
        name: _nicknameController.text.trim(),
        network: widget.network,
        serviceType: widget.serviceType,
      );
      _ensureSuccessful(result, 'Could not save this number.');
      _nicknameController.clear();
      SavedBeneficiaries.notifySaved();
    });
  }

  Future<void> _rename(Map<String, dynamic> item) async {
    final controller = TextEditingController(text: (item['name'] ?? '').toString());
    final route = DialogRoute<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rename saved number'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 80,
          decoration: const InputDecoration(
            labelText: 'Nickname (optional)',
            hintText: 'Leave blank to remove nickname',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    final name = await Navigator.of(context).push(route);
    await route.completed;
    controller.dispose();
    if (name == null || !mounted) return;
    await _performWrite(() async {
      final result = await _updater(id: item['_id'].toString(), name: name.trim());
      _ensureSuccessful(result, 'Could not rename this number.');
    });
  }

  Future<void> _confirmDelete(Map<String, dynamic> item) async {
    final phone = (item['phone'] ?? 'this number').toString();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete saved number?'),
        content: Text('Remove $phone from your saved numbers?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _performWrite(() async {
      final result = await _deleter(item['_id'].toString());
      _ensureSuccessful(result, 'Could not delete this number.');
    });
  }

  Future<void> _performWrite(Future<void> Function() action) async {
    if (_writing) return;
    setState(() {
      _writing = true;
      _mutationError = null;
    });
    try {
      await action();
      await _load();
    } catch (error) {
      if (mounted) setState(() => _mutationError = _message(error));
    } finally {
      if (mounted) setState(() => _writing = false);
    }
  }

  void _ensureSuccessful(Map<String, dynamic> result, String fallback) {
    if (result['success'] == false) {
      throw Exception(result['message']?.toString() ?? fallback);
    }
  }

  void _select(Map<String, dynamic> item) {
    final phone = (item['phone'] ?? '').toString();
    widget.phoneController.value = TextEditingValue(
      text: phone,
      selection: TextSelection.collapsed(offset: phone.length),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final visibleItems = _visibleItems;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.38),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.bookmark_outline, color: theme.colorScheme.primary),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  'Saved Numbers',
                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              if (_loading)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _nicknameController,
            maxLength: 80,
            enabled: !_writing,
            decoration: const InputDecoration(
              labelText: 'Nickname (optional)',
              hintText: 'Mum, Office, My MTN',
              prefixIcon: Icon(Icons.person_outline),
              counterText: '',
              isDense: true,
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _writing ? null : _saveCurrentNumber,
              icon: const Icon(Icons.bookmark_add_outlined),
              label: Text(_writing ? 'Saving…' : 'Save this number'),
            ),
          ),
          if (_mutationError != null) ...[
            const SizedBox(height: 8),
            _inlineMessage(context, _mutationError!, isError: true),
          ],
          const SizedBox(height: 14),
          TextField(
            controller: _searchController,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              isDense: true,
              prefixIcon: const Icon(Icons.search),
              hintText: 'Search saved numbers',
              border: const OutlineInputBorder(),
              suffixIcon: _searchController.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      onPressed: () {
                        _searchController.clear();
                        setState(() {});
                      },
                      icon: const Icon(Icons.close),
                    ),
            ),
          ),
          const SizedBox(height: 8),
          if (_loading && _items.isEmpty)
            const _BeneficiaryLoading()
          else if (_loadError != null) ...[
            _inlineMessage(
              context,
              _loadError!,
              isError: true,
              action: TextButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ),
            if (_items.isNotEmpty) ...visibleItems.map((item) => _beneficiaryTile(context, item)),
          ]
          else if (_items.isEmpty)
            _inlineMessage(context, 'No saved numbers yet. Save this number for next time.')
          else if (visibleItems.isEmpty)
            _inlineMessage(context, 'No saved numbers match “${_searchController.text.trim()}”.')
          else
            ...visibleItems.map((item) => _beneficiaryTile(context, item)),
        ],
      ),
    );
  }

  Widget _beneficiaryTile(BuildContext context, Map<String, dynamic> item) {
    final theme = Theme.of(context);
    final name = (item['name'] ?? '').toString().trim();
    final phone = (item['phone'] ?? '').toString();
    return Container(
      margin: const EdgeInsets.only(top: 7),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: () => _select(item),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                child: Row(
                  children: [
                    Icon(Icons.phone_iphone, size: 20, color: theme.colorScheme.primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (name.isNotEmpty)
                            Text(name, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                          Text(phone, style: theme.textTheme.bodyMedium),
                        ],
                      ),
                    ),
                    const SizedBox(width: 5),
                    Text('Use', style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.primary)),
                  ],
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: 'Rename $phone',
            onPressed: _writing ? null : () => _rename(item),
            icon: const Icon(Icons.edit_outlined, size: 19),
          ),
          IconButton(
            tooltip: 'Delete $phone',
            onPressed: _writing ? null : () => _confirmDelete(item),
            icon: const Icon(Icons.delete_outline, size: 19),
          ),
        ],
      ),
    );
  }

  Widget _inlineMessage(
    BuildContext context,
    String message, {
    bool isError = false,
    Widget? action,
  }) {
    final color = isError ? Theme.of(context).colorScheme.error : Theme.of(context).hintColor;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: isError ? Theme.of(context).colorScheme.errorContainer : null,
        borderRadius: BorderRadius.circular(9),
      ),
      child: Row(
        children: [
          Expanded(child: Text(message, style: TextStyle(color: isError ? Theme.of(context).colorScheme.onErrorContainer : color))),
          if (action != null) action,
        ],
      ),
    );
  }
}

class _BeneficiaryLoading extends StatelessWidget {
  const _BeneficiaryLoading();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: 14),
        child: Column(
          children: [
            LinearProgressIndicator(),
            SizedBox(height: 8),
            Text('Loading saved numbers…'),
          ],
        ),
      );
}

String _message(Object error) =>
    error.toString().replaceFirst('Exception: ', '').trim();