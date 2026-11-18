import 'package:flutter/widgets.dart';

/// IndexedStack tabs retain their route even when they are not on screen.
class CustomerDashboardVisibility extends InheritedWidget {
  const CustomerDashboardVisibility({
    super.key,
    required this.visible,
    required super.child,
  });

  final bool visible;

  static bool of(BuildContext context) => context
          .dependOnInheritedWidgetOfExactType<CustomerDashboardVisibility>()
          ?.visible ??
      true;

  @override
  bool updateShouldNotify(CustomerDashboardVisibility oldWidget) =>
      visible != oldWidget.visible;
}
