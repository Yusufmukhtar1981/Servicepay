import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// The deliberately small data contract retained for an alert launch.
@immutable
class RiderDeliveryAlertPayload {
  const RiderDeliveryAlertPayload({
    required this.orderId,
    required this.assignmentEventId,
    required this.reference,
    required this.pickup,
    required this.dropoff,
  });

  final String orderId;
  final String assignmentEventId;
  final String reference;
  final String pickup;
  final String dropoff;

  static RiderDeliveryAlertPayload? fromData(Map<String, dynamic> data) {
    String value(List<String> keys) {
      for (final String key in keys) {
        final String candidate = data[key]?.toString().trim() ?? '';
        if (candidate.isNotEmpty) return candidate;
      }
      return '';
    }

    final String event =
        value(<String>['event', 'type', 'notificationType']).toUpperCase();
    if (event != 'DELIVERY_ASSIGNED') return null;
    final String orderId = value(<String>[
      'orderId',
      'order_id',
      'deliveryId',
      'delivery_id',
      'id',
    ]);
    if (orderId.isEmpty) return null;
    final String assignmentEventId = value(<String>[
      'assignmentEventId',
      'assignment_event_id',
      'eventId',
      'event_id',
    ]);
    return RiderDeliveryAlertPayload(
      orderId: orderId,
      assignmentEventId:
          assignmentEventId.isEmpty ? 'legacy:$orderId' : assignmentEventId,
      reference: value(<String>[
        'deliveryReference',
        'reference',
        'trackingNumber',
        'tracking_number'
      ]),
      pickup: value(<String>[
        'pickupLocation',
        'pickup',
        'pickupAddress',
        'pickup_address',
      ]),
      dropoff: value(<String>[
        'dropoffLocation',
        'dropoff',
        'deliveryAddress',
        'delivery_address',
        'destination',
      ]),
    );
  }

  Map<String, String> toJson() => <String, String>{
        'orderId': orderId,
        'assignmentEventId': assignmentEventId,
        'reference': reference,
        'pickup': pickup,
        'dropoff': dropoff,
      };

  static RiderDeliveryAlertPayload? fromJson(String encoded) {
    try {
      final dynamic decoded = jsonDecode(encoded);
      if (decoded is! Map) return null;
      final Map<String, dynamic> data = Map<String, dynamic>.from(decoded);
      final String orderId = data['orderId']?.toString().trim() ?? '';
      if (orderId.isEmpty) return null;
      return RiderDeliveryAlertPayload(
        orderId: orderId,
        assignmentEventId:
            data['assignmentEventId']?.toString().trim().isNotEmpty == true
                ? data['assignmentEventId'].toString().trim()
                : 'legacy:$orderId',
        reference: data['reference']?.toString() ?? '',
        pickup: data['pickup']?.toString() ?? '',
        dropoff: data['dropoff']?.toString() ?? '',
      );
    } catch (_) {
      return null;
    }
  }
}

class RiderDeliveryAlertService {
  RiderDeliveryAlertService._();

  static const String channelId = 'servicepay_delivery_assignments_v2';
  static const String channelName = 'Delivery Assignments';
  static const String _pendingPrefix = 'rider_delivery_alert_';
  static const String _shownEventPrefix =
      'rider_delivery_alert_shown_event_v2_';
  static const String _cancelledEventPrefix =
      'rider_delivery_alert_cancelled_event_v2_';
  static final FlutterLocalNotificationsPlugin _notifications =
      FlutterLocalNotificationsPlugin();
  static bool _initialized = false;
  static bool _refreshListenerInstalled = false;
  static RiderDeliveryAlertPayload? _deferredOpen;

  /// Installed by RiderMainNavigation, never persisted.
  static Future<void> Function(RiderDeliveryAlertPayload payload)? onOpenOrder;
  static Future<void> Function(RiderDeliveryAlertPayload payload)?
      onIncomingAlert;

  static int notificationIdFor(String orderId) {
    var hash = 0;
    for (final int unit in orderId.codeUnits) {
      hash = (hash * 31 + unit) & 0x7fffffff;
    }
    return hash == 0 ? 1 : hash;
  }

  static String deduplicationKeyFor(RiderDeliveryAlertPayload payload) =>
      _shownEventPrefix + payload.assignmentEventId;

  static bool cancellationMatches({
    required String pendingAssignmentEventId,
    required String cancellationAssignmentEventId,
  }) =>
      pendingAssignmentEventId.isEmpty ||
      cancellationAssignmentEventId.isEmpty ||
      pendingAssignmentEventId == cancellationAssignmentEventId;

  static String notificationBodyFor(RiderDeliveryAlertPayload payload) {
    if (payload.reference.trim().isNotEmpty) {
      return 'Delivery ${payload.reference.trim()} is ready. Tap to view details.';
    }
    return 'A delivery is ready. Tap to view details.';
  }

  static Future<void> initialize() async {
    if (_initialized || kIsWeb) return;
    const AndroidInitializationSettings android =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    await _notifications.initialize(
      const InitializationSettings(android: android),
      onDidReceiveNotificationResponse: (NotificationResponse response) async {
        final RiderDeliveryAlertPayload? payload =
            RiderDeliveryAlertPayload.fromJson(response.payload ?? '');
        if (payload != null) await open(payload);
      },
    );
    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      channelId,
      channelName,
      description: 'Urgent assigned delivery alerts',
      importance: Importance.max,
      playSound: true,
      sound: RawResourceAndroidNotificationSound('servicepay_delivery_order'),
      enableVibration: true,
    );
    await _notifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);
    _initialized = true;

    final NotificationAppLaunchDetails? launch =
        await _notifications.getNotificationAppLaunchDetails();
    final RiderDeliveryAlertPayload? payload =
        RiderDeliveryAlertPayload.fromJson(
      launch?.notificationResponse?.payload ?? '',
    );
    if (launch?.didNotificationLaunchApp ?? false) {
      if (payload != null) await _dispatchWhenReady(payload);
    }
  }

  static Future<void> handleBackgroundMessage(RemoteMessage message) async {
    await initialize();
    await _handle(message);
  }

  static Future<void> handleForegroundMessage(RemoteMessage message) async {
    await _handle(message, openAfterAlert: true);
  }

  static Future<void> handleOpenedMessage(RemoteMessage message) async {
    final RiderDeliveryAlertPayload? payload =
        RiderDeliveryAlertPayload.fromData(message.data);
    if (payload != null) await open(payload);
  }

  static Future<void> _handle(
    RemoteMessage message, {
    bool openAfterAlert = false,
  }) async {
    final String event = (message.data['event'] ?? message.data['type'] ?? '')
        .toString()
        .trim()
        .toUpperCase();
    if (event == 'DELIVERY_ASSIGNMENT_CANCELLED') {
      final String id = (message.data['orderId'] ??
              message.data['deliveryId'] ??
              message.data['order_id'] ??
              message.data['delivery_id'] ??
              '')
          .toString();
      final String assignmentEventId =
          (message.data['assignmentEventId'] ??
                  message.data['assignment_event_id'] ??
                  '')
              .toString()
              .trim();
      if (id.trim().isNotEmpty) {
        await cancelAssignment(
          id.trim(),
          assignmentEventId: assignmentEventId,
        );
      }
      return;
    }
    final RiderDeliveryAlertPayload? payload =
        RiderDeliveryAlertPayload.fromData(message.data);
    if (payload == null) return;
    final bool newlyShown = await show(payload);
    if (openAfterAlert && newlyShown) {
      final Future<void> Function(RiderDeliveryAlertPayload payload)? callback =
          onIncomingAlert;
      if (callback != null) await callback(payload);
    }
  }

  static Future<bool> show(RiderDeliveryAlertPayload payload) async {
    await initialize();
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String shownEventKey = deduplicationKeyFor(payload);
    if (prefs.getBool(_cancelledEventPrefix + payload.assignmentEventId) ??
        false) {
      return false;
    }
    if (prefs.getBool(shownEventKey) ?? false) return false;
    await prefs.setBool(shownEventKey, true);
    await prefs.setString(
        _pendingPrefix + payload.orderId, jsonEncode(payload.toJson()));
    final AndroidNotificationDetails android = AndroidNotificationDetails(
      channelId,
      channelName,
      channelDescription: 'Urgent assigned delivery alerts',
      importance: Importance.max,
      priority: Priority.max,
      category: AndroidNotificationCategory.message,
      visibility: NotificationVisibility.private,
      ongoing: false,
      autoCancel: true,
      timeoutAfter: 45000,
      playSound: true,
      sound: RawResourceAndroidNotificationSound('servicepay_delivery_order'),
      enableVibration: true,
      vibrationPattern: Int64List.fromList(<int>[0, 750, 400, 750]),
      // Android Notification.FLAG_INSISTENT: repeat sound until cancelled.
      additionalFlags: Int32List.fromList(<int>[4]),
    );
    try {
      await _notifications.show(
        notificationIdFor(payload.orderId),
        'Delivery Assigned',
        notificationBodyFor(payload),
        NotificationDetails(android: android),
        payload: jsonEncode(payload.toJson()),
      );
      return true;
    } catch (_) {
      await prefs.remove(shownEventKey);
      rethrow;
    }
  }

  static Future<void> cancel(String orderId) async {
    await initialize();
    await _notifications.cancel(notificationIdFor(orderId));
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pendingPrefix + orderId);
  }

  static Future<void> cancelAssignment(
    String orderId, {
    required String assignmentEventId,
  }) async {
    await initialize();
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    if (assignmentEventId.isNotEmpty) {
      await prefs.setBool(
        _cancelledEventPrefix + assignmentEventId,
        true,
      );
    }
    final RiderDeliveryAlertPayload? pending =
        RiderDeliveryAlertPayload.fromJson(
      prefs.getString(_pendingPrefix + orderId) ?? '',
    );
    if (pending != null &&
        !cancellationMatches(
          pendingAssignmentEventId: pending.assignmentEventId,
          cancellationAssignmentEventId: assignmentEventId,
        )) {
      return;
    }
    await _notifications.cancel(notificationIdFor(orderId));
    await prefs.remove(_pendingPrefix + orderId);
  }

  static Future<bool?> requestNotificationPermission() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return null;
    await initialize();
    return _notifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.requestNotificationsPermission();
  }

  static Future<void> open(RiderDeliveryAlertPayload payload) async {
    await cancel(payload.orderId);
    await _dispatchWhenReady(payload);
  }

  static Future<void> _dispatchWhenReady(
      RiderDeliveryAlertPayload payload) async {
    final Future<void> Function(RiderDeliveryAlertPayload payload)? callback =
        onOpenOrder;
    if (callback != null) {
      await callback(payload);
    } else {
      _deferredOpen = payload;
    }
  }

  static Future<void> registerCurrentToken() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    if ((prefs.getString('user_role') ?? '').toUpperCase() !=
        'DELIVERY_RIDER') {
      return;
    }
    final String auth = prefs.getString('auth_token')?.trim() ?? '';
    final String? fcmToken = await FirebaseMessaging.instance.getToken();
    if (auth.isEmpty || fcmToken == null || fcmToken.isEmpty) return;
    final http.Response response = await http
        .post(
          Uri.parse('https://api.servicepay.ng/api/riders/device-tokens'),
          headers: <String, String>{
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $auth',
          },
          body: jsonEncode(<String, String>{
            'token': fcmToken,
            'platform': 'ANDROID',
          }),
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Unable to register this device for delivery alerts.');
    }
  }

  static void listenForTokenRefresh() {
    if (_refreshListenerInstalled) return;
    _refreshListenerInstalled = true;
    FirebaseMessaging.instance.onTokenRefresh.listen((String _) async {
      try {
        await registerCurrentToken();
      } catch (error) {
        debugPrint('Rider push-token refresh failed: $error');
      }
    });
  }

  static Future<void> activate({
    required Future<void> Function(RiderDeliveryAlertPayload payload)
        onIncoming,
    required Future<void> Function(RiderDeliveryAlertPayload payload) onOpen,
  }) async {
    onIncomingAlert = onIncoming;
    onOpenOrder = onOpen;
    final RiderDeliveryAlertPayload? deferred = _deferredOpen;
    _deferredOpen = null;
    if (deferred != null) await onOpen(deferred);
  }

  static Future<void> unregisterCurrentToken() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String auth = prefs.getString('auth_token')?.trim() ?? '';
    final String? fcmToken = await FirebaseMessaging.instance.getToken();
    if (auth.isEmpty || fcmToken == null || fcmToken.isEmpty) return;
    try {
      await http
          .delete(
            Uri.parse('https://api.servicepay.ng/api/riders/device-tokens'),
            headers: <String, String>{
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $auth',
            },
            body: jsonEncode(<String, String>{'token': fcmToken}),
          )
          .timeout(const Duration(seconds: 10));
    } catch (error) {
      debugPrint('Rider push-token removal failed: $error');
    }
  }
}
