import 'package:flutter/material.dart';

import 'wallet_screen.dart';

/// Compatibility destination for older cached customer builds.
///
/// Customer manual funding has been retired from customer navigation. Any
/// legacy route now resolves safely to the Wallet instead of exposing the old
/// request form.
class ManualFundingScreen extends StatelessWidget {
  const ManualFundingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const WalletScreen();
  }
}
