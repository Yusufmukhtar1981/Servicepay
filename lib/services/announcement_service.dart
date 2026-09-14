import 'dart:convert';

import 'package:http/http.dart' as http;

class ServicePayAnnouncement {
  const ServicePayAnnouncement({
    required this.id,
    required this.title,
    required this.message,
    required this.type,
    required this.displayStyle,
    required this.priority,
    required this.visibility,
    required this.mandatory,
    this.imageUrl,
    this.cta,
    this.startsAt,
    this.endsAt,
    this.createdAt,
    this.viewed = false,
    this.acknowledged = false,
    this.dismissed = false,
    this.clicked = false,
  });

  final String id;
  final String title;
  final String message;
  final String type;
  final String displayStyle;
  final String? imageUrl;
  final Map<String, dynamic>? cta;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final int priority;
  final String visibility;
  final bool mandatory;
  final DateTime? createdAt;
  final bool viewed;
  final bool acknowledged;
  final bool dismissed;
  final bool clicked;

  bool get isPopup => displayStyle == 'POPUP' || displayStyle == 'BOTH';
  bool get isBanner => displayStyle == 'BANNER' || displayStyle == 'BOTH';
  bool get canDismiss => !mandatory;
  String? get ctaText => cta?['text']?.toString().trim().isEmpty == true
      ? null
      : cta?['text']?.toString();
  String? get ctaAction => cta?['action']?.toString();

  factory ServicePayAnnouncement.fromJson(Map<String, dynamic> json) {
    DateTime? date(dynamic value) =>
        value == null ? null : DateTime.tryParse(value.toString());
    final dynamic rawCta = json['cta'];
    final dynamic interaction =
        json['interaction'] ?? json['userInteraction'] ?? json['interactions'];
    final Map<String, dynamic> interactionMap =
        interaction is Map ? Map<String, dynamic>.from(interaction) : json;
    bool flag(String key) =>
        json[key] == true ||
        interactionMap[key] == true ||
        interactionMap['is${key[0].toUpperCase()}${key.substring(1)}'] == true;
    return ServicePayAnnouncement(
      id: (json['id'] ?? json['_id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      message: (json['message'] ?? '').toString(),
      type: (json['type'] ?? 'INFO').toString().toUpperCase(),
      displayStyle: (json['displayStyle'] ?? json['style'] ?? 'BANNER')
          .toString()
          .toUpperCase(),
      imageUrl: json['imageUrl']?.toString(),
      cta: rawCta is Map
          ? <String, dynamic>{
              ...Map<String, dynamic>.from(rawCta),
              if (rawCta['text'] == null) 'text': rawCta['label'],
              if (rawCta['action'] == null) 'action': rawCta['url'],
            }
          : null,
      startsAt: date(json['startsAt'] ?? json['startAt']),
      endsAt: date(json['endsAt'] ?? json['endAt']),
      priority: json['priority'] is num
          ? (json['priority'] as num).toInt()
          : int.tryParse('${json['priority']}') ?? 0,
      visibility: (json['visibility'] ?? 'always').toString().toLowerCase(),
      mandatory: json['mandatory'] == true ||
          (json['visibility']?.toString().toUpperCase() == 'MANDATORY'),
      createdAt: date(json['createdAt']),
      viewed: flag('viewed'),
      acknowledged: flag('acknowledged'),
      dismissed: flag('dismissed'),
      clicked: flag('clicked'),
    );
  }
}

class AnnouncementService {
  AnnouncementService({
    http.Client? client,
    this.baseUrl = 'https://api.servicepay.ng/api',
    required this.token,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String baseUrl;
  final String token;

  Map<String, String> get _headers => <String, String>{
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      };

  Future<List<ServicePayAnnouncement>> fetchActive() async {
    final response = await _client
        .get(Uri.parse('$baseUrl/announcements/active'), headers: _headers)
        .timeout(const Duration(seconds: 12));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Announcements are temporarily unavailable.');
    }
    final dynamic decoded = jsonDecode(response.body);
    dynamic list = decoded;
    if (decoded is Map) {
      list = decoded['announcements'] ?? decoded['data'] ?? decoded['items'];
      if (list is Map) {
        list = list['announcements'] ?? list['items'];
      }
    }
    if (list is! List) return <ServicePayAnnouncement>[];
    final now = DateTime.now();
    return list
        .whereType<Map>()
        .map((item) =>
            ServicePayAnnouncement.fromJson(Map<String, dynamic>.from(item)))
        .where((item) {
      return item.id.isNotEmpty &&
          (item.startsAt == null || !now.isBefore(item.startsAt!)) &&
          (item.endsAt == null || !now.isAfter(item.endsAt!));
    }).toList()
      ..sort((a, b) => b.priority != a.priority
          ? b.priority.compareTo(a.priority)
          : (b.createdAt ?? DateTime(1970))
              .compareTo(a.createdAt ?? DateTime(1970)));
  }

  Future<bool> _post(String id, String action) async {
    try {
      final http.Response response = await _client
          .post(
              Uri.parse(
                  '$baseUrl/announcements/${Uri.encodeComponent(id)}/$action'),
              headers: _headers)
          .timeout(const Duration(seconds: 10));
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      // Interaction telemetry is best effort and must never interrupt the
      // dashboard or prevent a customer from continuing.
      return false;
    }
  }

  Future<bool> view(String id) => _post(id, 'view');
  Future<bool> acknowledge(String id) => _post(id, 'acknowledge');
  Future<bool> dismiss(String id) => _post(id, 'dismiss');
  Future<bool> click(String id) => _post(id, 'click');
}
