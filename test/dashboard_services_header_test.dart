import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/dashboard_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
      'customer Services header stays left/right and clickable at phone and desktop widths',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    var openCount = 0;

    for (final width in <double>[320, 390, 1280]) {
      tester.view.physicalSize = Size(width, 800);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: CustomerServicesSectionHeader(
                showAllServices: true,
                allServicesUnavailable: false,
                onAllServices: () => openCount++,
              ),
            ),
          ),
        ),
      );

      final servicesRect = tester.getRect(find.text('Services'));
      final allServicesButton = find.byKey(const Key('customer-all-services'));
      final allServicesRect = tester.getRect(allServicesButton);
      expect(servicesRect.center.dy, closeTo(allServicesRect.center.dy, 1));
      expect(servicesRect.left, lessThan(allServicesRect.left));
      expect(allServicesRect.right, closeTo(width - 14, 1));
      expect(tester.takeException(), isNull);

      await tester.tap(allServicesButton);
      await tester.pump();
      expect(
          openCount,
          width == 320
              ? 1
              : width == 390
                  ? 2
                  : 3);
    }
  });
}
