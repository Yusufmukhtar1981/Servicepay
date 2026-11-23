import 'package:flutter/material.dart';

import '../servicepay_theme.dart';
import 'business_network_api.dart';

/// Read-only policy display. This does not accept payments or authorize credits.
class MerchantFundingNotice extends StatefulWidget {
  const MerchantFundingNotice({super.key, this.api});
  final BusinessNetworkApi? api;

  @override
  State<MerchantFundingNotice> createState() => _MerchantFundingNoticeState();
}

class _MerchantFundingNoticeState extends State<MerchantFundingNotice> {
  late final BusinessNetworkApi _api = widget.api ?? BusinessNetworkApi();
  late final Future<dynamic> _policy = _api.get('funding-policy');

  @override
  void dispose() {
    if (widget.api == null) _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<dynamic>(
        future: _policy,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const SizedBox.shrink();
          }
          final data = snapshot.data;
          if (!snapshot.hasError && data is Map &&
              data['category'] != 'MERCHANT') {
            return const SizedBox.shrink();
          }
          final minimum = data is Map ? data['minimumKobo'] : null;
          final valid = !snapshot.hasError && minimum is num &&
              minimum.isFinite && minimum >= 10000 &&
              minimum == minimum.roundToDouble();
          final message = valid
              ? 'Merchant minimum: ₦${(minimum / 100).toStringAsFixed(2)} per new funding request. '
                  'This is not a minimum wallet balance. Verified incoming transfers retain existing credit protection.'
              : 'Funding policy could not be confirmed. ServicePay checks the current minimum before initiating a funding request.';
          return Container(
            width: double.infinity,
            margin: const EdgeInsets.only(top: 14),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: ServicePayColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: ServicePayColors.accent),
            ),
            child: Text(message, style: const TextStyle(
              color: ServicePayColors.ink, fontSize: 14,
              fontWeight: FontWeight.w600, height: 1.45,
            )),
          );
        },
      );
}
