import 'package:flutter/material.dart';

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
    final entries = featureAccess.whereType<Map>().map(
          (entry) => Map<String, dynamic>.from(entry),
        );
    return Card(
      color: const Color(0xFFEAF3ED),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFD5E5D9)),
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
            Text('Status for ${kind.toUpperCase()} purchases',
                style: const TextStyle(color: Color(0xFF59685F), fontSize: 12)),
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
    final status = !feature.containsKey('ready')
        ? 'Status not confirmed'
        : !feature.containsKey('categories') || rawCategory == null
            ? 'Not confirmed for ${kind.toUpperCase()}'
            : !featureReady(feature)
                ? _humanState(state ?? 'DISABLED')
                : available
                    ? 'Available'
                    : _humanState(state ?? 'NOT_CONFIRMED');
    final history = feature['history'] == true || category['history'] == true;
    final reason = (category['reason'] ?? feature['reason'])?.toString();
    final explanation = reason?.trim().isNotEmpty == true
        ? reason!.trim()
        : available
            ? 'The service is ready for this purchase category.'
            : state == 'MAINTENANCE'
                ? 'Temporarily unavailable while maintenance is in progress.'
                : state == 'COMING_SOON' || state == 'COMINGSOON'
                    ? 'This service is planned but is not available yet.'
                    : state == 'DISABLED'
                        ? 'This service is currently disabled.'
                        : 'Availability has not been confirmed for this category.';
    return Padding(
      padding: const EdgeInsets.only(top: 11),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            available ? Icons.check_circle_outline : Icons.info_outline,
            size: 19,
            color:
                available ? const Color(0xFF08783E) : const Color(0xFF65736B),
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
                    Text(status,
                        style: const TextStyle(
                            fontSize: 12, fontWeight: FontWeight.w700)),
                  ],
                ),
                Text(explanation,
                    style: const TextStyle(
                        fontSize: 12, height: 1.35, color: Color(0xFF59685F))),
                if (history)
                  const Text(
                    'Existing history remains accessible.',
                    style: TextStyle(
                        fontSize: 12, height: 1.35, color: Color(0xFF315B43)),
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

String _humanState(String state) {
  return switch (state) {
    'COMING_SOON' || 'COMINGSOON' => 'Coming soon',
    'MAINTENANCE' || 'UNDER_MAINTENANCE' => 'Maintenance',
    'DISABLED' || 'OFF' => 'Disabled',
    'NOT_CONFIRMED' => 'Not confirmed',
    'READY' ||
    'AVAILABLE' ||
    'ENABLED' ||
    'ACTIVE' ||
    'SUPPORTED' =>
      'Unavailable',
    _ => 'Not available',
  };
}
