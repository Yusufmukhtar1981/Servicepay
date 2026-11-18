import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:servicepay_app/services/customer_alert_media.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => debugDefaultTargetPlatformOverride = TargetPlatform.android);
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  for (final stage in ['discovery', 'selection']) {
    for (final cancel in ['stop', 'dispose']) {
      test('$cancel during speech $stage never announces the amount', () async {
        final engine = DelayedTts();
        final adapter = FlutterTtsWalletAlertSpeech(tts: engine);
        expect(await adapter.availableEnglishLanguage(), 'en-GB');
        engine.delayStage = stage;
        final pending = adapter.speak('Money received. Naira 4250.75');
        await engine.preparing.future;
        if (cancel == 'stop') {
          await adapter.stop();
        } else {
          await adapter.dispose();
        }
        engine.resumePreparation.complete();
        await pending;
        expect(engine.spoken, isEmpty);
      });
    }
  }

  test('stop during initial voice discovery prevents selection', () async {
    final engine = DelayedTts()..delayStage = 'discovery';
    final adapter = FlutterTtsWalletAlertSpeech(tts: engine);
    final pending = adapter.availableEnglishLanguage();
    await engine.preparing.future;
    await adapter.stop();
    engine.resumePreparation.complete();
    expect(await pending, isNull);
    expect(engine.voiceSelections, 0);
  });

  for (final stage in ['stop', 'volume', 'source']) {
    test('stop during sound $stage prevents playback', () async {
      final player = DelayedPlayer(stage);
      final adapter = AudioplayersWalletAlertSound(player: player);
      final pending = adapter.play();
      await player.preparing.future;
      await adapter.stop();
      player.resumePreparation.complete();
      await pending;
      expect(player.resumes, 0);
      await adapter.dispose();
    });
  }
}

class DelayedTts extends FlutterTts {
  String? delayStage;
  int voiceSelections = 0;
  final spoken = <String>[];
  final preparing = Completer<void>();
  final resumePreparation = Completer<void>();

  Future<void> waitFor(String stage) async {
    if (delayStage != stage) return;
    if (!preparing.isCompleted) preparing.complete();
    await resumePreparation.future;
  }

  @override
  Future<dynamic> get getVoices async {
    await waitFor('discovery');
    return [
      {'name': 'Local British', 'locale': 'en-GB', 'network_required': '0'},
    ];
  }

  @override
  Future<dynamic> isLanguageAvailable(String language) async => true;
  @override
  Future<dynamic> setLanguage(String language) async => 1;
  @override
  Future<dynamic> setVoice(Map<String, String> voice) async {
    voiceSelections++;
    await waitFor('selection');
    return 1;
  }

  @override
  Future<dynamic> setSpeechRate(double rate) async => 1;
  @override
  Future<dynamic> awaitSpeakCompletion(bool awaitCompletion) async => 1;
  @override
  Future<dynamic> speak(String text, {bool focus = false}) async {
    spoken.add(text);
    return 1;
  }

  @override
  Future<dynamic> stop() async => 1;
}

class DelayedPlayer implements AudioPlayer {
  DelayedPlayer(this.delayStage);
  final String delayStage;
  int resumes = 0;
  int stops = 0;
  final preparing = Completer<void>();
  final resumePreparation = Completer<void>();

  Future<void> waitFor(String stage) async {
    if (delayStage != stage || preparing.isCompleted) return;
    preparing.complete();
    await resumePreparation.future;
  }

  @override
  Future<void> stop() async {
    stops++;
    if (stops == 1) await waitFor('stop');
  }

  @override
  Future<void> setVolume(double volume) => waitFor('volume');
  @override
  Future<void> setSource(Source source) => waitFor('source');
  @override
  Future<void> resume() async => resumes++;
  @override
  Future<void> dispose() async {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
