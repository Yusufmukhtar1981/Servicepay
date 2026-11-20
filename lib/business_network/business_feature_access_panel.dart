import 'package:flutter/material.dart';
import '../servicepay_theme.dart';

bool businessFeatureAvailableForKind(
  Map<String, dynamic> feature,
  String kind,
) {
  if (feature['ready'] != true) return false;
  final categories = feature['categories'];
  if (categories is! Map) return false;
  final value = categories[kind.toUpperCase()];
  if (value == null) return false;
  if (value is Map) {
    final state = (value['state'] ?? value['status'])?.toString().toUpperCase();
    if (state != null && state.isNotEmpty) {
      return const {'READY', 'AVAILABLE', 'ENABLED', 'ACTIVE', 'SUPPORTED'}
              .contains(state) &&
          value['ready'] != false;
    }
    return value['ready'] == true;
  }
  final state = value.toString().toUpperCase();
  return const {'READY', 'AVAILABLE', 'ENABLED', 'ACTIVE', 'SUPPORTED'}
      .contains(state);
}

class BusinessFeatureAccessPanel extends StatelessWidget {
  const BusinessFeatureAccessPanel({
    required this.featureAccess,
    required this.kind,
    required this.title,
    super.key,
  });

  final List<dynamic> featureAccess;
  final String kind;
  final String title;

  @override
  Widget build(BuildContext context) {
    final entries = featureAccess.whereType<Map>().where((entry) {
      final categories = entry['categories'];
      return categories is Map && categories.containsKey(kind.toUpperCase());
    }).map(
          (entry) => Map<String, dynamic>.from(entry),
        );
    return Card(
      color: ServicePayColors.brandSoft,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: ServicePayColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 5),
            const Text('Services for your account',
                style: TextStyle(color: ServicePayColors.muted, fontSize: 12)),
            const SizedBox(height: 5),
            ...entries.map((entry) => _FeatureAccessRow(
                  feature: entry,
                  kind: kind,
                )),
          ],
        ),
      ),
    );
  }
}

class _FeatureAccessRow extends StatelessWidget {
  const _FeatureAccessRow({required this.feature, required this.kind});

  final Map<String, dynamic> feature;
  final String kind;

  @override
  Widget build(BuildContext context) {
    final categories = feature['categories'];
    final rawCategory =
        categories is Map ? categories[kind.toUpperCase()] : null;
    final category = rawCategory is Map
        ? Map<String, dynamic>.from(rawCategory)
        : const <String, dynamic>{};
    final state = (category['state'] ??
            category['status'] ??
            (rawCategory is String ? rawCategory : null))
        ?.toString()
        .toUpperCase();
    final available = businessFeatureAvailableForKind(feature, kind);
    final comingSoon = state == 'COMING_SOON' || state == 'COMINGSOON';
    final status = available
        ? 'Available'
        : comingSoon
            ? 'Coming Soon'
            : 'Temporarily Unavailable';
    final history = feature['history'] == true || category['history'] == true;
    // Provider/configuration reasons belong to Admin, never customer copy.
    final explanation = available
        ? 'You can use this service.'
        : comingSoon
            ? 'This service is not available yet.'
            : 'Please try again later or contact Business Support.';
    return Padding(
      padding: const EdgeInsets.only(top: 11),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            available ? Icons.check_circle_outline : Icons.info_outline,
            size: 19,
            color:
                available ? ServicePayColors.accent : ServicePayColors.muted,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        feature['label']?.toString() ??
                            feature['key']?.toString() ??
                            'Service',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
                Text(status,
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w700)),
                Text(explanation,
                    style: const TextStyle(
                        fontSize: 12, height: 1.35, color: ServicePayColors.muted)),
                if (history)
                  const Text(
                    'Existing history remains accessible.',
                    style: TextStyle(
                        fontSize: 12, height: 1.35, color: ServicePayColors.accent),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

bool featureReady(Map<String, dynamic> feature) => feature['ready'] == true;

