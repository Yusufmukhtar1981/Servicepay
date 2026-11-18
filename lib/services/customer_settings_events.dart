import 'package:flutter/foundation.dart';

import 'customer_notification_settings.dart';
import 'session_store.dart';

@immutable
class CustomerSettingsEvent {
  const CustomerSettingsEvent(
      {required this.sessionToken, required this.settings});

  final String sessionToken;
  final CustomerNotificationSettings settings;
}

/// In-memory notification only; server responses remain the source of truth.
abstract final class CustomerSettingsEvents {
  static final ValueNotifier<CustomerSettingsEvent?> changes =
      ValueNotifier<CustomerSettingsEvent?>(null);

  static Future<void> publish(
    CustomerNotificationSettings settings, {
    String? expectedSessionToken,
  }) async {
    final token = await SessionStore.readToken();
    if (token == null ||
        token.isEmpty ||
        (expectedSessionToken != null && token != expectedSessionToken)) {
      return;
    }
    changes.value = CustomerSettingsEvent(
      sessionToken: token,
      settings: settings,
    );
  }
}
