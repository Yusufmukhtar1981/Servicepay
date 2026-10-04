import 'package:flutter/material.dart';
import '../login_screen.dart';
import 'session_store.dart';

/// Reauthenticate without deleting any submitted or retained purchase intent.
Future<void> signInForPurchaseRecovery(BuildContext context) async {
  await SessionStore.clear();
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const LoginScreen()),
    (_) => false,
  );
}
