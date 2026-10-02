import 'package:flutter/material.dart';
import 'dart:async';
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
    this.loadCachedBeneficiaries,
    this.loadTimeout = const Duration(seconds: 4),
  });

  final TextEditingController phoneController;
  final String serviceType;
  final String network;
  final BeneficiaryLoader? loadBeneficiaries;
  final BeneficiarySaver? saveBeneficiary;
  final BeneficiaryUpdater? updateBeneficiary;
  final BeneficiaryDeleter? deleteBeneficiary;
  final BeneficiaryLoader? loadCachedBeneficiaries;
  final Duration loadTimeout;

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
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
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
        throw Exception(
            result['message']?.toString() ?? 'Could not save this number.');
      }
      _notifyReloadListeners();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(result['message']?.toString() ?? 'Number saved.')),
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
  List<Map<String, dynamic>> _items = <Map<String, dynamic>>[];
  bool _loading = true;
  bool _writing = false;
  String? _loadError;
  String? _mutationError;
  int _loadGeneration = 0;
  StateSetter? _sheetSetState;

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
    _sheetSetState = null;
    super.dispose();
  }

  void _refreshViews([VoidCallback? change]) {
    if (mounted) setState(change ?? () {});
    final updateSheet = _sheetSetState;
    if (updateSheet != null) {
      try {
        updateSheet(() {});
      } catch (_) {
        _sheetSetState = null;
      }
    }
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
    unawaited(_restoreCached(generation));
    try {
      final result = await _loader().timeout(widget.loadTimeout);
      if (!mounted || generation != _loadGeneration) return;
      _refreshViews(() {
        _items = result.map((item) => Map<String, dynamic>.from(item)).toList();
        _loading = false;
        _loadError = null;
      });
    } catch (error) {
      if (!mounted || generation != _loadGeneration) return;
      _refreshViews(() {
        _loading = false;
        _loadError =
            "Saved numbers couldn't load. You can still enter a number manually.";
      });
    }
  }

  Future<void> _restoreCached(int generation) async {
    final cache = widget.loadCachedBeneficiaries ??
        (widget.loadBeneficiaries == null
            ? ApiService.cachedBeneficiaries
            : null);
    if (cache == null) return;
    try {
      final rows = await cache().timeout(const Duration(milliseconds: 750));
      if (!mounted ||
          generation != _loadGeneration ||
          (!_loading && _loadError == null)) {
        return;
      }
      if (rows.isNotEmpty) {
        _refreshViews(
            () => _items = rows.map(Map<String, dynamic>.from).toList());
      }
    } catch (_) {
      // Optional cached numbers must never block the form or its network fetch.
    }
  }

  Future<void> _openSaveDialog() async {
    final phoneController =
        TextEditingController(text: widget.phoneController.text.trim());
    final nicknameController = TextEditingController();
    bool saving = false;
    String? errorMessage;
    final route = DialogRoute<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Save number'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: phoneController,
                  autofocus: true,
                  keyboardType: TextInputType.phone,
                  maxLength: 24,
                  decoration: const InputDecoration(
                    labelText: 'Phone Number',
                    hintText: '08012345678',
                    counterText: '',
                    prefixIcon: Icon(Icons.phone_outlined),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: nicknameController,
                  maxLength: 80,
                  decoration: const InputDecoration(
                    labelText: 'Nickname (optional)',
                    hintText: 'Mum, Office',
                    counterText: '',
                    prefixIcon: Icon(Icons.person_outline),
                  ),
                ),
                if (errorMessage != null) ...[
                  const SizedBox(height: 8),
                  _inlineMessage(context, errorMessage!, isError: true),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: saving
                  ? null
                  : () async {
                      final phone = phoneController.text.trim();
                      if (phone.isEmpty) {
                        setDialogState(
                            () => errorMessage = 'Enter a phone number.');
                        return;
                      }
                      setDialogState(() {
                        saving = true;
                        errorMessage = null;
                      });
                      try {
                        final result = await _saver(
                          phone: phone,
                          name: nicknameController.text.trim(),
                          network: widget.network,
                          serviceType: widget.serviceType,
                        );
                        _ensureSuccessful(
                            result, 'Could not save this number.');
                        if (!mounted) return;
                        _upsertSavedItem(
                          phone: phone,
                          name: nicknameController.text.trim(),
                          result: result,
                        );
                        SavedBeneficiaries.notifySaved();
                        if (dialogContext.mounted) {
                          Navigator.pop(dialogContext, true);
                        }
                      } catch (error) {
                        if (dialogContext.mounted) {
                          setDialogState(() {
                            saving = false;
                            errorMessage = _message(error);
                          });
                        }
                      }
                    },
              child: Text(saving ? 'Saving…' : 'Save'),
            ),
          ],
        ),
      ),
    );
    await Navigator.of(context).push(route);
    await route.completed;
    phoneController.dispose();
    nicknameController.dispose();
  }

  void _upsertSavedItem({
    required String phone,
    required String name,
    required Map<String, dynamic> result,
  }) {
    final dynamic raw = result['beneficiary'] ?? result['data'];
    final Map<String, dynamic> saved =
        raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    saved['phone'] = saved['phone']?.toString() ?? phone;
    saved['name'] = saved['name']?.toString() ?? name;
    final index =
        _items.indexWhere((item) => (item['phone'] ?? '').toString() == phone);
    _refreshViews(() {
      if (index >= 0) {
        _items[index] = {..._items[index], ...saved};
      } else {
        _items = [saved, ..._items];
      }
      _loadError = null;
      _loading = false;
    });
  }

  Future<void> _rename(Map<String, dynamic> item) async {
    final controller =
        TextEditingController(text: (item['name'] ?? '').toString());
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
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
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
      final result =
          await _updater(id: item['_id'].toString(), name: name.trim());
      _ensureSuccessful(result, 'Could not rename this number.');
      final index = _items.indexWhere(
          (saved) => saved['_id'].toString() == item['_id'].toString());
      if (index >= 0) {
        final updated = Map<String, dynamic>.from(_items[index]);
        updated['name'] = name.trim();
        _refreshViews(() => _items[index] = updated);
      }
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
      _refreshViews(() => _items.removeWhere(
          (saved) => saved['_id'].toString() == item['_id'].toString()));
    });
  }

  Future<void> _performWrite(Future<void> Function() action) async {
    if (_writing) return;
    _refreshViews(() {
      _writing = true;
      _mutationError = null;
    });
    try {
      await action();
      if (!mounted) return;
      // Invalidate an earlier background response before refreshing the list.
      _loadGeneration++;
      unawaited(_load());
    } catch (error) {
      _refreshViews(() => _mutationError = _message(error));
    } finally {
      _refreshViews(() => _writing = false);
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
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 4, bottom: 8),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _showSavedNumbers,
              icon: const Icon(Icons.bookmark_outline, size: 18),
              label: const Text('Saved Numbers'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 11),
                visualDensity: VisualDensity.compact,
              ),
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: FilledButton.icon(
              onPressed: _openSaveDialog,
              icon: const Icon(Icons.bookmark_add_outlined, size: 18),
              label: const Text('Save Number'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 11),
                visualDensity: VisualDensity.compact,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showSavedNumbers() async {
    final searchController = TextEditingController();
    final media = MediaQuery.of(context);
    final maxHeight = media.size.height * 0.78;
    TransitionRoute<dynamic>? sheetRoute;
    final future = showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => AnimatedPadding(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        padding: EdgeInsets.only(
            bottom: MediaQuery.of(sheetContext).viewInsets.bottom),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: maxHeight),
            child: Material(
              color: Theme.of(sheetContext).colorScheme.surface,
              clipBehavior: Clip.antiAlias,
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(22)),
              child: StatefulBuilder(
                builder: (context, setModalState) {
                  sheetRoute ??=
                      ModalRoute.of(sheetContext) as TransitionRoute<dynamic>?;
                  _sheetSetState = setModalState;
                  final query = searchController.text.trim().toLowerCase();
                  final visibleItems = _items.where((item) {
                    final name = (item['name'] ?? '').toString().toLowerCase();
                    final phone =
                        (item['phone'] ?? '').toString().toLowerCase();
                    return query.isEmpty ||
                        name.contains(query) ||
                        phone.contains(query);
                  }).toList();
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text('Saved Numbers',
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleLarge
                                      ?.copyWith(fontWeight: FontWeight.w800)),
                            ),
                            if (_loading)
                              const SizedBox(
                                width: 17,
                                height: 17,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              ),
                            IconButton(
                              tooltip: 'Close',
                              onPressed: () => Navigator.pop(sheetContext),
                              icon: const Icon(Icons.close),
                            ),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: TextField(
                          controller: searchController,
                          onChanged: (_) => setModalState(() {}),
                          decoration: InputDecoration(
                            isDense: true,
                            prefixIcon: const Icon(Icons.search),
                            hintText: 'Search saved numbers',
                            border: const OutlineInputBorder(),
                            suffixIcon: searchController.text.isEmpty
                                ? null
                                : IconButton(
                                    tooltip: 'Clear search',
                                    onPressed: () {
                                      searchController.clear();
                                      setModalState(() {});
                                    },
                                    icon: const Icon(Icons.close),
                                  ),
                          ),
                        ),
                      ),
                      if (_loadError != null)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                          child: _inlineMessage(
                            context,
                            _loadError!,
                            isError: true,
                            action: TextButton.icon(
                              onPressed: _load,
                              icon: const Icon(Icons.refresh),
                              label: const Text('Retry'),
                            ),
                          ),
                        ),
                      if (_mutationError != null)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                          child: _inlineMessage(context, _mutationError!,
                              isError: true),
                        ),
                      Flexible(
                        child: _loading && _items.isEmpty
                            ? const _BeneficiaryLoading()
                            : _items.isEmpty
                                ? Center(
                                    child: Padding(
                                      padding: const EdgeInsets.all(24),
                                      child: Text(
                                        _loadError == null
                                            ? 'No saved numbers yet.'
                                            : 'Saved numbers are unavailable. You can still enter a number manually.',
                                        textAlign: TextAlign.center,
                                      ),
                                    ),
                                  )
                                : visibleItems.isEmpty
                                    ? Center(
                                        child: Padding(
                                          padding: const EdgeInsets.all(20),
                                          child: Text(
                                            'No saved numbers match “${searchController.text.trim()}”.',
                                            textAlign: TextAlign.center,
                                          ),
                                        ),
                                      )
                                    : ListView.builder(
                                        keyboardDismissBehavior:
                                            ScrollViewKeyboardDismissBehavior
                                                .onDrag,
                                        padding: const EdgeInsets.fromLTRB(
                                            16, 0, 16, 16),
                                        itemCount: visibleItems.length,
                                        itemBuilder: (context, index) =>
                                            _beneficiaryTile(
                                          context,
                                          visibleItems[index],
                                        ),
                                      ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
    await future;
    await sheetRoute?.completed;
    _sheetSetState = null;
    searchController.dispose();
  }

  Widget _beneficiaryTile(BuildContext context, Map<String, dynamic> item) {
    final theme = Theme.of(context);
    final name = (item['name'] ?? '').toString().trim();
    final phone = (item['phone'] ?? '').toString();
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: .32),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.only(left: 13, right: 4),
        leading: Icon(Icons.phone_iphone, color: theme.colorScheme.primary),
        title: Text(name.isEmpty ? phone : name,
            maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: name.isEmpty ? null : Text(phone),
        onTap: () {
          _select(item);
          Navigator.pop(context);
        },
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
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
      ),
    );
  }

  Widget _inlineMessage(
    BuildContext context,
    String message, {
    bool isError = false,
    Widget? action,
  }) {
    final color = isError
        ? Theme.of(context).colorScheme.error
        : Theme.of(context).hintColor;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: isError ? Theme.of(context).colorScheme.errorContainer : null,
        borderRadius: BorderRadius.circular(9),
      ),
      child: Row(
        children: [
          Expanded(
              child: Text(message,
                  style: TextStyle(
                      color: isError
                          ? Theme.of(context).colorScheme.onErrorContainer
                          : color))),
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
