import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/keke_order_screen.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:servicepay_app/services/keke_session_api.dart';

class _Location extends GeolocatorPlatform {
  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<LocationPermission> checkPermission() async => LocationPermission.whileInUse;
  @override
  Future<Position> getCurrentPosition({LocationSettings? locationSettings}) async =>
      Position(latitude: 12, longitude: 8.5, timestamp: DateTime(2026),
          accuracy: 5, altitude: 0, altitudeAccuracy: 0, heading: 0,
          headingAccuracy: 0, speed: 0, speedAccuracy: 0);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final tileImage = File('assets/image/servicepay_logo.png').readAsBytesSync();
  late Directory mapCache;
  late BuiltInMapCachingProvider cache;
  setUpAll(() async {
    mapCache = await Directory.systemTemp.createTemp('servicepay-keke-widget-');
    cache = BuiltInMapCachingProvider.getOrCreateInstance(
        cacheDirectory: mapCache.path, readOnly: true);
  });
  tearDownAll(() async {
    await cache.destroy();
    await mapCache.delete(recursive: true);
  });
  late GeolocatorPlatform original;
  setUp(() async {
    original = GeolocatorPlatform.instance;
    GeolocatorPlatform.instance = _Location();
    SharedPreferences.setMockInitialValues({});
    await SessionStore.clear();
    final jwt = 'test.${base64Url.encode(utf8.encode('{"id":"keke-test"}'))}.sig';
    await SessionStore.writeSession(jwt);
  });
  tearDown(() async {
    GeolocatorPlatform.instance = original;
    await SessionStore.clear();
  });

  for (final status in [200, 401, 503]) {
    testWidgets('destination selection handles fare HTTP $status correctly',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      var fareCalls = 0;
      final client = MockClient((request) async {
        if (request.url.host == 'tile.openstreetmap.org') {
          return http.Response.bytes(tileImage, 200,
              headers: {'content-type': 'image/png', 'cache-control': 'max-age=3600'});
        }
        if (request.url.path.endsWith('/keke-fare/estimate')) {
          fareCalls++;
          expect(request.headers['Authorization'], startsWith('Bearer test.'));
          expect(jsonDecode(request.body)['distanceKm'], greaterThan(0));
          return http.Response(status == 200
              ? '{"fare":{"totalFare":850}}'
              : '{"message":"Fare calculation temporarily unavailable"}', status);
        }
        return http.Response('{"ride":null}', 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: KekeOrderScreen()));
        // Drain location and initial active-ride reads without waiting on map tiles.
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        final map = tester.widget<FlutterMap>(find.byType(FlutterMap));
        map.options.onTap!(const TapPosition(Offset.zero, Offset.zero),
            const LatLng(12.01, 8.51));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(fareCalls, 1);
        expect(find.text('Fare unavailable'), findsNothing);
        if (status == 200) {
          expect(find.text('₦850'), findsOneWidget,
              reason: tester.widgetList<Text>(find.byType(Text))
                  .map((t) => t.data).join(' | '));
        } else if (status == 401) {
          expect(find.textContaining('session needs renewal'), findsWidgets);
        } else {
          expect(find.textContaining('Fare calculation temporarily unavailable'),
              findsWidgets);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      }, () => client);
    });
  }

  for (final outcome in ['success', 'no-driver', 'timeout']) {
    testWidgets('booking $outcome preserves single submission and actual outcome',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      var bookings = 0;
      final response = Completer<http.Response>();
      final client = MockClient((request) async {
        if (request.url.host == 'tile.openstreetmap.org') {
          return http.Response.bytes(tileImage, 200,
              headers: {'content-type': 'image/png', 'cache-control': 'max-age=3600'});
        }
        if (request.url.path.endsWith('/keke-fare/estimate')) {
          return http.Response('{"fare":{"totalFare":850}}', 200);
        }
        if (request.method == 'POST' && request.url.path.endsWith('/keke-rides')) {
          bookings++;
          expect(jsonDecode(request.body)['paymentMethod'], 'WALLET');
          return response.future;
        }
        return http.Response('{"ride":null}', 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: KekeOrderScreen()));
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        tester.widget<FlutterMap>(find.byType(FlutterMap)).options.onTap!(
            const TapPosition(Offset.zero, Offset.zero), const LatLng(12.01, 8.51));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        await tester.enterText(find.byType(TextField).last, 'Test destination');
        final request = find.text('Request Keke');
        await tester.ensureVisible(request);
        await tester.pump();
        await tester.tap(request);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('Confirm Keke request'), findsOneWidget);
        await tester.tap(find.text('Confirm request'));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
        for (var i = 0; i < 6; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(bookings, 1);
        expect(find.text('Searching...'), findsOneWidget);
        expect(await KekeBookingGuard.isUnresolved(), isTrue);
        if (outcome == 'success') {
          response.complete(http.Response(
              '{"message":"Keke request created.",'
              '"ride":{"_id":"test-ride","status":"SEARCHING_DRIVER"}}', 201));
        } else if (outcome == 'no-driver') {
          response.complete(http.Response('{"message":"No drivers available."}', 400));
        } else {
          response.completeError(TimeoutException('lost response'));
        }
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(bookings, 1);
        expect(find.text('Searching...'), findsNothing);
        if (outcome == 'timeout') {
          expect(await KekeBookingGuard.isUnresolved(), isTrue);
          final retry = find.text('Request Keke');
          await tester.ensureVisible(retry);
          await tester.pump();
          // Let the previous outcome snackbar leave the bottom button.
          await tester.pump(const Duration(seconds: 5));
          await tester.pump(const Duration(milliseconds: 300));
          await tester.tap(retry);
          await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
          for (var i = 0; i < 5; i++) {
            await tester.pump(const Duration(milliseconds: 50));
          }
          expect(bookings, 1);
          expect(find.textContaining('awaiting confirmation'), findsWidgets);
        } else {
          expect(await KekeBookingGuard.isUnresolved(), isFalse);
          expect(find.textContaining(outcome == 'success'
              ? 'Keke request created.' : 'No drivers available.'), findsWidgets);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      }, () => client);
    });
  }
}
