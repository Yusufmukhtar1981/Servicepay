import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/referral_presentation_policy.dart';
import 'package:servicepay_app/services/announcement_service.dart';
import 'package:servicepay_app/widgets/announcement_widgets.dart';

void main() {
  final DateTime now = DateTime.utc(2026, 11, 17);

  Map<String, dynamic> payload({
    dynamic version = 2,
    dynamic enabled = true,
    dynamic activatedAt = '2026-11-16T21:00:56.246Z',
    dynamic registrationBonus = 100,
    dynamic transactionCommission = 1,
  }) =>
      <String, dynamic>{
        'programme': <String, dynamic>{
          'version': version,
          'enabled': enabled,
          'activatedAt': activatedAt,
          'registrationBonus': registrationBonus,
          'transactionCommission': transactionCommission,
        },
      };

  test('requires live v2 policy, activation, and explicit finite rewards', () {
    expect(ReferralPresentationPolicy.parse(payload(), now: now), isNotNull);
    expect(
      ReferralPresentationPolicy.parse(
        payload(version: 1),
        now: now,
      ),
      isNull,
    );
    expect(
      ReferralPresentationPolicy.parse(
        payload(enabled: false),
        now: now,
      ),
      isNull,
    );
    expect(
      ReferralPresentationPolicy.parse(
        payload(activatedAt: '2026-11-18T00:00:00Z'),
        now: now,
      ),
      isNull,
    );
    expect(
      ReferralPresentationPolicy.parse(
        payload(activatedAt: 'not a date'),
        now: now,
      ),
      isNull,
    );
    expect(
      ReferralPresentationPolicy.parse(
        payload(registrationBonus: null),
        now: now,
      ),
      isNull,
    );
    expect(
      ReferralPresentationPolicy.parse(
        payload(transactionCommission: 'NaN'),
        now: now,
      ),
      isNull,
    );
    expect(
      ReferralPresentationPolicy.parse(
        payload(transactionCommission: -0.01),
        now: now,
      ),
      isNull,
    );
  });

  test('uses supplied rewards dynamically without legacy defaults', () {
    final policy = ReferralPresentationPolicy.parse(
      payload(
        registrationBonus: '1250.5',
        transactionCommission: 2.25,
      ),
      now: now,
    );
    expect(policy, isNotNull);
    expect(
      policy!.message,
      'Get ₦1,250.5 for each successful referral and ₦2.25 per eligible transaction.',
    );
    expect(
      ReferralPresentationPolicy.parse(
        <String, dynamic>{
          'programme': <String, dynamic>{
            'version': 2,
            'enabled': true,
            'activatedAt': '2026-11-16T21:00:56.246Z',
          },
        },
        now: now,
      ),
      isNull,
    );
  });

  testWidgets('referral CTA shares carousel and never creates Admin telemetry',
      (tester) async {
    final adminItem = ServicePayAnnouncement.fromJson(<String, dynamic>{
      'id': 'real-admin-announcement-17',
      'title': 'Service update',
      'message': 'A genuine Admin campaign.',
      'displayStyle': 'BANNER',
      'visibility': 'UNTIL_DISMISSED',
    });
    var referralActions = 0;
    final actionIds = <String>[];
    await tester.binding.setSurfaceSize(const Size(390, 850));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 360,
              child: AnnouncementPromotionCarousel(
                announcements: <ServicePayAnnouncement>[adminItem],
                referralPolicy: ReferralPresentationPolicy.parse(
                  payload(),
                  now: now,
                ),
                onDismiss: (_) {},
                onAcknowledge: (_) {},
                onAction: (item) => actionIds.add(item.id),
                onReferralAction: () => referralActions++,
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('referral-promotion-card')), findsOneWidget);
    expect(find.text('Refer & Earn'), findsOneWidget);
    expect(find.text('Get ₦100 for each successful referral and ₦1 per eligible transaction.'),
        findsOneWidget);
    expect(find.byKey(const Key('announcement-promotion-dot-0')), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const Key('referral-promotion-cta')));
    await tester.pump();
    expect(referralActions, 1);
    expect(actionIds, isEmpty);

    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('surface telemetry remains mapped only to real Admin ids',
      (tester) async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      return http.Response('{}', 204);
    });
    final adminItem = ServicePayAnnouncement.fromJson(<String, dynamic>{
      'id': 'admin-campaign-42',
      'title': 'Admin promotion',
      'message': 'Live campaign artwork and copy.',
      'displayStyle': 'BANNER',
      'visibility': 'UNTIL_DISMISSED',
    });
    var referralsOpened = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementSurface(
            announcements: <ServicePayAnnouncement>[adminItem],
            service: AnnouncementService(
              client: client,
              baseUrl: 'https://api.example.test/api',
              token: 'session-token',
            ),
            referralPolicy: ReferralPresentationPolicy.parse(
              payload(),
              now: now,
            ),
            onReferralAction: () => referralsOpened++,
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Refer & Earn'), findsOneWidget);
    expect(paths, contains('/api/announcements/admin-campaign-42/view'));

    await tester.tap(find.byKey(const Key('referral-promotion-cta')));
    await tester.pump();
    expect(referralsOpened, 1);
    expect(paths, <String>['/api/announcements/admin-campaign-42/view']);
    expect(paths.any((path) => path.contains('referral')), isFalse);
    expect(paths.any((path) => path.contains('policy')), isFalse);
  });

  testWidgets('referral promotion adapts across phone, tablet, and text sizes',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final MapEntry<Size, double> layout in <MapEntry<Size, double>>[
      const MapEntry<Size, double>(Size(320, 760), 1),
      const MapEntry<Size, double>(Size(320, 760), 2),
      const MapEntry<Size, double>(Size(430, 900), 1.2),
      const MapEntry<Size, double>(Size(768, 1024), 1.6),
      const MapEntry<Size, double>(Size(1440, 960), 2),
    ]) {
      final Size size = layout.key;
      final double scale = layout.value;
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(
              size: size,
              textScaler: TextScaler.linear(scale),
            ),
            child: Scaffold(
              body: Center(
                child: SizedBox(
                  width: (size.width - 32).clamp(0, 700).toDouble(),
                  child: AnnouncementPromotionCarousel(
                    announcements: const <ServicePayAnnouncement>[],
                    onDismiss: (_) {},
                    onAcknowledge: (_) {},
                    onAction: (_) {},
                    referralPolicy: ReferralPresentationPolicy.parse(
                      payload(),
                      now: now,
                    ),
                    onReferralAction: () {},
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.byKey(const Key('referral-promotion-card')), findsOneWidget);
      expect(find.byKey(const Key('referral-promotion-cta')), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });
}
