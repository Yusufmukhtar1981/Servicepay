import 'dart:async';
import 'dart:math' as math;

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

import 'customer_notification_settings.dart';
import 'web_speech_voice_locality.dart';

abstract interface class WalletAlertSoundAdapter {
  Future<void> play();
  Future<void> stop();
  Future<void> dispose();
}

abstract interface class WalletAlertSpeechAdapter {
  Future<String?> availableEnglishLanguage();
  Future<void> speak(String text);
  Future<void> stop();
  Future<void> dispose();
}

class WalletAlertMediaResult {
  const WalletAlertMediaResult({
    this.soundAvailable,
    this.voiceAvailable,
    this.voiceLanguage,
  });

  final bool? soundAvailable;
  final bool? voiceAvailable;
  final String? voiceLanguage;
}

class OfflineEnglishVoice {
  const OfflineEnglishVoice({required this.name, required this.locale});

  final String name;
  final String locale;

  Map<String, String> toPluginVoice() =>
      <String, String>{'name': name, 'locale': locale};
}

bool _isExplicitlyOfflineVoice(Map<String, Object?> voice) {
  final networkRequired = voice['network_required'];
  // flutter_tts Android serializes this TextToSpeech.Voice field as "0"/"1".
  return networkRequired == false ||
      networkRequired == '0' ||
      networkRequired == 0;
}

/// Select only voices explicitly identified as installed/offline.
///
/// Android supplies `network_required`; web callers synthesize that field
/// from SpeechSynthesisVoice.localService. Missing/unknown metadata is rejected.
OfflineEnglishVoice? selectOfflineEnglishVoice(
  Iterable<Map<String, Object?>> voices,
) {
  final candidates = <OfflineEnglishVoice>[];
  for (final voice in voices) {
    if (!_isExplicitlyOfflineVoice(voice)) continue;
    final name = voice['name'];
    final locale = voice['locale'];
    if (name is! String || name.trim().isEmpty || locale is! String) continue;
    final normalizedLocale = locale.trim().toLowerCase();
    if (normalizedLocale != 'en' &&
        !normalizedLocale.startsWith('en-') &&
        !normalizedLocale.startsWith('en_')) {
      continue;
    }
    candidates.add(OfflineEnglishVoice(name: name, locale: locale));
  }
  const preferred = <String>['en-NG', 'en-GB', 'en-US', 'en-CA', 'en-AU'];
  candidates.sort((a, b) {
    int rank(String locale) {
      final index = preferred.indexWhere(
        (value) => value.toLowerCase() == locale.toLowerCase(),
      );
      return index < 0 ? preferred.length : index;
    }

    return rank(a.locale).compareTo(rank(b.locale));
  });
  return candidates.isEmpty ? null : candidates.first;
}

/// Device-local alert audio. Call test methods from a user gesture to unlock
/// browser playback; real alerts always retain their visual handoff.
class CustomerAlertMediaService {
  CustomerAlertMediaService({
    required WalletAlertSoundAdapter sound,
    required WalletAlertSpeechAdapter speech,
    this.pluginTimeout = const Duration(seconds: 3),
    this.speechTimeout = const Duration(seconds: 15),
  })  : _sound = sound,
        _speech = speech;

  static final CustomerAlertMediaService shared = CustomerAlertMediaService(
    sound: AudioplayersWalletAlertSound(),
    speech: FlutterTtsWalletAlertSpeech(),
  );

  final WalletAlertSoundAdapter _sound;
  final WalletAlertSpeechAdapter _speech;
  final Duration pluginTimeout;
  final Duration speechTimeout;
  bool _soundStarted = false;
  bool _speechStarted = false;
  int _soundGeneration = 0;
  int _speechGeneration = 0;
  bool _disposed = false;

  Future<T> _bounded<T>(Future<T> operation) =>
      operation.timeout(pluginTimeout);

  Future<bool> testSound() async {
    if (_disposed) return false;
    final generation = ++_soundGeneration;
    try {
      _soundStarted = true;
      await _bounded(_sound.play());
      return !_disposed && generation == _soundGeneration;
    } catch (_) {
      unawaited(stopSound());
      return false;
    }
  }

  Future<bool> testVoice() async {
    if (_disposed) return false;
    final generation = ++_speechGeneration;
    try {
      _speechStarted = true;
      final language = await _bounded(_speech.availableEnglishLanguage());
      if (language == null || _disposed || generation != _speechGeneration) {
        return false;
      }
      await _speech.speak('ServicePay voice test.').timeout(speechTimeout);
      return !_disposed && generation == _speechGeneration;
    } catch (_) {
      unawaited(stopSpeech());
      return false;
    }
  }

  Future<WalletAlertMediaResult> playIncomingAlert(
    WalletCreditAlert alert,
    CustomerNotificationSettings settings, {
    required bool walletBalanceHidden,
  }) async {
    if (_disposed) {
      return const WalletAlertMediaResult(
          soundAvailable: false, voiceAvailable: false);
    }
    final soundGeneration = ++_soundGeneration;
    final speechGeneration = ++_speechGeneration;
    if (!settings.soundNotifications) await stopSound();
    if (!settings.voiceAnnouncements || walletBalanceHidden) {
      await stopSpeech();
    }
    bool? soundAvailable;
    bool? voiceAvailable;
    String? voiceLanguage;

    if (settings.soundNotifications &&
        !_disposed && soundGeneration == _soundGeneration) {
      try {
        _soundStarted = true;
        await _bounded(_sound.play());
        soundAvailable = !_disposed && soundGeneration == _soundGeneration;
      } catch (_) {
        soundAvailable = false;
        unawaited(stopSound());
      }
    }

    if (settings.voiceAnnouncements && !walletBalanceHidden &&
        !_disposed && speechGeneration == _speechGeneration) {
      try {
        _speechStarted = true;
        voiceLanguage = await _bounded(_speech.availableEnglishLanguage());
        if (voiceLanguage == null ||
            _disposed ||
            speechGeneration != _speechGeneration) {
          voiceAvailable = false;
        } else {
          await _bounded(_speech.stop());
          if (_disposed || speechGeneration != _speechGeneration) {
            voiceAvailable = false;
            return WalletAlertMediaResult(
              soundAvailable: soundAvailable,
              voiceAvailable: voiceAvailable,
              voiceLanguage: voiceLanguage,
            );
          }
          await _speech
            .speak(
              'Money received. Naira ${alert.amount.toStringAsFixed(2)} '
              'has been added to your wallet.',
            )
            .timeout(speechTimeout);
          voiceAvailable = !_disposed && speechGeneration == _speechGeneration;
        }
      } catch (_) {
        voiceAvailable = false;
        unawaited(stopSpeech());
      }
    }

    return WalletAlertMediaResult(
      soundAvailable: soundAvailable,
      voiceAvailable: voiceAvailable,
      voiceLanguage: voiceLanguage,
    );
  }

  Future<void> stopSound() async {
    _soundGeneration++;
    if (!_soundStarted) return;
    _soundStarted = false;
    try {
      await _bounded(_sound.stop());
    } catch (_) {
      // UI remains usable if an audio platform is unavailable.
    }
  }

  Future<void> stopSpeech() async {
    _speechGeneration++;
    if (!_speechStarted) return;
    _speechStarted = false;
    try {
      await _bounded(_speech.stop());
    } catch (_) {
      // UI remains usable if a device voice is unavailable.
    }
  }

  Future<void> stopAll() async {
    await Future.wait<void>(<Future<void>>[
      stopSound(),
      stopSpeech(),
    ]);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await stopAll();
    await Future.wait<void>(<Future<void>>[
      _bounded(_sound.dispose()).catchError((Object _) {}),
      _bounded(_speech.dispose()).catchError((Object _) {}),
    ]);
  }
}

class AudioplayersWalletAlertSound implements WalletAlertSoundAdapter {
  AudioplayersWalletAlertSound({
    AudioPlayer? player,
    this.operationTimeout = const Duration(seconds: 3),
  }) : _instance = player;

  AudioPlayer? _instance;
  int _generation = 0;
  bool _disposed = false;
  AudioPlayer get _player => _instance ??= AudioPlayer();
  final Duration operationTimeout;
  Uint8List? _tone;

  Uint8List _buildTone() {
    if (_tone != null) return _tone!;
    const sampleRate = 22050;
    const durationMs = 150;
    final samples = sampleRate * durationMs ~/ 1000;
    final dataBytes = samples * 2;
    final wav = ByteData(44 + dataBytes);

    void writeTag(int offset, String value) {
      for (var i = 0; i < value.length; i++) {
        wav.setUint8(offset + i, value.codeUnitAt(i));
      }
    }

    writeTag(0, 'RIFF');
    wav.setUint32(4, 36 + dataBytes, Endian.little);
    writeTag(8, 'WAVE');
    writeTag(12, 'fmt ');
    wav.setUint32(16, 16, Endian.little);
    wav.setUint16(20, 1, Endian.little);
    wav.setUint16(22, 1, Endian.little);
    wav.setUint32(24, sampleRate, Endian.little);
    wav.setUint32(28, sampleRate * 2, Endian.little);
    wav.setUint16(32, 2, Endian.little);
    wav.setUint16(34, 16, Endian.little);
    writeTag(36, 'data');
    wav.setUint32(40, dataBytes, Endian.little);
    for (var i = 0; i < samples; i++) {
      final fade = math.min(1.0, math.min(i / 200, (samples - i) / 200));
      final sample =
          (math.sin(2 * math.pi * 740 * i / sampleRate) * 0.32 * fade * 32767)
              .round()
              .clamp(-32768, 32767);
      wav.setInt16(44 + i * 2, sample, Endian.little);
    }
    _tone = wav.buffer.asUint8List();
    return _tone!;
  }

  @override
  Future<void> play() async {
    if (_disposed) return;
    final generation = ++_generation;
    await _player.stop().timeout(operationTimeout);
    if (_disposed || generation != _generation) return;
    await _player.setVolume(0.72).timeout(operationTimeout);
    if (_disposed || generation != _generation) return;
    await _player
        .setSource(BytesSource(_buildTone(), mimeType: 'audio/wav'))
        .timeout(operationTimeout);
    if (_disposed || generation != _generation) return;
    await _player.resume().timeout(operationTimeout);
  }

  @override
  Future<void> stop() {
    _generation++;
    return _instance?.stop().timeout(operationTimeout) ?? Future<void>.value();
  }

  @override
  Future<void> dispose() {
    _disposed = true;
    _generation++;
    return _instance?.dispose().timeout(operationTimeout) ?? Future<void>.value();
  }
}

class FlutterTtsWalletAlertSpeech implements WalletAlertSpeechAdapter {
  FlutterTtsWalletAlertSpeech({
    FlutterTts? tts,
    this.operationTimeout = const Duration(seconds: 3),
  }) : _instance = tts;

  FlutterTts? _instance;
  int _generation = 0;
  bool _disposed = false;
  FlutterTts get _tts => _instance ??= FlutterTts();
  final Duration operationTimeout;
  String? _englishLocale;
  OfflineEnglishVoice? _selectedVoice;

  Future<T> _call<T>(Future<T> operation) =>
      operation.timeout(operationTimeout);

  List<Map<String, Object?>> _voiceMaps(dynamic raw) {
    if (raw is! List) return <Map<String, Object?>>[];
    return raw
        .whereType<Map>()
        .map((voice) => Map<String, Object?>.from(voice))
        .toList(growable: false);
  }

  Future<List<Map<String, Object?>>> _installedVoiceMetadata() async {
    final pluginVoices = _voiceMaps(await _call(_tts.getVoices));
    if (kIsWeb) {
      final browserVoices = await _call(readWebSpeechVoiceLocality());
      if (browserVoices == null) return <Map<String, Object?>>[];
      return pluginVoices.map((voice) {
        final name = voice['name'];
        final locale = voice['locale'];
        final browserVoice = browserVoices.where((candidate) =>
            candidate['name'] == name && candidate['locale'] == locale);
        final isLocal = browserVoice.any(
          (candidate) => candidate['localService'] == true,
        );
        return <String, Object?>{
          ...voice,
          'network_required': !isLocal,
        };
      }).toList(growable: false);
    }
    if (defaultTargetPlatform == TargetPlatform.android) {
      return pluginVoices;
    }
    // Other platforms do not expose locality metadata through this adapter.
    return <Map<String, Object?>>[];
  }

  @override
  Future<String?> availableEnglishLanguage() async {
    if (_disposed) return null;
    if (_englishLocale != null) return _englishLocale;
    final generation = ++_generation;
    final voice = selectOfflineEnglishVoice(await _installedVoiceMetadata());
    if (_disposed || generation != _generation) return null;
    if (voice == null) return null;
    final dynamic available =
        await _call(_tts.isLanguageAvailable(voice.locale));
    if (_disposed || generation != _generation) return null;
    if (available != true && available != 1) return null;
    // Set language first; on web that call may choose a default voice. Apply
    // the verified local voice last so it cannot silently switch to a remote one.
    await _call(_tts.setLanguage(voice.locale));
    if (_disposed || generation != _generation) return null;
    final dynamic voiceSet = await _call(_tts.setVoice(voice.toPluginVoice()));
    if (_disposed || generation != _generation) return null;
    if (!kIsWeb && voiceSet != true && voiceSet != 1) return null;
    await _call(_tts.setSpeechRate(0.46));
    if (_disposed || generation != _generation) return null;
    await _call(_tts.awaitSpeakCompletion(true));
    if (_disposed || generation != _generation) return null;
    _selectedVoice = voice;
    _englishLocale = voice.locale;
    return voice.locale;
  }

  @override
  Future<void> speak(String text) async {
    if (_disposed) return;
    final generation = ++_generation;
    final voice = _selectedVoice;
    if (voice == null) {
      throw StateError('No explicitly local English voice is selected.');
    }
    final currentVoices = await _installedVoiceMetadata();
    if (_disposed || generation != _generation) return;
    final stillLocal = currentVoices.any(
      (candidate) =>
          candidate['name'] == voice.name &&
          candidate['locale'] == voice.locale &&
          _isExplicitlyOfflineVoice(candidate),
    );
    if (!stillLocal) {
      throw StateError('The selected English voice is no longer local.');
    }
    final dynamic voiceSet = await _call(_tts.setVoice(voice.toPluginVoice()));
    if (_disposed || generation != _generation) return;
    if (!kIsWeb && voiceSet != true && voiceSet != 1) {
      throw StateError('The selected local English voice is unavailable.');
    }
    final result = await _tts.speak(text).timeout(const Duration(seconds: 15));
    if (result != 1) {
      throw StateError('Device speech was not accepted.');
    }
  }

  @override
  Future<void> stop() async {
    _generation++;
    final tts = _instance;
    if (tts != null) await _call(tts.stop());
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    await stop();
  }
}
