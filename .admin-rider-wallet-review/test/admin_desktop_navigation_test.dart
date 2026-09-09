import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/main_navigation.dart';

void main() {
  List<BottomNavigationBarItem> modules() {
    return List<BottomNavigationBarItem>.generate(
      16,
      (int index) => BottomNavigationBarItem(
        icon: const Icon(Icons.widgets_outlined),
        activeIcon: const Icon(Icons.widgets),
        label: 'Module ${index + 1}',
      ),
    );
  }

  Widget navigationHarness({
    int initialIndex = 0,
  }) {
    int selectedIndex = initialIndex;
    return MaterialApp(
      home: Scaffold(
        body: StatefulBuilder(
          builder: (
            BuildContext context,
            StateSetter setState,
          ) {
            return Column(
              children: <Widget>[
                TextButton(
                  key: const Key('select-last-module'),
                  onPressed: () {
                    setState(() {
                      selectedIndex = 15;
                    });
                  },
                  child: const Text('Select last'),
                ),
                const Spacer(),
                AdminDesktopModuleNavigation(
                  items: modules(),
                  currentIndex: selectedIndex,
                  onTap: (int index) {
                    setState(() {
                      selectedIndex = index;
                    });
                  },
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Finder opacityInside(Finder arrow) {
    return find.descendant(
      of: arrow,
      matching: find.byType(AnimatedOpacity),
    );
  }

  testWidgets(
    'desktop module arrows stay fixed and fade at the scroll boundaries',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(900, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(navigationHarness());
      await tester.pump();

      final Finder left = find.byKey(const Key('admin-modules-scroll-left'));
      final Finder right = find.byKey(const Key('admin-modules-scroll-right'));
      final Finder scrollView =
          find.byKey(const Key('admin-modules-scroll-view'));

      expect(left, findsOneWidget);
      expect(right, findsOneWidget);
      expect(scrollView, findsOneWidget);
      expect(
        tester.widget<AnimatedOpacity>(opacityInside(left)).opacity,
        0.35,
      );
      expect(
        tester.widget<AnimatedOpacity>(opacityInside(right)).opacity,
        1,
      );

      final Rect leftBefore = tester.getRect(left);
      final Rect rightBefore = tester.getRect(right);
      final ScrollableState scrollable =
          tester.state<ScrollableState>(find.byType(Scrollable));

      tester.binding.handlePointerEvent(
        PointerScrollEvent(
          position: tester.getCenter(scrollView),
          scrollDelta: const Offset(160, 0),
        ),
      );
      await tester.pumpAndSettle();
      expect(scrollable.position.pixels, greaterThan(0));

      await tester.tap(right);
      await tester.pumpAndSettle();

      expect(scrollable.position.pixels, greaterThan(160));
      expect(tester.getRect(left), leftBefore);
      expect(tester.getRect(right), rightBefore);
      expect(
        tester.widget<AnimatedOpacity>(opacityInside(left)).opacity,
        1,
      );

      await tester.drag(scrollView, const Offset(-240, 0));
      await tester.pumpAndSettle();
      expect(scrollable.position.pixels, greaterThan(304));

      while (
          tester.widget<AnimatedOpacity>(opacityInside(right)).opacity > 0.5) {
        await tester.tap(right);
        await tester.pumpAndSettle();
      }

      expect(
        scrollable.position.pixels,
        closeTo(scrollable.position.maxScrollExtent, 0.5),
      );
      expect(
        tester.widget<AnimatedOpacity>(opacityInside(right)).opacity,
        0.35,
      );
      expect(find.text('Module 16'), findsOneWidget);

      await tester.tap(find.text('Module 16'));
      await tester.pumpAndSettle();
      expect(find.text('Module 16'), findsOneWidget);
    },
  );

  testWidgets(
    'holding the more-modules arrow continues smooth scrolling',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(900, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(navigationHarness());
      await tester.pump();

      final ScrollableState scrollable =
          tester.state<ScrollableState>(find.byType(Scrollable));
      final Finder right = find.byKey(const Key('admin-modules-scroll-right'));
      final TestGesture gesture =
          await tester.startGesture(tester.getCenter(right));

      await tester.pump(const Duration(milliseconds: 600));
      for (var interval = 0; interval < 4; interval++) {
        await tester.pump(const Duration(milliseconds: 350));
      }
      await gesture.up();
      await tester.pumpAndSettle();

      expect(scrollable.position.pixels, greaterThan(304));
    },
  );

  testWidgets(
    'tooltips and selected-module changes scroll the destination into view',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(760, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(navigationHarness());
      await tester.pump();

      final List<String> tooltipMessages = tester
          .widgetList<Tooltip>(find.byType(Tooltip))
          .map((Tooltip tooltip) => tooltip.message ?? '')
          .toList();
      expect(tooltipMessages, contains('Previous modules'));
      expect(tooltipMessages, contains('More modules'));

      final ScrollableState scrollable =
          tester.state<ScrollableState>(find.byType(Scrollable));
      expect(scrollable.position.pixels, 0);

      await tester.tap(find.byKey(const Key('select-last-module')));
      await tester.pumpAndSettle();

      expect(scrollable.position.pixels, greaterThan(0));
      expect(
        scrollable.position.pixels,
        closeTo(scrollable.position.maxScrollExtent, 0.5),
      );
      expect(find.text('Module 16'), findsOneWidget);
    },
  );
}
