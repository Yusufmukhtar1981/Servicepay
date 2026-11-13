import 'package:flutter/foundation.dart';
import 'package:flutter_native_contact_picker/flutter_native_contact_picker.dart';

bool get supported => defaultTargetPlatform == TargetPlatform.android;

Future<List<String>?> selectPhoneNumbers() async {
  // This package uses the system's number picker and its per-selection grant.
  // No READ_CONTACTS permission or address-book enumeration is necessary.
  final selected = await FlutterNativeContactPicker().selectPhoneNumber();
  if (selected == null) return null;
  final number = selected.selectedPhoneNumber;
  if (number != null && number.trim().isNotEmpty) return [number];
  return selected.phoneNumbers;
}
