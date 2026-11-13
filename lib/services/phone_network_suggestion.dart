import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'data_phone.dart';
import 'contact_picker_stub.dart'
    if (dart.library.io) 'contact_picker_native.dart'
    if (dart.library.js_interop) 'contact_picker_web.dart' as platform;

/// Prefix-based Nigerian mobile network suggestions. This is not an MNP
/// lookup, so customers can always select a different network manually.
class PhoneNetworkSuggestionController extends ChangeNotifier {
  PhoneNetworkSuggestionController({
    required this.phoneController,
    required this.onSuggestion,
    this.debounceDuration = const Duration(milliseconds: 450),
  }) {
    _canonicalPhone = normalizeDataPhone(phoneController.text);
    phoneController.addListener(_handlePhoneChanged);
    _scheduleDetection();
  }

  final TextEditingController phoneController;
  final Future<void> Function(String network) onSuggestion;
  final Duration debounceDuration;

  Timer? _timer;
  String _canonicalPhone = '';
  String? suggestedNetwork;
  bool isDetecting = false;
  bool hasManualOverride = false;
  bool _disposed = false;
  int _generation = 0;

  static const Map<String, List<String>> _prefixes = {
    'MTN': [
      '07025',
      '07026',
      '0703',
      '0704',
      '0706',
      '0707',
      '0803',
      '0806',
      '0810',
      '0813',
      '0814',
      '0816',
      '0903',
      '0906',
      '0913',
      '0916',
    ],
    'Airtel': [
      '0701',
      '0708',
      '0802',
      '0808',
      '0812',
      '0901',
      '0902',
      '0904',
      '0907',
      '0912',
      '0911',
    ],
    'Glo': ['0705', '0805', '0807', '0811', '0815', '0905', '0915'],
    '9mobile': ['0809', '0817', '0818', '0908', '0909'],
  };

  static String? suggestNetwork(String input) {
    final phone = normalizeDataPhone(input);
    if (!RegExp(r'^0\d{10}$').hasMatch(phone)) return null;
    for (final entry in _prefixes.entries) {
      if (entry.value.any(phone.startsWith)) return entry.key;
    }
    return null;
  }

  String get normalizedPhone => _canonicalPhone;

  String? get unsupportedNetworkExplanation {
    if (_canonicalPhone.startsWith('0801')) {
      return '0801 is not a prefix of MTN, Airtel, Glo or 9mobile. '
          'Choose the current network manually only if this number was ported.';
    }
    if (_canonicalPhone.startsWith('0804')) {
      return '0804 is allocated to M-Tel, not one of these four networks. '
          'Choose the current network manually only if this number was ported.';
    }
    return null;
  }

  void markManualSelection() {
    hasManualOverride = true;
    _timer?.cancel();
    isDetecting = false;
    _generation++;
    notifyListeners();
  }

  void _handlePhoneChanged() {
    final next = normalizeDataPhone(phoneController.text);
    if (next == _canonicalPhone) return;
    _canonicalPhone = next;
    hasManualOverride = false;
    suggestedNetwork = null;
    _generation++;
    _timer?.cancel();
    _scheduleDetection();
  }

  void _scheduleDetection() {
    final generation = _generation;
    final phone = _canonicalPhone;
    if (!RegExp(r'^0\d{10}$').hasMatch(phone)) {
      isDetecting = false;
      notifyListeners();
      return;
    }
    isDetecting = true;
    notifyListeners();
    _timer = Timer(debounceDuration, () async {
      if (_disposed || generation != _generation) return;
      final network = suggestNetwork(phone);
      suggestedNetwork = network;
      isDetecting = false;
      notifyListeners();
      if (network != null && !hasManualOverride && !_disposed) {
        await onSuggestion(network);
      }
    });
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _timer?.cancel();
    phoneController.removeListener(_handlePhoneChanged);
    super.dispose();
  }
}

enum ContactPickerFailure { permissionDenied, unavailable, unsupported }

class ContactPickerException implements Exception {
  const ContactPickerException(this.failure);
  final ContactPickerFailure failure;
}

/// Small platform-channel boundary; no contact-list permission or upload.
class ContactPhonePicker {
  ContactPhonePicker({
    MethodChannel? channel,
    bool? supported,
  })  : _channel = channel,
        _supported = supported;

  final MethodChannel? _channel;
  final bool? _supported;

  bool get isSupported {
    if (_supported != null) return _supported;
    return platform.supported;
  }

  Future<String?> pickPhoneNumber({
    Future<String?> Function(List<String> numbers)? chooseNumber,
  }) async {
    if (!isSupported) {
      throw const ContactPickerException(ContactPickerFailure.unsupported);
    }
    try {
      final injectedChannel = _channel;
      if (injectedChannel != null) {
        return await injectedChannel.invokeMethod<String>('pickPhoneNumber');
      }
      final selected = await platform.selectPhoneNumbers();
      if (selected == null) return null;
      final numbers = selected
          .map(normalizeDataPhone)
          .where((number) => number.isNotEmpty)
          .toSet()
          .toList();
      if (numbers.isEmpty) return null;
      if (numbers.length == 1) return numbers.single;
      // A contact may have several numbers. Never silently pick the first.
      return chooseNumber == null ? null : await chooseNumber(numbers);
    } on PlatformException catch (error) {
      if (error.code == 'permission_denied') {
        throw const ContactPickerException(
            ContactPickerFailure.permissionDenied);
      }
      throw const ContactPickerException(ContactPickerFailure.unavailable);
    } on MissingPluginException {
      throw const ContactPickerException(ContactPickerFailure.unavailable);
    }
  }
}
