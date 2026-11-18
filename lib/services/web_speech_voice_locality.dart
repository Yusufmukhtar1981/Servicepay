import 'web_speech_voice_locality_stub.dart'
    if (dart.library.html) 'web_speech_voice_locality_web.dart' as platform;

Future<List<Map<String, Object?>>?> readWebSpeechVoiceLocality() =>
    platform.readWebSpeechVoiceLocality();
