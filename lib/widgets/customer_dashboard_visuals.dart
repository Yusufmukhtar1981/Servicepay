import 'package:flutter/material.dart';

/// Customer-home colors are intentionally scoped here so staff dashboards keep
/// the palette defined by the shared application theme.
abstract final class CustomerDashboardPalette {
  static const navy = Color(0xFF062F24);
  /// Turquoise highlight for Customer Dashboard icons and key accents.
  static const royalBlue = serviceCyan;
  /// Unified Customer Home icon and active-navigation identity.
  static const serviceCyan = Color(0xFF22D3EE);
  /// Opaque, softly turquoise-tinted well on the dark green service cards.
  static const serviceIconWell = Color(0xFF105443);
  static const teal = Color(0xFF078553);
  static const canvas = Color(0xFF062F24);
  static const card = Color(0xFF083B2B);
  static const serviceCard = Color(0xFF0B3026);
  static const success = Color(0xFF5BE3A9);
  static const warning = Color(0xFFFFC56B);
  static const error = Color(0xFFFF9A8B);
  static const muted = softText;
  static const border = Color(0xFF16845F);
  static const paleBlue = Color(0xFF0A3529);
  static const text = Color(0xFFFFFFFF);
  static const softText = Color(0xFFB8D8CC);
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

/// The nine Home shortcuts share the approved turquoise identity.
abstract final class CustomerServiceColors {
  static const Map<String, Color> byTitle = <String, Color>{
    'Data': CustomerDashboardPalette.serviceCyan,
    'Airtime': CustomerDashboardPalette.serviceCyan,
    'Delivery': CustomerDashboardPalette.serviceCyan,
    'NIN Verification': CustomerDashboardPalette.serviceCyan,
    'Marketplace': CustomerDashboardPalette.serviceCyan,
    'Electricity': CustomerDashboardPalette.serviceCyan,
    'EduPay': CustomerDashboardPalette.serviceCyan,
    'Keke Napep': CustomerDashboardPalette.serviceCyan,
    'Flight Booking': CustomerDashboardPalette.serviceCyan,
  };

  /// Uniform icon colour without changing a service's identity or route.
  static Color iconFor(String title) =>
      byTitle[title] ?? CustomerDashboardPalette.serviceCyan;

  static Color tintFor(String title) => CustomerDashboardPalette.serviceIconWell;
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
