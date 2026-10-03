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

  test(
      'customer destinations include only valid visible active routes for origin',
      () {
    final List<Map<String, dynamic>> routes = <Map<String, dynamic>>[
      <String, dynamic>{
        'originState': 'KANO',
        'destinationState': 'ABUJA',
        'status': 'ACTIVE',
        'customerVisible': true,
        'baseFare': 2500,
        'maximumWeightKg': 10,
      },
      <String, dynamic>{
        'originState': 'KANO',
        'destinationState': 'KADUNA',
        'status': 'ACTIVE',
        'baseFare': 2500,
        'maximumWeightKg': 10,
      },
      <String, dynamic>{
        'originState': 'KANO',
        'destinationState': 'LAGOS',
        'status': 'ACTIVE',
        'customerVisible': false,
        'baseFare': 2500,
        'maximumWeightKg': 10,
      },
      <String, dynamic>{
        'originState': 'KANO',
        'destinationState': 'RIVERS',
        'status': 'INACTIVE',
        'customerVisible': true,
        'baseFare': 2500,
        'maximumWeightKg': 10,
      },
      <String, dynamic>{
        'originState': 'KANO',
        'destinationState': 'EKITI',
        'status': 'ACTIVE',
        'customerVisible': true,
        'baseFare': 2500,
        'maximumWeightKg': 0,
      },
    ];

    expect(
      InterstateLogisticsContracts.destinationsForOrigin(routes, 'KANO'),
      <String>['ABUJA', 'KADUNA'],
    );
    expect(
      InterstateLogisticsContracts.destinationsForOrigin(routes, 'ABUJA'),
      isEmpty,
    );
  });
}
