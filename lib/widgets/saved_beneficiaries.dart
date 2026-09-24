import 'package:flutter/material.dart';
import '../services/api_service.dart';

class SavedBeneficiaries extends StatefulWidget {
  const SavedBeneficiaries({
    super.key,
    required this.phoneController,
    required this.serviceType,
    required this.network,
  });
  final TextEditingController phoneController;
  final String serviceType;
  final String network;

  @override
  State<SavedBeneficiaries> createState() => _SavedBeneficiariesState();

  static Future<void> offerSave({
    required BuildContext context,
    required String phone,
    required String network,
    required String serviceType,
  }) async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Save this number'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 80,
          decoration: const InputDecoration(labelText: 'Beneficiary name', hintText: 'Mum, Office, My MTN'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Not now')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.trim().isEmpty || !context.mounted) return;
    try {
      final result = await ApiService.saveBeneficiary(
        phone: phone, name: name, network: network, serviceType: serviceType,
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result['message']?.toString() ?? 'Number saved.')),
      );
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString().replaceFirst('Exception: ', ''))),
      );
    }
  }
}

class _SavedBeneficiariesState extends State<SavedBeneficiaries> {
  List<Map<String, dynamic>> items = [];
  bool loading = true;
  final searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final result = await ApiService.getBeneficiaries();
      if (mounted) setState(() { items = result; loading = false; });
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _rename(Map<String, dynamic> item) async {
    final controller = TextEditingController(text: item['name']?.toString() ?? '');
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename beneficiary'),
        content: TextField(controller: controller, autofocus: true, maxLength: 80),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.isEmpty) return;
    await ApiService.updateBeneficiary(id: item['_id'].toString(), name: name);
    _load();
  }

  Future<void> _delete(Map<String, dynamic> item) async {
    await ApiService.deleteBeneficiary(item['_id'].toString());
    _load();
  }

  @override
  Widget build(BuildContext context) {
    if (loading || items.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Saved Numbers / Beneficiaries', style: TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        TextField(
          controller: searchController,
          onChanged: (_) => _loadSearch(),
          decoration: const InputDecoration(
            isDense: true,
            prefixIcon: Icon(Icons.search),
            hintText: 'Search saved numbers',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 48,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, index) {
              final item = items[index];
              return GestureDetector(
                onLongPress: () => _rename(item),
                child: InputChip(
                  avatar: const Icon(Icons.person_outline, size: 18),
                  label: Text('${item['name']} · ${item['phone']}'),
                  onPressed: () => widget.phoneController.text = item['phone'].toString(),
                  onDeleted: () => _delete(item),
                  deleteButtonTooltipMessage: 'Delete',
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _loadSearch() async {
    final result = await ApiService.getBeneficiaries(search: searchController.text);
    if (mounted) setState(() => items = result);
  }
}