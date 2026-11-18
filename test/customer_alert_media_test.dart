import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/services/customer_alert_media.dart';
import 'package:servicepay_app/services/customer_notification_settings.dart';

void main() {
  test('idle media never touches platform playback before opt-in', () async {
    final sound = FakeSound();
    final speech = FakeSpeech();
    final media = CustomerAlertMediaService(sound: sound, speech: speech);
    await media.stopAll();
    expect(sound.playCount, 0);
    expect(sound.stopCount, 0);
    expect(speech.stopCount, 0);
    expect(speech.utterances, isEmpty);
  });

  WalletCreditAlert alert() => WalletCreditAlert(
        id: 'ledger-media',
        amount: 4250.75,
        reference: 'reference-media',
        createdAt: DateTime.utc(2025),
        balance: 9000.75,
        creditBalance: 4250.75,
      );

  test('sound and speech choices operate independently and respect masking',
      () async {
    final sound = FakeSound();
    final speech = FakeSpeech();
    final media = CustomerAlertMediaService(sound: sound, speech: speech);

    await media.playIncomingAlert(
      alert(),
      const CustomerNotificationSettings(soundNotifications: true),
      walletBalanceHidden: false,
    );
    expect(sound.playCount, 1);
    expect(speech.utterances, isEmpty);

    await media.playIncomingAlert(
      alert(),
      const CustomerNotificationSettings(voiceAnnouncements: true),
      walletBalanceHidden: false,
    );
    expect(sound.playCount, 1);
    expect(speech.utterances.single, contains('Naira 4250.75'));

    await media.playIncomingAlert(
      alert(),
      const CustomerNotificationSettings(
        soundNotifications: true,
        voiceAnnouncements: true,
      ),
      walletBalanceHidden: true,
    );
    expect(sound.playCount, 2);
    expect(speech.utterances, hasLength(1));

    await media.playIncomingAlert(
      alert(),
      const CustomerNotificationSettings(),
      walletBalanceHidden: false,
    );
    expect(sound.playCount, 2);
    expect(speech.utterances, hasLength(1));
    await media.dispose();
  });

  test('unsupported English voice and failed local sound report fallbacks',
      () async {
    final sound = FakeSound()..throwOnPlay = true;
    final speech = FakeSpeech()..language = null;
    final media = CustomerAlertMediaService(sound: sound, speech: speech);
    final result = await media.playIncomingAlert(
      alert(),
      const CustomerNotificationSettings(
        soundNotifications: true,
        voiceAnnouncements: true,
      ),
      walletBalanceHidden: false,
    );
    expect(result.soundAvailable, isFalse);
    expect(result.voiceAvailable, isFalse);
    expect(speech.utterances, isEmpty);
    await media.dispose();
  });

  test('stop during queued speech cancels the stale utterance result',
      () async {
    final sound = FakeSound();
    final speech = FakeSpeech()..pendingSpeech = Completer<void>();
    final media = CustomerAlertMediaService(sound: sound, speech: speech);
    final pending = media.playIncomingAlert(
      alert(),
      const CustomerNotificationSettings(voiceAnnouncements: true),
      walletBalanceHidden: false,
    );
    await speech.started.future;
    await media.stopSpeech();
    speech.pendingSpeech!.complete();
    final result = await pending;
    expect(speech.stopCount, 2);
    expect(result.voiceAvailable, isFalse);
    await media.dispose();
  });

  test('test controls are gesture-driven adapter calls', () async {
    final sound = FakeSound();
    final speech = FakeSpeech();
    final media = CustomerAlertMediaService(sound: sound, speech: speech);
    expect(await media.testSound(), isTrue);
    expect(await media.testVoice(), isTrue);
    expect(sound.playCount, 1);
    expect(speech.utterances.single, 'ServicePay voice test.');
    await media.dispose();
  });

  test('hung speech falls back within the injected timeout and later resumes',
      () async {
    final sound = FakeSound();
    final speech = FakeSpeech()..hangSpeak = true;
    final media = CustomerAlertMediaService(
      sound: sound,
      speech: speech,
      pluginTimeout: const Duration(milliseconds: 8),
      speechTimeout: const Duration(milliseconds: 8),
    );
    final settings =
        const CustomerNotificationSettings(voiceAnnouncements: true);

    final first = await media.playIncomingAlert(
      alert(),
      settings,
      walletBalanceHidden: false,
    );
    expect(first.voiceAvailable, isFalse);
    expect(speech.stopCount, greaterThanOrEqualTo(2));

    speech.hangSpeak = false;
    final next = await media.playIncomingAlert(
      alert(),
      settings,
      walletBalanceHidden: false,
    );
    expect(next.voiceAvailable, isTrue);
    expect(speech.utterances, hasLength(2));
    await media.dispose();
  });

  test('hung sound test times out, cancels, and can be retried', () async {
    final sound = FakeSound()..hangPlay = true;
    final media = CustomerAlertMediaService(
      sound: sound,
      speech: FakeSpeech(),
      pluginTimeout: const Duration(milliseconds: 8),
      speechTimeout: const Duration(milliseconds: 8),
    );
    expect(await media.testSound(), isFalse);
    expect(sound.stopCount, 1);
    sound.hangPlay = false;
    expect(await media.testSound(), isTrue);
    await media.dispose();
  });

  test('hung voice discovery and stop calls are bounded', () async {
    final speech = FakeSpeech()..hangAvailability = true;
    final media = CustomerAlertMediaService(
      sound: FakeSound(),
      speech: speech,
      pluginTimeout: const Duration(milliseconds: 8),
      speechTimeout: const Duration(milliseconds: 8),
    );
    expect(await media.testVoice(), isFalse);
    expect(speech.stopCount, 1);

    speech.hangAvailability = false;
    expect(await media.testVoice(), isTrue);
    speech.hangStop = true;
    await media.stopSpeech();
    expect(speech.stopCount, 2);

    speech.hangStop = false;
    expect(await media.testVoice(), isTrue);
    await media.dispose();
  });

  test('voice selection rejects remote and unknown locality metadata', () {
    final selected = selectOfflineEnglishVoice(<Map<String, Object?>>[
      <String, Object?>{
        'name': 'Cloud English',
        'locale': 'en-NG',
        'network_required': true,
      },
      <String, Object?>{'name': 'Unverified English', 'locale': 'en-GB'},
      <String, Object?>{
        'name': 'Local British English',
        'locale': 'en-GB',
        'network_required': false,
      },
      <String, Object?>{
        'name': 'Local Nigerian English',
        'locale': 'en-NG',
        'network_required': '0',
      },
      <String, Object?>{
        'name': 'Local French',
        'locale': 'fr-FR',
        'network_required': false,
      },
      <String, Object?>{
        'name': 'Unknown Nigerian English',
        'locale': 'en-NG',
        'network_required': 'offline',
      },
    ]);
    expect(selected?.name, 'Local Nigerian English');
    expect(selected?.locale, 'en-NG');
    expect(
      selectOfflineEnglishVoice(<Map<String, Object?>>[
        <String, Object?>{
          'name': 'Remote English',
          'locale': 'en-US',
          'network_required': true,
        },
        <String, Object?>{'name': 'Unknown English', 'locale': 'en-GB'},
      ]),
      isNull,
    );
  });
}

class FakeSound implements WalletAlertSoundAdapter {
  int playCount = 0;
  int stopCount = 0;
  bool throwOnPlay = false;
  bool hangPlay = false;
  final Completer<void> _hungPlay = Completer<void>();

  @override
  Future<void> play() async {
    playCount++;
    if (hangPlay) await _hungPlay.future;
    if (throwOnPlay) throw StateError('Audio blocked');
  }

  @override
  Future<void> stop() async => stopCount++;

  @override
  Future<void> dispose() async {}
}

class FakeSpeech implements WalletAlertSpeechAdapter {
  String? language = 'en-GB';
  final List<String> utterances = <String>[];
  int stopCount = 0;
  Completer<void>? pendingSpeech;
  final Completer<void> started = Completer<void>();
  bool hangSpeak = false;
  final Completer<void> _hungSpeak = Completer<void>();
  bool hangStop = false;
  final Completer<void> _hungStop = Completer<void>();

  @override
  Future<String?> availableEnglishLanguage() {
    return hangAvailability ? _hungAvailability.future : Future.value(language);
  }

  bool hangAvailability = false;
  final Completer<String?> _hungAvailability = Completer<String?>();

  @override
  Future<void> speak(String text) async {
    utterances.add(text);
    if (!started.isCompleted) started.complete();
    if (hangSpeak) await _hungSpeak.future;
    await pendingSpeech?.future;
  }

  @override
  Future<void> stop() async {
    stopCount++;
    if (hangStop) await _hungStop.future;
  }

  @override
  Future<void> dispose() async {}
}
