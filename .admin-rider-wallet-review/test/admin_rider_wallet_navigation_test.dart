import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_rider_wallet_screen.dart';
import 'package:servicepay_app/admin/admin_rider_withdrawals_screen.dart';
import 'package:servicepay_app/admin/fintech_screen_registry.dart';

void main() {
  test('Rider fintech cards resolve to their production admin screens', () {
    expect(
      fintechScreenForTitle('Rider Wallets'),
      isA<AdminRiderWalletScreen>(),
    );
    expect(
      fintechScreenForTitle('Rider Withdrawals'),
      isA<AdminRiderWithdrawalsScreen>(),
    );
  });

  test('withdrawal reversal is limited to unpaid locked-fund statuses', () {
    expect(riderWithdrawalCanBeReversed('PENDING'), isTrue);
    expect(riderWithdrawalCanBeReversed('APPROVED'), isTrue);
    expect(riderWithdrawalCanBeReversed('PROCESSING'), isTrue);
    for (final String status in <String>[
      'PAID',
      'REJECTED',
      'FAILED',
      'CANCELLED',
      'REVERSED',
    ]) {
      expect(
        riderWithdrawalCanBeReversed(status),
        isFalse,
        reason: '$status must remain terminal',
      );
    }
  });

  testWidgets('Rider Wallet Management exposes targeted rider search',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AdminRiderWalletScreen()),
    );

    expect(find.text('Rider Wallet Management'), findsOneWidget);
    expect(find.byKey(const Key('rider-wallet-search')), findsOneWidget);
    expect(find.text('Search'), findsOneWidget);
  });
}
