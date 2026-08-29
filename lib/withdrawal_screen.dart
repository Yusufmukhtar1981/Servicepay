import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'reset_transaction_pin_screen.dart';
import 'transaction_pin_screen.dart';

class WithdrawalScreen extends StatefulWidget {
  const WithdrawalScreen({
    super.key,
    this.client,
  });

  final http.Client? client;

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
  String? pendingRequestKey;
  String? pendingFingerprint;
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
    final prefs = await SharedPreferences.getInstance();

    for (final key in [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final value = prefs.getString(key)?.trim();

      if (value != null && value.isNotEmpty) {
        return value.replaceFirst(
          'Bearer ',
          '',
        );
      }
    }

    return null;
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

    final pin = await showWithdrawalPinDialog(
      bank: bank,
      accountNumber: accountNumber,
      amount: amount,
    );

    if (!mounted) return;
    setState(() {
      isAwaitingPin = false;
    });

    if (pin == null) return;

    final fingerprint =
        '$bank|$accountNumber|$accountName|${amount.toStringAsFixed(2)}';
    if (pendingRequestKey == null || pendingFingerprint != fingerprint) {
      pendingRequestKey =
          'withdrawal-${DateTime.now().microsecondsSinceEpoch}-${fingerprint.hashCode.abs()}';
      pendingFingerprint = fingerprint;
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      final token = await getToken();
      if (token == null) {
        throw StateError('Your login session was not found.');
      }

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
              'transactionPin': pin,
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
        pendingRequestKey = null;
        pendingFingerprint = null;

        showMessage(
          data['message']?.toString() ??
              'Withdrawal request submitted for approval.',
        );

        await loadWithdrawals();
      } else {
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
    return Scaffold(
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
                                builder: (_) =>
                                    ResetTransactionPinScreen(client: _client),
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
    );
  }
}
