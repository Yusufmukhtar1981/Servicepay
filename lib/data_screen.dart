import 'package:flutter/material.dart';

import 'services/api_service.dart';
import 'services/data_purchase_intent.dart';
import 'services/data_phone.dart';
import 'services/purchase_session_recovery.dart';
import 'receipt_screen.dart';
import 'widgets/saved_beneficiaries.dart';
import 'widgets/purchase_processing.dart';
import 'dart:convert';

class DataScreen extends StatefulWidget {
  const DataScreen(
      {super.key,
      this.purchaseIntent,
      this.loadPlans,
      this.purchase,
      this.statusQuery,
      this.retireRequest,
      this.loadBeneficiaries,
      this.saveBeneficiary});
  final BeneficiaryLoader? loadBeneficiaries;
  final BeneficiarySaver? saveBeneficiary;
  final DataPurchaseIntent? purchaseIntent;
  final Future<Map<String, dynamic>> Function(String network)? loadPlans;
  final Future<Map<String, dynamic>> Function(Map<String, dynamic> input)?
      purchase;
  final Future<Map<String, dynamic>> Function(String key)? statusQuery;
  final Future<Map<String, dynamic>> Function(String key)? retireRequest;

  @override
  State<DataScreen> createState() => _DataScreenState();
}

class _DataScreenState extends State<DataScreen> {
  static const Color primaryGreen = Color(0xFF08783E);

  static const Color softGreen = Color(0xFFEAF7F0);

  final TextEditingController phoneController = TextEditingController();
  final FocusNode _phoneFocus = FocusNode();

  final List<String> networks = const <String>[
    'MTN',
    'Airtel',
    'Glo',
    '9mobile',
  ];

  String selectedNetwork = 'MTN';
  String selectedCategory = 'All';

  List<Map<String, dynamic>> dataPlans = <Map<String, dynamic>>[];

  bool isLoadingPlans = true;
  int _catalogGeneration = 0;
  bool isBuyingData = false;
  late final DataPurchaseIntent _purchaseIntent;
  PurchasePhase _phase = PurchasePhase.idle;
  String? _pendingKey;
  String _pendingMessage = '';
  bool _restoring = true;
  bool _canStartSeparate = false;
  bool _canRetireUnrecorded = false;
  bool _authenticationRequired = false;
  List<Map<String, dynamic>> _retainedRequests = [];

  String plansError = '';

  @override
  void initState() {
    super.initState();
    _purchaseIntent = widget.purchaseIntent ?? DataPurchaseIntent();
    loadDataPlans();
    _restorePurchase();
  }

  @override
  void dispose() {
    phoneController.dispose();
    _phoneFocus.dispose();
    super.dispose();
  }

  bool get isBusy =>
      isLoadingPlans || isBuyingData || _restoring || _pendingKey != null;

  Future<void> _restorePurchase() async {
    try {
      final pending = await _purchaseIntent.pending();
      final retained = await _purchaseIntent.retained();
      if (!mounted) return;
      setState(() => _retainedRequests = retained);
      if (pending != null) {
        setState(() {
          _pendingKey = pending['key'] as String;
          _phase = PurchasePhase.pending;
          _pendingMessage =
              'An earlier DATA purchase is awaiting confirmation. '
              'Check its status; no new purchase will be sent.';
        });
        await _checkPurchase();
      }
    } catch (_) {
      if (mounted)
        setState(() {
          _pendingMessage = 'Cannot safely recover the previous request. '
              'Check Transactions before making another purchase.';
          _pendingKey = '';
          _phase = PurchasePhase.pending;
        });
    } finally {
      if (mounted)
        setState(() {
          _restoring = false;
        });
    }
  }

  Future<void> _checkPurchase({Map<String, dynamic>? retained}) async {
    final key = retained?['key'] as String? ?? _pendingKey;
    if (isBuyingData || key == null || key.isEmpty) return;
    setState(() {
      isBuyingData = true;
    });
    try {
      final pending = retained ?? await _purchaseIntent.pending();
      if (pending == null || !mounted) return;
      final parts = jsonDecode(pending['fingerprint'] as String) as List;
      final result =
          await (widget.statusQuery ?? ApiService.dataPurchaseStatus)(key);
      if (!mounted) return;
      if (result['authenticationRequired'] == true ||
          result['httpStatus'] == 401) {
        setState(() {
          _authenticationRequired = true;
          _canStartSeparate = false;
          _canRetireUnrecorded = false;
          _pendingMessage = 'Your session has expired. Sign in again to check '
              'the original request. No purchase has been resent.';
        });
        return;
      }
      setState(() => _authenticationRequired = false);
      if (retained != null) {
        final outcome = purchaseOutcome(result);
        if (outcome == PurchasePhase.success ||
            outcome == PurchasePhase.failed) {
          await _purchaseIntent.finishRetained(key);
          final remaining = await _purchaseIntent.retained();
          if (mounted) setState(() => _retainedRequests = remaining);
        }
        showMessage(result['message']?.toString() ??
            'This earlier request is still awaiting confirmation.');
        return;
      }
      setState(() => _canStartSeparate =
          result['allowSeparatePurchase'] == true &&
              result['status'] == 'UNKNOWN');
      setState(() =>
          _canRetireUnrecorded = result['canRetireUnrecordedRequest'] == true);
      await _presentDataResult(result,
          network: parts[0].toString(),
          phone: parts[1].toString(),
          code: parts[2].toString(),
          name: pending['planName']?.toString() ?? parts[2].toString(),
          price: double.parse(parts[3].toString()));
    } catch (error) {
      if (mounted) {
        setState(() {
          _phase = PurchasePhase.pending;
          _authenticationRequired = error is PurchaseAuthenticationRequired;
          _canStartSeparate = false;
          _canRetireUnrecorded = false;
          _pendingMessage = _authenticationRequired
              ? 'Your session has expired. Sign in again to check the original request.'
              : 'Status is unavailable. The original request is retained. Do not submit again.';
        });
      }
    } finally {
      if (mounted)
        setState(() {
          isBuyingData = false;
        });
    }
  }

  Future<void> _startSeparatePurchase() async {
    if (!_canStartSeparate || isBuyingData) return;
    final acknowledged = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Start a separate purchase?'),
        content: const Text(
          'The earlier purchase is unresolved and its funds remain held. '
          'It will be retained for status checks, not resent or automatically '
          'refunded. A separate purchase uses a new request key and can charge '
          'your wallet separately. Check your balance and Transactions first.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Start separate purchase')),
        ],
      ),
    );
    if (acknowledged != true || !mounted || isBuyingData) return;
    setState(() => isBuyingData = true);
    try {
      // Recheck immediately: a formerly UNKNOWN operation can become active or
      // terminal while the acknowledgement dialog is open.
      final result = await (widget.statusQuery ??
          ApiService.dataPurchaseStatus)(_pendingKey!);
      if (result['authenticationRequired'] == true ||
          result['httpStatus'] == 401) {
        if (mounted) {
          setState(() {
            _authenticationRequired = true;
            _canStartSeparate = false;
            _canRetireUnrecorded = false;
            _pendingMessage =
                'Your session has expired. Sign in again to check '
                'the original request. No new purchase was started.';
          });
        }
        return;
      }
      if (result['allowSeparatePurchase'] != true ||
          result['status'] != 'UNKNOWN') {
        showMessage('Check the original request again before continuing.');
        return;
      }
      await _purchaseIntent.retainForSeparatePurchase(_pendingKey!);
      final retained = await _purchaseIntent.retained();
      if (!mounted) return;
      setState(() {
        _retainedRequests = retained;
        _pendingKey = null;
        _pendingMessage = '';
        _canStartSeparate = false;
        _phase = PurchasePhase.idle;
      });
      _phoneFocus.requestFocus();
    } catch (_) {
      showMessage(
          'The earlier request could not be safely retained. No new purchase was started.',
          isError: true);
    } finally {
      if (mounted) setState(() => isBuyingData = false);
    }
  }

  Future<void> _retireUnrecordedPurchase() async {
    if (!_canRetireUnrecorded || isBuyingData || _pendingKey == null) return;
    final acknowledged = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Resolve unrecorded request?'),
        content: const Text(
            'The server will check whether the original request '
            'was admitted. Only if no purchase exists will it permanently block '
            'that old key before letting you buy again. No provider request or '
            'automatic refund will be made.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Resolve request')),
        ],
      ),
    );
    if (acknowledged != true || !mounted || isBuyingData) return;
    setState(() => isBuyingData = true);
    try {
      final result = await (widget.retireRequest ??
          ApiService.retireUnrecordedDataRequest)(_pendingKey!);
      if (result['requestRetired'] == true && result['status'] == 'FAILED') {
        await _purchaseIntent.finish(_pendingKey!);
        if (!mounted) return;
        setState(() {
          _pendingKey = null;
          _pendingMessage = '';
          _canRetireUnrecorded = false;
          _canStartSeparate = false;
          _phase = PurchasePhase.idle;
        });
      }
      showMessage(
          result['message']?.toString() ?? 'Check the original request again.');
    } catch (_) {
      showMessage('Recovery is unavailable. The original key is retained.',
          isError: true);
    } finally {
      if (mounted) setState(() => isBuyingData = false);
    }
  }

  double parseAmount(dynamic amount) {
    final String value =
        amount.toString().replaceAll('₦', '').replaceAll(',', '').trim();

    return double.tryParse(value) ?? 0;
  }

  String formatAmount(dynamic amount) {
    final double value = parseAmount(amount);

    if (value == value.roundToDouble()) {
      return value.toStringAsFixed(0);
    }

    return value.toStringAsFixed(2);
  }

  String getPlanCode(
    Map<String, dynamic> plan,
  ) {
    return plan['code']?.toString().trim() ??
        plan['id']?.toString().trim() ??
        '';
  }

  String getPlanName(
    Map<String, dynamic> plan,
  ) {
    return plan['name']?.toString().trim() ??
        plan['description']?.toString().trim() ??
        'Data Plan';
  }

  String getCategory(
    Map<String, dynamic> plan,
  ) {
    final String name = getPlanName(plan).toUpperCase();

    if (name.contains('SME')) {
      return 'SME';
    }

    if (name.contains('AWOOF')) {
      return 'Awoof';
    }

    if (name.contains('DIRECT')) {
      return 'Direct';
    }

    return 'Other';
  }

  String getBundleSize(
    Map<String, dynamic> plan,
  ) {
    final String name = getPlanName(plan);

    final RegExp pattern = RegExp(
      r'(\d+(?:\.\d+)?)\s*(MB|GB|TB)',
      caseSensitive: false,
    );

    final RegExpMatch? match = pattern.firstMatch(name);

    if (match == null) {
      return name;
    }

    final String number = match.group(1) ?? '';

    final String unit = (match.group(2) ?? '').toUpperCase();

    return '$number $unit';
  }

  String getValidity(
    Map<String, dynamic> plan,
  ) {
    final String name = getPlanName(plan);

    final RegExp dayPattern = RegExp(
      r'(\d+)\s*day',
      caseSensitive: false,
    );

    final RegExpMatch? dayMatch = dayPattern.firstMatch(name);

    if (dayMatch != null) {
      final String days = dayMatch.group(1) ?? '';

      return '$days Day${days == '1' ? '' : 's'}';
    }

    if (name.toUpperCase().contains('WEEKLY')) {
      return 'Weekly';
    }

    if (name.toUpperCase().contains('MONTHLY')) {
      return 'Monthly';
    }

    if (name.toUpperCase().contains('DAILY')) {
      return 'Daily';
    }

    return '';
  }

  bool isValidPhone(String phone) {
    return RegExp(
      r'^0\d{10}$',
    ).hasMatch(phone);
  }

  List<String> get categories {
    final Set<String> found = dataPlans.map(getCategory).toSet();

    final List<String> result = <String>['All'];

    for (final String item in const <String>[
      'SME',
      'Awoof',
      'Direct',
      'Other',
    ]) {
      if (found.contains(item)) {
        result.add(item);
      }
    }

    return result;
  }

  List<Map<String, dynamic>> get visiblePlans {
    final List<Map<String, dynamic>> result = selectedCategory == 'All'
        ? List<Map<String, dynamic>>.from(
            dataPlans,
          )
        : dataPlans
            .where(
              (Map<String, dynamic> plan) =>
                  getCategory(plan) == selectedCategory,
            )
            .toList();

    result.sort(
      (
        Map<String, dynamic> a,
        Map<String, dynamic> b,
      ) =>
          parseAmount(a['price']).compareTo(
        parseAmount(b['price']),
      ),
    );

    return result;
  }

  void showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: isError ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  Future<void> loadDataPlans() async {
    if (!mounted) return;
    final generation = ++_catalogGeneration;
    final network = selectedNetwork;

    setState(() {
      isLoadingPlans = true;
      plansError = '';
      dataPlans = <Map<String, dynamic>>[];
      selectedCategory = 'All';
    });

    try {
      final Map<String, dynamic> result = widget.loadPlans != null
          ? await widget.loadPlans!(network).timeout(const Duration(seconds: 8))
          : await ApiService.getDataPlans(network: network)
              .timeout(const Duration(seconds: 8));

      if (!mounted || generation != _catalogGeneration) return;

      if (result['success'] != true) {
        setState(() {
          if (result['httpStatus'] == 401) {
            _authenticationRequired = true;
            _canStartSeparate = false;
            _canRetireUnrecorded = false;
            _pendingMessage = 'Your session has expired. Sign in again to load '
                'DATA plans and check your earlier requests.';
          }
          plansError =
              result['message']?.toString() ?? 'Unable to load data plans.';
        });
        return;
      }

      final dynamic rawPlans = result['plans'];

      final List<Map<String, dynamic>> plans = <Map<String, dynamic>>[];

      if (rawPlans is List) {
        for (final dynamic item in rawPlans) {
          if (item is Map) {
            final Map<String, dynamic> plan = Map<String, dynamic>.from(item);

            if (getPlanCode(plan).isNotEmpty &&
                parseAmount(plan['price']) > 0) {
              plans.add(plan);
            }
          }
        }
      }

      plans.sort(
        (
          Map<String, dynamic> a,
          Map<String, dynamic> b,
        ) =>
            parseAmount(a['price']).compareTo(
          parseAmount(b['price']),
        ),
      );

      if (!mounted || generation != _catalogGeneration) return;

      setState(() {
        dataPlans = plans;

        if (plans.isEmpty) {
          plansError =
              'No active data plans were returned for $selectedNetwork.';
        }
      });
    } catch (error) {
      if (!mounted || generation != _catalogGeneration) return;

      setState(() {
        plansError = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    } finally {
      if (mounted && generation == _catalogGeneration) {
        setState(() {
          isLoadingPlans = false;
        });
      }
    }
  }

  Future<void> buyPlan(
    Map<String, dynamic> plan,
  ) async {
    if (isBusy) return;

    final String phone = normalizeDataPhone(phoneController.text);

    if (!isValidPhone(phone)) {
      showMessage(
        'Please enter a valid 11-digit phone number.',
        isError: true,
      );
      return;
    }

    final String code = getPlanCode(plan);

    final String name = getPlanName(plan);

    final double price = parseAmount(plan['price']);
    final String? productQuote = plan['productQuote']?.toString();

    if (code.isEmpty || price <= 0) {
      showMessage(
        'This data plan is invalid.',
        isError: true,
      );
      return;
    }

    final String network = selectedNetwork;
    // Claim the whole confirmation flow, not just the network call: two taps
    // must never open two independent Buy dialogs.
    setState(() {
      isBuyingData = true;
      _phase = PurchasePhase.confirming;
    });
    String? preparedKey;
    try {
      bool confirmationSubmitted = false;
      final bool? confirmed = await showDialog<bool>(
        context: context,
        builder: (BuildContext dialogContext) {
          return AlertDialog(
            title: const Text(
              'Confirm Data Purchase',
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  getBundleSize(plan),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(name),
                const SizedBox(height: 14),
                Text(
                  'Network: $selectedNetwork',
                ),
                Text(
                  'Phone: $phone',
                ),
                const SizedBox(height: 10),
                Text(
                  '₦${formatAmount(price)}',
                  style: const TextStyle(
                    color: primaryGreen,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.pop(
                  dialogContext,
                  false,
                ),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () {
                  if (confirmationSubmitted) return;
                  confirmationSubmitted = true;
                  Navigator.pop(dialogContext, true);
                },
                child: const Text('Buy Data'),
              ),
            ],
          );
        },
      );

      if (confirmed != true || !mounted) return;
      // Bind the confirmed intent before PIN; never create a second key later.
      final String idempotencyKey = await _purchaseIntent.keyForSubmission(
        network: network,
        phone: phone,
        planCode: code,
        price: price,
        productQuote: productQuote,
        planName: name,
        preparedOnly: true,
      );
      preparedKey = idempotencyKey;
      if (!mounted) return;
      String transactionPin = '';
      final TextEditingController transactionPinController =
          TextEditingController();
      bool pinSubmitted = false;
      final pinRoute = DialogRoute<String>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) {
          return StatefulBuilder(builder: (dialogContext, setPinState) {
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
                  onPressed: pinSubmitted
                      ? null
                      : () {
                          if (pinSubmitted) return;
                          final pin = transactionPinController.text.trim();
                          if (!RegExp(r'^\d{4}$').hasMatch(pin)) return;
                          setPinState(() => pinSubmitted = true);
                          setState(() {
                            _phase = PurchasePhase.processing;
                          });
                          Navigator.of(dialogContext).pop(
                            pin,
                          );
                        },
                  child: const Text('Confirm'),
                ),
              ],
            );
          });
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

      await _purchaseIntent.markSubmitted(idempotencyKey);
      _pendingKey = idempotencyKey;
      final Map<String, dynamic> result = widget.purchase != null
          ? await widget.purchase!({
              'transactionPin': transactionPin,
              'network': network,
              'phone': phone,
              'planCode': code,
              'productQuote': productQuote,
              'amount': price,
              'idempotencyKey': idempotencyKey
            })
          : await ApiService.buyData(
              transactionPin: transactionPin,
              network: network,
              phone: phone,
              planCode: code,
              productQuote: productQuote,

              // Backward compatibility only.
              // Backend now determines real selling price.
              amount: price,
              idempotencyKey: idempotencyKey,
            );

      await _presentDataResult(result,
          network: network, phone: phone, code: code, name: name, price: price);
    } catch (error) {
      if (mounted)
        setState(() {
          _phase = _pendingKey == null
              ? PurchasePhase.failed
              : PurchasePhase.pending;
          _pendingMessage = _pendingKey == null
              ? ''
              : 'The original request is awaiting confirmation. Check status; do not submit again.';
        });
      showMessage(
          _pendingKey == null
              ? error.toString().replaceFirst('Exception: ', '')
              : _pendingMessage,
          isError: _pendingKey == null);
    } finally {
      if (preparedKey != null) {
        await _purchaseIntent.cancelPreparation(preparedKey);
      }
      if (mounted)
        setState(() {
          isBuyingData = false;
          if (_phase == PurchasePhase.confirming) _phase = PurchasePhase.idle;
        });
    }
  }

  Future<void> _presentDataResult(
    Map<String, dynamic> result, {
    required String network,
    required String phone,
    required String code,
    required String name,
    required double price,
  }) async {
    final outcome =
        result['requestRetired'] == true && result['status'] == 'FAILED'
            ? PurchasePhase.failed
            : purchaseOutcome(result);
    final bool success = outcome == PurchasePhase.success;
    if (!mounted) return;
    setState(() {
      _phase = outcome;
    });

    String message = result['message']?.toString() ??
        result['response_description']?.toString() ??
        result['description']?.toString() ??
        result['error']?.toString() ??
        (success ? 'Data purchase successful.' : 'Data purchase failed.');

    final String reference = result['reference']?.toString() ?? '';

    final String status = result['status']?.toString().toUpperCase() ?? '';
    if (outcome == PurchasePhase.success || outcome == PurchasePhase.failed) {
      if (_pendingKey != null) await _purchaseIntent.finish(_pendingKey!);
      if (mounted)
        setState(() {
          _pendingKey = null;
          _pendingMessage = '';
        });
    }
    if (!mounted) return;

    if (outcome == PurchasePhase.pending) {
      message = result['status'] == 'UNKNOWN' &&
              result['manualReviewRequired'] == true
          ? 'The earlier request remains unconfirmed and retained for review. '
              'Use the available recovery action; do not resend the original request.'
          : 'Your transaction is being processed. Please do not retry '
              'with a new request. Its final status must be confirmed.';
      setState(() {
        _pendingMessage = message;
      });
    }
    if (!success && (status == 'REFUNDED' || status == 'REVERSED')) {
      message = '$message Your wallet has been refunded.';
    }

    if (reference.isNotEmpty) {
      message = '$message Reference: $reference';
    }

    showMessage(
      message,
      isError: !success,
    );

    if (success) {
      final String receiptPhone = result['phone']?.toString() ??
          (result['transaction'] is Map
              ? (result['transaction'] as Map)['phone']?.toString()
              : null) ??
          phone;
      final String receiptNetwork = network;

      final String receiptPlan = result['planName']?.toString() ??
          result['plan_name']?.toString() ??
          result['dataPlan']?.toString() ??
          result['data_plan']?.toString() ??
          name;

      final String receiptAmount = result['amountCharged']?.toString() ??
          result['amount_charged']?.toString() ??
          result['amount']?.toString() ??
          price.toString();

      final String receiptReference = reference;

      final String receiptStatus = status.isNotEmpty ? status : 'SUCCESSFUL';

      final DateTime now =
          DateTime.tryParse('${result['createdAt'] ?? ''}')?.toLocal() ??
              DateTime.now();

      final String receiptDate = '${now.day.toString().padLeft(2, '0')}/'
          '${now.month.toString().padLeft(2, '0')}/'
          '${now.year} '
          '${now.hour.toString().padLeft(2, '0')}:'
          '${now.minute.toString().padLeft(2, '0')}';

      phoneController.clear();

      if (!mounted) return;

      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (BuildContext dialogContext) {
          return AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(22),
            ),
            icon: const Icon(
              Icons.check_circle_rounded,
              color: primaryGreen,
              size: 60,
            ),
            title: const Text(
              'Data Purchase Successful',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
            content: SingleChildScrollView(
              child: Text(
                'Network: $receiptNetwork\nPhone: $receiptPhone\n'
                'Data plan: $receiptPlan\nAmount: ₦$receiptAmount\n'
                'Reference: $receiptReference\nDate/time: $receiptDate',
              ),
            ),
            actionsAlignment: MainAxisAlignment.center,
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                },
                child: const Text('Done'),
              ),
              FilledButton.icon(
                onPressed: () {
                  Navigator.of(dialogContext).pop();

                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => ReceiptScreen(
                        serviceName: 'Data Purchase',
                        amount: receiptAmount,
                        status: receiptStatus,
                        reference: receiptReference,
                        date: receiptDate,
                        details: {
                          'Network': receiptNetwork,
                          'Phone Number': receiptPhone,
                          'Data Plan': receiptPlan,
                        },
                      ),
                    ),
                  );
                },
                icon: const Icon(
                  Icons.receipt_long_rounded,
                ),
                label: const Text(
                  'View Receipt',
                ),
              ),
            ],
          );
        },
      );
    }
  }

  Widget buildNetworkSelector() {
    return SizedBox(
      height: 46,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: networks.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (
          BuildContext context,
          int index,
        ) {
          final String network = networks[index];

          final bool selected = selectedNetwork == network;

          return ChoiceChip(
            label: Text(network),
            selected: selected,
            selectedColor: primaryGreen,
            backgroundColor: Colors.white,
            side: BorderSide(
              color: selected ? primaryGreen : Colors.grey.shade300,
            ),
            labelStyle: TextStyle(
              color: selected ? Colors.white : Colors.black87,
              fontWeight: FontWeight.w700,
            ),
            onSelected: isBuyingData
                ? null
                : (_) async {
                    if (selected) return;

                    setState(() {
                      selectedNetwork = network;
                    });

                    await loadDataPlans();
                  },
          );
        },
      ),
    );
  }

  Widget buildCategorySelector() {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 7),
        itemBuilder: (
          BuildContext context,
          int index,
        ) {
          final String category = categories[index];

          return FilterChip(
            label: Text(category),
            selected: selectedCategory == category,
            selectedColor: softGreen,
            checkmarkColor: primaryGreen,
            onSelected: (_) {
              setState(() {
                selectedCategory = category;
              });
            },
          );
        },
      ),
    );
  }

  Widget buildPlanCard(
    Map<String, dynamic> plan,
  ) {
    final String name = getPlanName(plan);

    final String bundle = getBundleSize(plan);

    final String category = getCategory(plan);

    final String validity = getValidity(plan);

    return Card(
      elevation: 0,
      color: Colors.white,
      margin: const EdgeInsets.only(
        bottom: 12,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: isBusy ? null : () => buyPlan(plan),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: <Widget>[
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: softGreen,
                  borderRadius: BorderRadius.circular(
                    15,
                  ),
                ),
                child: const Icon(
                  Icons.signal_cellular_alt_rounded,
                  color: primaryGreen,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      bundle,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(
                      height: 3,
                    ),
                    Text(
                      [
                        category,
                        validity,
                      ]
                          .where(
                            (String value) => value.isNotEmpty,
                          )
                          .join(' • '),
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(
                      height: 4,
                    ),
                    Text(
                      name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.grey.shade700,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text(
                    '₦${formatAmount(plan['price'])}',
                    style: const TextStyle(
                      color: primaryGreen,
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(
                    height: 8,
                  ),
                  FilledButton(
                    onPressed: isBusy ? null : () => buyPlan(plan),
                    style: FilledButton.styleFrom(
                      backgroundColor: primaryGreen,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                      ),
                    ),
                    child: const Text('Buy'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final List<Map<String, dynamic>> displayed = visiblePlans;

    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FA),
      appBar: AppBar(
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        title: const Text(
          'Buy Data',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: isBuyingData ? null : loadDataPlans,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: PopScope(
        canPop: _phase != PurchasePhase.processing,
        child: PurchaseProcessing(
          processing: _phase == PurchasePhase.processing,
          service: 'data',
          child: RefreshIndicator(
            onRefresh: loadDataPlans,
            child: CustomScrollView(
              slivers: <Widget>[
                SliverToBoxAdapter(
                    child: Column(children: [
                  if (_pendingMessage.isNotEmpty)
                    MaterialBanner(
                      content: Text(
                          '${_authenticationRequired ? 'Sign in required' : _canStartSeparate || _canRetireUnrecorded ? 'Earlier request needs review' : 'Transaction Pending'}\n$_pendingMessage'),
                      actions: [
                        if (_authenticationRequired)
                          TextButton(
                            onPressed: isBuyingData
                                ? null
                                : () => signInForPurchaseRecovery(context),
                            child: const Text('Sign in again'),
                          ),
                        TextButton(
                            onPressed:
                                isBuyingData ? null : () => _checkPurchase(),
                            child: const Text('Check existing request')),
                        if (_canStartSeparate)
                          TextButton(
                            onPressed:
                                isBuyingData ? null : _startSeparatePurchase,
                            child: const Text('Start a separate purchase'),
                          ),
                        if (_canRetireUnrecorded)
                          TextButton(
                            onPressed:
                                isBuyingData ? null : _retireUnrecordedPurchase,
                            child: const Text('Resolve unrecorded request'),
                          ),
                      ],
                    ),
                  for (final request in _retainedRequests)
                    ListTile(
                      title: const Text(
                          'Earlier DATA request retained for review'),
                      trailing: TextButton(
                        onPressed: isBuyingData
                            ? null
                            : () => _checkPurchase(retained: request),
                        child: const Text('Check status'),
                      ),
                    ),
                  Container(
                    width: double.infinity,
                    color: Colors.white,
                    padding: const EdgeInsets.fromLTRB(
                      16,
                      16,
                      16,
                      14,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        TextField(
                          controller: phoneController,
                          focusNode: _phoneFocus,
                          onTap: () => _phoneFocus.requestFocus(),
                          enabled: true,
                          maxLength: 24,
                          keyboardType: TextInputType.phone,
                          decoration: InputDecoration(
                            labelText: 'Beneficiary Phone Number',
                            hintText: '08012345678',
                            counterText: '',
                            prefixIcon: const Icon(
                              Icons.phone_android_rounded,
                            ),
                            filled: true,
                            fillColor: const Color(
                              0xFFF8FAFC,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(
                                14,
                              ),
                            ),
                          ),
                        ),
                        SavedBeneficiaries(
                          loadBeneficiaries: widget.loadBeneficiaries,
                          saveBeneficiary: widget.saveBeneficiary,
                          phoneController: phoneController,
                          network: selectedNetwork,
                          serviceType: 'DATA',
                        ),
                        const SizedBox(
                          height: 14,
                        ),
                        const Text(
                          'Network',
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(
                          height: 8,
                        ),
                        buildNetworkSelector(),
                        if (!isLoadingPlans && dataPlans.isNotEmpty) ...[
                          const SizedBox(
                            height: 14,
                          ),
                          const Text(
                            'Data Type',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(
                            height: 8,
                          ),
                          buildCategorySelector(),
                        ],
                      ],
                    ),
                  ),
                ])),
                if (isLoadingPlans ||
                    plansError.isNotEmpty ||
                    displayed.isEmpty)
                  SliverToBoxAdapter(
                    child: SizedBox(
                        height: 240,
                        child: isLoadingPlans
                            ? const Center(
                                child: CircularProgressIndicator(),
                              )
                            : plansError.isNotEmpty
                                ? Center(
                                    child: Padding(
                                      padding: const EdgeInsets.all(
                                        24,
                                      ),
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: <Widget>[
                                          const Icon(
                                            Icons.error_outline_rounded,
                                            size: 46,
                                            color: Colors.red,
                                          ),
                                          const SizedBox(
                                            height: 12,
                                          ),
                                          Text(
                                            plansError,
                                            textAlign: TextAlign.center,
                                          ),
                                          const SizedBox(
                                            height: 14,
                                          ),
                                          FilledButton.icon(
                                            onPressed: loadDataPlans,
                                            icon: const Icon(
                                              Icons.refresh_rounded,
                                            ),
                                            label: const Text(
                                              'Try Again',
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  )
                                : displayed.isEmpty
                                    ? const Center(
                                        child: Text(
                                          'No plans found in this category.',
                                        ),
                                      )
                                    : const SizedBox.shrink()),
                  ),
                if (!isLoadingPlans &&
                    plansError.isEmpty &&
                    displayed.isNotEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.all(16),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) => buildPlanCard(displayed[index]),
                        childCount: displayed.length,
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
