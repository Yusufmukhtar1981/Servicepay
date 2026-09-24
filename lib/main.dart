import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'firebase_options.dart';
import 'login_screen.dart';
import 'reset_password_screen.dart';
import 'startup_session_gate.dart';
import 'servicepay_theme.dart';
import 'privacy_policy_screen.dart';
import 'public_website_screen.dart';
import 'register_screen.dart';
import 'referral_attribution_service.dart';
import 'services/session_store.dart';
import 'edupay/edupay_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'rider/rider_delivery_alert_service.dart';
import 'rider/rider_auth_session.dart';

final GlobalKey<NavigatorState> servicePayNavigatorKey =
    GlobalKey<NavigatorState>();

bool isServicePayRegistrationUri(Uri uri) {
  final path = uri.path.toLowerCase();
  final mode = uri.queryParameters['mode']?.trim().toLowerCase();
  final register = uri.queryParameters['register']?.trim().toLowerCase();

  return path == '/register' ||
      path == '/register/' ||
      mode == 'register' ||
      register == 'true';
}

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
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

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
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

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
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  await RiderDeliveryAlertService.initialize();

  // Messaging listeners are process-wide; RiderMainNavigation supplies the
  // Rider-facing presentation callback only after an authenticated Rider opens.
  unawaited(
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
    }).catchError((Object error, StackTrace stackTrace) {
      debugPrint('Messaging listener startup failed: $error');
    }),
  );
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
  const ServicePayStartupScreen({super.key});

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
              style: TextStyle(color: Color(0xFF52605D), fontSize: 15),
            ),
          ],
        ),
      ),
    );
  }
}

class ServicePayApp extends StatefulWidget {
  const ServicePayApp({super.key});

  @override
  State<ServicePayApp> createState() => _ServicePayAppState();
}

class _ServicePayAppState extends State<ServicePayApp> {
  static const MethodChannel _deepLinkChannel =
      MethodChannel('ng.servicepay.app/deep_links');
  static const EventChannel _deepLinkEvents =
      EventChannel('ng.servicepay.app/deep_links/events');
  Uri? _nativeInitialUri;
  StreamSubscription<dynamic>? _deepLinkSubscription;
  bool _registrationRouteOpening = false;

  @override
  void initState() {
    super.initState();
    _readNativeInitialUri();
    if (!kIsWeb) {
      _deepLinkSubscription = _deepLinkEvents.receiveBroadcastStream().listen(
        (dynamic value) => _handleNativeUri(value?.toString()),
      );
    }
  }

  Future<void> _readNativeInitialUri() async {
    if (kIsWeb) return;
    try {
      final value = await _deepLinkChannel.invokeMethod<String>('initialUri');
      _handleNativeUri(value);
    } on PlatformException {
      // Older builds have no deep-link channel; normal startup is unchanged.
    } catch (_) {
      // A malformed or unavailable platform link must not block login.
    }
  }

  void _handleNativeUri(String? value) {
    if (value == null || value.trim().isEmpty) return;
    final uri = Uri.tryParse(value);
    if (uri == null || !isServicePayRegistrationUri(uri)) return;
    _nativeInitialUri = uri;
    if (!mounted) return;

    // A warm app already has a Navigator stack. Rebuilding MaterialApp.home
    // does not leave the current screen, so explicitly push registration.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _registrationRouteOpening) return;
      final navigator = servicePayNavigatorKey.currentState;
      if (navigator == null) {
        setState(() {});
        return;
      }
      _registrationRouteOpening = true;
      navigator
          .push<void>(
        MaterialPageRoute<void>(
          builder: (_) => RegisterScreen(
            initialReferralCode: ReferralCodeNormalizer.fromUri(uri),
          ),
        ),
      )
          .whenComplete(() {
        _registrationRouteOpening = false;
      });
    });
  }

  @override
  void dispose() {
    _deepLinkSubscription?.cancel();
    super.dispose();
  }

  Widget getInitialScreen() {
    final Uri currentUri = _nativeInitialUri ?? Uri.base;

    final String path = currentUri.path.toLowerCase();

    final String resetMode =
        currentUri.queryParameters['reset-password']?.toLowerCase() ?? '';

    final String mode = currentUri.queryParameters['mode']?.toLowerCase() ?? '';

    final String token = currentUri.queryParameters['token']?.trim() ?? '';

    final bool isResetPasswordLink = path == '/reset-password' ||
        path.endsWith('/reset-password/') ||
        resetMode == 'true' ||
        mode == 'reset-password';

    if (isResetPasswordLink) {
      return ResetPasswordScreen(token: token);
    }

    if (path == '/privacy-policy' || path == '/privacy-policy/') {
      return const PrivacyPolicyScreen();
    }

    if (isServicePayRegistrationUri(currentUri)) {
      return RegisterScreen(
        initialReferralCode: ReferralCodeNormalizer.fromUri(currentUri),
      );
    }

    if (kIsWeb) {
      final bool edupayEntry = path == '/edupay' ||
          path == '/edupay/' ||
          currentUri.queryParameters['entry']?.toLowerCase() == 'edupay';
      return WebLandingSessionGate(edupayEntry: edupayEntry);
    }
    return const StartupSessionGate();
  }

  @override
  Widget build(BuildContext context) {
    RiderAuthSession.onUnauthorized = () {
      servicePayNavigatorKey.currentState?.pushAndRemoveUntil<void>(
        MaterialPageRoute<void>(
          builder: (_) => const LoginScreen(),
        ),
        (_) => false,
      );
    };
    return MaterialApp(
      title: 'ServicePay',
      navigatorKey: servicePayNavigatorKey,
      debugShowCheckedModeBanner: false,
      theme: ServicePayTheme.light(),
      home: getInitialScreen(),
    );
  }
}

/// Keeps the public website as the signed-out web root while restoring an
/// existing authenticated session. This intentionally does not change the
/// shared StartupSessionGate logged-out behavior used by native and login.
class WebLandingSessionGate extends StatefulWidget {
  const WebLandingSessionGate({super.key, this.edupayEntry = false});

  final bool edupayEntry;

  @override
  State<WebLandingSessionGate> createState() => _WebLandingSessionGateState();
}

class _WebLandingSessionGateState extends State<WebLandingSessionGate> {
  bool _checking = true;
  bool _hasSession = false;

  @override
  void initState() {
    super.initState();
    _checkSession();
  }

  Future<void> _checkSession() async {
    try {
      // SharedPreferences is retained here for compatibility with older
      // sessions; SessionStore is the authoritative token location.
      await SharedPreferences.getInstance();
      final token = (await SessionStore.readToken())?.trim() ?? '';
      if (mounted) {
        setState(() {
          _hasSession = token.isNotEmpty;
          _checking = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const ServicePayStartupScreen();
    }
    if (!_hasSession) {
      return const PublicWebsiteScreen();
    }
    return StartupSessionGate(
      authenticatedHomeOverride:
          widget.edupayEntry ? const EduPayScreen() : null,
    );
  }
}
