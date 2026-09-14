import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/announcement_service.dart';
import 'package:servicepay_app/services/reward_progress_service.dart';
import 'package:servicepay_app/widgets/announcement_widgets.dart';

void main() {
  ServicePayAnnouncement announcement() => ServicePayAnnouncement(
        id: 'promo-1',
        title: 'Smartphone reward',
        message: 'Complete the campaign requirements.',
        type: 'PROMOTION',
        displayStyle: 'BOTH',
        priority: 1,
        visibility: 'always',
        mandatory: false,
        campaignTrackingEnabled: true,
        rewardDescription: 'Smart Android Phone',
      );

  testWidgets('renders capped server progress and honest qualification state',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RewardProgressCard(
            announcement: announcement(),
            progress: const RewardProgress(
              transactionCount: 120,
              requiredTransactionCount: 100,
              transactionValue: 500000,
              requiredTransactionValue: 250000,
              qualified: true,
            ),
          ),
        ),
      ),
    );

    expect(find.text('Smartphone Reward Progress'), findsOneWidget);
    expect(find.text('Smart Android Phone'), findsOneWidget);
    expect(find.text('120 / 100'), findsOneWidget);
    expect(find.text('₦500,000.00 / ₦250,000.00'), findsOneWidget);
    expect(find.text('QUALIFIED'), findsOneWidget);
    expect(find.textContaining('winner'), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('renders loading and API error states without hiding card',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: <Widget>[
              RewardProgressCard(
                announcement: announcement(),
                loading: true,
              ),
              RewardProgressCard(
                announcement: announcement(),
                error: 'Reward progress is currently unavailable.',
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Loading your reward progress…'), findsOneWidget);
    expect(
        find.text('Reward progress is currently unavailable.'), findsOneWidget);
    expect(find.text('Smartphone Reward Progress'), findsNWidgets(2));
  });

  testWidgets('BOTH popup dismissal retains its banner and progress card',
      (tester) async {
    final List<String> paths = <String>[];
    final MockClient client = MockClient((request) async {
      paths.add(request.url.path);
      if (request.url.path.endsWith('/progress')) {
        return http.Response(
          '{"data":{"count":1,"value":1000,"qualified":false,'
          '"requirements":{"qualifyingTransactionCount":2,'
          '"qualifyingTransactionValue":2000}}}',
          200,
        );
      }
      return http.Response('{}', 204);
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementSurface(
            announcements: <ServicePayAnnouncement>[announcement()],
            service: AnnouncementService(
              client: client,
              baseUrl: 'https://example.test/api',
              token: 'token',
            ),
            rewardProgressService: RewardProgressService(
              client: client,
              baseUrl: 'https://example.test/api',
              token: 'token',
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.text('Got it'));
    await tester.pump();
    await tester.pump();

    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('Smartphone reward'), findsOneWidget);
    expect(find.byType(RewardProgressCard), findsOneWidget);
    expect(paths, isNot(contains('/api/announcements/promo-1/dismiss')));
  });
}