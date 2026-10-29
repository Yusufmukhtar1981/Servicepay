import 'dart:async';
import 'dart:html' as html;
import 'dart:js' as js;
import 'dart:js_util' as js_util;
import 'dart:typed_data';

class VoiceCapture {
  html.MediaStream? _stream;
  Object? _context;
  Object? _processor;
  Object? _source;
  Object? _mutedOutput;
  final List<double> _samples = <double>[];
  int _inputRate = 44100;

  bool get isSupported => html.window.navigator.mediaDevices != null;

  Future<void> start() async {
    if (!isSupported) {
      throw UnsupportedError('This browser cannot record audio.');
    }
    await cancel();
    _stream = await html.window.navigator.mediaDevices!
        .getUserMedia(<String, dynamic>{'audio': true, 'video': false});
    final Object constructor = js_util.getProperty(html.window, 'AudioContext');
    _context = js_util.callConstructor<Object>(constructor, const []);
    _inputRate = js_util.getProperty<num>(_context!, 'sampleRate').round();
    _source = js_util.callMethod<Object>(_context!, 'createMediaStreamSource', [_stream!]);
    _processor = js_util.callMethod<Object>(_context!, 'createScriptProcessor', [4096, 1, 1]);
    _mutedOutput = js_util.callMethod<Object>(_context!, 'createGain', const []);
    js_util.setProperty(js_util.getProperty<Object>(_mutedOutput!, 'gain'), 'value', 0);
    js_util.setProperty(_processor!, 'onaudioprocess', js.allowInterop((Object event) {
      final Object buffer = js_util.getProperty<Object>(event, 'inputBuffer');
      final Float32List channel = js_util.callMethod<Float32List>(buffer, 'getChannelData', [0]);
      _samples.addAll(channel);
    }));
    js_util.callMethod<void>(_source!, 'connect', [_processor!]);
    js_util.callMethod<void>(_processor!, 'connect', [_mutedOutput!]);
    js_util.callMethod<void>(_mutedOutput!, 'connect', [js_util.getProperty<Object>(_context!, 'destination')]);
    await js_util.promiseToFuture<Object?>(js_util.callMethod(_context!, 'resume', const []));
  }

  Future<List<int>> stop() async {
    final List<double> samples = List<double>.from(_samples);
    _samples.clear();
    await _release();
    if (samples.isEmpty) {
      throw StateError(
          'No audio was captured. Check microphone access and try again.');
    }
    return _encodePcm16Wav(samples, _inputRate, 16000);
  }

  Future<void> cancel() async {
    _samples.clear();
    await _release();
  }

  Future<void> dispose() => cancel();

  Future<void> _release() async {
    if (_processor != null) {
      js_util.setProperty(_processor!, 'onaudioprocess', null);
      js_util.callMethod<void>(_processor!, 'disconnect', const []);
    }
    if (_source != null) js_util.callMethod<void>(_source!, 'disconnect', const []);
    if (_mutedOutput != null) js_util.callMethod<void>(_mutedOutput!, 'disconnect', const []);
    _processor = null;
    _source = null;
    _mutedOutput = null;
    final html.MediaStream? stream = _stream;
    _stream = null;
    if (stream != null) {
      for (final html.MediaStreamTrack track in stream.getTracks()) {
        track.stop();
      }
    }
    final Object? context = _context;
    _context = null;
    if (context != null) {
      await js_util.promiseToFuture<Object?>(js_util.callMethod(context, 'close', const []));
    }
  }

  List<int> _encodePcm16Wav(
      List<double> samples, int sourceRate, int targetRate) {
    final int outputCount = (samples.length * targetRate / sourceRate).floor();
    final ByteData bytes = ByteData(44 + outputCount * 2);
    void writeAscii(int offset, String value) {
      for (int i = 0; i < value.length; i++) {
        bytes.setUint8(offset + i, value.codeUnitAt(i));
      }
    }

    writeAscii(0, 'RIFF');
    bytes.setUint32(4, 36 + outputCount * 2, Endian.little);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    bytes.setUint32(16, 16, Endian.little);
    bytes.setUint16(20, 1, Endian.little);
    bytes.setUint16(22, 1, Endian.little);
    bytes.setUint32(24, targetRate, Endian.little);
    bytes.setUint32(28, targetRate * 2, Endian.little);
    bytes.setUint16(32, 2, Endian.little);
    bytes.setUint16(34, 16, Endian.little);
    writeAscii(36, 'data');
    bytes.setUint32(40, outputCount * 2, Endian.little);

    for (int i = 0; i < outputCount; i++) {
      final double sourcePosition = i * sourceRate / targetRate;
      final int before = sourcePosition.floor().clamp(0, samples.length - 1);
      final int after = (before + 1).clamp(0, samples.length - 1);
      final double fraction = sourcePosition - before;
      final double sample =
          (samples[before] * (1 - fraction) + samples[after] * fraction)
              .clamp(-1.0, 1.0);
      final int pcm =
          sample < 0 ? (sample * 32768).round() : (sample * 32767).round();
      bytes.setInt16(44 + i * 2, pcm, Endian.little);
    }
    return bytes.buffer.asUint8List();
  }
}
