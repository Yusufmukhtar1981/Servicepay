import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/customer_notification_settings_screen.dart';
import 'package:servicepay_app/services/customer_alert_media.dart';
import 'package:servicepay_app/services/customer_notification_settings.dart';

void main() {
  testWidgets('settings screen saves an individual preference authoritatively',
      (tester) async {
    var sound = false;
    final api = CustomerNotificationSettingsApi(
      client: MockClient((request) async {
        if (request.method == 'PATCH') {
          final change = jsonDecode(request.body) as Map<String, dynamic>;
          sound = change['soundNotifications'] as bool;
        }
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'settings': <String, dynamic>{
              'dashboardBackground': 'green',
              'soundNotifications': sound,
              'voiceAnnouncements': false,
            },
          }),
          200,
        );
      }),
      readToken: () async => 'customer-session',
    );
    await tester.pumpWidget(MaterialApp(
      home: CustomerNotificationSettingsScreen(api: api),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Make it yours'), findsOneWidget);

    await tester.tap(find.text('Play notification sound'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(sound, isTrue);
    expect(
      tester
          .widget<SwitchListTile>(
            find.ancestor(
              of: find.text('Play notification sound'),
              matching: find.byType(SwitchListTile),
            ),
          )
          .value,
      isTrue,
    );
    api.close();
  });

  testWidgets('settings errors stay visible and offer retry', (tester) async {
    final api = CustomerNotificationSettingsApi(
      client: MockClient((_) async => http.Response('unavailable', 503)),
      readToken: () async => 'customer-session',
    );
    await tester.pumpWidget(MaterialApp(
      home: CustomerNotificationSettingsScreen(api: api),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('could not be loaded'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    api.close();
  });

  testWidgets('settings test buttons invoke user-gesture media adapters',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final sound = ScreenTestSound();
    final speech = ScreenTestSpeech();
    final media = CustomerAlertMediaService(sound: sound, speech: speech);
    final api = CustomerNotificationSettingsApi(
      client: MockClient((_) async => http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'settings': <String, dynamic>{
                'dashboardBackground': 'green',
                'soundNotifications': false,
                'voiceAnnouncements': false,
              },
            }),
            200,
          )),
      readToken: () async => 'customer-session',
    );
    await tester.pumpWidget(MaterialApp(
      home: CustomerNotificationSettingsScreen(api: api, media: media),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Test sound'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));
    await tester.tap(find.text('Test English voice'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));
    expect(sound.plays, 1);
    expect(speech.utterances, <String>['ServicePay voice test.']);
    await media.dispose();
    api.close();
  });
}

class ScreenTestSound implements WalletAlertSoundAdapter {
  int plays = 0;
  @override
  Future<void> play() async => plays++;
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

class ScreenTestSpeech implements WalletAlertSpeechAdapter {
  final List<String> utterances = <String>[];
  @override
  Future<String?> availableEnglishLanguage() async => 'en-GB';
  @override
  Future<void> speak(String text) async => utterances.add(text);
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}
