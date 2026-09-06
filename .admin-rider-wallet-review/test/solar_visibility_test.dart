import 'package:flutter_test/flutter_test.dart';

import 'package:servicepay_app/admin/admin_solar_screen.dart';
import 'package:servicepay_app/admin/fintech_screen_registry.dart';

void main() {
  test('ServicePay Solar resolves to the live admin control centre', () {
    expect(
      fintechScreenForTitle('ServicePay Solar'),
      isA<AdminSolarScreen>(),
    );
  });
}
