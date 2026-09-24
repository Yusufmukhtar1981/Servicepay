import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SessionStore.clear();
  });

  test('role management pages hydrate a secure login without legacy keys',
      () async {
    await SessionStore.writeToken('state-manager-session');

    // This models a fresh page load: pages ask SessionStore for the hydrated
    // session instead of reading a stale SharedPreferences token.
    expect(await SessionStore.readToken(), 'state-manager-session');

    final SharedPreferences preferences =
        await SharedPreferences.getInstance();
    expect(preferences.getString('auth_token'), isNull);
    expect(preferences.getString('access_token'), isNull);
    expect(preferences.getString('token'), isNull);
  });

  test('all role-management requests use the hydrated token for Bearer auth',
      () {
    const files = <String>[
      'role_dashboard_screen.dart',
      'create_agent_screen.dart',
      'management_users_screen.dart',
      'role_commissions_screen.dart',
      'role_transactions_screen.dart',
    ];

    for (final String fileName in files) {
      final String source =
          File('lib/$fileName').readAsStringSync();
      expect(source, contains('SessionStore.readToken()'), reason: fileName);
      expect(source, contains("'Authorization': 'Bearer \$token'"),
          reason: fileName);
      expect(source, isNot(contains("'auth_token'")), reason: fileName);
      expect(source, isNot(contains("'access_token'")), reason: fileName);
      expect(source, isNot(contains("'admin_token'")), reason: fileName);
    }

    // SharedPreferences remains intentionally available for non-token
    // profile details on the dashboard.
    final String dashboard =
        File('lib/role_dashboard_screen.dart').readAsStringSync();
    expect(dashboard, contains("'user_name'"));
  });
}