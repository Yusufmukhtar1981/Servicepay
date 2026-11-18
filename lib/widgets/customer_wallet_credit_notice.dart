import 'package:flutter/material.dart';

import '../services/customer_notification_settings.dart';
import 'customer_dashboard_visuals.dart';

class CustomerWalletCreditNotice extends StatelessWidget {
  const CustomerWalletCreditNotice({
    required this.alert,
    required this.onDismiss,
    this.hideAmount = false,
    super.key,
  });

  final WalletCreditAlert alert;
  final VoidCallback onDismiss;
  final bool hideAmount;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final amount = alert.amount.toStringAsFixed(2);
    final amountText = hideAmount
        ? 'A credit was added to your wallet'
        : '₦$amount added to your wallet';
    return Semantics(
      liveRegion: true,
      label: hideAmount
          ? 'Money received. A credit was added to your wallet.'
          : 'Money received. Nigerian naira $amount.',
      child: TweenAnimationBuilder<Offset>(
        tween: Tween<Offset>(
          begin: reduceMotion ? Offset.zero : const Offset(0, -0.18),
          end: Offset.zero,
        ),
        duration:
            reduceMotion ? Duration.zero : const Duration(milliseconds: 360),
        curve: Curves.easeOutCubic,
        builder: (context, offset, child) => FractionalTranslation(
          translation: offset,
          child: child,
        ),
        child: Material(
          elevation: 8,
          color: CustomerDashboardPalette.card,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: CustomerDashboardPalette.success),
            ),
            child: Row(
              children: <Widget>[
                const Icon(Icons.south_west_rounded,
                    color: CustomerDashboardPalette.success, size: 25),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Text('Money received',
                          style: TextStyle(
                            color: CustomerDashboardPalette.text,
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                          )),
                      const SizedBox(height: 3),
                      Text(amountText,
                          style: const TextStyle(
                            color: CustomerDashboardPalette.softText,
                            fontSize: 13,
                          )),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Dismiss money received notice',
                  onPressed: onDismiss,
                  icon: const Icon(Icons.close_rounded,
                      color: CustomerDashboardPalette.muted),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
