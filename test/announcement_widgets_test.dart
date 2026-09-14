import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/announcement_service.dart';
import 'package:servicepay_app/widgets/announcement_widgets.dart';

void main() {
  ServicePayAnnouncement item({
    String id = 'a',
    String title = 'Service update',
    String style = 'BANNER',
    String visibility = 'UNTIL_DISMISSED',
    bool acknowledged = false,
    bool mandatory = false,
    Map<String, dynamic>? cta,
    int priority = 3,
    DateTime? createdAt,
  }) =>
      ServicePayAnnouncement(
        id: id,
        title: title,
        message: 'Your account remains protected.',
        type: 'INFO',
        displayStyle: style,
        priority: priority,
        visibility: visibility,
        mandatory: mandatory,
        acknowledged: acknowledged,
        cta: cta,
        createdAt: createdAt,
      );

  testWidgets('renders announcement banner and supports dismissal',
      (tester) async {
    final client = MockClient((request) async {
      expect(
          request.url.path,
          anyOf(
            '/api/announcements/a/view',
            '/api/announcements/a/dismiss',
          ));
      return http.Response('{}', 204);
    });
    final item = ServicePayAnnouncement.fromJson({
      'id': 'a',
      'title': 'Service update',
      'message': 'Your account remains protected.',
      'displayStyle': 'BANNER',
      'visibility': 'untilDismissed',
    });
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [item],
          service: AnnouncementService(
            client: client,
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    expect(find.text('Service update'), findsOneWidget);
    expect(find.text('Your account remains protected.'), findsOneWidget);
    await tester.tap(find.byTooltip('Dismiss announcement'));
    await tester.pump();
    expect(find.text('Service update'), findsNothing);
  });

  testWidgets(
      'automatically presents the highest-priority popup and records view',
      (tester) async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      return http.Response('{}', 204);
    });
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(id: 'low', style: 'POPUP', priority: 1),
            item(id: 'high', style: 'POPUP', priority: 9),
          ],
          service: AnnouncementService(
            client: client,
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    await tester.pump();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(find.text('Service update'), findsOneWidget);
    expect(paths, contains('/api/announcements/high/view'));
  });

  testWidgets(
      'mandatory popup cannot close from barrier and requires acknowledgment',
      (tester) async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      return http.Response('{}', 204);
    });
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
              style: 'POPUP',
              visibility: 'MANDATORY',
              mandatory: true,
            ),
          ],
          service: AnnouncementService(
            client: client,
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    await tester.pump();
    await tester.tapAt(const Offset(5, 5));
    await tester.pump();
    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.text('Acknowledge'));
    await tester.pump();
    expect(find.byType(AlertDialog), findsNothing);
    expect(paths, contains('/api/announcements/a/acknowledge'));
  });

  testWidgets(
      'mandatory popup remains open when acknowledgment is not recorded',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
              style: 'POPUP',
              visibility: 'MANDATORY',
              mandatory: true,
            ),
          ],
          service: AnnouncementService(
            client: MockClient((request) async {
              if (request.url.path.endsWith('/acknowledge')) {
                return http.Response('{"success":false}', 409);
              }
              return http.Response('{}', 204);
            }),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    await tester.pump();
    await tester.tap(find.text('Acknowledge'));
    await tester.pump();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(
      find.text('Acknowledgment could not be recorded. Please try again.'),
      findsOneWidget,
    );
  });

  testWidgets('popup displays ServicePay branding and publication date',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
              style: 'POPUP',
              createdAt: DateTime.utc(2026, 9, 14, 12),
            ),
          ],
          service: AnnouncementService(
            client: MockClient((_) async => http.Response('{}', 204)),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('ServicePay'), findsOneWidget);
    expect(find.byIcon(Icons.shield_rounded), findsOneWidget);
    expect(find.text('Published 14 Sep 2026'), findsOneWidget);
  });

  testWidgets('already acknowledged once-only announcement stays hidden',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
              style: 'BOTH',
              visibility: 'ONCE',
              acknowledged: true,
            ),
          ],
          service: AnnouncementService(
            client: MockClient((_) async => http.Response('{}', 204)),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    expect(find.text('Service update'), findsNothing);
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('mandatory banner has acknowledgment and no dismiss control',
      (tester) async {
    final paths = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(style: 'BANNER', visibility: 'MANDATORY', mandatory: true),
          ],
          service: AnnouncementService(
            client: MockClient((request) async {
              paths.add(request.url.path);
              return http.Response('{}', 204);
            }),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('Acknowledge'), findsOneWidget);
    expect(find.byTooltip('Dismiss announcement'), findsNothing);
    await tester.tap(find.text('Acknowledge'));
    await tester.pump();
    expect(find.text('Service update'), findsNothing);
    expect(paths, contains('/api/announcements/a/acknowledge'));
  });

  testWidgets('popup queue advances in priority order', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
                id: 'low',
                title: 'Lower priority',
                style: 'POPUP',
                priority: 2),
            item(
                id: 'high',
                title: 'Higher priority',
                style: 'POPUP',
                priority: 8),
          ],
          service: AnnouncementService(
            client: MockClient((_) async => http.Response('{}', 204)),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('Higher priority'), findsOneWidget);
    await tester.tap(find.text('Got it'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Lower priority'), findsOneWidget);
    expect(find.text('Higher priority'), findsNothing);
  });

  testWidgets('CTA records click and rejects unsafe in-app action',
      (tester) async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      return http.Response('{}', 204);
    });
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
              cta: {'text': 'Review', 'action': 'servicepay://unknown'},
            ),
          ],
          service: AnnouncementService(
            client: client,
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Review'));
    await tester.pump();
    expect(paths, contains('/api/announcements/a/click'));
    expect(
        find.text('This announcement action is unavailable.'), findsOneWidget);
  });

  testWidgets('interaction API failure leaves the dashboard surface usable',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [item()],
          service: AnnouncementService(
            client: MockClient((_) async {
              throw http.ClientException('offline');
            }),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('Service update'), findsOneWidget);
  });
}
