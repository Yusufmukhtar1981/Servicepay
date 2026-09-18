import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('clear wins over an in-flight legacy migration', () async {
    final channel = const MethodChannel(
      'plugins.it_nomads.com/flutter_secure_storage',
    );
    final writeStarted = Completer<void>();
    final releaseWrite = Completer<void>();
    var deleted = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'write') {
        writeStarted.complete();
        await releaseWrite.future;
      }
      if (call.method == 'delete') deleted = true;
      return null;
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });

    SharedPreferences.setMockInitialValues({'auth_token': 'legacy-token'});
    expect(await SessionStore.readToken(), 'legacy-token');
    await writeStarted.future;
    final clearing = SessionStore.clear();
    releaseWrite.complete();
    await clearing;

    expect(deleted, isTrue);
    expect(await SessionStore.readToken(), isNull);
  });

  test('clear removes fallback after a failed migration', () async {
    final channel = const MethodChannel(
      'plugins.it_nomads.com/flutter_secure_storage',
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'write') {
        throw StateError('secure storage unavailable');
      }
      return null;
    });
    SharedPreferences.setMockInitialValues({'auth_token': 'failed-token'});

    expect(await SessionStore.readToken(), 'failed-token');
    await SessionStore.clear();

    expect(await SessionStore.readToken(), isNull);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });
}