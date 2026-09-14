import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/announcement_service.dart';

void main() {
  test('fetches, unwraps and prioritises active announcements', () async {
    final client = MockClient((request) async {
      expect(request.url.path, '/api/announcements/active');
      expect(request.headers['authorization'], 'Bearer test-token');
      return http.Response(
        '{"data":{"announcements":[{"id":"low","title":"Later","message":"B","priority":1,"displayStyle":"BANNER"},{"id":"high","title":"Now","message":"A","priority":9,"displayStyle":"POPUP"}]}}',
        200,
      );
    });
    final result = await AnnouncementService(
      client: client,
      baseUrl: 'https://example.test/api',
      token: 'test-token',
    ).fetchActive();
    expect(result.map((item) => item.id), ['high', 'low']);
    expect(result.first.isPopup, isTrue);
  });

  test('maps the customer public payload shape', () {
    final item = ServicePayAnnouncement.fromJson({
      'id': 'server-id',
      'title': 'Security notice',
      'message': 'Please review your account.',
      'style': 'BOTH',
      'visibility': 'MANDATORY',
      'startAt': '2027-01-01T00:00:00Z',
      'endAt': '2027-02-01T00:00:00Z',
      'createdAt': '2026-12-20T12:00:00Z',
      'cta': {'label': 'Review', 'url': 'https://servicepay.ng/review'},
    });
    expect(item.isPopup, isTrue);
    expect(item.isBanner, isTrue);
    expect(item.mandatory, isTrue);
    expect(item.ctaText, 'Review');
    expect(item.ctaAction, 'https://servicepay.ng/review');
    expect(item.startsAt, isNotNull);
    expect(item.endsAt, isNotNull);
    expect(item.createdAt, DateTime.parse('2026-12-20T12:00:00Z'));
  });

  test('posts each interaction to the planned endpoint', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      return http.Response('{}', 204);
    });
    final service = AnnouncementService(
      client: client,
      baseUrl: 'https://example.test/api',
      token: 'token',
    );
    await service.view('a');
    await service.acknowledge('a');
    await service.dismiss('a');
    await service.click('a');
    expect(paths, [
      '/api/announcements/a/view',
      '/api/announcements/a/acknowledge',
      '/api/announcements/a/dismiss',
      '/api/announcements/a/click',
    ]);
  });

  test('returns false when an interaction is not accepted', () async {
    final service = AnnouncementService(
      client: MockClient((_) async => http.Response(
            '{"success":false,"message":"Not recorded"}',
            409,
          )),
      baseUrl: 'https://example.test/api',
      token: 'token',
    );

    expect(await service.acknowledge('mandatory'), isFalse);
  });
}
