import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/campaign_idempotency_key.dart';

void main() {
  test('reuses its key for immediate broadcast retries', () {
    var generated = 0;
    final key = CampaignIdempotencyKey(generate: () => 'key-${++generated}');

    final firstSubmission = key.value;
    final retrySubmission = key.value;

    expect(retrySubmission, firstSubmission);
    expect(generated, 1);
  });

  test('rotates its key when campaign content or audience changes', () {
    var generated = 0;
    final key = CampaignIdempotencyKey(generate: () => 'key-${++generated}');

    final beforeChange = key.value;
    key.resetForContentOrAudienceChange();
    final afterContentChange = key.value;
    key.resetForContentOrAudienceChange();
    final afterAudienceChange = key.value;

    expect(afterContentChange, isNot(beforeChange));
    expect(afterAudienceChange, isNot(afterContentChange));
  });
}
