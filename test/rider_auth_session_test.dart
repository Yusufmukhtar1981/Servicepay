import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/rider/rider_auth_session.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SessionStore.clear();
  });

  test('migrates a legacy rider token to the canonical persistent key',
      () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'accessToken': 'Bearer legacy-rider-token',
    });

    expect(await RiderAuthSession.token(), 'legacy-rider-token');
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    expect(await RiderAuthSession.token(), 'legacy-rider-token');
    expect(prefs.getString('accessToken'), isNull);
  });

  test('canonical rider token survives a new preferences lookup', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'persistent-rider-token',
    });

    expect(await RiderAuthSession.token(), 'persistent-rider-token');
    expect(await RiderAuthSession.token(), 'persistent-rider-token');
  });

  test('clear removes canonical and backward-compatible rider token keys',
      () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'current',
      'accessToken': 'legacy',
    });

    await RiderAuthSession.clear();
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('auth_token'), isNull);
    expect(prefs.getString('accessToken'), isNull);
  });

  test('unauthorized clears the session and invokes the root login reset',
      () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'accessToken': 'expired-rider-token',
    });
    expect(await RiderAuthSession.token(), 'expired-rider-token');
    var resetCount = 0;
    RiderAuthSession.onUnauthorized = () {
      resetCount += 1;
    };
    addTearDown(() => RiderAuthSession.onUnauthorized = null);

    await RiderAuthSession.handleUnauthorized();

    expect(await RiderAuthSession.token(), isEmpty);
    expect(resetCount, 1);
  });
}
