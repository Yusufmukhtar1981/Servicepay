import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Android uses the Flutter version without a hard-coded code override',
      () {
    final String app = File('android/app/build.gradle.kts').readAsStringSync();
    expect(app, contains('versionCode = flutter.versionCode'));
    expect(app, contains('versionName = flutter.versionName'));
    expect(app, isNot(matches(RegExp(r'versionCode\s*=\s*\d+'))));
    expect(app, contains('applicationId = "ng.servicepay.app"'));
  });

  test('Release signing cannot silently fall back to the debug key', () {
    final String app = File('android/app/build.gradle.kts').readAsStringSync();
    expect(app, contains('Missing android/key.properties'));
    expect(app, contains('signingConfigs.getByName("release")'));
    expect(app, isNot(contains('signingConfigs.getByName("debug")')));
  });

  test('Customer services retain the production API', () {
    final String api = File('lib/services/api_service.dart').readAsStringSync();
    expect(api, contains("https://api.servicepay.ng/api"));
    expect(api, isNot(contains('localhost')));
    expect(api, isNot(contains('127.0.0.1')));
  });
}
