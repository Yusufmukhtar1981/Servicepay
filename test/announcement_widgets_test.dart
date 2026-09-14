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
    String message = 'Your account remains protected.',
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
        message: message,
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

  testWidgets('BOTH popup dismissal keeps its banner visible', (tester) async {
    final paths = <String>[];
    final completed = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
              id: 'both-promo',
              title: 'Smartphone reward promo',
              style: 'BOTH',
            ),
          ],
          service: AnnouncementService(
            client: MockClient((request) async {
              paths.add(request.url.path);
              return http.Response('{}', 204);
            }),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
          onPopupCompleted: (value) => completed.add(value.id),
        ),
      ),
    ));
    await tester.pump();

    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.text('Got it'));
    await tester.pump();
    await tester.pump();

    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('Smartphone reward promo'), findsOneWidget);
    expect(completed, <String>['both-promo']);
    expect(paths, isNot(contains('/api/announcements/both-promo/dismiss')));
  });

  testWidgets('BOTH popup acknowledgment keeps its banner visible',
      (tester) async {
    final paths = <String>[];
    final completed = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
              id: 'mandatory-both',
              title: 'Required account update',
              style: 'BOTH',
              visibility: 'MANDATORY',
              mandatory: true,
            ),
          ],
          service: AnnouncementService(
            client: MockClient((request) async {
              paths.add(request.url.path);
              return http.Response('{}', 204);
            }),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
          onPopupCompleted: (value) => completed.add(value.id),
        ),
      ),
    ));
    await tester.pump();

    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.text('Acknowledge').last);
    await tester.pump();
    await tester.pump();

    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('Required account update'), findsOneWidget);
    expect(completed, <String>['mandatory-both']);
    expect(
      paths,
      contains('/api/announcements/mandatory-both/acknowledge'),
    );
  });

  testWidgets('explicit banner dismissal is reported to the parent',
      (tester) async {
    final removed = <String>[];
    final paths = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AnnouncementSurface(
          announcements: [
            item(
              id: 'every-login-banner',
              style: 'BANNER',
              visibility: 'EVERY_LOGIN',
            ),
          ],
          service: AnnouncementService(
            client: MockClient((request) async {
              paths.add(request.url.path);
              return http.Response('{}', 204);
            }),
            baseUrl: 'https://example.test/api',
            token: 'token',
          ),
          onBannerRemoved: (value) => removed.add(value.id),
        ),
      ),
    ));

    await tester.tap(find.byTooltip('Dismiss announcement'));
    await tester.pump();

    expect(removed, <String>['every-login-banner']);
    expect(
      paths,
      contains('/api/announcements/every-login-banner/dismiss'),
    );
    expect(find.text('Service update'), findsNothing);
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

  testWidgets(
      'promotion carousel orders priority, shows indicators, and swipes',
      (tester) async {
    final ServicePayAnnouncement low = item(
      id: 'low',
      title: 'Lower promotion',
      priority: 2,
    );
    final ServicePayAnnouncement high = item(
      id: 'high',
      title: 'Smartphone reward',
      priority: 8,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementPromotionCarousel(
            announcements: <ServicePayAnnouncement>[high, low],
            onDismiss: (_) {},
            onAcknowledge: (_) {},
            onAction: (_) {},
          ),
        ),
      ),
    );

    expect(find.text('Smartphone reward'), findsOneWidget);
    expect(find.bySemanticsLabel('ServicePay promotions'), findsOneWidget);
    expect(find.byType(AnimatedContainer), findsNWidgets(2));

    await tester.fling(find.byType(PageView), const Offset(-700, 0), 1200);
    await tester.pumpAndSettle();
    expect(find.text('Lower promotion'), findsOneWidget);
  });

  testWidgets('promotion carousel is compact and uses branded no-image artwork',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementPromotionCarousel(
            announcements: <ServicePayAnnouncement>[
              item(title: 'SERVICEPAY SMARTPHONE REWARD PROMO'),
            ],
            onDismiss: (_) {},
            onAcknowledge: (_) {},
            onAction: (_) {},
          ),
        ),
      ),
    );

    expect(find.byIcon(Icons.account_balance_wallet_rounded), findsOneWidget);
    final Size size = tester.getSize(find.byType(PageView));
    expect(size.height, lessThan(230));
  });

  testWidgets('POPUP-only announcements never create a promotion carousel',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementSurface(
            announcements: <ServicePayAnnouncement>[
              item(id: 'popup-only', style: 'POPUP'),
            ],
            service: AnnouncementService(
              client: MockClient((_) async => http.Response('{}', 204)),
              baseUrl: 'https://example.test/api',
              token: 'token',
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(AnnouncementPromotionCarousel), findsNothing);
    expect(find.byType(AlertDialog), findsOneWidget);
  });

  testWidgets('empty eligible set renders no promotion section or space',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementSurface(
            announcements: <ServicePayAnnouncement>[
              item(id: 'hidden', style: 'BANNER', acknowledged: true),
            ],
            service: AnnouncementService(
              client: MockClient((_) async => http.Response('{}', 204)),
              baseUrl: 'https://example.test/api',
              token: 'token',
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(AnnouncementPromotionCarousel), findsNothing);
    expect(find.text('Service update'), findsNothing);
  });

  testWidgets('CTA is forwarded to the carousel callback', (tester) async {
    ServicePayAnnouncement? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementPromotionCarousel(
            announcements: <ServicePayAnnouncement>[
              item(cta: <String, dynamic>{'text': 'Review'}),
            ],
            onDismiss: (_) {},
            onAcknowledge: (_) {},
            onAction: (value) => selected = value,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Review'));
    expect(selected?.id, 'a');
  });

  testWidgets('320px promotion card with CTA has no vertical overflow',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 320,
            child: AnnouncementPromotionCarousel(
              announcements: <ServicePayAnnouncement>[
                item(
                  title: 'A promotion with a longer title',
                  cta: <String, dynamic>{'text': 'Review offer'},
                ),
              ],
              onDismiss: (_) {},
              onAcknowledge: (_) {},
              onAction: (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.text('Review offer'), findsOneWidget);
    expect(tester.getSize(find.byType(PageView)).height, 194);
  });

  testWidgets(
      '320px card reflows safely at 200 percent with long content and actions',
      (tester) async {
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(
          textScaler: TextScaler.linear(2),
        ),
        child: MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 320,
              child: AnnouncementPromotionCarousel(
                announcements: <ServicePayAnnouncement>[
                  item(
                    title:
                        'A very long smartphone reward title that must reflow',
                    message:
                        'This longer promotion message explains the offer and needs to remain readable at a larger text size.',
                    mandatory: true,
                    cta: <String, dynamic>{'text': 'Review this offer'},
                  ),
                ],
                onDismiss: (_) {},
                onAcknowledge: (_) {},
                onAction: (_) {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.text('Review this offer'), findsOneWidget);
    expect(find.text('Acknowledge'), findsOneWidget);
    expect(tester.getSize(find.byType(PageView)).height, greaterThan(194));
  });

  testWidgets(
      'larger phone and constrained web cards adapt at 200 percent text',
      (tester) async {
    for (final double width in <double>[412, 600]) {
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(
            textScaler: TextScaler.linear(2),
          ),
          child: MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: width,
                child: AnnouncementPromotionCarousel(
                  announcements: <ServicePayAnnouncement>[
                    item(
                      title:
                          'A very long smartphone reward title that must reflow',
                      message:
                          'This longer promotion message explains the offer and needs to remain readable at a larger text size.',
                      mandatory: true,
                      cta: <String, dynamic>{'text': 'Review this offer'},
                    ),
                  ],
                  onDismiss: (_) {},
                  onAcknowledge: (_) {},
                  onAction: (_) {},
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(tester.takeException(), isNull, reason: 'viewport width $width');
      expect(find.text('Review this offer'), findsOneWidget);
      expect(find.text('Acknowledge'), findsOneWidget);
      expect(tester.getSize(find.byType(PageView)).height, greaterThan(194));
    }
  });

  testWidgets('pause and resume controls stop and restart auto-rotation',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementPromotionCarousel(
            announcements: <ServicePayAnnouncement>[
              item(id: 'one', title: 'First promotion'),
              item(id: 'two', title: 'Second promotion'),
            ],
            onDismiss: (_) {},
            onAcknowledge: (_) {},
            onAction: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.byTooltip('Pause promotions'), findsOneWidget);

    await tester.tap(find.byTooltip('Pause promotions'));
    await tester.pump();
    expect(find.byTooltip('Resume promotions'), findsOneWidget);
    await tester.pump(const Duration(seconds: 7));
    expect(find.text('First promotion'), findsOneWidget);

    await tester.tap(find.byTooltip('Resume promotions'));
    await tester.pump();
    expect(find.byTooltip('Pause promotions'), findsOneWidget);
  });

  testWidgets('carousel exposes the current promotion position semantics',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementPromotionCarousel(
            announcements: <ServicePayAnnouncement>[
              item(id: 'one', title: 'First promotion'),
              item(id: 'two', title: 'Second promotion'),
            ],
            onDismiss: (_) {},
            onAcknowledge: (_) {},
            onAction: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.bySemanticsLabel('Promotion 1 of 2'), findsOneWidget);
    expect(
        find.bySemanticsLabel('Pause promotion auto-rotation'), findsOneWidget);
  });
}
