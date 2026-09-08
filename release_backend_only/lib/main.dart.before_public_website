import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';
import 'login_screen.dart';
import 'reset_password_screen.dart';

/*
 * =====================================================
 * FIREBASE BACKGROUND MESSAGE HANDLER
 * =====================================================
 *
 * Mainly used by Android/iOS.
 *
 * Flutter Web background notifications will also
 * use firebase-messaging-sw.js, which we will create
 * in the next step.
 */
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(
  RemoteMessage message,
) async {
  await Firebase.initializeApp(
    options:
        DefaultFirebaseOptions.currentPlatform,
  );

  debugPrint(
    'SERVICEPAY BACKGROUND FCM: ${message.messageId}',
  );
}

/*
 * =====================================================
 * MAIN
 * =====================================================
 */
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  /*
   * Initialize Firebase for Android + Web.
   */
  await Firebase.initializeApp(
    options:
        DefaultFirebaseOptions.currentPlatform,
  );

  /*
   * Register background handler.
   */
  FirebaseMessaging.onBackgroundMessage(
    firebaseMessagingBackgroundHandler,
  );

  /*
   * Ask permission for notifications.
   *
   * On Web this may trigger browser notification
   * permission when supported.
   *
   * We intentionally do NOT request the Web Push
   * token here yet because we still need the
   * ServicePay VAPID public key.
   */
  try {
    await FirebaseMessaging.instance
        .requestPermission(
      alert: true,
      badge: true,
      sound: true,
      announcement: false,
      carPlay: false,
      criticalAlert: false,
      provisional: false,
    );
  } catch (error) {
    debugPrint(
      'SERVICEPAY FCM PERMISSION ERROR: $error',
    );
  }

  /*
   * Foreground Firebase messages.
   *
   * Later, incoming Keke messages will be connected
   * to the Rider alert screen.
   */
  FirebaseMessaging.onMessage.listen(
    (
      RemoteMessage message,
    ) {
      debugPrint(
        'SERVICEPAY FOREGROUND FCM: ${message.messageId}',
      );

      debugPrint(
        'SERVICEPAY FCM TITLE: ${message.notification?.title}',
      );

      debugPrint(
        'SERVICEPAY FCM BODY: ${message.notification?.body}',
      );

      debugPrint(
        'SERVICEPAY FCM DATA: ${message.data}',
      );
    },
  );

  /*
   * User tapped a notification and opened ServicePay.
   */
  FirebaseMessaging.onMessageOpenedApp.listen(
    (
      RemoteMessage message,
    ) {
      debugPrint(
        'SERVICEPAY FCM OPENED: ${message.messageId}',
      );

      debugPrint(
        'SERVICEPAY FCM OPENED DATA: ${message.data}',
      );
    },
  );

  runApp(
    const ServicePayApp(),
  );
}

/*
 * =====================================================
 * SERVICEPAY APP
 * =====================================================
 */
class ServicePayApp
    extends StatelessWidget {
  const ServicePayApp({
    super.key,
  });

  Widget getInitialScreen() {
    final Uri currentUri =
        Uri.base;

    final String path =
        currentUri.path.toLowerCase();

    final String resetMode =
        currentUri
                .queryParameters[
                    'reset-password']
                ?.toLowerCase() ??
            '';

    final String mode =
        currentUri
                .queryParameters[
                    'mode']
                ?.toLowerCase() ??
            '';

    final String token =
        currentUri
                .queryParameters[
                    'token']
                ?.trim() ??
            '';

    final bool isResetPasswordLink =
        path == '/reset-password' ||
            path.endsWith(
              '/reset-password/',
            ) ||
            resetMode == 'true' ||
            mode == 'reset-password';

    if (isResetPasswordLink) {
      return ResetPasswordScreen(
        token: token,
      );
    }

    return const LoginScreen();
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return MaterialApp(
      title: 'ServicePay',
      debugShowCheckedModeBanner:
          false,
      theme: ThemeData(
        colorScheme:
            ColorScheme.fromSeed(
          seedColor:
              const Color(
            0xFF159447,
          ),
        ),
        useMaterial3: true,
        scaffoldBackgroundColor:
            const Color(
          0xFFF7F9F8,
        ),
      ),
      home:
          getInitialScreen(),
    );
  }
}