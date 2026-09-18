import 'package:flutter/material.dart';
import 'services/biometric_auth_service.dart';
import 'services/session_store.dart';
import 'services/transaction_authorization_service.dart';

class BiometricSettingsScreen extends StatefulWidget {
  const BiometricSettingsScreen({super.key, BiometricAuthService? service})
    : service = service;
  final BiometricAuthService? service;
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
  String? deviceId;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final available = await service.isSupported();
    if (!available) {
      TransactionAuthorizationService.setTransactionBiometricsEnabled(false);
      if (mounted) {
        setState(() {
          supported = false;
          loading = false;
        });
      }
      return;
    }
    final token = await SessionStore.readToken();
    final remote = token == null ? null : await service.settings(token);
    final enrolled = await service.isEnrolled();
    final localId = await service.deviceId();
    TransactionAuthorizationService.setTransactionBiometricsEnabled(
      remote?.transactionEnabled == true &&
          remote?.deviceId != null &&
          remote?.deviceId == localId,
    );
    if (mounted) {
      setState(() {
        supported = available;
        loginEnabled = enrolled;
        transactionEnabled = remote?.transactionEnabled ?? false;
        loginEnabled = remote?.loginEnabled ?? enrolled;
        deviceId = remote?.deviceId ?? localId;
        error = token == null
            ? 'Sign in again before managing trusted devices.'
            : (!enrolled
                  ? 'This trusted device is no longer registered. Re-enroll to use biometrics.'
                  : (remote == null
                        ? 'Trusted device settings could not be refreshed.'
                        : null));
        loading = false;
      });
    }
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
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.all(20),
              children: [
                if (error != null)
                  Text(error!, style: TextStyle(color: Colors.red.shade700)),
                if (!supported)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'Biometrics are unavailable on this device. You can continue using your password and transaction PIN.',
                      ),
                    ),
                  ),
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
