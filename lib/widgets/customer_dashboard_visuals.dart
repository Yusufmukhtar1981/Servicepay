import 'package:flutter/material.dart';

/// Customer-home colors are intentionally scoped here so staff dashboards keep
/// the palette defined by the shared application theme.
abstract final class CustomerDashboardPalette {
  static const navy = Color(0xFF06271D);
  static const royalBlue = Color(0xFF36E875);
  static const teal = Color(0xFF16894B);
  static const canvas = Color(0xFF031D16);
  static const card = Color(0xFF082D21);
  static const success = Color(0xFF36E875);
  static const warning = Color(0xFFE6A52B);
  static const error = Color(0xFFDC4545);
  static const muted = Color(0xFFA4C2B0);
  static const border = Color(0xFF174735);
  static const paleBlue = Color(0xFF10412C);
  static const text = Color(0xFFF3FFF6);
  static const softText = Color(0xFFC2DCCD);
  static const walletStart = Color(0xFF08D95B);
  static const walletEnd = Color(0xFF087D3B);
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
          colors: <Color>[Color(0xFF0B3928), Color(0xFF06271D)],
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
