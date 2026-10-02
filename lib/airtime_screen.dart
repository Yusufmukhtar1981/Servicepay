import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'services/api_service.dart';
import 'widgets/saved_beneficiaries.dart';

class AirtimeScreen extends StatefulWidget {
  const AirtimeScreen({
    super.key,
    this.purchaseIntent,
  });

  final AirtimePurchaseIntent? purchaseIntent;

  @override
  State<AirtimeScreen> createState() => _AirtimeScreenState();
}

class _AirtimeScreenState extends State<AirtimeScreen> {
  final TextEditingController phoneController = TextEditingController();

  final TextEditingController amountController = TextEditingController();

  List<String> networks = [];
  final Map<String, int> providerNetworkIds = {};
  bool _catalogLoading = true;
  String? _catalogError;

  String selectedNetwork = 'MTN';
  bool isLoading = false;
  bool _isCheckingStatus = false;
  String? _pendingIdempotencyKey;
  List<String> _retainedRequestKeys = [];
  String? _pendingIntentError;
  String? _pendingMessage;
  late final AirtimePurchaseIntent _purchaseIntent;

  @override
  void initState() {
    super.initState();
    _purchaseIntent = widget.purchaseIntent ?? AirtimePurchaseIntent();
    _restorePendingIntent();
    _loadNetworks();
  }

  Future<void> _loadNetworks() async {
    try {
      final response = await ApiService.getAirtimeNetworks();
      if (response['success'] != true || response['data'] is! List) {
        throw Exception('Airtime networks could not be verified.');
      }
      final mapped = <String, int>{};
      const labels = {'MTN': 'MTN', 'AIRTEL': 'Airtel', 'GLO': 'Glo',
        '9MOBILE': '9mobile', 'ETISALAT': '9mobile'};
      for (final row in response['data'] as List) {
        final label = labels[row['displayName'].toString().toUpperCase()];
        final id = int.tryParse(row['providerId'].toString());
        if (label != null && id != null && id > 0) mapped[label] = id;
      }
      if (mapped.isEmpty) throw Exception('Airtime networks could not be verified.');
      if (!mounted) return;
      setState(() {
        providerNetworkIds.addAll(mapped);
        networks = mapped.keys.toList();
        if (!networks.contains(selectedNetwork)) selectedNetwork = networks.first;
        _catalogLoading = false;
        _catalogError = null;
      });
    } catch (_) {
      if (mounted) setState(() {
        _catalogLoading = false;
        _catalogError = 'Airtime networks are unavailable. Retry loading; no purchase has been made.';
      });
    }
  }

  @override
  void dispose() {
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
    if (isLoading || _isCheckingStatus) return;

    String phone = phoneController.text.trim();

    final String amountText = amountController.text.trim();

    final int? amountCents = AirtimePurchaseIntent.amountInCents(amountText);

    if (phone.isEmpty || amountText.isEmpty) {
      showMessage(
        'Please enter the phone number and amount.',
      );
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
    setState(() {
      isLoading = true;
    });

    try {
      final providerId = providerNetworkIds[network];
      if (providerId == null) {
        showMessage('Load the current Airtime networks before buying.');
        return;
      }
      final quoted = await ApiService.quoteAirtime(networkId: providerId, amount: purchaseAmount, phone: phone);
      final quote = quoted['data'] as Map?;
      final sellingPrice = double.tryParse(quote?['customerSellingPrice'].toString() ?? '');
      final normalizedPhone = quote?['normalizedPhone']?.toString();
      if (quoted['success'] != true || sellingPrice == null || sellingPrice <= 0 ||
          normalizedPhone == null || normalizedPhone.isEmpty) {
        showMessage(quoted['message']?.toString() ??
          'The phone number or selling price could not be confirmed. No purchase was made.');
        return;
      }
      phone = normalizedPhone;
      final bool? confirmed = await showDialog<bool>(
        context: context,
        builder: (BuildContext dialogContext) {
          return AlertDialog(
            title: const Text(
              'Confirm airtime purchase',
            ),
            content: Text(
              'Purchase ₦${amount.toStringAsFixed(0)} '
              '$network airtime for $phone?\nWallet charge: ₦${sellingPrice.toStringAsFixed(2)}',
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
      final String? enteredPin = await showDialog<String>(
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
                  Navigator.of(dialogContext).pop(
                    transactionPinController.text.trim(),
                  );
                },
                child: const Text('Confirm'),
              ),
            ],
          );
        },
      );
      transactionPinController.dispose();
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

      final Map<String, dynamic> result = await _purchaseIntent.submit(
        network: network,
        phone: phone,
        amount: purchaseAmount,
        dispatch: (String idempotencyKey) => ApiService.buyAirtime(
          transactionPin: transactionPin,
          network: network,
          providerNetworkId: providerId,
          customerSellingPrice: sellingPrice,
          phone: phone,
          amount: purchaseAmount,
          idempotencyKey: idempotencyKey,
        ),
      );

      if (!mounted) return;
      await _restorePendingIntent();
      if (!mounted) return;

      final String responseStatus =
          result['status']?.toString().toUpperCase() ?? '';
      final bool purchaseTerminal = _purchaseIntent.isTerminalResult(result);
      final bool terminalRefund = responseStatus == 'REFUNDED' ||
          responseStatus == 'REVERSED' ||
          (responseStatus == 'FAILED' &&
              result['dispatchStatus'] == 'REFUNDED');
      final bool unresolved = !purchaseTerminal;
      const successfulStatuses = <String>{
        'SUCCESS',
        'SUCCESSFUL',
        'COMPLETED',
      };
      final bool purchaseSucceeded =
          purchaseTerminal && successfulStatuses.contains(responseStatus);

      final String message = result['message']?.toString() ??
          result['response_description']?.toString() ??
          result['description']?.toString() ??
          result['error']?.toString() ??
          (purchaseSucceeded
              ? 'Airtime purchase was successful.'
              : 'Airtime purchase failed.');

      if (unresolved) {
        final String pendingMessage =
            _purchaseIntent.isDeliveredAccountingPending(result)
                ? 'Airtime delivered, but confirmation is pending. The request '
                    'key is retained; use Check previous request to retrieve '
                    'the final status and charge amount.'
                : 'Your airtime request has not been confirmed. Its request '
                    'key has been retained; please check its status before '
                    'trying again.';
        setState(() {
          _pendingMessage = pendingMessage;
        });
        showMessage(pendingMessage);
      } else if (purchaseSucceeded) {
        showMessage(message);
        await SavedBeneficiaries.offerSave(
          context: context,
          phone: phone,
          network: network,
          serviceType: 'AIRTIME',
        );
        if (!mounted) return;

        phoneController.clear();
        amountController.clear();
      } else {
        final String? reference = result['reference']?.toString();

        String finalMessage = message;

        if (terminalRefund) {
          finalMessage = '$message Your wallet has been refunded.';
        }

        if (reference != null && reference.isNotEmpty) {
          finalMessage = '$finalMessage Reference: $reference';
        }

        showMessage(finalMessage);
      }
    } catch (error) {
      final String message = error is TimeoutException
          ? 'The airtime request timed out. Its request key has been retained; '
              'please check its status before trying again.'
          : error.toString().replaceFirst('Exception: ', '');
      await _restorePendingIntent();
      showMessage(message);
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<void> _restorePendingIntent() async {
    try {
      final String? key = await _purchaseIntent.pendingKey();
      final retained = await _purchaseIntent.retainedKeys();
      if (!mounted) return;
      setState(() {
        _pendingIdempotencyKey = key;
        _retainedRequestKeys = retained;
        _pendingIntentError = null;
        _pendingMessage = key == null
            ? null
            : 'A previous airtime request is still awaiting a final status. '
                'Check its status, or explicitly start a separate purchase. '
                'The earlier request will not be resent.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _pendingIdempotencyKey = null;
        _pendingIntentError = error.toString().replaceFirst('Exception: ', '');
        _pendingMessage = 'A previous airtime request could not be verified. '
            'Do not start another purchase until its status is confirmed.';
      });
    }
  }

  Future<void> startSeparatePurchase() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Start a separate purchase?'),
        content: const Text('The earlier request is still unresolved. It will '
            'remain available for status checks and will not be resent or '
            'refunded automatically. A separate purchase uses a new request '
            'key and may charge your wallet separately.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true),
              child: const Text('Start separate purchase')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _purchaseIntent.retainForSeparatePurchase();
      await _restorePendingIntent();
      showMessage('Earlier request retained for status checks. '
          'You can now enter a separate purchase.');
    } catch (error) {
      showMessage('The earlier request could not be safely retained. '
          'No new purchase was started. $error');
    }
  }

  Future<void> checkPreviousRequest({String? requestKey}) async {
    if (isLoading || _isCheckingStatus) return;

    String? key = requestKey ?? _pendingIdempotencyKey;
    if (key == null) {
      await _restorePendingIntent();
      key = _pendingIdempotencyKey;
    }
    if (!mounted) return;
    if (key == null) {
      showMessage(
        'There is no verifiable previous airtime request to check.',
      );
      return;
    }

    setState(() {
      _isCheckingStatus = true;
      _pendingMessage = 'Checking the status of your previous request...';
    });

    try {
      final Map<String, dynamic> result =
          await ApiService.requeryAirtime(idempotencyKey: key);
      final bool terminal = _purchaseIntent.isTerminalResult(result);
      if (terminal) await _purchaseIntent.finish(key);
      if (!mounted) return;

      if (terminal) {
        await _restorePendingIntent();
        if (!mounted) return;
        final String status =
            result['status']?.toString().toUpperCase() ?? 'CONFIRMED';
        final String message = result['message']?.toString() ??
            result['response_description']?.toString() ??
            result['description']?.toString() ??
            'The previous airtime request is $status.';
        final String? amountCharged = result['amountCharged']?.toString();
        final String? reference = result['reference']?.toString();
        showMessage(
          <String>[
            message,
            if (amountCharged != null && amountCharged.trim().isNotEmpty)
              'Amount charged: ₦$amountCharged',
            if (reference != null && reference.trim().isNotEmpty)
              'Reference: $reference',
          ].join(' '),
        );
      } else {
        setState(() {
          _pendingIntentError = null;
          _pendingMessage = _purchaseIntent.isDeliveredAccountingPending(result)
              ? 'Airtime delivered, but confirmation is pending. The '
                  'request key is retained; check again to retrieve the '
                  'final status and charge amount.'
              : 'The previous airtime request is not confirmed yet. Its '
                  'request key has been retained; check again later.';
        });
      }
    } catch (error) {
      if (!mounted) return;
      final String message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _pendingMessage = 'Status could not be confirmed. The request key '
            'has been retained. $message';
      });
      showMessage(message);
    } finally {
      if (mounted) {
        setState(() {
          _isCheckingStatus = false;
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
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: 600,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_retainedRequestKeys.isNotEmpty ||
                    _pendingIntentError != null) ...[
                  Card(
                    color: Colors.orange.shade50,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _pendingMessage ??
                                'A previous airtime request needs a status '
                                    'check.',
                          ),
                          const SizedBox(height: 8),
                          if (_pendingIdempotencyKey != null) OutlinedButton.icon(
                            onPressed: _pendingIdempotencyKey == null ||
                                    _isCheckingStatus
                                ? null
                                : checkPreviousRequest,
                            icon: _isCheckingStatus
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.refresh),
                            label: Text(
                              _isCheckingStatus
                                  ? 'Checking status...'
                                  : 'Check previous request',
                            ),
                          ),
                          for (final key in _retainedRequestKeys.where(
                              (key) => key != _pendingIdempotencyKey))
                            TextButton.icon(
                              onPressed: isLoading || _isCheckingStatus
                                  ? null : () => checkPreviousRequest(requestKey: key),
                              icon: const Icon(Icons.refresh),
                              label: Text('Check earlier request '
                                  '${_retainedRequestKeys.indexOf(key) + 1}'),
                            ),
                          if (_pendingIdempotencyKey != null &&
                              _pendingIntentError == null)
                            TextButton(
                              onPressed: isLoading || _isCheckingStatus
                                  ? null : startSeparatePurchase,
                              child: const Text('Start a separate purchase'),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
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
                  onChanged: isLoading || _isCheckingStatus
                      ? null
                      : (String? value) {
                          if (value == null) return;

                          setState(() {
                            selectedNetwork = value;
                          });
                        },
                ),
                const SizedBox(height: 22),
                if (_catalogLoading) const LinearProgressIndicator(),
                if (_catalogError != null) ...[
                  Text(_catalogError!, style: const TextStyle(color: Colors.red)),
                  TextButton(onPressed: () {
                    setState(() { _catalogLoading = true; _catalogError = null; });
                    _loadNetworks();
                  }, child: const Text('Retry loading networks')),
                ],
                const Text(
                  'Phone Number',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: phoneController,
                  enabled: !isLoading && !_isCheckingStatus,
                  keyboardType: TextInputType.phone,
                  maxLength: 24,
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
                  enabled: !isLoading && !_isCheckingStatus,
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
                        isLoading || _isCheckingStatus || _catalogLoading ||
                        _catalogError != null || _pendingIdempotencyKey != null ||
                        _pendingIntentError != null ? null : buyAirtime,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: isLoading || _isCheckingStatus
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
  }) =>
      _withStorageLock<String>(() async {
        final fingerprint = _fingerprint(
          network: network,
          phone: phone,
          amount: amount,
        );
        final saved = await _storage.read(_storageKey);
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
    required Future<Map<String, dynamic>> Function(String idempotencyKey)
        dispatch,
  }) async {
    final key = await keyForSubmission(
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
        if (item is! Map || item['key'] is! String ||
            (item['key'] as String).isEmpty || item['fingerprint'] is! String) {
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
      if (item is! Map || item['key'] is! String ||
          (item['key'] as String).isEmpty || item['fingerprint'] is! String) {
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
    if (item is! Map || item['key'] is! String ||
        (item['key'] as String).isEmpty || item['fingerprint'] is! String) {
      throw StateError('The current request could not be safely retained.');
    }
    final retained = await _readRetained();
    if (!retained.any((entry) => entry['key'] == item['key'])) {
      if (retained.length >= 100) {
        throw StateError('Resolve an earlier request before retaining more.');
      }
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
    if (result['provider'] == 'TELECOM_ABODE' && result['dispatchStatus'] == 'SUCCEEDED' &&
        ['SUCCESS', 'SUCCESSFUL', 'COMPLETED'].contains(deliveryStatus)) return true;
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
