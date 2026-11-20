import 'package:flutter/material.dart';
import '../servicepay_theme.dart';

/// Customer-home colors are intentionally scoped here so staff dashboards keep
/// the palette defined by the shared application theme.
abstract final class CustomerDashboardPalette {
  static const navy = Color(0xFF002E24);
  static const royalBlue = Color(0xFF00DB91);
  static const teal = Color(0xFF087F68);
  static const canvas = Color(0xFF003D30);
  static const card = Color(0xFF087F68);
  static const success = Color(0xFF5BE3A9);
  static const warning = Color(0xFFFFC56B);
  static const error = Color(0xFFFF9A8B);
  static const muted = Color(0xFFE8FFF2);
  static const border = ServicePayColors.border;
  static const paleBlue = Color(0xFF0C5444);
  static const text = Color(0xFFFFFFFF);
  static const softText = Color(0xFFE2FAEF);
  static const walletStart = Color(0xFF00DB91);
  static const walletEnd = Color(0xFF00B57A);
  /// Deep-forest foreground for content placed on the bright wallet gradient.
  static const onWallet = Color(0xFF002A21);
}

class CustomerServiceGlyph extends StatelessWidget {
  const CustomerServiceGlyph({
    required this.icon,
    required this.backgroundColor,
    required this.iconColor,
    this.size = 42,
    this.iconSize = 22,
    this.radius = 14,
    super.key,
  });

  final IconData icon;
  final Color backgroundColor;
  final Color iconColor;
  final double size;
  final double iconSize;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final Duration duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 180);
    return AnimatedContainer(
      duration: duration,
      curve: Curves.easeOut,
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Icon(icon, color: iconColor, size: iconSize),
    );
  }
}

class CustomerCampaignFrame extends StatelessWidget {
  const CustomerCampaignFrame({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.all(Radius.circular(22)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[Color(0xFF087F68), Color(0xFF06604F)],
        ),
      ),
      foregroundDecoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: CustomerDashboardPalette.border),
      ),
      child: child,
    );
  }
}
