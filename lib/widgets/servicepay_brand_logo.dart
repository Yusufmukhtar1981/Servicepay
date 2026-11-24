import 'package:flutter/material.dart';

/// The existing official ServicePay app mark. Use the bundled asset on every
/// platform so the same image is available offline and in captured receipts.
class ServicePayBrandLogo extends StatelessWidget {
  const ServicePayBrandLogo({
    super.key,
    required this.size,
    this.decorative = false,
  });

  static const String asset = 'assets/image/servicepay_dashboard_mark.png';
  static const AssetImage image = AssetImage(asset);
  final double size;
  final bool decorative;

  @override
  Widget build(BuildContext context) {
    return Image(
      image: image,
      width: size,
      height: size,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
      gaplessPlayback: true,
      semanticLabel: 'ServicePay logo',
      excludeFromSemantics: decorative,
    );
  }
}
