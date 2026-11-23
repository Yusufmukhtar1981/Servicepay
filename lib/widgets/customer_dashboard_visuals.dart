import 'package:flutter/material.dart';

/// Customer-home colors are intentionally scoped here so staff dashboards keep
/// the palette defined by the shared application theme.
abstract final class CustomerDashboardPalette {
  // Exact premium base colours from the approved brief.
  static const canvas = Color(0xFF061F1A);
  static const header = Color(0xFF0A3028);
  static const section = Color(0xFF092B23);
  static const serviceCard = Color(0xFF0B3329);
  static const accountCard = Color(0xFF0C382E);
  static const border = Color(0xFF1C6552);
  static const primaryAccent = Color(0xFF28DDB5);
  static const serviceCyan = Color(0xFF22D3EE);
  static const text = Color(0xFFF5FFFB);
  static const softText = Color(0xFFA9C8BE);
  static const walletStart = Color(0xFF00B894);
  static const walletEnd = Color(0xFF087F68);

  /// Legacy aliases kept so other customer surfaces keep compiling.
  static const navy = canvas;
  static const royalBlue = serviceCyan;
  static const teal = primaryAccent;
  static const card = section;
  static const muted = softText;
  /// Raised inset fill (icon wells, selected nav pill) derived from the border.
  static const paleBlue = Color(0xFF0F4134);
  /// Hairline divider between compact rows.
  static const divider = Color(0x331C6552);
  static const success = Color(0xFF5BE3A9);
  static const warning = Color(0xFFFFC56B);
  static const error = Color(0xFFFF9A8B);

  /// Wallet text. The bright gradient is paired with a forest scrim layer and
  /// heavier weights so small labels never sit on the raw #00B894 stop.
  static const onWallet = text;
  static const walletScrim = Color(0x99061F1A);
  static const walletInset = Color(0x66061F1A);
  static const walletAction = text;
  static const nav = header;

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

/// Restore the original individual service identities from the phone reference.
abstract final class CustomerServiceColors {
  static const Map<String, Color> byTitle = <String, Color>{
    'Data': Color(0xFF38BDF8),
    'Airtime': Color(0xFF2DD4BF),
    'Delivery': Color(0xFFFB923C),
    'NIN Verification': Color(0xFFA78BFA),
    'Marketplace': Color(0xFFFBBF24),
    'Electricity': Color(0xFFFDE047),
    'EduPay': Color(0xFF818CF8),
    'Keke Napep': Color(0xFFFB7185),
    'Flight Booking': Color(0xFF60A5FA),
  };

  /// Colours do not change service identity, availability or navigation.
  static Color iconFor(String title) =>
      byTitle[title] ?? CustomerDashboardPalette.serviceCyan;

  static Color tintFor(String title) => Color.alphaBlend(
        iconFor(title).withValues(alpha: .15),
        CustomerDashboardPalette.serviceCard,
      );
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
