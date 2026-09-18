import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'services/biometric_auth_service.dart';
import 'services/session_store.dart';
import 'services/transaction_authorization_service.dart';

class BiometricSettingsScreen extends StatefulWidget {
  const BiometricSettingsScreen({
    super.key,
    this.service,
    this.loadTimeout = const Duration(seconds: 12),
    this.isWeb,
  });
  final BiometricAuthService? service;
  final Duration loadTimeout;
  final bool? isWeb;
  @override
  State<BiometricSettingsScreen> createState() =>
      _BiometricSettingsScreenState();
}

class _BiometricSettingsScreenState extends State<BiometricSettingsScreen> {
  late final BiometricAuthService service =
      widget.service ?? BiometricAuthService();
  bool loginEnabled = false;
  bool transactionEnabled = false;
  bool supported = false;
  bool loading = true;
  bool loadFailed = false;
  bool webUnavailable = false;
  String? deviceId;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!loading && mounted) {
      setState(() {
        loading = true;
        loadFailed = false;
        error = null;
      });
    }

    if (widget.isWeb ?? kIsWeb) {
      TransactionAuthorizationService.setTransactionBiometricsEnabled(false);
      if (mounted) {
        setState(() {
          supported = false;
          webUnavailable = true;
          loadFailed = false;
          error = null;
          loading = false;
        });
      }
      return;
    }

    try {
      final state = await _loadNativeSettings().timeout(widget.loadTimeout);
      TransactionAuthorizationService.setTransactionBiometricsEnabled(
        state.transactionEnabled &&
            state.remoteDeviceId != null &&
            state.remoteDeviceId == state.localDeviceId,
      );
      if (mounted) {
        setState(() {
          supported = state.supported;
          webUnavailable = false;
          loadFailed = false;
          loginEnabled = state.loginEnabled;
          transactionEnabled = state.transactionEnabled;
          deviceId = state.remoteDeviceId ?? state.localDeviceId;
          error = state.error;
        });
      }
    } catch (loadError) {
      TransactionAuthorizationService.setTransactionBiometricsEnabled(false);
      debugPrint(
        'Biometric settings initialization failed '
        '(${loadError.runtimeType}).',
      );
      if (mounted) {
        setState(() {
          supported = false;
          webUnavailable = false;
          loadFailed = true;
          error = 'Unable to load biometric settings.';
        });
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<_LoadedBiometricSettings> _loadNativeSettings() async {
    final available = await service.isSupported();
    if (!available) {
      return const _LoadedBiometricSettings(supported: false);
    }
    final token = await SessionStore.readToken();
    final remote = token == null ? null : await service.settings(token);
    final enrolled = await service.isEnrolled();
    final localId = await service.deviceId();
    return _LoadedBiometricSettings(
      supported: true,
      loginEnabled: remote?.loginEnabled ?? enrolled,
      transactionEnabled: remote?.transactionEnabled ?? false,
      localDeviceId: localId,
      remoteDeviceId: remote?.deviceId,
      error: token == null
          ? 'Sign in again before managing trusted devices.'
          : (!enrolled
              ? 'This trusted device is no longer registered. Re-enroll to use biometrics.'
              : (remote == null
                  ? 'Trusted device settings could not be refreshed.'
                  : null)),
    );
  }

  Future<void> _toggle(bool transaction, bool value) async {
    if (!supported) return;
    final token = await SessionStore.readToken();
    if (token == null) return;
    var nextLogin = loginEnabled;
    var nextTransaction = transactionEnabled;
    if (transaction) {
      nextTransaction = value;
    } else {
      nextLogin = value;
    }
    if (value && !await service.isEnrolled() && !await service.enroll(token)) {
      if (mounted)
        setState(() => error = 'Biometric enrollment was not completed.');
      return;
    }
    if (!nextLogin && !nextTransaction) {
      await service.revoke(token);
    } else if (!await service.updateSettings(
      token,
      loginEnabled: nextLogin,
      transactionEnabled: nextTransaction,
    )) {
      if (mounted)
        setState(() => error = 'Unable to update trusted device settings.');
      return;
    }
    if (mounted) {
      setState(() {
        loginEnabled = nextLogin;
        transactionEnabled = nextTransaction;
        error = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Security & Biometrics')),
        body: SafeArea(
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (loadFailed) ...[
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Unable to load biometric settings.'),
                              const SizedBox(height: 12),
                              FilledButton.tonal(
                                onPressed: _load,
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ] else if (error != null)
                      Text(error!,
                          style: TextStyle(color: Colors.red.shade700)),
                    if (webUnavailable)
                      const Card(
                        child: Padding(
                          padding: EdgeInsets.all(16),
                          child: Text(
                            'Biometric authentication is available in the Servicepay mobile app. You can continue using your password and transaction PIN on the web.',
                          ),
                        ),
                      )
                    else if (!supported && !loadFailed)
                      const Card(
                        child: Padding(
                          padding: EdgeInsets.all(16),
                          child: Text(
                            'Biometrics are unavailable on this device. You can continue using your password and transaction PIN.',
                          ),
                        ),
                      ),
                    if (!loadFailed) ...[
                      SwitchListTile(
                        title: const Text('Biometric login'),
                        subtitle: const Text(
                          'Use fingerprint or face unlock to sign in',
                        ),
                        value: loginEnabled,
                        onChanged: supported ? (v) => _toggle(false, v) : null,
                      ),
                      SwitchListTile(
                        title: const Text('Biometric transaction approval'),
                        subtitle: const Text(
                          'Approve supported transactions without entering your PIN',
                        ),
                        value: transactionEnabled,
                        onChanged: supported ? (v) => _toggle(true, v) : null,
                      ),
                    ],
                    if (deviceId != null)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Manage trusted device'),
                        subtitle: Text(
                          'This device • ${deviceId!.substring(0, deviceId!.length > 8 ? 8 : deviceId!.length)}…',
                        ),
                        trailing: TextButton(
                          onPressed: () async {
                            final token = await SessionStore.readToken();
                            if (token != null) await service.revoke(token);
                            if (mounted)
                              setState(() {
                                loginEnabled = false;
                                transactionEnabled = false;
                                deviceId = null;
                              });
                          },
                          child: const Text('Remove'),
                        ),
                      ),
                  ],
                ),
        ),
      );
}

class _LoadedBiometricSettings {
  const _LoadedBiometricSettings({
    required this.supported,
    this.loginEnabled = false,
    this.transactionEnabled = false,
    this.localDeviceId,
    this.remoteDeviceId,
    this.error,
  });

  final bool supported;
  final bool loginEnabled;
  final bool transactionEnabled;
  final String? localDeviceId;
  final String? remoteDeviceId;
  final String? error;
}
