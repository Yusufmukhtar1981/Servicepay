import 'package:flutter/material.dart';
import '../servicepay_theme.dart';

/// Customer-home colors are intentionally scoped here so staff dashboards keep
/// the palette defined by the shared application theme.
abstract final class CustomerDashboardPalette {
  static const navy = Color(0xFF071F1B);
  /// Emerald highlight (#36C99A) for icons and key accents only.
  static const royalBlue = Color(0xFF36C99A);
  static const teal = Color(0xFF087F68);
  static const canvas = Color(0xFF071F1B);
  static const card = Color(0xFF103D34);
  static const success = Color(0xFF5BE3A9);
  static const warning = Color(0xFFFFC56B);
  static const error = Color(0xFFFF9A8B);
  static const muted = Color(0xFFB8D0C8);
  static const border = ServicePayColors.border;
  static const paleBlue = Color(0xFF16483D);
  static const text = Color(0xFFFFFFFF);
  static const softText = Color(0xFFB8D0C8);
  static const walletStart = Color(0xFF087F68);
  static const walletEnd = Color(0xFF0A6655);
  /// White foreground for the dark luxurious wallet gradient (>= 5:1).
  static const onWallet = Color(0xFFFFFFFF);
  /// Darker inset fill for secondary wallet actions; carries white text.
  static const walletInset = Color(0xFF0A4A3F);
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
          colors: <Color>[Color(0xFF16483D), Color(0xFF103D34)],
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
