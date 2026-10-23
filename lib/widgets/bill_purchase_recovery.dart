import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../airtime_screen.dart';
import '../services/api_service.dart';
import '../services/data_purchase_intent.dart';
import '../services/purchase_session_recovery.dart';
import 'purchase_processing.dart';

class BillPurchaseRecovery extends StatefulWidget {
  const BillPurchaseRecovery({
    super.key,
    required this.isActive,
    this.dataIntent,
    this.airtimeIntent,
    this.dataStatusQuery,
    this.dataRetireRequest,
    this.airtimeStatusQuery,
    this.onTerminalStatusConfirmed,
  });

  final bool isActive;
  final DataPurchaseIntent? dataIntent;
  final AirtimePurchaseIntent? airtimeIntent;
  final Future<Map<String, dynamic>> Function(String reference)?
      dataStatusQuery;
  final Future<Map<String, dynamic>> Function(String key)? dataRetireRequest;
  final Future<Map<String, dynamic>> Function(String key)? airtimeStatusQuery;
  final VoidCallback? onTerminalStatusConfirmed;

  @override
  State<BillPurchaseRecovery> createState() => _BillPurchaseRecoveryState();
}

class _BillPurchaseRecoveryState extends State<BillPurchaseRecovery>
    with WidgetsBindingObserver {
  late final DataPurchaseIntent _dataIntent;
  late final AirtimePurchaseIntent _airtimeIntent;
  Timer? _timer;
  List<Map<String, dynamic>> _dataRequests = [];
  List<String> _airtimeKeys = [];
  final Map<String, String> _messages = {};
  final Map<String, bool> _checking = {};
  final Set<String> _retiring = {};
  final Set<String> _authenticationRequired = {};
  bool _loading = true;
  bool _loadInProgress = false;
  bool _reloadAfterLoad = false;
  String? _storageError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _dataIntent = widget.dataIntent ?? DataPurchaseIntent();
    _airtimeIntent = widget.airtimeIntent ?? AirtimePurchaseIntent();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_load(checkActive: true));
    });
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_isVisible && !_loadInProgress) {
        unawaited(_refreshActive());
      }
    });
  }

  @override
  void didUpdateWidget(covariant BillPurchaseRecovery oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isActive && !oldWidget.isActive) {
      unawaited(_load(checkActive: true));
    }
  }

  bool get _isVisible =>
      mounted &&
      widget.isActive &&
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed &&
      (ModalRoute.of(context)?.isCurrent ?? true);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && widget.isActive) {
      unawaited(_load(checkActive: true));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load({bool checkActive = false}) async {
    if (!widget.isActive || !_isVisible || _loadInProgress) return;
    _loadInProgress = true;
    setState(() {
      _loading = true;
      _storageError = null;
    });
    try {
      final activeData = await _dataIntent.pending();
      if (!_isVisible) return;
      final retainedData = await _dataIntent.retained();
      if (!_isVisible) return;
      final activeAirtime = await _airtimeIntent.pendingKey();
      if (!_isVisible) return;
      final airtimeKeys = await _airtimeIntent.retainedKeys();
      if (!mounted || !_isVisible) return;
      final data = <Map<String, dynamic>>[
        if (activeData != null) {...activeData, '_retained': false},
        ...retainedData.map((request) => {...request, '_retained': true}),
      ];
      setState(() {
        _dataRequests = data;
        _airtimeKeys = airtimeKeys.toSet().toList();
      });
      if (checkActive && _isVisible) {
        if (activeData != null) {
          await _checkData(activeData, retained: false, quiet: true);
        }
        if (activeAirtime != null) {
          await _checkAirtime(activeAirtime, quiet: true);
        }
      }
    } catch (error) {
      if (mounted && _isVisible) {
        setState(() => _storageError =
            'Some saved purchase requests could not be verified locally.');
      }
    } finally {
      _loadInProgress = false;
      if (mounted && _isVisible) {
        setState(() => _loading = false);
      } else {
        _loading = false;
      }
      if (_reloadAfterLoad && _isVisible) {
        _reloadAfterLoad = false;
        unawaited(_load());
      }
    }
  }

  Future<void> _refreshActive() async {
    if (!_isVisible) return;
    await _load(checkActive: true);
  }

  String _key(Map<String, dynamic> request) => request['key']?.toString() ?? '';

  Future<void> _checkData(
    Map<String, dynamic> request, {
    required bool retained,
    bool quiet = false,
  }) async {
    final key = _key(request);
    if (key.isEmpty || _checking[key] == true || !_isVisible) return;
    setState(() {
      _checking[key] = true;
      _messages.remove(key);
    });
    try {
      final rawFingerprint = jsonDecode(request['fingerprint'] as String);
      if (rawFingerprint is! List || rawFingerprint.length < 4) {
        throw StateError('Saved purchase details are incomplete.');
      }
      final result =
          await (widget.dataStatusQuery ?? ApiService.dataPurchaseStatus)(
        request['statusReference']?.toString() ?? key,
      ).timeout(const Duration(seconds: 8));
      if (!mounted || !_isVisible) return;
      final httpStatus =
          result['httpStatus'] is int ? result['httpStatus'] as int : 0;
      final lookupUnconfirmed = result['authenticationRequired'] == true ||
          httpStatus == 401 ||
          httpStatus == 403 ||
          (httpStatus != 0 && (httpStatus < 200 || httpStatus >= 300));
      if (result['authenticationRequired'] == true ||
          httpStatus == 401 ||
          httpStatus == 403) {
        _authenticationRequired.add(key);
      } else {
        _authenticationRequired.remove(key);
      }
      final outcome =
          lookupUnconfirmed ? PurchasePhase.pending : purchaseOutcome(result);
      if (outcome == PurchasePhase.success || outcome == PurchasePhase.failed) {
        if (retained) {
          await _dataIntent.finishRetained(key);
        } else {
          await _dataIntent.finish(key);
        }
        if (!mounted || !_isVisible) return;
        final status =
            outcome == PurchasePhase.success ? 'confirmed' : 'not fulfilled';
        setState(() => _messages[key] = 'The earlier DATA request is $status.');
        widget.onTerminalStatusConfirmed?.call();
        if (_loadInProgress) {
          _reloadAfterLoad = true;
        } else {
          await _load();
        }
      } else {
        final status = result['status']?.toString().toUpperCase();
        setState(() => _messages[key] = _authenticationRequired.contains(key)
            ? 'Sign in again to verify this request. Its key remains saved.'
            : status == 'UNKNOWN' || status == 'PENDING'
                ? 'Still verifying. No final outcome is available yet.'
                : 'Status could not be confirmed. The request remains saved.');
        if (!quiet) _showMessage(_messages[key]!);
      }
      if (mounted &&
          _isVisible &&
          !retained &&
          result['canRetireUnrecordedRequest'] == true) {
        setState(() => _messages[key] =
            'The request is not recorded yet; it remains protected until the server confirms its disposition.');
      }
    } catch (error) {
      if (mounted && _isVisible) {
        final message = error is PurchaseAuthenticationRequired
            ? 'Sign in again to verify this request. Its key remains saved.'
            : 'Status could not be confirmed. The request remains saved.';
        if (error is PurchaseAuthenticationRequired) {
          _authenticationRequired.add(key);
        }
        setState(() => _messages[key] = message);
        if (!quiet) _showMessage(message);
      }
    } finally {
      if (mounted && _isVisible) {
        setState(() => _checking.remove(key));
      } else {
        _checking.remove(key);
      }
    }
  }

  Future<void> _checkAirtime(String key, {bool quiet = false}) async {
    if (key.isEmpty || _checking[key] == true || !_isVisible) return;
    setState(() {
      _checking[key] = true;
      _messages.remove(key);
    });
    try {
      final result = await (widget.airtimeStatusQuery ??
              (requestKey) => ApiService.requeryAirtime(
                    idempotencyKey: requestKey,
                  ))(key)
          .timeout(const Duration(seconds: 12));
      if (!mounted || !_isVisible) return;
      final httpStatus =
          result['httpStatus'] is int ? result['httpStatus'] as int : 0;
      if (result['authenticationRequired'] == true ||
          httpStatus == 401 ||
          httpStatus == 403) {
        _authenticationRequired.add(key);
        setState(() => _messages[key] =
            'Sign in again to verify this request. Its key remains saved.');
        if (!quiet) _showMessage(_messages[key]!);
        return;
      }
      _authenticationRequired.remove(key);
      if (_airtimeIntent.isTerminalResult(result)) {
        await _airtimeIntent.finish(key);
        if (!mounted || !_isVisible) return;
        final status = result['status']?.toString().toUpperCase() ?? '';
        setState(() => _messages[key] =
            'The earlier AIRTIME request is ${status == 'FAILED' || status == 'REFUNDED' || status == 'REVERSED' ? 'confirmed not fulfilled' : 'confirmed'}.');
        widget.onTerminalStatusConfirmed?.call();
        if (_loadInProgress) {
          _reloadAfterLoad = true;
        } else {
          await _load();
        }
      } else {
        setState(() => _messages[key] = _airtimeIntent
                .isDeliveredAccountingPending(result)
            ? 'Delivery is recorded; final wallet confirmation is still being verified.'
            : 'Still verifying. No final outcome is available yet.');
        if (!quiet) _showMessage(_messages[key]!);
      }
    } catch (error) {
      if (mounted && _isVisible) {
        final message = error is PurchaseAuthenticationRequired
            ? 'Sign in again to verify this request. Its key remains saved.'
            : 'Status could not be confirmed. The request remains saved.';
        if (error is PurchaseAuthenticationRequired) {
          _authenticationRequired.add(key);
        }
        setState(() => _messages[key] = message);
        if (!quiet) _showMessage(message);
      }
    } finally {
      if (mounted && _isVisible) {
        setState(() => _checking.remove(key));
      } else {
        _checking.remove(key);
      }
    }
  }

  Future<void> _retireDataRequest(Map<String, dynamic> request) async {
    final key = _key(request);
    if (key.isEmpty || !_isVisible || _retiring.contains(key)) return;
    setState(() => _retiring.add(key));
    try {
      final approved = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Resolve unrecorded request?'),
          content: const Text(
            'The server will check whether the original request was admitted. '
            'The old key is kept unless the server confirms it can be retired.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Resolve request'),
            ),
          ],
        ),
      );
      if (approved != true || !mounted || !_isVisible) return;
      final result = await (widget.dataRetireRequest ??
          ApiService.retireUnrecordedDataRequest)(key);
      final retirementHttpStatus =
          result['httpStatus'] is int ? result['httpStatus'] as int : 0;
      final confirmedRetirement = result['requestRetired'] == true &&
          result['status'] == 'FAILED' &&
          (retirementHttpStatus == 0 ||
              (retirementHttpStatus >= 200 && retirementHttpStatus < 300));
      if (confirmedRetirement) {
        await _dataIntent.finish(key);
      }
      if (!mounted || !_isVisible) return;
      _showMessage(confirmedRetirement
          ? result['message']?.toString() ??
              'The server confirmed the request was not admitted.'
          : 'The server did not confirm retirement; the request remains saved.');
      await _load();
    } catch (_) {
      if (mounted && _isVisible) {
        _showMessage(
            'The request could not be resolved; its key remains saved.');
      }
    } finally {
      if (mounted && _isVisible) {
        setState(() => _retiring.remove(key));
      } else {
        _retiring.remove(key);
      }
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    if (!_isVisible) return const SizedBox.shrink();
    if (_loading && _dataRequests.isEmpty && _airtimeKeys.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 10),
        child: LinearProgressIndicator(),
      );
    }
    if (_storageError != null) {
      return Card(
        child: ListTile(
          leading: const Icon(Icons.info_outline),
          title: Text(_storageError!),
          trailing: IconButton(
            tooltip: 'Retry recovery',
            onPressed: () => _load(checkActive: true),
            icon: const Icon(Icons.refresh),
          ),
        ),
      );
    }
    if (_dataRequests.isEmpty && _airtimeKeys.isEmpty) {
      return const SizedBox.shrink();
    }
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Purchase verification',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
            const SizedBox(height: 4),
            const Text(
                'Unresolved local requests are checked here. No request is resent and no receipt is generated.'),
            for (final request in _dataRequests) ...[
              const Divider(height: 20),
              _RecoveryRow(
                label: 'DATA request',
                detail: 'Request ${_shortKey(_key(request))}',
                message: _messages[_key(request)] ??
                    'This request is awaiting verification.',
                checking: _checking[_key(request)] == true,
                resolving: _retiring.contains(_key(request)),
                onCheck: () => _checkData(
                  request,
                  retained: request['_retained'] == true,
                ),
                onResolve: request['_retained'] == true ||
                        _messages[_key(request)]
                                ?.startsWith('The request is not recorded') !=
                            true
                    ? null
                    : () => _retireDataRequest(request),
                onSignIn: _authenticationRequired.contains(_key(request))
                    ? () => signInForPurchaseRecovery(context)
                    : null,
              ),
            ],
            for (final key in _airtimeKeys) ...[
              const Divider(height: 20),
              _RecoveryRow(
                label: 'AIRTIME request',
                detail: 'Request ${_shortKey(key)}',
                message:
                    _messages[key] ?? 'This request is awaiting verification.',
                checking: _checking[key] == true,
                onCheck: () => _checkAirtime(key),
                onSignIn: _authenticationRequired.contains(key)
                    ? () => signInForPurchaseRecovery(context)
                    : null,
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _shortKey(String key) => key.length > 18
      ? '${key.substring(0, 8)}…${key.substring(key.length - 6)}'
      : key;
}

class _RecoveryRow extends StatelessWidget {
  const _RecoveryRow({
    required this.label,
    required this.detail,
    required this.message,
    required this.checking,
    required this.onCheck,
    this.resolving = false,
    this.onResolve,
    this.onSignIn,
  });

  final String label;
  final String detail;
  final String message;
  final bool checking;
  final bool resolving;
  final VoidCallback onCheck;
  final VoidCallback? onResolve;
  final VoidCallback? onSignIn;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
              IconButton(
                tooltip: 'Check request',
                onPressed: checking ? null : onCheck,
                icon: checking
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh),
              ),
            ],
          ),
          Text(detail, style: Theme.of(context).textTheme.labelSmall),
          Text(message),
          if (onSignIn != null)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: onSignIn,
                child: const Text('Sign in again'),
              ),
            ),
          if (onResolve != null)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: resolving ? null : onResolve,
                child: Text(
                  resolving
                      ? 'Resolving request…'
                      : 'Resolve unrecorded request',
                ),
              ),
            ),
        ],
      );
}
