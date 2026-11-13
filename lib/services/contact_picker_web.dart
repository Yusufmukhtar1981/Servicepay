// @dart=3.5
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/services.dart';

@JS('navigator.contacts')
external BrowserContacts? get _contacts;

@JS('isSecureContext')
external bool get _secureContext;

@JS('window.top')
external JSObject? get _topWindow;

@JS('window.self')
external JSObject get _selfWindow;

extension type BrowserContacts(JSObject _) implements JSObject {
  external JSPromise<JSArray<BrowserContact>> select(
      JSArray<JSString> properties, BrowserContactOptions options);
}

extension type BrowserContact(JSObject _) implements JSObject {
  external JSArray<JSString>? get tel;
}

extension type BrowserContactOptions._(JSObject _) implements JSObject {
  external factory BrowserContactOptions({required bool multiple});
}

bool get supported {
  final contacts = _contacts;
  return _secureContext &&
      _topWindow == _selfWindow &&
      contacts != null &&
      contacts.getProperty<JSAny?>('select'.toJS).isA<JSFunction>();
}

Future<List<String>?> selectPhoneNumbers() async {
  final contacts = _contacts;
  if (!supported || contacts == null) return null;
  try {
    // Call select synchronously from the tap. Do not await a permission or
    // capability request first: Chrome requires transient user activation.
    final selection = contacts.select(
        ['tel'.toJS].toJS, BrowserContactOptions(multiple: false));
    final selected = (await selection.toDart).toDart;
    if (selected.isEmpty) return null;
    // Only one contact's phone numbers; no names or address book are requested.
    return selected.first.tel?.toDart.map((value) => value.toDart).toList();
  } catch (error) {
    String? name;
    try {
      name = (error as JSObject).getProperty<JSString?>('name'.toJS)?.toDart;
    } catch (_) {
      // Unknown browser failures remain unavailable, never silently successful.
    }
    if (name == 'AbortError') return null;
    if (name == 'NotAllowedError' || name == 'SecurityError') {
      throw PlatformException(code: 'permission_denied');
    }
    throw PlatformException(code: 'unavailable');
  }
}
