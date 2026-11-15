import 'package:flutter/material.dart';

/// Customer-home colors are intentionally scoped here so staff dashboards keep
/// the palette defined by the shared application theme.
abstract final class CustomerDashboardPalette {
  static const navy = Color(0xFF102B55);
  static const royalBlue = Color(0xFF2878E8);
  static const teal = Color(0xFF12A6A0);
  static const canvas = Color(0xFFF4F7FC);
  static const card = Color(0xFFFFFFFF);
  static const success = Color(0xFF159B70);
  static const warning = Color(0xFFE6A52B);
  static const error = Color(0xFFDC4545);
  static const muted = Color(0xFF64748B);
  static const border = Color(0xFFE2EAF4);
  static const paleBlue = Color(0xFFEAF1FC);
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
      padding: const EdgeInsets.all(1.5),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[
            CustomerDashboardPalette.royalBlue,
            CustomerDashboardPalette.teal,
          ],
        ),
        borderRadius: BorderRadius.circular(22),
      ),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 2),
        decoration: BoxDecoration(
          color: CustomerDashboardPalette.card,
          borderRadius: BorderRadius.circular(20.5),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                const CustomerServiceGlyph(
                  icon: Icons.campaign_rounded,
                  backgroundColor: CustomerDashboardPalette.paleBlue,
                  iconColor: CustomerDashboardPalette.royalBlue,
                  size: 34,
                  iconSize: 19,
                  radius: 11,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'SERVICEPAY UPDATES',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: CustomerDashboardPalette.royalBlue,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0.8,
                            ),
                      ),
                      const SizedBox(height: 2),
                      const Text(
                        'Offers and important notices',
                        style: TextStyle(
                          color: CustomerDashboardPalette.navy,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            child,
          ],
        ),
      ),
    );
  }
}
