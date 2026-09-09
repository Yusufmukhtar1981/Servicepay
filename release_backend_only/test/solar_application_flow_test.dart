import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:servicepay_app/services/solar_api_service.dart';
import 'package:servicepay_app/solar_screen.dart';

class _FakeSolarApiService extends SolarApiService {
  _FakeSolarApiService({this.failure});

  final Object? failure;
  Map<String, dynamic>? submittedApplication;
  int applicationLoads = 0;

  static const Map<String, dynamic> solarPackage = <String, dynamic>{
    '_id': 'solar-package-1',
    'name': 'Home Solar 2kW',
    'description': 'Reliable home power',
    'cashPrice': 850000,
    'financedPrice': 900000,
    'depositPercent': 20,
    'installmentMonths': 12,
    'repaymentFrequency': 'MONTHLY',
  };

  @override
  Future<Map<String, dynamic>> getPackages() async => <String, dynamic>{
        'packages': <Map<String, dynamic>>[solarPackage]
      };

  @override
  Future<Map<String, dynamic>> getApplications() async {
    applicationLoads++;
    return <String, dynamic>{
      'applications': submittedApplication == null
          ? <Map<String, dynamic>>[]
          : <Map<String, dynamic>>[
              <String, dynamic>{
                '_id': 'application-1',
                'status': 'SUBMITTED',
                'packageSnapshot': solarPackage,
                'business': submittedApplication!['business'],
                'applicationPreferences':
                    submittedApplication!['applicationPreferences'],
              },
            ],
    };
  }

  @override
  Future<Map<String, dynamic>> getFinance() async =>
      <String, dynamic>{'finance': <Map<String, dynamic>>[]};

  @override
  Future<Map<String, dynamic>> submitApplication(
    Map<String, dynamic> application,
  ) async {
    if (failure != null) throw failure!;
    submittedApplication = application;
    return <String, dynamic>{
      'success': true,
      'message': 'Application submitted successfully.',
    };
  }
}

Finder _textField(String label) => find.widgetWithText(TextFormField, label);

Future<void> _centerInViewport(
  WidgetTester tester,
  Finder finder,
  Finder scrollable,
) async {
  await tester.scrollUntilVisible(finder, 220, scrollable: scrollable);
  await tester.pump();
  final double centerY = tester.getCenter(finder).dy;
  if (centerY < 120) {
    await tester.drag(scrollable, Offset(0, 240 - centerY));
  } else if (centerY > 740) {
    await tester.drag(scrollable, Offset(0, 620 - centerY));
  }
  await tester.pumpAndSettle();
}

Future<void> _enterRequiredFormFields(
  WidgetTester tester,
) async {
  final Finder scrollable = find.byType(Scrollable).first;
  final Map<String, String> values = <String, String>{
    'Full name': 'Amina Customer',
    'Phone number': '08030000000',
    'Residential / installation address': '12 Solar Street',
    'State': 'Lagos',
    'Local government area': 'Ikeja',
    'Occupation / business': 'Food retail business',
    'Preferred repayment period (months)': '12',
  };
  for (final MapEntry<String, String> entry in values.entries) {
    final Finder field = _textField(entry.key);
    await tester.scrollUntilVisible(field, 220, scrollable: scrollable);
    await tester.enterText(field, entry.value);
  }

  final Finder income = find.byKey(const Key('solar_income_range'));
  await _centerInViewport(tester, income, scrollable);
  await tester.tap(income);
  await tester.pumpAndSettle();
  await tester.tap(find.text('₦100,001 - ₦250,000').last);
  await tester.pumpAndSettle();

  final Finder upfront = find.byKey(const Key('solar_upfront_payment'));
  await _centerInViewport(tester, upfront, scrollable);
  await tester.tap(upfront);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Standard package deposit').last);
  await tester.pumpAndSettle();

  for (final String key in <String>[
    'solar_declaration_truth',
    'solar_declaration_terms',
    'solar_declaration_recovery',
  ]) {
    final Finder checkbox = find.byKey(Key(key));
    await _centerInViewport(tester, checkbox, scrollable);
    await tester.tap(checkbox);
    await tester.pump();
  }
}

void main() {
  testWidgets('Solar home exposes a prominent responsive application journey',
      (WidgetTester tester) async {
    final _FakeSolarApiService api = _FakeSolarApiService();
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(MaterialApp(home: SolarScreen(api: api)));
    await tester.pumpAndSettle();

    expect(find.text('Apply for Solar'), findsOneWidget);
    await tester.tap(find.text('Apply for Solar'));
    await tester.pumpAndSettle();

    expect(find.text('Choose a Solar package'), findsOneWidget);
    expect(find.text('Home Solar 2kW'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'customer submission preserves preferences and refreshes My applications',
      (WidgetTester tester) async {
    final _FakeSolarApiService api = _FakeSolarApiService();
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(MaterialApp(
      routes: <String, WidgetBuilder>{
        '/solar': (_) => SolarScreen(api: api),
      },
      initialRoute: '/solar',
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply for Solar'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Home Solar 2kW'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply for this package'));
    await tester.pumpAndSettle();

    await _enterRequiredFormFields(tester);
    expect(
      tester
          .widget<CheckboxListTile>(
              find.byKey(const Key('solar_declaration_truth')))
          .value,
      isTrue,
    );
    expect(
      tester
          .widget<CheckboxListTile>(
              find.byKey(const Key('solar_declaration_terms')))
          .value,
      isTrue,
    );
    expect(
      tester
          .widget<CheckboxListTile>(
              find.byKey(const Key('solar_declaration_recovery')))
          .value,
      isTrue,
    );
    expect(tester.state<FormState>(find.byType(Form)).validate(), isTrue);
    final Finder submit = find.byKey(const Key('solar_submit_application'));
    await _centerInViewport(tester, submit, find.byType(Scrollable).first);
    await tester.tap(submit);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(api.submittedApplication, isNotNull);
    expect(
      api.submittedApplication!['applicationPreferences'],
      <String, String>{
        'occupationBusiness': 'Food retail business',
        'monthlyIncomeRange': '₦100,001 - ₦250,000',
        'preferredRepaymentPeriod': '12',
        'upfrontPaymentOption': 'Standard package deposit',
      },
    );
    expect(find.text('My applications'), findsOneWidget);
    expect(find.text('Home Solar 2kW'), findsOneWidget);
    expect(find.textContaining('Status: SUBMITTED'), findsOneWidget);
    expect(api.applicationLoads, greaterThanOrEqualTo(2));
  });

  testWidgets('failed submission stays on the form and shows the API message',
      (WidgetTester tester) async {
    final _FakeSolarApiService api = _FakeSolarApiService(
      failure: const SolarApiException('Solar package is no longer in stock.'),
    );
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(MaterialApp(
      home: SolarApplicationFormScreen(
        package: _FakeSolarApiService.solarPackage,
        api: api,
      ),
    ));
    await tester.pumpAndSettle();
    await _enterRequiredFormFields(tester);
    final Finder submit = find.byKey(const Key('solar_submit_application'));
    await _centerInViewport(tester, submit, find.byType(Scrollable).first);
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(find.text('Solar application'), findsOneWidget);
    expect(find.text('Solar package is no longer in stock.'), findsOneWidget);
    expect(api.submittedApplication, isNull);
  });
}
