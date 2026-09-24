import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Keeps referral codes in one consistent format across links, fields and
/// requests. Referral codes are case-insensitive, but are sent canonically.
class ReferralCodeNormalizer {
  const ReferralCodeNormalizer._();

  static String? fromUri(Uri uri) => normalize(uri.queryParameters['ref']);

  static String? normalize(String? value) {
    final code = value?.trim().toUpperCase() ?? '';
    return code.isEmpty ? null : code;
  }
}

class ReferralAttribution {
  const ReferralAttribution({
    required this.code,
    this.firstName,
  });

  final String code;
  final String? firstName;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'code': code,
        if (firstName != null && firstName!.trim().isNotEmpty)
          'firstName': firstName!.trim(),
      };

  static ReferralAttribution? fromJson(dynamic value) {
    if (value is! Map) return null;
    final code = ReferralCodeNormalizer.normalize(value['code']?.toString());
    if (code == null) return null;
    final firstName = value['firstName']?.toString().trim();
    return ReferralAttribution(
      code: code,
      firstName: firstName == null || firstName.isEmpty ? null : firstName,
    );
  }
}

/// SharedPreferences persistence is deliberately isolated so registration can
/// keep an attribution while the user moves through pages or leaves the flow.
class ReferralAttributionStore {
  ReferralAttributionStore({
    Future<SharedPreferences> Function()? preferencesLoader,
  }) : _preferencesLoader = preferencesLoader ?? SharedPreferences.getInstance;

  static const String storageKey = 'pending_referral_attribution';

  final Future<SharedPreferences> Function() _preferencesLoader;

  Future<ReferralAttribution?> read() async {
    final prefs = await _preferencesLoader();
    final raw = prefs.getString(storageKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      return ReferralAttribution.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  Future<void> write(ReferralAttribution attribution) async {
    final prefs = await _preferencesLoader();
    await prefs.setString(storageKey, jsonEncode(attribution.toJson()));
  }

  Future<void> clear() async {
    final prefs = await _preferencesLoader();
    await prefs.remove(storageKey);
  }
}

class ReferralValidationResult {
  const ReferralValidationResult.invalid(this.code)
      : isValid = false,
        isUnavailable = false,
        firstName = null;

  const ReferralValidationResult.unavailable(this.code)
      : isValid = false,
        isUnavailable = true,
        firstName = null;

  const ReferralValidationResult.valid(
    this.code, {
    this.firstName,
  })  : isValid = true,
        isUnavailable = false;

  final String code;
  final bool isValid;
  final bool isUnavailable;
  final String? firstName;

  ReferralAttribution? get attribution => isValid
      ? ReferralAttribution(
          code: code,
          firstName: firstName,
        )
      : null;
}

class ReferralAttributionService {
  ReferralAttributionService({
    http.Client? client,
    ReferralAttributionStore? store,
    this.validationTimeout = const Duration(seconds: 4),
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        store = store ?? ReferralAttributionStore();

  static const String validationUrl =
      'https://api.servicepay.ng/api/auth/referral/validate';

  final http.Client _client;
  final bool _ownsClient;
  final ReferralAttributionStore store;
  final Duration validationTimeout;

  Future<ReferralValidationResult> validate(String? rawCode) async {
    final code = ReferralCodeNormalizer.normalize(rawCode);
    if (code == null) {
      return const ReferralValidationResult.invalid('');
    }

    try {
      final response = await _client.get(
        Uri.parse(validationUrl).replace(
          queryParameters: <String, String>{'code': code},
        ),
        headers: const <String, String>{'Accept': 'application/json'},
      ).timeout(validationTimeout);
      final body = _decodeMap(response.body);
      final data = body['data'] is Map
          ? Map<String, dynamic>.from(body['data'] as Map)
          : body;
      if (response.statusCode >= 400 &&
          response.statusCode < 500 &&
          response.statusCode != 429) {
        // A definitive client error means this code is not usable.  Do not
        // fall back to an older cached attribution for an explicitly supplied
        // link in this case.
        return ReferralValidationResult.invalid(code);
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return ReferralValidationResult.unavailable(code);
      }
      final valid = data['valid'] == true || data['isValid'] == true;
      if (!valid) return ReferralValidationResult.invalid(code);

      final firstName = data['firstName']?.toString().trim();
      return ReferralValidationResult.valid(
        code,
        firstName: firstName == null || firstName.isEmpty ? null : firstName,
      );
    } catch (_) {
      // Link validation must never prevent normal registration.
      return ReferralValidationResult.unavailable(code);
    }
  }

  Future<ReferralAttribution?> captureAndPersist(String? rawCode) async {
    final code = ReferralCodeNormalizer.normalize(rawCode);
    if (code == null) return null;
    final result = await validate(rawCode);
    final attribution = result.attribution;
    if (attribution != null) {
      try {
        await store.write(attribution);
      } catch (_) {
        // Persistence is best effort; a valid link can still be used for
        // this registration even when local storage is temporarily absent.
      }
    }

    if (result.isUnavailable) {
      final cached = await restore();
      if (cached?.code == code) {
        return cached;
      }
    }

    if (attribution == null) {
      await clearPending();
    }
    return attribution;
  }

  Future<ReferralAttribution?> restore() async {
    try {
      return await store.read();
    } catch (_) {
      return null;
    }
  }

  Future<void> clearPending() async {
    try {
      await store.clear();
    } catch (_) {
      // Account creation has already succeeded; storage cleanup is best effort.
    }
  }

  void dispose() {
    if (_ownsClient) _client.close();
  }

  static Map<String, dynamic> _decodeMap(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }
}
