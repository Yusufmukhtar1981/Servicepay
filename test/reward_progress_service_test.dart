import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/reward_progress_service.dart';

void main() {
  test('loads authenticated announcement progress and unwraps requirements',
      () async {
    final MockClient client = MockClient((request) async {
      expect(request.url.path, '/api/announcements/promo-1/progress');
      expect(request.headers['authorization'], 'Bearer customer-token');
      return http.Response(
        '{"success":true,"data":{"count":63,"value":187500,'
        '"remainingCount":37,"remainingValue":62500,"qualified":false,'
        '"requirements":{"qualifyingTransactionCount":100,'
        '"qualifyingTransactionValue":250000}}}',
        200,
      );
    });

    final RewardProgress result = await RewardProgressService(
      client: client,
      baseUrl: 'https://example.test/api',
      token: 'customer-token',
    ).fetchProgress('promo-1');

    expect(result.transactionCount, 63);
    expect(result.requiredTransactionCount, 100);
    expect(result.transactionValue, 187500);
    expect(result.requiredTransactionValue, 250000);
    expect(result.remainingTransactions, 37);
    expect(result.remainingValue, 62500);
    expect(result.qualified, isFalse);
  });

  test('surfaces API failures for the non-blocking dashboard layer', () async {
    final RewardProgressService service = RewardProgressService(
      client: MockClient((_) async => http.Response('offline', 503)),
      baseUrl: 'https://example.test/api',
      token: 'customer-token',
    );

    expect(
      () => service.fetchProgress('promo-1'),
      throwsA(isA<StateError>()),
    );
  });
}