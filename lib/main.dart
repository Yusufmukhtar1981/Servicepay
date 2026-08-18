import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';
import 'login_screen.dart';
import 'reset_password_screen.dart';

import 'package:flutter/foundation.dart';
import 'public_website_screen.dart';

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
    options: DefaultFirebaseOptions.currentPlatform,
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

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  FirebaseMessaging.onBackgroundMessage(
    firebaseMessagingBackgroundHandler,
  );

  runApp(
    const ServicePayApp(),
  );

  // Non-critical notification setup runs after the UI has started.
  Future<void>.delayed(const Duration(milliseconds: 300), () async {
    try {
      await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        announcement: false,
        carPlay: false,
        criticalAlert: false,
        provisional: false,
      );
    } catch (error) {
      debugPrint('SERVICEPAY FCM PERMISSION ERROR: $error');
    }

    FirebaseMessaging.onMessage.listen(
      (RemoteMessage message) {
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

    FirebaseMessaging.onMessageOpenedApp.listen(
      (RemoteMessage message) {
        debugPrint(
          'SERVICEPAY FCM OPENED: ${message.messageId}',
        );
        debugPrint(
          'SERVICEPAY FCM OPENED DATA: ${message.data}',
        );
      },
    );
  });
}

class ServicePayApp extends StatelessWidget {
  const ServicePayApp({
    super.key,
  });

  Widget getInitialScreen() {
    final Uri currentUri = Uri.base;

    final String path = currentUri.path.toLowerCase();

    final String resetMode =
        currentUri.queryParameters['reset-password']?.toLowerCase() ?? '';

    final String mode = currentUri.queryParameters['mode']?.toLowerCase() ?? '';

    final String token = currentUri.queryParameters['token']?.trim() ?? '';

    final bool isResetPasswordLink = path == '/reset-password' ||
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
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(
            0xFF159447,
          ),
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(
          0xFFF7F9F8,
        ),
      ),
      home: kIsWeb ? const PublicWebsiteScreen() : getInitialScreen(),
    );
  }
}
