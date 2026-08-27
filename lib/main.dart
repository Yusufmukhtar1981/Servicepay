import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';
import 'login_screen.dart';
import 'reset_password_screen.dart';

import 'package:flutter/foundation.dart';
import 'public_website_screen.dart';
import 'rider/rider_delivery_alert_service.dart';

final GlobalKey<NavigatorState> servicePayNavigatorKey =
    GlobalKey<NavigatorState>();

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

  await RiderDeliveryAlertService.handleBackgroundMessage(message);
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
  await RiderDeliveryAlertService.initialize();

  runApp(
    const ServicePayApp(),
  );

  // Messaging listeners are process-wide; RiderMainNavigation supplies the
  // Rider-facing presentation callback only after an authenticated Rider opens.
  Future<void>.delayed(const Duration(milliseconds: 300), () async {
    FirebaseMessaging.onMessage.listen(
      RiderDeliveryAlertService.handleForegroundMessage,
    );

    FirebaseMessaging.onMessageOpenedApp.listen(
      (RemoteMessage message) =>
          RiderDeliveryAlertService.handleOpenedMessage(message),
    );

    final RemoteMessage? initialMessage =
        await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) {
      await RiderDeliveryAlertService.handleOpenedMessage(initialMessage);
    }
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
      navigatorKey: servicePayNavigatorKey,
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
