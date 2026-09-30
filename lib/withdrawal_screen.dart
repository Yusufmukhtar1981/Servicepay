import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'reset_transaction_pin_screen.dart';
import 'transaction_pin_screen.dart';
import 'services/customer_feature_config_service.dart';
import 'services/session_store.dart';
import 'services/biometric_auth_service.dart';
import 'services/transaction_authorization_service.dart';

class WithdrawalScreen extends StatefulWidget {
  const WithdrawalScreen({
    super.key,
    this.client,
    this.pendingIntentWriter,
  });

  final http.Client? client;
  final Future<bool> Function(String key, String value)? pendingIntentWriter;

  @override
  State<WithdrawalScreen> createState() => _WithdrawalScreenState();
}

class _WithdrawalScreenState extends State<WithdrawalScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final bankController = TextEditingController();
  final accountNumberController = TextEditingController();
  final accountNameController = TextEditingController();
  final amountController = TextEditingController();

  bool isSubmitting = false;
  bool isAwaitingPin = false;
  bool isLoadingHistory = true;
  bool? hasTransactionPin;
  double minimumWithdrawal = 100;
  double maximumWithdrawal = 50000;
  double? availableBalance;
  String? pendingRequestKey;
  String? pendingFingerprint;
  String? pendingCustomerId;
  bool pendingRequestAcknowledged = false;
  String? pendingWithdrawalReference;
  String? pendingWithdrawalStatus;
  static const String _pendingWithdrawalStoragePrefix =
      'customer_withdrawal_pending_intent_v1_';
  final Random _secureRandom = Random.secure();
  late final http.Client _client;
  late final bool _ownsClient;

  List<Map<String, dynamic>> withdrawals = [];

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
    loadSavedBankAccount();
    loadWithdrawalLimits();
    loadWithdrawals();
    loadTransactionPinStatus();
  }

  @override
  void dispose() {
    bankController.dispose();
    accountNumberController.dispose();
    accountNameController.dispose();
    amountController.dispose();
    if (_ownsClient) {
      _client.close();
    }
    super.dispose();
  }

  Future<String?> getToken() async {
    final value = (await SessionStore.readToken())?.trim();
    if (value == null || value.isEmpty) return null;
    return value.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '');
  }

  Future<String> _loadAuthenticatedCustomerId(String token) async {
    availableBalance = null;
    final response = await _client.get(
      Uri.parse('$baseUrl/auth/profile'),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    ).timeout(const Duration(seconds: 20));
    final decoded = jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Unable to verify your signed-in customer account.');
    }
    final result = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    dynamic profile = result['user'] ?? result['profile'] ?? result['data'];
    if (profile is Map &&
        (profile['user'] is Map || profile['profile'] is Map)) {
      profile = profile['user'] ?? profile['profile'];
    }
    if (profile is! Map) profile = result;
    final customerId =
        (profile['id'] ?? profile['_id'] ?? profile['customerId'])
            ?.toString()
            .trim();
    if (customerId == null || customerId.isEmpty) {
      throw StateError('Unable to verify your signed-in customer account.');
    }
    final walletBalance = _asDouble(profile['walletBalance']);
    final walletHeldBalance = _asDouble(profile['walletHeldBalance']) ?? 0;
    availableBalance = walletBalance == null
        ? null
        : (walletBalance - walletHeldBalance)
            .clamp(0, double.infinity)
            .toDouble();
    return customerId;
  }

  double? _asDouble(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '');
  }

  String _pendingStorageKey(String customerId) =>
      '$_pendingWithdrawalStoragePrefix$customerId';

  Future<void> _restorePendingIntent(String customerId) async {
    final prefs = await SharedPreferences.getInstance();
    final savedIntent = prefs.getString(_pendingStorageKey(customerId));
    pendingRequestKey = null;
    pendingFingerprint = null;
    pendingCustomerId = null;
    pendingRequestAcknowledged = false;
    pendingWithdrawalReference = null;
    pendingWithdrawalStatus = null;
    if (savedIntent == null) return;

    try {
      final saved = jsonDecode(savedIntent);
      if (saved is! Map ||
          saved['customerId']?.toString() != customerId ||
          saved['requestKey'] is! String ||
          saved['intentHash'] is! String) {
        await prefs.remove(_pendingStorageKey(customerId));
        return;
      }
      pendingRequestKey = saved['requestKey'] as String;
      pendingFingerprint = saved['intentHash'] as String;
      pendingCustomerId = customerId;
      pendingRequestAcknowledged = saved['acknowledged'] == true;
      pendingWithdrawalReference = saved['reference']?.toString();
      pendingWithdrawalStatus = saved['status']?.toString();
    } on FormatException {
      await prefs.remove(_pendingStorageKey(customerId));
    }
  }

  String _fingerprint(
    String bank,
    String accountNumber,
    String accountName,
    double amount,
  ) {
    final normalizedIntent = jsonEncode(<String>[
      bank.trim(),
      accountNumber.trim(),
      accountName.trim(),
      amount.toStringAsFixed(2),
    ]);
    return sha256.convert(utf8.encode(normalizedIntent)).toString();
  }

  String _createIdempotencyKey() {
    final bytes = List<int>.generate(24, (_) => _secureRandom.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  Future<bool> _persistPendingIntent(
    SharedPreferences prefs,
    String key,
    String value,
  ) async {
    final writer = widget.pendingIntentWriter;
    return writer == null ? prefs.setString(key, value) : writer(key, value);
  }

  Future<bool> _savePendingIntent({
    required String customerId,
    required String requestKey,
    required String intentHash,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    return _persistPendingIntent(
      prefs,
      _pendingStorageKey(customerId),
      jsonEncode(<String, String>{
        'customerId': customerId,
        'requestKey': requestKey,
        'intentHash': intentHash,
      }),
    );
  }

  Future<bool> _markPendingAcknowledged(
    String customerId,
    Map<String, dynamic> withdrawal,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    final storageKey = _pendingStorageKey(customerId);
    final savedIntent = prefs.getString(storageKey);
    if (savedIntent == null) return false;

    final decoded = jsonDecode(savedIntent);
    if (decoded is! Map) return false;
    final saved = Map<String, dynamic>.from(decoded);
    saved['acknowledged'] = true;
    saved['reference'] = withdrawal['reference']?.toString() ??
        withdrawal['_id']?.toString() ??
        '';
    saved['status'] = withdrawal['status']?.toString() ?? 'PENDING';
    if (!await _persistPendingIntent(prefs, storageKey, jsonEncode(saved))) {
      return false;
    }
    pendingCustomerId = customerId;
    pendingRequestAcknowledged = true;
    pendingWithdrawalReference = saved['reference'] as String;
    pendingWithdrawalStatus = saved['status'] as String;
    return true;
  }

  Future<void> _clearPendingIntent(String customerId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pendingStorageKey(customerId));
    pendingRequestKey = null;
    pendingFingerprint = null;
    pendingCustomerId = null;
    pendingRequestAcknowledged = false;
    pendingWithdrawalReference = null;
    pendingWithdrawalStatus = null;
  }

  Future<void> _startNewWithdrawal() async {
    final customerId = pendingCustomerId;
    if (customerId == null) return;
    await _clearPendingIntent(customerId);
    if (!mounted) return;
    amountController.clear();
    setState(() {});
  }

  Future<void> loadTransactionPinStatus() async {
    try {
      final token = await getToken();
      if (token == null) {
        return;
      }
      final response = await _client.get(
        Uri.parse('$baseUrl/transaction-pin/status'),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token'
        },
      ).timeout(const Duration(seconds: 15));
      final decoded = jsonDecode(response.body);
      final data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
      if (!mounted ||
          response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        return;
      }
      setState(() {
        hasTransactionPin = data['transactionPinSet'] == true ||
            data['hasTransactionPin'] == true ||
            (data['data'] is Map &&
                ((data['data'] as Map)['transactionPinSet'] == true ||
                    (data['data'] as Map)['hasTransactionPin'] == true));
      });
    } catch (_) {
      // The submission endpoint remains authoritative when status is unavailable.
    }
  }

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  Future<void> loadSavedBankAccount() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;

    setState(() {
      bankController.text = prefs.getString('withdrawal_bank_name') ?? '';
      accountNumberController.text =
          prefs.getString('withdrawal_account_number') ?? '';
      accountNameController.text =
          prefs.getString('withdrawal_account_name') ?? '';
    });
  }

  Future<void> saveBankAccount() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'withdrawal_bank_name',
      bankController.text.trim(),
    );
    await prefs.setString(
      'withdrawal_account_number',
      accountNumberController.text.trim(),
    );
    await prefs.setString(
      'withdrawal_account_name',
      accountNameController.text.trim(),
    );
  }

  Future<void> loadWithdrawalLimits() async {
    try {
      final response = await _client.get(
        Uri.parse('$baseUrl/settings/public'),
        headers: const {'Accept': 'application/json'},
      ).timeout(const Duration(seconds: 15));
      final decoded = jsonDecode(response.body);
      final data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
      final settings = data['settings'] is Map
          ? Map<String, dynamic>.from(data['settings'] as Map)
          : <String, dynamic>{};
      final limits = settings['transactionLimits'] is Map
          ? Map<String, dynamic>.from(settings['transactionLimits'] as Map)
          : <String, dynamic>{};
      final minimum = (limits['minimumBankTransfer'] as num?)?.toDouble();
      final maximum = (limits['maximumBankTransfer'] as num?)?.toDouble();

      if (!mounted) return;
      setState(() {
        if (minimum != null && minimum >= 100) {
          minimumWithdrawal = minimum;
        }
        if (maximum != null && maximum >= minimumWithdrawal) {
          maximumWithdrawal = maximum;
        }
      });
    } catch (_) {
      // Defaults match the backend settings defaults.
    }
  }

  Future<String?> showWithdrawalPinDialog({
    required String bank,
    required String accountNumber,
    required double amount,
  }) {
    var pin = '';

    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Confirm Withdrawal'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Request withdrawal of ₦${amount.toStringAsFixed(0)} '
              'to $bank • $accountNumber.',
            ),
            const SizedBox(height: 16),
            TextField(
              autofocus: true,
              obscureText: true,
              maxLength: 4,
              keyboardType: TextInputType.number,
              onChanged: (value) {
                pin = value.replaceAll(RegExp(r'\D'), '');
              },
              decoration: const InputDecoration(
                labelText: 'Transaction PIN',
                border: OutlineInputBorder(),
                counterText: '',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
                ScaffoldMessenger.of(dialogContext).showSnackBar(
                  const SnackBar(
                    content: Text('Enter your 4-digit transaction PIN.'),
                  ),
                );
                return;
              }
              Navigator.pop(dialogContext, pin);
            },
            child: const Text('Continue'),
          ),
        ],
      ),
    );
  }

  Future<void> loadWithdrawals() async {
    setState(() {
      isLoadingHistory = true;
    });

    try {
      final token = await getToken();

      if (token == null) {
        throw StateError('Login session not found.');
      }

      final customerId = await _loadAuthenticatedCustomerId(token);
      await _restorePendingIntent(customerId);

      final response = await _client.get(
        Uri.parse(
          '$baseUrl/withdrawals/my',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      ).timeout(const Duration(seconds: 20));

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      final raw = data['withdrawals'];

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw StateError(
          data['message']?.toString() ?? 'Unable to load withdrawals.',
        );
      }

      withdrawals = raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => Map<String, dynamic>.from(
                  item,
                ),
              )
              .toList()
          : [];
      final requestKey = pendingRequestKey;
      if (requestKey != null) {
        for (final withdrawal in withdrawals) {
          if (withdrawal['idempotencyKey']?.toString() != requestKey) {
            continue;
          }
          final acknowledged =
              await _markPendingAcknowledged(customerId, withdrawal);
          showMessage(
            acknowledged
                ? 'Your withdrawal was found in history. Use New Withdrawal '
                    'before making another request.'
                : 'Your withdrawal was found in history, but its confirmation '
                    'could not be saved. Retry only with the original details.',
          );
          break;
        }
      }
    } catch (_) {
      showMessage(
        'Unable to load withdrawals.',
      );
    }

    if (!mounted) return;

    setState(() {
      isLoadingHistory = false;
    });
  }

  Future<void> submitWithdrawal() async {
    if (isSubmitting || isAwaitingPin) return;

    final bank = bankController.text.trim();
    final accountNumber = accountNumberController.text.trim();
    final accountName = accountNameController.text.trim();

    final amount = double.tryParse(
      amountController.text.replaceAll(',', '').trim(),
    );

    if (bank.isEmpty ||
        accountName.isEmpty ||
        accountNumber.length != 10 ||
        amount == null ||
        amount < minimumWithdrawal ||
        amount > maximumWithdrawal) {
      showMessage(
        'Enter valid details and an amount from '
        '₦${minimumWithdrawal.toStringAsFixed(0)} to '
        '₦${maximumWithdrawal.toStringAsFixed(0)}.',
      );
      return;
    }
    if (hasTransactionPin == false) {
      showMessage('Create a transaction PIN before requesting a withdrawal.');
      return;
    }

    setState(() {
      isAwaitingPin = true;
    });

    final token = await getToken();
    if (token == null) {
      if (mounted) setState(() => isAwaitingPin = false);
      showMessage('Your login session was not found.');
      return;
    }
    late final String customerId;
    try {
      customerId = await _loadAuthenticatedCustomerId(token);
    } catch (error) {
      showMessage(
        error is StateError
            ? error.message
            : 'Unable to verify your signed-in customer account.',
      );
      if (mounted) setState(() => isAwaitingPin = false);
      return;
    }
    await _restorePendingIntent(customerId);

    if (!mounted) return;
    if (pendingRequestAcknowledged) {
      showMessage(
        'This withdrawal is already listed in history. Use New Withdrawal '
        'before making another request.',
      );
      setState(() => isAwaitingPin = false);
      return;
    }
    final fingerprint = _fingerprint(
      bank,
      accountNumber,
      accountName,
      amount,
    );
    final isRetryIntent =
        pendingRequestKey != null && pendingFingerprint == fingerprint;
    if (pendingRequestKey != null && !isRetryIntent) {
      showMessage(
        'A previous withdrawal is still unresolved. Retry with its original '
        'details or refresh history before starting another request.',
      );
      setState(() => isAwaitingPin = false);
      return;
    }
    final spendableBalance = availableBalance;
    if (!isRetryIntent &&
        spendableBalance != null &&
        amount > spendableBalance) {
      showMessage(
        'Your available wallet balance is ₦${spendableBalance.toStringAsFixed(2)}.',
      );
      setState(() => isAwaitingPin = false);
      return;
    }

    final requestBody = <String, dynamic>{
      'bankName': bank,
      'accountNumber': accountNumber,
      'accountName': accountName,
      'amount': amount,
    };
    final needsNewKey = pendingRequestKey == null;
    final requestKey = pendingRequestKey ?? _createIdempotencyKey();
    try {
      final saved = await _savePendingIntent(
        customerId: customerId,
        requestKey: requestKey,
        intentHash: fingerprint,
      );
      if (!saved) {
        if (mounted) setState(() => isAwaitingPin = false);
        showMessage(
          'Unable to save a safe retry key. No withdrawal was submitted.',
        );
        return;
      }
    } catch (_) {
      if (mounted) setState(() => isAwaitingPin = false);
      showMessage(
        'Unable to save a safe retry key. No withdrawal was submitted.',
      );
      return;
    }
    pendingRequestKey = requestKey;
    pendingFingerprint = fingerprint;
    pendingCustomerId = customerId;
    final createdPendingKey = needsNewKey;
    Map<String, dynamic> authorization;
    if (TransactionAuthorizationService.transactionBiometricsEnabled) {
      String? grant;
      String? deviceId;
      try {
        grant = await TransactionAuthorizationService().authorizeTransaction(
          token: token,
          operation: TransactionAuthorizationService.withdrawal,
          requestBody: requestBody,
          idempotencyKey: pendingRequestKey!,
        );
        deviceId =
            grant == null ? null : await BiometricAuthService().deviceId();
      } catch (_) {
        grant = null;
      }
      if (grant != null && deviceId != null) {
        authorization = {'biometricGrant': grant, 'deviceId': deviceId};
      } else {
        setState(() => isAwaitingPin = true);
        final pin = await showWithdrawalPinDialog(
          bank: bank,
          accountNumber: accountNumber,
          amount: amount,
        );
        if (!mounted) return;
        setState(() => isAwaitingPin = false);
        if (pin == null) {
          if (createdPendingKey) await _clearPendingIntent(customerId);
          return;
        }
        authorization = {'transactionPin': pin};
      }
    } else {
      setState(() => isAwaitingPin = true);
      final pin = await showWithdrawalPinDialog(
        bank: bank,
        accountNumber: accountNumber,
        amount: amount,
      );
      if (!mounted) return;
      setState(() => isAwaitingPin = false);
      if (pin == null) {
        if (createdPendingKey) await _clearPendingIntent(customerId);
        return;
      }
      authorization = {'transactionPin': pin};
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      final response = await _client
          .post(
            Uri.parse(
              '$baseUrl/withdrawals/request',
            ),
            headers: {
              'Authorization': 'Bearer $token',
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Idempotency-Key': pendingRequestKey!,
            },
            body: jsonEncode({
              'bankName': bank,
              'accountNumber': accountNumber,
              'accountName': accountName,
              'amount': amount,
              ...authorization,
            }),
          )
          .timeout(const Duration(seconds: 30));

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true &&
          data['withdrawal'] is Map) {
        await saveBankAccount();
        amountController.clear();
        await _clearPendingIntent(customerId);

        showMessage(
          data['message']?.toString() ??
              'Withdrawal request submitted for approval.',
        );

        await loadWithdrawals();
      } else {
        if ((response.statusCode == 400 || response.statusCode == 422) &&
            data['success'] == false) {
          await _clearPendingIntent(customerId);
        }
        showMessage(
          data['message']?.toString() ??
              'The withdrawal request was not accepted.',
        );
      }
    } on TimeoutException {
      showMessage(
        'The request timed out. Your request key is saved; tap again to check '
        'or safely retry without a second debit.',
      );
    } on FormatException {
      showMessage(
        'The withdrawal service returned an invalid response. No success was confirmed.',
      );
    } catch (error) {
      showMessage(
        error is StateError
            ? error.message
            : 'Unable to submit withdrawal. Please retry safely.',
      );
    }

    if (!mounted) return;

    setState(() {
      isSubmitting = false;
    });
  }

  Color statusColor(String status) {
    switch (status) {
      case 'APPROVED':
        return Colors.green;
      case 'REJECTED':
        return Colors.red;
      default:
        return Colors.orange;
    }
  }

  @override
  Widget build(BuildContext context) {
    return CustomerFeatureGate(
      featureKey: 'WITHDRAWAL',
      client: widget.client,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Withdrawal'),
        ),
        body: RefreshIndicator(
          onRefresh: loadWithdrawals,
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: const Color(
                    0xFFEAF7F0,
                  ),
                  borderRadius: BorderRadius.circular(
                    18,
                  ),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.account_balance_wallet_rounded,
                      color: primaryGreen,
                      size: 32,
                    ),
                    SizedBox(height: 10),
                    Text(
                      'Request a Withdrawal',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 6),
                    Text(
                      'Your requested amount will be reserved while Head Office reviews and processes your bank payment.',
                      style: TextStyle(
                        color: Colors.black54,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
              if (pendingRequestKey != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: pendingRequestAcknowledged
                        ? const Color(0xFFEAF7F0)
                        : const Color(0xFFFFF4D6),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        pendingRequestAcknowledged
                            ? 'This withdrawal is already in history'
                                '${pendingWithdrawalReference == null || pendingWithdrawalReference!.isEmpty ? '' : ' (${pendingWithdrawalReference!})'}'
                                '${pendingWithdrawalStatus == null || pendingWithdrawalStatus!.isEmpty ? '' : ' — ${pendingWithdrawalStatus!}'}.'
                            : 'A previous withdrawal is unresolved. Retry only '
                                'with the same bank, account name, account '
                                'number, and amount. Refresh history to check '
                                'for a completed request.',
                        style: const TextStyle(height: 1.35),
                      ),
                      if (pendingRequestAcknowledged) ...[
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: _startNewWithdrawal,
                          child: const Text('New Withdrawal'),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 18),
              TextField(
                controller: bankController,
                decoration: const InputDecoration(
                  labelText: 'Bank Name',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: accountNumberController,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                maxLength: 10,
                decoration: const InputDecoration(
                  labelText: 'Account Number',
                  border: OutlineInputBorder(),
                  counterText: '',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: accountNameController,
                decoration: const InputDecoration(
                  labelText: 'Account Name',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: amountController,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Withdrawal Amount',
                  prefixText: '₦ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Allowed amount: ₦${minimumWithdrawal.toStringAsFixed(0)} – '
                '₦${maximumWithdrawal.toStringAsFixed(0)}. '
                'Your bank details are saved on this device after a confirmed request.',
                style: const TextStyle(
                  color: Colors.black54,
                  height: 1.35,
                ),
              ),
              if (availableBalance != null) ...[
                const SizedBox(height: 6),
                Text(
                  'Available to withdraw: ₦${availableBalance!.toStringAsFixed(2)}',
                  style: const TextStyle(
                    color: Colors.black54,
                    height: 1.35,
                  ),
                ),
              ],
              Wrap(
                spacing: 8,
                children: [
                  if (hasTransactionPin != true)
                    TextButton.icon(
                      onPressed: isSubmitting
                          ? null
                          : () {
                              Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) =>
                                      TransactionPinScreen(client: _client),
                                ),
                              );
                            },
                      icon: const Icon(Icons.pin_outlined),
                      label: const Text('Create PIN'),
                    ),
                  if (hasTransactionPin == true)
                    TextButton.icon(
                      onPressed: isSubmitting
                          ? null
                          : () {
                              Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) => ResetTransactionPinScreen(
                                      client: _client),
                                ),
                              );
                            },
                      icon: const Icon(Icons.lock_reset_rounded),
                      label: const Text('Reset PIN'),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed:
                    isSubmitting || isAwaitingPin ? null : submitWithdrawal,
                style: FilledButton.styleFrom(
                  backgroundColor: primaryGreen,
                  padding: const EdgeInsets.symmetric(
                    vertical: 16,
                  ),
                ),
                icon: isSubmitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(
                        Icons.arrow_circle_down_rounded,
                      ),
                label: Text(
                  isSubmitting
                      ? 'Submitting...'
                      : isAwaitingPin
                          ? 'Confirming PIN...'
                          : 'Request Withdrawal',
                ),
              ),
              const SizedBox(height: 26),
              const Text(
                'Withdrawal History',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 12),
              if (isLoadingHistory)
                const Center(
                  child: CircularProgressIndicator(),
                )
              else if (withdrawals.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(
                    vertical: 24,
                  ),
                  child: Center(
                    child: Text(
                      'No withdrawal requests yet.',
                    ),
                  ),
                )
              else
                ...withdrawals.map(
                  (item) {
                    final status =
                        item['status']?.toString().toUpperCase() ?? 'PENDING';
                    final createdAt =
                        DateTime.tryParse(item['createdAt']?.toString() ?? '');
                    final createdLabel = createdAt == null
                        ? ''
                        : '${createdAt.toLocal().day.toString().padLeft(2, '0')}/'
                            '${createdAt.toLocal().month.toString().padLeft(2, '0')}/'
                            '${createdAt.toLocal().year} '
                            '${createdAt.toLocal().hour.toString().padLeft(2, '0')}:'
                            '${createdAt.toLocal().minute.toString().padLeft(2, '0')}';
                    final note = item['adminNote']?.toString().trim() ?? '';

                    return Card(
                      margin: const EdgeInsets.only(
                        bottom: 10,
                      ),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: statusColor(
                            status,
                          ).withValues(
                            alpha: 0.12,
                          ),
                          child: Icon(
                            Icons.payments_rounded,
                            color: statusColor(
                              status,
                            ),
                          ),
                        ),
                        title: Text(
                          '₦${item['amount'] ?? 0}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        subtitle: Text(
                          '${item['bankName'] ?? '-'} • '
                          '${item['accountNumber'] ?? '-'}\n'
                          '${item['accountName'] ?? '-'}\n'
                          '${item['reference'] ?? ''}'
                          '${createdLabel.isEmpty ? '' : '\n$createdLabel'}'
                          '${note.isEmpty ? '' : '\nNote: $note'}',
                        ),
                        isThreeLine: true,
                        trailing: Text(
                          status,
                          style: TextStyle(
                            color: statusColor(
                              status,
                            ),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    );
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}
