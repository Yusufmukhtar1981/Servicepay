import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'widgets/pending_purchase_warning.dart';
import 'widgets/purchase_processing.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'services/api_service.dart';
import 'services/data_phone.dart';
import 'services/phone_network_suggestion.dart';
import 'services/purchase_session_recovery.dart';
import 'widgets/saved_beneficiaries.dart';
import 'widgets/beneficiary_phone_entry.dart';
import 'airtime_result_screen.dart';

class AirtimeScreen extends StatefulWidget {
  const AirtimeScreen({
    super.key,
    this.purchaseIntent,
    this.loadNetworks,
    this.loadBeneficiaries,
    this.pendingContext,
    this.contactPicker,
  });

  final AirtimePurchaseIntent? purchaseIntent;
  final Future<Map<String, dynamic>> Function()? loadNetworks;
  final BeneficiaryLoader? loadBeneficiaries;
  final PendingPurchaseContextLoader? pendingContext;
  final ContactPhonePicker? contactPicker;

  @override
  State<AirtimeScreen> createState() => _AirtimeScreenState();
}

class _AirtimeScreenState extends State<AirtimeScreen> {
  final TextEditingController phoneController = TextEditingController();

  final TextEditingController amountController = TextEditingController();

  // Labels are static, but purchase still requires server-verified catalogue IDs.
  List<String> networks = ['MTN', 'Airtel', 'Glo', '9mobile'];
  final Map<String, int> providerNetworkIds = {};
  bool _catalogLoading = true;
  String? _catalogError;
  bool _catalogAuthenticationRequired = false;

  String selectedNetwork = 'MTN';
  bool isLoading = false;
  bool _processingPurchase = false;
  bool _purchasePending = false;
  late final AirtimePurchaseIntent _purchaseIntent;
  late final PhoneNetworkSuggestionController _networkSuggestions;
  late final ContactPhonePicker _contactPicker;

  @override
  void initState() {
    super.initState();
    _purchaseIntent = widget.purchaseIntent ?? AirtimePurchaseIntent();
    _contactPicker = widget.contactPicker ?? ContactPhonePicker();
    _networkSuggestions = PhoneNetworkSuggestionController(
      phoneController: phoneController,
      onSuggestion: (network) async {
        if (!mounted || !networks.contains(network)) return;
        setState(() => selectedNetwork = network);
      },
    );
    _loadNetworks();
  }

  Future<void> _loadNetworks() async {
    if (mounted) {
      setState(() {
        _catalogLoading = true;
        _catalogError = null;
        _catalogAuthenticationRequired = false;
      });
    }
    try {
      final response =
          await (widget.loadNetworks ?? ApiService.getAirtimeNetworks)()
              .timeout(const Duration(seconds: 35));
      if (response['httpStatus'] == 401) {
        throw const PurchaseAuthenticationRequired('Sign in again.');
      }
      if (response['success'] != true || response['data'] is! List) {
        throw Exception('Airtime networks could not be verified.');
      }
      final mapped = <String, int>{};
      const labels = {
        'MTN': 'MTN',
        'AIRTEL': 'Airtel',
        'GLO': 'Glo',
        '9MOBILE': '9mobile',
        'ETISALAT': '9mobile'
      };
      for (final row in response['data'] as List) {
        final label = labels[row['displayName'].toString().toUpperCase()];
        final id =
            int.tryParse((row['networkId'] ?? row['providerId']).toString());
        if (label != null && id != null && id > 0) mapped[label] = id;
      }
      if (mapped.isEmpty) {
        throw Exception('Airtime networks could not be verified.');
      }
      if (!mounted) return;
      setState(() {
        providerNetworkIds.addAll(mapped);
        networks = mapped.keys.toList();
        if (!networks.contains(selectedNetwork)) {
          selectedNetwork = networks.first;
        }
        _catalogLoading = false;
        _catalogError = null;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _catalogLoading = false;
          _catalogAuthenticationRequired =
              error is PurchaseAuthenticationRequired;
          _catalogError = _catalogAuthenticationRequired
              ? 'Your session has expired. Sign in again to load Airtime networks. '
                  'No purchase has been made.'
              : 'Airtime networks could not be loaded. Retry loading; '
                  'no purchase has been made.';
        });
      }
    }
  }

  @override
  void dispose() {
    _networkSuggestions.dispose();
    phoneController.dispose();
    amountController.dispose();
    super.dispose();
  }

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Future<void> buyAirtime() async {
    if (isLoading) return;

    String phone = normalizeDataPhone(phoneController.text.trim());

    final String amountText = amountController.text.trim();

    final int? amountCents = AirtimePurchaseIntent.amountInCents(amountText);

    if (phone.isEmpty || amountText.isEmpty) {
      showMessage(
        'Please enter the phone number and amount.',
      );
      return;
    }
    if (!RegExp(r'^0\d{10}$').hasMatch(phone)) {
      showMessage('Please enter a valid 11-digit phone number.');
      return;
    }

    if (amountCents == null || amountCents < 5000) {
      showMessage(
        'The minimum airtime amount is ₦50.',
      );
      return;
    }
    final double amount = amountCents / 100;
    final String purchaseAmount =
        AirtimePurchaseIntent.formatAmountCents(amountCents);

    final String network = selectedNetwork;
    bool requestWasDispatched = false;
    String dispatchedRequestKey = '';
    setState(() {
      isLoading = true;
      _purchasePending = false;
    });

    try {
      // Read prior requests for safety, but never requery or resend them here.
      await _purchaseIntent.retainedKeys();
      final previousActiveKey = await _purchaseIntent.pendingKey();
      if (!mounted) return;
      final providerId = providerNetworkIds[network];
      if (providerId == null) {
        showMessage('Load the current Airtime networks before buying.');
        return;
      }
      final quoted = await ApiService.quoteAirtime(
          networkId: providerId, amount: purchaseAmount, phone: phone);
      final quote = quoted['data'] as Map?;
      final sellingPrice =
          double.tryParse(quote?['customerSellingPrice'].toString() ?? '');
      final normalizedPhone = quote?['normalizedPhone']?.toString();
      if (quoted['success'] != true ||
          sellingPrice == null ||
          sellingPrice <= 0 ||
          normalizedPhone == null ||
          normalizedPhone.isEmpty) {
        showMessage(quoted['message']?.toString() ??
            'The phone number or selling price could not be confirmed. No purchase was made.');
        return;
      }
      phone = normalizedPhone;
      if (!mounted) return;
      bool confirmationSubmitted = false;
      final bool? confirmed = await showDialog<bool>(
        context: context,
        builder: (BuildContext dialogContext) {
          return AlertDialog(
            title: const Text(
              'Confirm airtime purchase',
            ),
            content: Text(
              'Purchase ₦${amount.toStringAsFixed(0)} '
              '$network airtime for $phone?\n'
              'Wallet charge: ₦${sellingPrice.toStringAsFixed(2)}\n\n'
              'Confirming authorizes ONE NEW purchase and a separate wallet charge.',
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.pop(
                    dialogContext,
                    false,
                  );
                },
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: () {
                  if (confirmationSubmitted) return;
                  confirmationSubmitted = true;
                  Navigator.pop(
                    dialogContext,
                    true,
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                ),
                child: const Text('Confirm'),
              ),
            ],
          );
        },
      );

      if (confirmed != true || !mounted) return;

      String transactionPin = '';
      final TextEditingController transactionPinController =
          TextEditingController();
      bool pinSubmitted = false;
      final pinRoute = DialogRoute<String>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text('Enter Transaction PIN'),
            content: TextField(
              controller: transactionPinController,
              autofocus: true,
              obscureText: true,
              keyboardType: TextInputType.number,
              maxLength: 4,
              decoration: const InputDecoration(
                labelText: '4-digit PIN',
                hintText: '••••',
                counterText: '',
                border: OutlineInputBorder(),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: () {
                  if (pinSubmitted) return;
                  final pin = transactionPinController.text.trim();
                  if (!RegExp(r'^\d{4}$').hasMatch(pin)) return;
                  pinSubmitted = true;
                  setState(() {
                    _processingPurchase = true;
                  });
                  Navigator.of(dialogContext).pop(
                    pin,
                  );
                },
                child: const Text('Confirm'),
              ),
            ],
          );
        },
      );
      final String? enteredPin = await Navigator.of(context).push(pinRoute);
      pinRoute.completed.then((_) => transactionPinController.dispose());
      transactionPin = enteredPin ?? '';

      if (transactionPin.isEmpty) {
        return;
      }

      if (!RegExp(r'^\d{4}$').hasMatch(transactionPin)) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Please enter a valid 4-digit Transaction PIN.'),
            ),
          );
        }
        return;
      }

      // Keep the unresolved active identity untouched until purchase consent
      // and PIN are complete; archive it durably immediately before admission.
      if (previousActiveKey != null) {
        await _purchaseIntent.retainForSeparatePurchase();
      }
      String requestKey = '';
      final Map<String, dynamic> result = await _purchaseIntent.submit(
        newPurchase: true,
        network: network,
        phone: phone,
        amount: purchaseAmount,
        dispatch: (String idempotencyKey) {
          requestKey = idempotencyKey;
          dispatchedRequestKey = idempotencyKey;
          requestWasDispatched = true;
          return ApiService.buyAirtime(
            transactionPin: transactionPin,
            network: network,
            acknowledgePendingPurchase: true,
            providerNetworkId: providerId,
            customerSellingPrice: sellingPrice,
            phone: phone,
            amount: purchaseAmount,
            idempotencyKey: idempotencyKey,
          ).timeout(const Duration(seconds: 25));
        },
      );
      if (mounted) {
        setState(() {
          _processingPurchase = false;
        });
      }

      if (!mounted) return;

      final status = result['status']?.toString().toUpperCase() ?? '';
      _purchasePending = !_purchaseIntent.isTerminalResult(result);
      final reference = result['reference']?.toString() ?? '';
      final identity = reference.isNotEmpty ? reference : requestKey;
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => AirtimeResultScreen(
            identity: identity,
            idempotencyKey: requestKey,
            initialResult: result,
            phone: phone,
            network: network,
            amount: purchaseAmount,
            requery: (key) => ApiService.requeryAirtime(idempotencyKey: key),
            onTerminal: requestKey.isEmpty
                ? null
                : () => _purchaseIntent.finish(requestKey),
          ),
        ),
      );
      if (mounted &&
          const {'SUCCESS', 'SUCCESSFUL', 'COMPLETED'}.contains(status)) {
        phoneController.clear();
        amountController.clear();
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _processingPurchase = false;
          if (error is TimeoutException) _purchasePending = true;
        });
      }
      if (error is TimeoutException && mounted && requestWasDispatched) {
        final key = dispatchedRequestKey;
        if (key.isNotEmpty) {
          _purchasePending = true;
          await Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => AirtimeResultScreen(
                identity: key,
                idempotencyKey: key,
                initialResult: const {
                  'status': 'TIMEOUT',
                  'pending': true,
                  'success': false,
                },
                phone: phoneController.text.trim(),
                network: selectedNetwork,
                amount: amountController.text.trim(),
                requery: (requestKey) =>
                    ApiService.requeryAirtime(idempotencyKey: requestKey),
                onTerminal: () => _purchaseIntent.finish(key),
              ),
            ),
          );
        } else {
          showMessage(
              'The result is not confirmed. Do not submit again; check your transaction history.');
        }
      } else {
        final message = error.toString().replaceFirst('Exception: ', '');
        showMessage(message);
      }
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          _processingPurchase = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Buy Airtime',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: PurchaseProcessing(
        processing: _processingPurchase,
        pending: _purchasePending,
        nonBlocking: true,
        service: 'airtime',
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 600,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Select Network',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: selectedNetwork,
                    decoration: InputDecoration(
                      prefixIcon: const Icon(
                        Icons.sim_card_outlined,
                      ),
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    items: networks
                        .map(
                          (String network) => DropdownMenuItem<String>(
                            value: network,
                            child: Text(network),
                          ),
                        )
                        .toList(),
                    onChanged: isLoading
                        ? null
                        : (String? value) {
                            if (value == null) return;

                            _networkSuggestions.markManualSelection();
                            setState(() {
                              selectedNetwork = value;
                            });
                          },
                  ),
                  const SizedBox(height: 22),
                  if (_catalogLoading) const LinearProgressIndicator(),
                  if (_catalogError != null) ...[
                    Text(_catalogError!,
                        style: const TextStyle(color: Colors.red)),
                    TextButton(
                        onPressed: _catalogAuthenticationRequired
                            ? () => signInForPurchaseRecovery(context)
                            : _loadNetworks,
                        child: Text(_catalogAuthenticationRequired
                            ? 'Sign in again'
                            : 'Retry loading networks')),
                  ],
                  const Text(
                    'Phone Number',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 10),
                  BeneficiaryPhoneEntry(
                    phoneController: phoneController,
                    suggestions: _networkSuggestions,
                    selectedNetwork: selectedNetwork,
                    picker: _contactPicker,
                    enabled: !isLoading,
                    onMessage: showMessage,
                    decoration: InputDecoration(
                      hintText: '08012345678 or +2348012345678',
                      counterText: '',
                      prefixIcon: const Icon(
                        Icons.phone_outlined,
                      ),
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  SavedBeneficiaries(
                    loadBeneficiaries: widget.loadBeneficiaries,
                    phoneController: phoneController,
                    network: selectedNetwork,
                    serviceType: 'AIRTIME',
                  ),
                  const SizedBox(height: 22),
                  const Text(
                    'Amount',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: amountController,
                    enabled: !isLoading,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      hintText: 'Enter amount',
                      prefixText: '₦ ',
                      prefixIcon: const Icon(
                        Icons.payments_outlined,
                      ),
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton(
                      onPressed:
                          isLoading || _catalogLoading || _catalogError != null
                              ? null
                              : buyAirtime,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: _processingPurchase
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                color: Colors.white,
                              ),
                            )
                          : const Text(
                              'Buy Airtime',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

abstract class AirtimePurchaseIntentStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class _SecureAirtimePurchaseIntentStorage
    implements AirtimePurchaseIntentStorage {
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Airtime keys are durable and deliberately use a namespace separate from
/// the DATA purchase store. An ambiguous response must not create a new key.
class AirtimePurchaseIntent {
  AirtimePurchaseIntent({AirtimePurchaseIntentStorage? storage})
      : _storage = storage ?? _SecureAirtimePurchaseIntentStorage();

  final AirtimePurchaseIntentStorage _storage;
  static const String _storageKey = 'servicepay.airtimePurchase.pending';
  static const String _archiveKey = 'servicepay.airtimePurchase.retained';
  static final Map<String, Future<void>> _submissions =
      <String, Future<void>>{};

  static int? amountInCents(String amount) {
    final match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(amount.trim());
    if (match == null) return null;

    final int? whole = int.tryParse(match.group(1)!);
    final String fraction = (match.group(2) ?? '').padRight(2, '0');
    final int? cents = int.tryParse(fraction);
    if (whole == null || cents == null) return null;

    return whole * 100 + cents;
  }

  static String formatAmountCents(int cents) =>
      '${cents ~/ 100}.${(cents % 100).toString().padLeft(2, '0')}';

  String _fingerprint({
    required String network,
    required String phone,
    required String amount,
  }) {
    final int? cents = amountInCents(amount);
    if (cents == null) {
      throw ArgumentError.value(amount, 'amount');
    }

    return jsonEncode(<Object>[
      network.trim().toUpperCase(),
      phone.trim().replaceAll(RegExp(r'\s+'), ''),
      cents,
    ]);
  }

  Future<T> _withStorageLock<T>(Future<T> Function() operation) async {
    final preceding = _submissions[_storageKey];
    final completed = Completer<void>();
    _submissions[_storageKey] = completed.future;

    try {
      if (preceding != null) await preceding;
      return await operation();
    } finally {
      if (identical(_submissions[_storageKey], completed.future)) {
        _submissions.remove(_storageKey);
      }
      completed.complete();
    }
  }

  Future<String> keyForSubmission({
    required String network,
    required String phone,
    required String amount,
    bool newPurchase = false,
  }) =>
      _withStorageLock<String>(() async {
        final fingerprint = _fingerprint(
          network: network,
          phone: phone,
          amount: amount,
        );
        final saved = await _storage.read(_storageKey);
        if (saved != null && newPurchase) {
          throw StateError(
              'A previous request needs a separate-purchase acknowledgement.');
        }
        if (saved != null) {
          try {
            final existing = jsonDecode(saved);
            if (existing is! Map ||
                existing['fingerprint'] is! String ||
                existing['key'] is! String ||
                (existing['key'] as String).isEmpty) {
              throw const FormatException('Invalid pending airtime request.');
            }
            if (existing['fingerprint'] != fingerprint) {
              throw StateError(
                'A previous airtime purchase may still be processing. '
                'Confirm its final status before starting a different '
                'purchase.',
              );
            }
            return existing['key'] as String;
          } on FormatException {
            throw StateError(
              'An earlier airtime purchase could not be verified. Confirm its '
              'status before starting another purchase.',
            );
          }
        }

        final random = Random.secure();
        final key = 'airtime-${base64UrlEncode(
          List<int>.generate(24, (_) => random.nextInt(256)),
        ).replaceAll('=', '')}';
        // A successful durable write is required before the network is called.
        await _storage.write(
          _storageKey,
          jsonEncode({'fingerprint': fingerprint, 'key': key}),
        );
        return key;
      });

  Future<String?> pendingKey() => _withStorageLock<String?>(() async {
        final saved = await _storage.read(_storageKey);
        if (saved == null) return null;

        try {
          final existing = jsonDecode(saved);
          if (existing is! Map ||
              existing['fingerprint'] is! String ||
              existing['key'] is! String ||
              (existing['key'] as String).isEmpty) {
            throw const FormatException('Invalid pending airtime request.');
          }
          return existing['key'] as String;
        } on FormatException {
          throw StateError(
            'An earlier airtime purchase could not be verified. Confirm its '
            'status before starting another purchase.',
          );
        }
      });

  Future<Map<String, dynamic>> submit({
    required String network,
    required String phone,
    required String amount,
    bool newPurchase = false,
    required Future<Map<String, dynamic>> Function(String idempotencyKey)
        dispatch,
  }) async {
    final key = await keyForSubmission(
      newPurchase: newPurchase,
      network: network,
      phone: phone,
      amount: amount,
    );
    final result = await dispatch(key);
    if (isTerminalResult(result)) await finish(key);
    return result;
  }

  Future<List<Map<String, dynamic>>> _readRetained() async {
    final raw = await _storage.read(_archiveKey);
    if (raw == null) return [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) throw const FormatException();
      return decoded.map((item) {
        if (item is! Map ||
            item['key'] is! String ||
            (item['key'] as String).isEmpty ||
            item['fingerprint'] is! String) {
          throw const FormatException();
        }
        return Map<String, dynamic>.from(item);
      }).toList();
    } on FormatException {
      throw StateError('Earlier request storage could not be verified.');
    }
  }

  Future<List<String>> retainedKeys() => _withStorageLock(() async {
        final retained = await _readRetained();
        final active = await _storage.read(_storageKey);
        if (active != null) {
          final item = jsonDecode(active);
          if (item is! Map ||
              item['key'] is! String ||
              (item['key'] as String).isEmpty ||
              item['fingerprint'] is! String) {
            throw StateError('The current request could not be verified.');
          }
          retained.add(Map<String, dynamic>.from(item));
        }
        return retained.map((item) => item['key'] as String).toSet().toList();
      });

  /// Explicit user action only: retain the old request durably before freeing
  /// the active slot. Its key is for queries, never a new provider dispatch.
  Future<void> retainForSeparatePurchase() => _withStorageLock(() async {
        final active = await _storage.read(_storageKey);
        if (active == null) return;
        final item = jsonDecode(active);
        if (item is! Map ||
            item['key'] is! String ||
            (item['key'] as String).isEmpty ||
            item['fingerprint'] is! String) {
          throw StateError('The current request could not be safely retained.');
        }
        final retained = await _readRetained();
        if (!retained.any((entry) => entry['key'] == item['key'])) {
          // An arbitrary archive count must not lock independent purchases.
          // Keep the durable write/read-back guard before freeing this key.
          retained.add(Map<String, dynamic>.from(item));
        }
        final encoded = jsonEncode(retained);
        await _storage.write(_archiveKey, encoded);
        if (await _storage.read(_archiveKey) != encoded) {
          throw StateError('Earlier request could not be durably retained.');
        }
        await _storage.delete(_storageKey);
      });

  bool isTerminalResult(Map<String, dynamic> result) {
    final deliveryStatus = result['status']?.toString().toUpperCase();
    if ((result['deliveryStatus'] == 'SUCCEEDED' ||
            (result['provider'] == 'TELECOM_ABODE' &&
                result['dispatchStatus'] == 'SUCCEEDED')) &&
        ['SUCCESS', 'SUCCESSFUL', 'COMPLETED'].contains(deliveryStatus)) {
      return true;
    }
    final httpStatus =
        result['httpStatus'] is int ? result['httpStatus'] as int : 0;
    final status = result['status']?.toString().toUpperCase() ?? '';
    const unresolvedStatuses = <String>{
      'PENDING',
      'PROCESSING',
      'IN_PROGRESS',
      'QUEUED',
      'UNKNOWN',
      'TIMEOUT',
      'NETWORK_ERROR',
      'ERROR',
    };

    if (httpStatus < 200 ||
        httpStatus >= 300 ||
        unresolvedStatuses.contains(status)) {
      return false;
    }

    final reference = result['reference']?.toString() ?? '';
    if (reference.trim().isEmpty) return false;

    const successStatuses = <String>{'SUCCESS', 'SUCCESSFUL', 'COMPLETED'};
    if (successStatuses.contains(status) &&
        result['accountingStatus']?.toString().trim().toUpperCase() !=
            'COMPLETE') {
      return false;
    }

    return successStatuses.contains(status) ||
        status == 'FAILED' ||
        status == 'REFUNDED' ||
        status == 'REVERSED';
  }

  bool isDeliveredAccountingPending(Map<String, dynamic> result) {
    if (result['deliveryStatus'] == 'SUCCEEDED') return false;
    final httpStatus =
        result['httpStatus'] is int ? result['httpStatus'] as int : 0;
    final status = result['status']?.toString().toUpperCase() ?? '';
    const successStatuses = <String>{'SUCCESS', 'SUCCESSFUL', 'COMPLETED'};
    final reference = result['reference']?.toString() ?? '';

    return httpStatus >= 200 &&
        httpStatus < 300 &&
        successStatuses.contains(status) &&
        reference.trim().isNotEmpty &&
        result['accountingStatus']?.toString().trim().toUpperCase() !=
            'COMPLETE';
  }

  Future<void> finish(String key) => _withStorageLock<void>(() async {
        final saved = await _storage.read(_storageKey);
        if (saved != null) {
          final dynamic existing = jsonDecode(saved);
          if (existing is Map && existing['key'] == key) {
            await _storage.delete(_storageKey);
          }
        }
        final retained = await _readRetained();
        final remaining = retained.where((item) => item['key'] != key).toList();
        if (remaining.length != retained.length) {
          await _storage.write(_archiveKey, jsonEncode(remaining));
        }
      });
}
