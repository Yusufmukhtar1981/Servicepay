import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../login_screen.dart';
import '../services/session_store.dart';
import 'branch_counter_api.dart';
import 'counter_receipt_platform.dart';

part 'branch_counter_list.dart';
part 'branch_counter_form.dart';
part 'branch_counter_detail.dart';
part 'branch_counter_components.dart';
part 'branch_counter_receipt.dart';

typedef CounterReceiptOpener = Future<bool> Function(String html);

const Color _forest = Color(0xff0b4438);
const Color _green = Color(0xff087f5b);
const Color _canvas = Color(0xfff4f7f4);
const Color _ink = Color(0xff17332c);

Map<String, dynamic> _map(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

List<Map<String, dynamic>> _maps(dynamic value) => value is List
    ? value.whereType<Map>().map((Map row) => _map(row)).toList()
    : <Map<String, dynamic>>[];

int _int(dynamic value, int fallback) =>
    value is num ? value.toInt() : int.tryParse('$value') ?? fallback;

String _human(String value) =>
    value.toLowerCase().split('_').map((String part) {
      if (part.isEmpty) return part;
      return '${part[0].toUpperCase()}${part.substring(1)}';
    }).join(' ');

String _money(dynamic value) {
  final num number = value is num ? value : num.tryParse('$value') ?? 0;
  final String raw = number.round().toString();
  return raw.replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'), (Match match) => ',');
}