import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/services/customer_notification_settings.dart';
import 'package:servicepay_app/widgets/customer_wallet_credit_notice.dart';

void main() {
  testWidgets(
      'masked wallet notice keeps the amount out of visual and spoken text',
      (tester) async {
    final alert = WalletCreditAlert(
      id: 'ledger-private',
      amount: 8472.25,
      reference: 'private-reference',
      createdAt: DateTime.utc(2025, 2, 1),
      balance: 10000,
      creditBalance: 8472.25,
    );
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: CustomerWalletCreditNotice(
          alert: alert,
          hideAmount: true,
          onDismiss: () {},
        ),
      ),
    ));
    expect(find.text('Money received'), findsOneWidget);
    expect(find.text('A credit was added to your wallet'), findsOneWidget);
    expect(find.textContaining('8472.25'), findsNothing);
    final semantics =
        tester.getSemantics(find.byType(CustomerWalletCreditNotice));
    expect(semantics.label, contains('A credit was added'));
    expect(semantics.label, isNot(contains('8472.25')));
  });

  testWidgets('visible wallet notice has a dismiss action', (tester) async {
    var dismissed = false;
    final alert = WalletCreditAlert(
      id: 'ledger-public',
      amount: 1700,
      reference: 'public-reference',
      createdAt: DateTime.utc(2025, 2, 1),
      balance: 3000,
      creditBalance: 1700,
    );
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: CustomerWalletCreditNotice(
          alert: alert,
          onDismiss: () => dismissed = true,
        ),
      ),
    ));
    expect(find.text('₦1700.00 added to your wallet'), findsOneWidget);
    await tester.tap(find.byTooltip('Dismiss money received notice'));
    expect(dismissed, isTrue);
  });
}
