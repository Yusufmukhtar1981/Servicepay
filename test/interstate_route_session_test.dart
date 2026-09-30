import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/interstate_logistics_screen.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SessionStore.clear();
  });
  tearDown(() async => SessionStore.clear());

  test('Interstate reads the canonical signed-in session', () async {
    await SessionStore.writeToken('customer-session-token');
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    expect(prefs.getString('auth_token'), isNull);
    expect(await InterstateLogisticsContracts.sessionToken(),
        'customer-session-token');
  });

  test('Interstate refuses route requests without a session', () async {
    await expectLater(
      InterstateLogisticsContracts.sessionToken(),
      throwsA(isA<StateError>()),
    );
  });
}