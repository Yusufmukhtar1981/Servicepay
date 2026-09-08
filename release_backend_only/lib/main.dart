import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';
import 'reset_password_screen.dart';
import 'startup_session_gate.dart';
import 'servicepay_theme.dart';
import 'privacy_policy_screen.dart';
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
  // Register the top-level background entry point before mounting any UI.
  // The handler initializes Firebase inside its own isolate when invoked.
  FirebaseMessaging.onBackgroundMessage(
    firebaseMessagingBackgroundHandler,
  );

  // Authentication and the customer UI do not depend on notification setup.
  // Mount the app immediately so a slow or unavailable Firebase/plugin
  // initialization can never hold the customer on the startup splash.
  runApp(const ServicePayApp());
  unawaited(
    initializeServicePayServices()
        .timeout(const Duration(seconds: 5))
        .catchError((Object error, StackTrace stackTrace) {
      debugPrint('ServicePay background startup failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }),
  );
}

Future<void> initializeServicePayServices() async {
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  await RiderDeliveryAlertService.initialize();

  // Messaging listeners are process-wide; RiderMainNavigation supplies the
  // Rider-facing presentation callback only after an authenticated Rider opens.
  unawaited(Future<void>.delayed(const Duration(milliseconds: 300), () async {
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
  }).catchError((Object error, StackTrace stackTrace) {
    debugPrint('Messaging listener startup failed: $error');
  }));
}

class ServicePayBootstrap extends StatefulWidget {
  const ServicePayBootstrap({
    super.key,
    this.initializeServices = initializeServicePayServices,
    this.startupTimeout = const Duration(seconds: 5),
  });

  final Future<void> Function() initializeServices;
  final Duration startupTimeout;

  @override
  State<ServicePayBootstrap> createState() => _ServicePayBootstrapState();
}

class _ServicePayBootstrapState extends State<ServicePayBootstrap> {
  bool _isReady = false;

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      await widget.initializeServices().timeout(widget.startupTimeout);
    } on TimeoutException catch (error, stackTrace) {
      debugPrint('ServicePay startup timed out: $error');
      debugPrintStack(stackTrace: stackTrace);
    } catch (error, stackTrace) {
      debugPrint('ServicePay startup failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }

    if (mounted) {
      setState(() {
        _isReady = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isReady) {
      return const ServicePayApp();
    }

    return MaterialApp(
      title: 'ServicePay',
      debugShowCheckedModeBanner: false,
      theme: ServicePayTheme.light(),
      home: const ServicePayStartupScreen(),
    );
  }
}

class ServicePayStartupScreen extends StatelessWidget {
  const ServicePayStartupScreen({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Color(0xFFF7F9F8),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'ServicePay',
              style: TextStyle(
                color: Color(0xFF0F766E),
                fontSize: 30,
                fontWeight: FontWeight.w800,
              ),
            ),
            SizedBox(height: 24),
            SizedBox(
              width: 32,
              height: 32,
              child: CircularProgressIndicator(
                strokeWidth: 3,
                color: Color(0xFF0F766E),
              ),
            ),
            SizedBox(height: 16),
            Text(
              'Preparing your account…',
              style: TextStyle(
                color: Color(0xFF52605D),
                fontSize: 15,
              ),
            ),
          ],
        ),
      ),
    );
  }
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

    if (path == '/privacy-policy' || path == '/privacy-policy/') {
      return const PrivacyPolicyScreen();
    }

    return kIsWeb ? const PublicWebsiteScreen() : const StartupSessionGate();
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return MaterialApp(
      title: 'ServicePay',
      navigatorKey: servicePayNavigatorKey,
      debugShowCheckedModeBanner: false,
      theme: ServicePayTheme.light(),
      home: getInitialScreen(),
    );
  }
}
