// This file is conditionally imported only by the browser-specific adapter.
// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:js_util' as js_util;

Future<List<Map<String, Object?>>?> readWebSpeechVoiceLocality() async {
  try {
    final window = js_util.getProperty<Object?>(js_util.globalThis, 'window');
    if (window == null) return null;
    final synthesis = js_util.getProperty<Object?>(window, 'speechSynthesis');
    if (synthesis == null) return null;
    final voices =
        js_util.callMethod<Object?>(synthesis, 'getVoices', <Object?>[]);
    if (voices == null) return null;
    final length = js_util.getProperty<num>(voices, 'length').toInt();
    return List<Map<String, Object?>>.generate(length, (index) {
      final voice = js_util.getProperty<Object?>(voices, index);
      if (voice == null) return <String, Object?>{};
      return <String, Object?>{
        'name': js_util.getProperty<Object?>(voice, 'name'),
        'locale': js_util.getProperty<Object?>(voice, 'lang'),
        'localService': js_util.getProperty<Object?>(voice, 'localService'),
      };
    }, growable: false);
  } catch (_) {
    return null;
  }
}
