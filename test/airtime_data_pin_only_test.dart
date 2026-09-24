import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Airtime and Data purchases remain PIN-only', () {
    for (final path in [
      'lib/airtime_screen.dart',
      'lib/data_screen.dart',
    ]) {
      final source = File(path).readAsStringSync();
      expect(source, isNot(contains('authorizeTransaction')));
      expect(source, isNot(contains('biometricGrant')));
      expect(source, contains('Enter Transaction PIN'));
      expect(source, contains('transactionPin: transactionPin'));
    }
  });
}