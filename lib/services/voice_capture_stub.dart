class VoiceCapture {
  bool get isSupported => false;
  Future<void> start() async {
    throw UnsupportedError(
        'Voice recording is only available in a supported browser.');
  }

  Future<List<int>> stop() async => <int>[];
  Future<void> cancel() async {}
  Future<void> dispose() async {}
}
