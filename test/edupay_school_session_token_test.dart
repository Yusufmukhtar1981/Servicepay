import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('EduPay school management uses SessionStore without legacy token keys', () {
    final source = File('lib/edupay_school_management_screen.dart').readAsStringSync();
    expect(source, contains('SessionStore.readToken()'));
    expect(source, contains('Your session has expired'));
    expect(source, isNot(contains('SharedPreferences')));
    expect(source, isNot(contains("'auth_token'")));
    expect(source, isNot(contains("'access_token'")));
    expect(source, isNot(contains("'token'")));
  });
}