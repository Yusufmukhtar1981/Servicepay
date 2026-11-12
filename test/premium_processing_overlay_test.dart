import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/widgets/purchase_processing.dart';

Widget _screen({
  required bool processing,
  bool pending = false,
  bool nonBlocking = false,
  VoidCallback? onTap,
}) {
  return MaterialApp(
    home: Scaffold(
      body: PurchaseProcessing(
        processing: processing,
        pending: pending,
        nonBlocking: nonBlocking,
        service: 'data',
        requestId: 'SP-REQ-2048',
        child: Center(
          child: ElevatedButton(
            onPressed: onTap,
            child: const Text('Underlying action'),
          ),
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final width in [320.0, 390.0, 430.0]) {
    testWidgets('processing overlay fits at ${width.toInt()}px with large text',
        (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 720));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: Scaffold(
            body: PurchaseProcessing(
              processing: true,
              service: 'data',
              requestId: 'SP-REQ-2048',
              child: const Center(child: Text('Purchase screen')),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(
        find.text(
          'ServicePay is processing your transaction. Please wait...',
        ),
        findsOneWidget,
      );
      expect(
        find.text('Please wait while we process your transaction...'),
        findsOneWidget,
      );
      expect(find.text('Please do not close the app.'), findsOneWidget);
      expect(find.text('Request ID: SP-REQ-2048'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('active processing blocks underlying taps and route pops',
      (tester) async {
    var taps = 0;
    final navigatorKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: navigatorKey,
        home: const Scaffold(body: Text('Previous route')),
      ),
    );
    final route = MaterialPageRoute<void>(
      builder: (_) => Scaffold(
        body: PurchaseProcessing(
          processing: true,
          nonBlocking: true,
          service: 'data',
          child: Center(
            child: ElevatedButton(
              onPressed: () => taps++,
              child: const Text('Underlying action'),
            ),
          ),
        ),
      ),
    );
    navigatorKey.currentState!.push<void>(route);
    await tester.pump();
    // SDKs use different Android transition durations. Complete the route
    // animation, not the intentionally continuous processing spinner.
    await tester.pump(route.transitionDuration);
    await tester.pump();

    await tester.tap(
      find.text('Underlying action'),
      warnIfMissed: false,
    );
    await tester.pump();
    expect(taps, 0);

    await navigatorKey.currentState!.maybePop();
    await tester.pump(const Duration(milliseconds: 100));
    expect(route.isCurrent, isTrue);
    expect(
      find.text('ServicePay is processing your transaction. Please wait...'),
      findsOneWidget,
    );
    expect(find.text('Previous route'), findsNothing);
  });

  testWidgets('pending nonBlocking status leaves History action available',
      (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      _screen(
        processing: false,
        pending: true,
        nonBlocking: true,
        onTap: () => taps++,
      ),
    );
    await tester.pump();

    expect(
        find.text('PROCESSING — check History for updates.'), findsOneWidget);
    expect(
      find.text('Your request key is saved. Do not submit again.'),
      findsOneWidget,
    );
    expect(
      find.text('ServicePay is processing your transaction. Please wait...'),
      findsNothing,
    );
    await tester.tap(find.text('Underlying action'));
    await tester.pump();
    expect(taps, 1);
  });

  testWidgets('overlay is removed when processing completes', (tester) async {
    var processing = true;
    await tester.pumpWidget(
      MaterialApp(
        home: StatefulBuilder(
          builder: (context, setState) => Scaffold(
            body: Column(
              children: [
                TextButton(
                  onPressed: () => setState(() => processing = false),
                  child: const Text('Complete'),
                ),
                Expanded(
                  child: PurchaseProcessing(
                    processing: processing,
                    service: 'data',
                    child: const Center(child: Text('Purchase screen')),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(
      find.text('ServicePay is processing your transaction. Please wait...'),
      findsOneWidget,
    );

    await tester.tap(find.text('Complete'));
    await tester.pumpAndSettle();
    expect(
      find.text('ServicePay is processing your transaction. Please wait...'),
      findsNothing,
    );
    expect(find.text('Purchase screen'), findsOneWidget);
  });
}
