import 'package:flutter/material.dart';

import '../services/data_phone.dart';
import '../services/phone_network_suggestion.dart';

class BeneficiaryPhoneEntry extends StatefulWidget {
  const BeneficiaryPhoneEntry({
    super.key,
    required this.phoneController,
    required this.suggestions,
    required this.selectedNetwork,
    required this.decoration,
    required this.enabled,
    required this.picker,
    this.maxLength = 24,
    this.onMessage,
    this.focusNode,
    this.onFieldTap,
  });

  final TextEditingController phoneController;
  final PhoneNetworkSuggestionController suggestions;
  final String selectedNetwork;
  final InputDecoration decoration;
  final bool enabled;
  final ContactPhonePicker picker;
  final int maxLength;
  final ValueChanged<String>? onMessage;
  final FocusNode? focusNode;
  final VoidCallback? onFieldTap;

  @override
  State<BeneficiaryPhoneEntry> createState() => _BeneficiaryPhoneEntryState();
}

class _BeneficiaryPhoneEntryState extends State<BeneficiaryPhoneEntry> {
  @override
  void initState() {
    super.initState();
    widget.suggestions.addListener(_refresh);
  }

  @override
  void didUpdateWidget(covariant BeneficiaryPhoneEntry oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.suggestions != widget.suggestions) {
      oldWidget.suggestions.removeListener(_refresh);
      widget.suggestions.addListener(_refresh);
    }
  }

  @override
  void dispose() {
    widget.suggestions.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  bool _isPickingContact = false;

  String get _suggestionMessage {
    final controller = widget.suggestions;
    if (controller.isDetecting) return 'Checking number prefix…';
    if (controller.hasManualOverride) {
      return 'Network selected manually: ${widget.selectedNetwork}.';
    }
    if (controller.suggestedNetwork != null) {
      return 'Prefix-based suggestion: ${controller.suggestedNetwork} '
          '(not MNP verified).';
    }
    final unsupportedExplanation = controller.unsupportedNetworkExplanation;
    if (unsupportedExplanation != null) return unsupportedExplanation;
    if (RegExp(r'^0\d{10}$').hasMatch(controller.normalizedPhone)) {
      return 'No prefix suggestion available. Choose a network manually.';
    }
    return 'Network suggestions use prefixes and are not MNP verified.';
  }

  Future<void> _selectContact() async {
    if (_isPickingContact) return;
    if (!widget.picker.isSupported) {
      widget.onMessage?.call(
        'Contact selection is unavailable here. Enter the number manually.',
      );
      return;
    }
    setState(() => _isPickingContact = true);
    try {
      final selected = await widget.picker.pickPhoneNumber(
        chooseNumber: _chooseContactNumber,
      );
      if (!mounted || selected == null) return;
      final normalized = normalizeDataPhone(selected);
      widget.phoneController.value = TextEditingValue(
        text: normalized,
        selection: TextSelection.collapsed(offset: normalized.length),
      );
    } on ContactPickerException catch (error) {
      final message = switch (error.failure) {
        ContactPickerFailure.permissionDenied =>
          'Contact access was denied. You can still enter the number manually.',
        ContactPickerFailure.unavailable =>
          'The contact picker is unavailable. Enter the number manually.',
        ContactPickerFailure.unsupported =>
          'Contacts are unavailable on this platform. Enter the number manually.',
      };
      widget.onMessage?.call(message);
    } catch (_) {
      widget.onMessage?.call(
        'The contact picker could not be opened. Enter the number manually.',
      );
    } finally {
      if (mounted) setState(() => _isPickingContact = false);
    }
  }

  Future<String?> _chooseContactNumber(List<String> numbers) async {
    if (!mounted || numbers.isEmpty) return null;
    if (numbers.length == 1) return numbers.single;
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Choose a phone number'),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360, maxHeight: 320),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final number in numbers)
                  ListTile(
                    title: Text(number),
                    onTap: () => Navigator.of(dialogContext).pop(number),
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final unsupported = !widget.picker.isSupported;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextField(
                controller: widget.phoneController,
                focusNode: widget.focusNode,
                enabled: widget.enabled,
                keyboardType: TextInputType.phone,
                maxLength: widget.maxLength,
                onTap: widget.onFieldTap,
                decoration: widget.decoration,
              ),
            ),
            const SizedBox(width: 8),
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: OutlinedButton.icon(
                key: const Key('beneficiary-select-contact'),
                onPressed: widget.enabled &&
                        widget.picker.isSupported &&
                        !_isPickingContact
                    ? _selectContact
                    : null,
                icon: _isPickingContact
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.contacts_outlined, size: 18),
                label: const Text('Select Contact'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 54),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 5, left: 2),
          child: Row(
            children: [
              if (widget.suggestions.isDetecting) ...[
                const SizedBox(
                  width: 13,
                  height: 13,
                  child: CircularProgressIndicator(strokeWidth: 1.8),
                ),
                const SizedBox(width: 7),
              ],
              Expanded(
                child: Text(
                  _suggestionMessage,
                  style: TextStyle(
                    fontSize: 12,
                    color: widget.suggestions.suggestedNetwork == null
                        ? Colors.black54
                        : const Color(0xFF08783E),
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ),
        if (unsupported)
          const Padding(
            padding: EdgeInsets.only(top: 2, left: 2),
            child: Text(
              'Contacts are unavailable here. Enter the number manually.',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ),
      ],
    );
  }
}
