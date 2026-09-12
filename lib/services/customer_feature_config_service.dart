import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/material.dart';

/// The customer-facing, deliberately small representation of a feature.
///
/// This model must not contain the admin's reason, audit actor, or scope
/// details.  It is also tolerant of older settings responses so that an
/// application update is not required when the server is rolled back.
class CustomerFeatureConfig {
  const CustomerFeatureConfig({
    required this.key,
    this.enabled = true,
    this.effectiveEnabled = true,
    this.visible = true,
    this.maintenanceMode = false,
    this.title = '',
    this.message = '',
    this.expectedReturnAt,
    this.schedule = const <String, dynamic>{},
    this.version,
  });

  final String key;
  final bool enabled;
  final bool effectiveEnabled;
  final bool visible;
  final bool maintenanceMode;
  final String title;
  final String message;
  final DateTime? expectedReturnAt;
  final Map<String, dynamic> schedule;
  final String? version;

  bool get isBlocked => maintenanceMode || !effectiveEnabled;

  CustomerFeatureConfig copyWith({
    bool? enabled,
    bool? effectiveEnabled,
    bool? visible,
    bool? maintenanceMode,
    String? title,
    String? message,
    DateTime? expectedReturnAt,
    Map<String, dynamic>? schedule,
    String? version,
  }) {
    return CustomerFeatureConfig(
      key: key,
      enabled: enabled ?? this.enabled,
      effectiveEnabled: effectiveEnabled ?? this.effectiveEnabled,
      visible: visible ?? this.visible,
      maintenanceMode: maintenanceMode ?? this.maintenanceMode,
      title: title ?? this.title,
      message: message ?? this.message,
      expectedReturnAt: expectedReturnAt ?? this.expectedReturnAt,
      schedule: schedule ?? this.schedule,
      version: version ?? this.version,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'key': key,
        'enabled': enabled,
        'effectiveEnabled': effectiveEnabled,
        'visible': visible,
        'maintenanceMode': maintenanceMode,
        'title': title,
        'message': message,
        'expectedReturnAt': expectedReturnAt?.toIso8601String(),
        'schedule': schedule,
        'version': version,
      };

  factory CustomerFeatureConfig.fromJson(Map<dynamic, dynamic> value) {
    final String key = _key(value['key'] ?? value['feature'] ?? value['id']);
    final bool enabled = _bool(value['enabled'], true);
    final Map<String, dynamic> schedule = _map(
      value['schedule'] ?? value['scheduling'],
    );
    for (final String scheduleKey in <String>[
      'scheduledEnabledAt',
      'scheduledDisabledAt',
      'enabledAt',
      'disabledAt',
    ]) {
      if (!schedule.containsKey(scheduleKey) && value[scheduleKey] != null) {
        schedule[scheduleKey] = value[scheduleKey];
      }
    }
    return CustomerFeatureConfig(
      key: key,
      enabled: enabled,
      effectiveEnabled: _bool(
        value['effectiveEnabled'] ?? value['effective_enabled'],
        enabled,
      ),
      visible: _bool(
        value['visible'] ?? value['isVisible'] ?? value['is_visible'],
        true,
      ),
      maintenanceMode: _bool(
        value['maintenanceMode'] ?? value['maintenance_mode'],
        false,
      ),
      title: _string(value['title'] ?? value['displayName'] ?? value['name']),
      message: _string(
        value['message'] ??
            value['maintenanceMessage'] ??
            value['maintenance_message'],
      ),
      expectedReturnAt: _date(
        value['expectedReturnAt'] ?? value['expected_return_at'],
      ),
      schedule: schedule,
      version: _nullableString(value['version'] ?? value['configVersion']),
    );
  }

  static String _key(dynamic value) => value?.toString().trim() ?? '';

  static String _string(dynamic value) => value?.toString().trim() ?? '';

  static String? _nullableString(dynamic value) {
    final String result = _string(value);
    return result.isEmpty ? null : result;
  }

  static bool _bool(dynamic value, bool fallback) {
    if (value is bool) return value;
    final String normalized = value?.toString().toLowerCase().trim() ?? '';
    if (normalized == 'true' ||
        normalized == '1' ||
        normalized == 'enabled' ||
        normalized == 'on') {
      return true;
    }
    if (normalized == 'false' ||
        normalized == '0' ||
        normalized == 'disabled' ||
        normalized == 'off') {
      return false;
    }
    return fallback;
  }

  static DateTime? _date(dynamic value) {
    if (value == null || value.toString().trim().isEmpty) return null;
    return DateTime.tryParse(value.toString());
  }

  static Map<String, dynamic> _map(dynamic value) {
    if (value is! Map) return <String, dynamic>{};
    return Map<String, dynamic>.from(value);
  }
}

class CustomerFeatureConfiguration {
  const CustomerFeatureConfiguration({
    required this.features,
    this.version,
    this.fromCache = false,
  });

  final Map<String, CustomerFeatureConfig> features;
  final String? version;
  final bool fromCache;

  CustomerFeatureConfig forKey(String key) {
    final String normalized =
        CustomerFeatureConfigurationService.normalizeKey(key);
    return features[normalized] ??
        CustomerFeatureConfig(key: normalized.isEmpty ? key : normalized);
  }

  CustomerFeatureConfiguration copyWithCache(bool value) {
    return CustomerFeatureConfiguration(
      features: features,
      version: version,
      fromCache: value,
    );
  }
}

/// Loads the customer-safe feature registry and retains the last valid one.
///
/// A settings outage is not a reason to hide or disable customer services.
/// Unknown and missing entries therefore resolve to the existing production
/// default (enabled and visible), while an explicitly supplied false value is
/// respected.
class CustomerFeatureConfigurationService {
  CustomerFeatureConfigurationService({
    http.Client? client,
    this.baseUrl = defaultBaseUrl,
    DateTime Function()? now,
  })  : _client = client,
        _now = now ?? DateTime.now;

  static const String defaultBaseUrl = 'https://api.servicepay.ng/api';
  static const String endpointPath = '/settings/customer/features';
  static const String _cacheKey = 'customer_feature_configuration_v1';
  static const int cacheSchemaVersion = 1;
  static const Duration cacheTtl = Duration(minutes: 15);

  final http.Client? _client;
  final String baseUrl;
  final DateTime Function() _now;

  static final Map<String, CustomerFeatureConfig> productionDefaults =
      <String, CustomerFeatureConfig>{
    for (final String key in canonicalKeys)
      key: CustomerFeatureConfig(key: key),
  };

  static const List<String> canonicalKeys = <String>[
    'AIRTIME',
    'DATA',
    'ELECTRICITY',
    'CABLE_TV',
    'EXAM_PIN',
    'NIN_VERIFICATION',
    'BVN_VERIFICATION',
    'DELIVERY',
    'SOLAR',
    'EMPOWERMENT',
    'MARKETPLACE',
    'AMANA',
    'ORGANIZATIONS',
    'ORGANIZATION_WITHDRAWALS',
    'PHONE_FINANCING',
    'SERVICEPAY_CALL',
    'CARDS',
    'MINI_APPS',
    'QR_PAY',
    'PAY_BY_LINK',
    'REQUEST_MONEY',
    'TRANSPORT',
    'AI_SUPPORT',
    'WALLET',
    'WALLET_FUNDING',
    'SERVICEPAY_TRANSFER',
    'BANK_TRANSFER',
    'WITHDRAWAL',
    'REFERRAL',
    'NOTIFICATIONS',
    'GROUP_WALLET',
    'FLIGHT_BOOKING',
    'KEKE_NAPEP',
    'PROGRAM_SPONSOR',
    'STORE_POSTING',
  ];

  static CustomerFeatureConfiguration defaults() =>
      CustomerFeatureConfiguration(features: productionDefaults);

  static String normalizeKey(String value) => value
      .trim()
      .replaceAllMapped(
        RegExp(r'([a-z])([A-Z])'),
        (Match match) => '${match.group(1)}_${match.group(2)}',
      )
      .replaceAll(RegExp(r'[\s-]+'), '_')
      .toUpperCase();

  Future<CustomerFeatureConfiguration> load({
    bool forceRefresh = true,
    http.Client? client,
  }) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    final CustomerFeatureConfiguration? cached = _readCache(preferences);
    final CustomerFeatureConfiguration safe = cached ?? _defaultConfiguration();

    if (!forceRefresh) return safe.copyWithCache(cached != null);

    try {
      final bool ownsClient = client == null && _client == null;
      final http.Client requestClient = client ?? _client ?? http.Client();
      http.Response response = await requestClient.get(
        Uri.parse('$baseUrl$endpointPath'),
        headers: const <String, String>{
          'Accept': 'application/json',
        },
      ).timeout(const Duration(seconds: 12));

      // Keep rollout variants and old appSettings installations working while
      // the customer-safe endpoint is deployed under the settings namespace.
      // Every response is parsed into the same safe model.
      if (response.statusCode == 404 || response.statusCode == 405) {
        for (final String path in <String>[
          '/feature-control/config',
          '/feature-control/public',
          '/settings/public',
        ]) {
          response = await requestClient.get(
            Uri.parse('$baseUrl$path'),
            headers: const <String, String>{
              'Accept': 'application/json',
            },
          ).timeout(const Duration(seconds: 12));
          if (response.statusCode >= 200 && response.statusCode < 300) {
            break;
          }
          if (response.statusCode != 404 && response.statusCode != 405) {
            break;
          }
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (ownsClient) requestClient.close();
        return safe.copyWithCache(cached != null);
      }

      final dynamic decoded = jsonDecode(response.body);
      final CustomerFeatureConfiguration? parsed = _parse(decoded);
      if (parsed == null || parsed.features.isEmpty) {
        if (ownsClient) requestClient.close();
        return safe.copyWithCache(cached != null);
      }

      final CustomerFeatureConfiguration merged = _merge(safe, parsed);
      await preferences.setString(
        _cacheKey,
        jsonEncode(<String, dynamic>{
          'cacheVersion': cacheSchemaVersion,
          'cachedAt': _now().toUtc().toIso8601String(),
          'version': merged.version,
          'features':
              merged.features.values.map((item) => item.toJson()).toList(),
        }),
      );
      if (ownsClient) requestClient.close();
      return merged;
    } catch (_) {
      return safe.copyWithCache(cached != null);
    }
  }

  Future<CustomerFeatureConfig> loadFeature(
    String key, {
    bool forceRefresh = true,
    http.Client? client,
  }) async {
    final CustomerFeatureConfiguration configuration = await load(
      forceRefresh: forceRefresh,
      client: client,
    );
    return configuration.forKey(key);
  }

  CustomerFeatureConfiguration _defaultConfiguration() => defaults();

  CustomerFeatureConfiguration? _readCache(SharedPreferences preferences) {
    final String? raw = preferences.getString(_cacheKey);
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final dynamic decoded = jsonDecode(raw);
      final CustomerFeatureConfiguration? parsed = _parse(decoded);
      if (parsed == null) return null;
      if (!_isFreshCache(decoded)) {
        return _failOpenCachedConfiguration(parsed);
      }
      return parsed.copyWithCache(true);
    } catch (_) {
      return null;
    }
  }

  bool _isFreshCache(dynamic decoded) {
    if (decoded is! Map) return false;
    final dynamic rawVersion = decoded['cacheVersion'];
    final int? cacheVersion = rawVersion is int
        ? rawVersion
        : int.tryParse(rawVersion?.toString() ?? '');
    if (cacheVersion != cacheSchemaVersion) return false;
    final DateTime? cachedAt = DateTime.tryParse(
      decoded['cachedAt']?.toString() ?? '',
    );
    if (cachedAt == null) return false;
    final Duration age = _now().toUtc().difference(cachedAt.toUtc());
    return age >= Duration.zero && age <= cacheTtl;
  }

  CustomerFeatureConfiguration _failOpenCachedConfiguration(
    CustomerFeatureConfiguration cached,
  ) {
    // A stale control can no longer safely represent the current production
    // state. Discard every restriction, including hidden state and maintenance
    // copy, while retaining the canonical production registry.
    return CustomerFeatureConfiguration(
      features: <String, CustomerFeatureConfig>{
        for (final String key in canonicalKeys)
          key: productionDefaults[key]!,
      },
      version: cached.version,
      fromCache: true,
    );
  }

  CustomerFeatureConfiguration? _parse(dynamic decoded) {
    if (decoded is! Map) return null;
    final Map<dynamic, dynamic> root = decoded;
    dynamic raw = root['features'];
    raw ??= root['data'] is Map ? (root['data'] as Map)['features'] : null;
    raw ??=
        root['settings'] is Map ? (root['settings'] as Map)['features'] : null;
    raw ??= root['data'] is List ? root['data'] : null;
    raw ??= root['settings'] is List ? root['settings'] : null;

    final Map<String, CustomerFeatureConfig> result =
        <String, CustomerFeatureConfig>{};
    if (raw is List) {
      for (final dynamic item in raw) {
        if (item is Map) {
          final CustomerFeatureConfig feature =
              CustomerFeatureConfig.fromJson(item);
          final String key = normalizeKey(feature.key);
          if (key.isNotEmpty) result[key] = feature.copyWith();
        }
      }
    } else if (raw is Map) {
      raw.forEach((dynamic rawKey, dynamic value) {
        if (value is Map) {
          final Map<dynamic, dynamic> item = Map<dynamic, dynamic>.from(value);
          item['key'] ??= rawKey;
          final CustomerFeatureConfig feature =
              CustomerFeatureConfig.fromJson(item);
          final String key = normalizeKey(feature.key);
          if (key.isNotEmpty) result[key] = feature;
        }
      });
    }

    // The first customer endpoint may be served by the legacy public settings
    // controller during rollout. Convert only its service booleans here.
    if (result.isEmpty && root['settings'] is Map) {
      final dynamic services = (root['settings'] as Map)['services'];
      if (services is Map) {
        services.forEach((dynamic key, dynamic value) {
          if (value is bool) {
            final String canonical = _legacyKey(key.toString());
            if (canonical.isNotEmpty) {
              result[canonical] = CustomerFeatureConfig(
                key: canonical,
                enabled: value,
                effectiveEnabled: value,
              );
            }
          }
        });
      }
    }
    if (result.isEmpty) return null;
    return CustomerFeatureConfiguration(
      features: result,
      version: _string(root['version'] ?? root['configVersion']),
    );
  }

  CustomerFeatureConfiguration _merge(
    CustomerFeatureConfiguration safe,
    CustomerFeatureConfiguration incoming,
  ) {
    final Map<String, CustomerFeatureConfig> merged =
        <String, CustomerFeatureConfig>{...safe.features};
    incoming.features.forEach((String key, CustomerFeatureConfig value) {
      if (canonicalKeys.contains(key)) {
        merged[key] = CustomerFeatureConfig(
          key: key,
          enabled: value.enabled,
          effectiveEnabled: value.effectiveEnabled,
          visible: value.visible,
          maintenanceMode: value.maintenanceMode,
          title: value.title,
          message: value.message,
          expectedReturnAt: value.expectedReturnAt,
          schedule: value.schedule,
          version: value.version ?? incoming.version,
        );
      }
    });
    return CustomerFeatureConfiguration(
      features: merged,
      version: incoming.version ?? safe.version,
    );
  }

  static String _legacyKey(String key) {
    final String normalized = normalizeKey(key).replaceFirst(
      RegExp(r'_ENABLED$'),
      '',
    );
    const Map<String, String> aliases = <String, String>{
      'CABLETV': 'CABLE_TV',
      'KEKENAPEP': 'KEKE_NAPEP',
      'SERVICEPAYTRANSFER': 'SERVICEPAY_TRANSFER',
      'BANKTRANSFER': 'BANK_TRANSFER',
      'WALLETFUNDING': 'WALLET_FUNDING',
      'NINVERIFICATION': 'NIN_VERIFICATION',
      'BVNVERIFICATION': 'BVN_VERIFICATION',
      'FLIGHTBOOKING': 'FLIGHT_BOOKING',
    };
    final String keyWithoutUnderscores = normalized.replaceAll('_', '');
    return aliases[keyWithoutUnderscores] ??
        (canonicalKeys.contains(normalized) ? normalized : '');
  }

  static String? _string(dynamic value) {
    final String result = value?.toString().trim() ?? '';
    return result.isEmpty ? null : result;
  }
}

/// Protects a direct entry point as well as dashboard tiles.  The child is
/// shown immediately to preserve the old production behaviour while settings
/// load; only an explicit server/cache decision can replace it.
class CustomerFeatureGate extends StatefulWidget {
  const CustomerFeatureGate({
    required this.featureKey,
    required this.child,
    this.client,
    super.key,
  });

  final String featureKey;
  final Widget child;
  final http.Client? client;

  @override
  State<CustomerFeatureGate> createState() => _CustomerFeatureGateState();
}

class _CustomerFeatureGateState extends State<CustomerFeatureGate> {
  CustomerFeatureConfig? blocked;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final CustomerFeatureConfig state =
        await CustomerFeatureConfigurationService().loadFeature(
      widget.featureKey,
      client: widget.client,
    );
    if (!mounted || !state.isBlocked) return;
    setState(() => blocked = state);
  }

  @override
  Widget build(BuildContext context) {
    final CustomerFeatureConfig? state = blocked;
    if (state == null) return widget.child;
    final String title = state.title.trim().isEmpty
        ? 'Temporarily unavailable'
        : state.title.trim();
    final String message =
        state.maintenanceMode && state.message.trim().isNotEmpty
            ? state.message.trim()
            : 'Temporarily unavailable';
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.pause_circle_outline_rounded, size: 56),
              const SizedBox(height: 14),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 16),
              ),
              if (state.expectedReturnAt != null) ...<Widget>[
                const SizedBox(height: 8),
                Text(
                  'Expected back: ${state.expectedReturnAt!.toLocal()}',
                  textAlign: TextAlign.center,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
