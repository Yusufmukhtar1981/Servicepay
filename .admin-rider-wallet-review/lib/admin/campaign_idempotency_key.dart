import 'dart:math';

/// Retains a broadcast key until the operator changes the campaign it identifies.
///
/// A broadcast may have been accepted even when its response was lost, so retrying
/// an unchanged campaign must reuse this key.
class CampaignIdempotencyKey {
  CampaignIdempotencyKey({String Function()? generate})
      : _generate = generate ?? _newKey;

  final String Function() _generate;
  String? _key;

  String get value => _key ??= _generate();

  void resetForContentOrAudienceChange() {
    _key = null;
  }

  static String _newKey() {
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final random = Random.secure().nextInt(1 << 32);
    return 'campaign-$timestamp-${random.toRadixString(16)}';
  }
}
