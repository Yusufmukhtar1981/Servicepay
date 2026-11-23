import 'package:flutter/material.dart';
import '../servicepay_theme.dart';

/// Customer-home colors are intentionally scoped here so staff dashboards keep
/// the palette defined by the shared application theme.
abstract final class CustomerDashboardPalette {
  static const navy = Color(0xFF062A22);
  /// Bright emerald highlight for icons and key accents.
  static const royalBlue = Color(0xFF35E6A8);
  static const teal = Color(0xFF078553);
  static const canvas = Color(0xFF062A22);
  static const card = Color(0xFF104638);
  static const success = Color(0xFF5BE3A9);
  static const warning = Color(0xFFFFC56B);
  static const error = Color(0xFFFF9A8B);
  static const muted = Color(0xFF8FC8B6);
  static const border = ServicePayColors.border;
  static const paleBlue = Color(0xFF0B382D);
  static const text = Color(0xFFFFFFFF);
  static const softText = Color(0xFFBCEFE0);
  static const walletStart = Color(0xFF078553);
  static const walletEnd = Color(0xFF086447);
  /// White foreground for both wallet gradient endpoints (>= 4.5:1).
  static const onWallet = Color(0xFFFFFFFF);
  /// Darker inset fill for secondary wallet actions; carries white text.
  static const walletInset = Color(0xFF0B382D);

  /// ServicePay bright green for active segmented selections.
  static const activeGreen = Color(0xFF20D69A);
  /// Muted green fill for inactive segmented selections.
  static const inactiveGreen = Color(0xFF0B382D);

  /// Shared semantic series colours. Metric cards, chart bars and chart
  /// legends all read from these so a legend always matches its series.
  static const seriesBlue = Color(0xFF60A5FA);
  static const seriesEmerald = Color(0xFF34D399);
  static const seriesCoral = Color(0xFFFB7185);
  static const seriesAmber = Color(0xFFFBBF24);
}

/// Exact per-service icon colours for the nine Home shortcuts.
abstract final class CustomerServiceColors {
  static const Map<String, Color> byTitle = <String, Color>{
    'Data': Color(0xFF38BDF8),
    'Airtime': Color(0xFF34D399),
    'Delivery': Color(0xFFFB923C),
    'NIN Verification': Color(0xFFA78BFA),
    'Marketplace': Color(0xFFFBBF24),
    'Electricity': Color(0xFFFDE047),
    'EduPay': Color(0xFF818CF8),
    'Keke Napep': Color(0xFFFB7185),
    'Flight Booking': Color(0xFF60A5FA),
  };

  /// Icon colour for [title]; unknown services keep the emerald accent.
  static Color iconFor(String title) =>
      byTitle[title] ?? CustomerDashboardPalette.royalBlue;

  /// Solid dark icon well keeps every approved service colour clearly visible.
  static Color tintFor(String title) => CustomerDashboardPalette.paleBlue;
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
          colors: <Color>[
            CustomerDashboardPalette.paleBlue,
            CustomerDashboardPalette.card,
          ],
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
