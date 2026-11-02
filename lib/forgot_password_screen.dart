import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'services/customer_account_recovery.dart';

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({
    super.key,
    this.client,
    this.urlLauncher,
  });

  final http.Client? client;
  final RecoveryUrlLauncher? urlLauncher;

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryColor = Color(0xFF0F766E);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController emailController = TextEditingController();

  bool isLoading = false;
  bool emailSent = false;
  bool isPhoneLoading = false;
  bool? smsAvailable;
  String phoneAction = 'PASSWORD_RESET';
  RecoveryEntry? _pendingRecovery;
  bool _pendingRecoveryExpired = false;
  bool _openingPendingRecovery = false;
  Timer? _pendingExpiryTimer;
  late final http.Client _client;
  late final bool _ownsClient;
  late final CustomerAccountRecoveryService _recovery;
  final TextEditingController phoneController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
    _recovery = CustomerAccountRecoveryService(
      client: _client,
      baseUrl: baseUrl,
      launch: widget.urlLauncher ??
          (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
    );
    _loadRecoveryAvailability();
  }

  @override
  void dispose() {
    emailController.dispose();
    phoneController.dispose();
    _pendingExpiryTimer?.cancel();
    if (_ownsClient) _client.close();
    super.dispose();
  }

  Future<void> _loadRecoveryAvailability() async {
    try {
      final available = await _recovery.smsAvailable();
      if (mounted) setState(() => smsAvailable = available);
    } catch (_) {
      if (mounted) setState(() => smsAvailable = false);
    }
  }

  Future<void> _requestPhoneRecovery() async {
    final phone = phoneController.text.trim();
    if (phone.isEmpty ||
        isPhoneLoading ||
        smsAvailable != true ||
        (_pendingRecovery != null && !_pendingRecoveryExpired)) {
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() => isPhoneLoading = true);
    try {
      final entry = await _recovery.requestPhoneChallenge(
        phone: phone,
        action: phoneAction,
      );
      if (!mounted) return;
      _setPendingRecovery(entry);
      bool opened = false;
      try {
        opened = await _recovery.openEntry(entry.uri);
      } catch (_) {
        opened = false;
      }
      if (!opened && mounted) {
        showMessage(
          'Your request was received, but the secure recovery page could not be opened. Check your browser and try opening the recovery page again later.',
          isError: true,
        );
      }
    } catch (_) {
      if (mounted) {
        showMessage(
          'If the details match an eligible account, recovery instructions will be sent to its verified phone. Please try again later if you do not receive them.',
          isError: false,
        );
      }
    } finally {
      if (mounted) setState(() => isPhoneLoading = false);
    }
  }

  void _setPendingRecovery(RecoveryEntry entry) {
    _pendingExpiryTimer?.cancel();
    final expiresAt = entry.expiresAt;
    final expired =
        expiresAt != null && !expiresAt.isAfter(DateTime.now().toUtc());
    setState(() {
      _pendingRecovery = entry;
      _pendingRecoveryExpired = expired;
    });
    if (expiresAt != null && !expired) {
      final remaining = expiresAt.difference(DateTime.now().toUtc());
      _pendingExpiryTimer = Timer(remaining, () {
        if (mounted) setState(() => _pendingRecoveryExpired = true);
      });
    }
  }

  Future<void> _openPendingRecovery() async {
    final pending = _pendingRecovery;
    if (pending == null || _pendingRecoveryExpired || _openingPendingRecovery) {
      return;
    }
    setState(() => _openingPendingRecovery = true);
    try {
      final opened = await _recovery.openEntry(pending.uri);
      if (!opened && mounted) {
        showMessage(
          'The secure page could not be opened. Check your browser and use this button to try again; no new code was sent.',
          isError: true,
        );
      }
    } catch (_) {
      if (mounted) {
        showMessage(
          'The secure page could not be opened. Check your browser and use this button to try again; no new code was sent.',
          isError: true,
        );
      }
    } finally {
      if (mounted) setState(() => _openingPendingRecovery = false);
    }
  }

  String? validateEmail(
    String? value,
  ) {
    final String email = value?.trim().toLowerCase() ?? '';

    if (email.isEmpty) {
      return 'Enter your registered email address.';
    }

    final RegExp emailPattern = RegExp(
      r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$',
    );

    if (!emailPattern.hasMatch(email)) {
      return 'Enter a valid email address.';
    }

    return null;
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{
        'success': false,
        'message': 'The server returned an empty response.',
      };
    }

    try {
      final dynamic decoded = jsonDecode(body);

      if (decoded is Map) {
        return Map<String, dynamic>.from(
          decoded,
        );
      }
    } catch (error) {
      debugPrint(
        'Forgot-password response error: $error',
      );
    }

    return <String, dynamic>{
      'success': false,
      'message': 'The server returned an invalid response.',
    };
  }

  void showMessage(
    String message, {
    required bool isError,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            message,
          ),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(
            seconds: 5,
          ),
          backgroundColor: isError ? Colors.red.shade700 : primaryColor,
        ),
      );
  }

  Future<void> sendResetLink() async {
    final bool valid = formKey.currentState?.validate() ?? false;

    if (!valid || isLoading) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      isLoading = true;
    });

    try {
      final Uri endpoint = Uri.parse(
        '$baseUrl/auth/forgot-password',
      );

      final http.Response response = await http
          .post(
            endpoint,
            headers: const {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'email': emailController.text.trim().toLowerCase(),
            }),
          )
          .timeout(
            const Duration(
              seconds: 120,
            ),
          );

      final Map<String, dynamic> result = decodeResponse(response);

      if (!mounted) {
        return;
      }

      final String serverMessage = result['message']?.toString().trim() ?? '';

      final bool success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          result['success'] == true;

      if (!success) {
        showMessage(
          serverMessage.isNotEmpty
              ? serverMessage
              : 'Unable to send the password reset link.',
          isError: true,
        );

        return;
      }

      setState(() {
        emailSent = true;
      });

      showMessage(
        serverMessage.isNotEmpty
            ? serverMessage
            : 'Password reset instructions have been sent.',
        isError: false,
      );
    } on TimeoutException {
      showMessage(
        'The request took too long. Please try again.',
        isError: true,
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to the ServicePay server.',
        isError: true,
      );
    } catch (error) {
      debugPrint(
        'Forgot-password error: $error',
      );

      showMessage(
        'Unable to send the password reset link. Please try again.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Widget buildServicePayLogo() {
    return SizedBox(
      width: 210,
      height: 130,
      child: Image.asset(
        'assets/image/servicepay_logo.png',
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
        gaplessPlayback: true,
        errorBuilder: (
          BuildContext context,
          Object error,
          StackTrace? stackTrace,
        ) {
          debugPrint(
            'SERVICEPAY LOGO ERROR: $error',
          );

          return const Center(
            child: Text(
              'ServicePay',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w900,
                color: primaryColor,
              ),
            ),
          );
        },
      ),
    );
  }

  InputDecoration buildEmailDecoration() {
    return InputDecoration(
      labelText: 'Registered email address',
      hintText: 'customer@example.com',
      prefixIcon: const Icon(
        Icons.email_outlined,
      ),
      filled: true,
      fillColor: const Color(
        0xFFF8FAFC,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
        borderSide: const BorderSide(
          color: Color(
            0xFFE2E8F0,
          ),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
        borderSide: const BorderSide(
          color: primaryColor,
          width: 2,
        ),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
        borderSide: const BorderSide(
          color: Colors.red,
        ),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
        borderSide: const BorderSide(
          color: Colors.red,
          width: 2,
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(
        0xFFF4F7F9,
      ),
      appBar: AppBar(
        title: const Text(
          'Forgot Password',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: const Color(
          0xFF172033,
        ),
        elevation: 0,
        surfaceTintColor: Colors.white,
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(
              22,
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 460,
              ),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(
                    26,
                  ),
                  border: Border.all(
                    color: const Color(
                      0xFFE2E8F0,
                    ),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: 0.07,
                      ),
                      blurRadius: 24,
                      offset: const Offset(
                        0,
                        10,
                      ),
                    ),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    28,
                    20,
                    28,
                    30,
                  ),
                  child: emailSent ? buildSuccessContent() : buildRequestForm(),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget buildRequestForm() {
    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: buildServicePayLogo(),
          ),
          const SizedBox(
            height: 2,
          ),
          const Text(
            'Reset your password',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(
                0xFF172033,
              ),
              fontSize: 25,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(
            height: 9,
          ),
          Text(
            'Enter the email address registered with your ServicePay account. We will send you a secure password reset link.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.grey.shade600,
              fontSize: 14,
              height: 1.5,
            ),
          ),
          const SizedBox(
            height: 28,
          ),
          TextFormField(
            controller: emailController,
            enabled: !isLoading,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [
              AutofillHints.email,
            ],
            validator: validateEmail,
            onFieldSubmitted: (_) {
              if (!isLoading) {
                sendResetLink();
              }
            },
            decoration: buildEmailDecoration(),
          ),
          const SizedBox(
            height: 22,
          ),
          SizedBox(
            height: 54,
            child: ElevatedButton.icon(
              onPressed: isLoading ? null : sendResetLink,
              style: ElevatedButton.styleFrom(
                backgroundColor: primaryColor,
                foregroundColor: Colors.white,
                disabledBackgroundColor: primaryColor.withValues(
                  alpha: 0.45,
                ),
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                ),
              ),
              icon: isLoading
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(
                      Icons.send_rounded,
                    ),
              label: Text(
                isLoading ? 'Sending...' : 'Send Reset Link',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Divider(),
          const SizedBox(height: 16),
          const Text(
            'Use your verified phone',
            style: TextStyle(
              color: Color(0xFF172033),
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            'If your account has an eligible verified phone, we will send a secure recovery code. This does not change your contact details.',
            style: TextStyle(
              color: Colors.grey.shade700,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            value: phoneAction,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'What do you need help with?',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(
                value: 'PASSWORD_RESET',
                child: Text('Reset password'),
              ),
              DropdownMenuItem(
                value: 'PIN_RECOVERY',
                child: Text('Recover transaction PIN'),
              ),
            ],
            onChanged: isPhoneLoading ||
                    (_pendingRecovery != null && !_pendingRecoveryExpired)
                ? null
                : (value) {
                    if (value != null) setState(() => phoneAction = value);
                  },
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: phoneController,
            enabled: !isPhoneLoading &&
                smsAvailable == true &&
                (_pendingRecovery == null || _pendingRecoveryExpired),
            onChanged: (_) => setState(() {}),
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.telephoneNumber],
            decoration: const InputDecoration(
              labelText: 'Registered phone number',
              hintText: 'Enter the phone on your account',
              prefixIcon: Icon(Icons.phone_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          if (smsAvailable == false) ...[
            const SizedBox(height: 8),
            const Text(
              'Phone recovery is currently unavailable. Use the email recovery option above.',
              key: Key('phone-recovery-unavailable'),
              style: TextStyle(color: Color(0xFF7C2D12), height: 1.4),
            ),
          ],
          const SizedBox(height: 12),
          SizedBox(
            height: 50,
            child: OutlinedButton.icon(
              key: const Key('phone-recovery-submit'),
              onPressed: smsAvailable == true &&
                      !isPhoneLoading &&
                      (_pendingRecovery == null || _pendingRecoveryExpired) &&
                      phoneController.text.trim().isNotEmpty
                  ? _requestPhoneRecovery
                  : null,
              icon: isPhoneLoading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.sms_outlined),
              label: Text(
                isPhoneLoading
                    ? 'Requesting secure code...'
                    : _pendingRecoveryExpired
                        ? 'Request another code'
                        : _pendingRecovery != null
                            ? 'Code request pending'
                            : 'Continue with phone',
              ),
            ),
          ),
          if (_pendingRecovery != null) ...[
            const SizedBox(height: 12),
            Container(
              key: const Key('phone-recovery-pending'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _pendingRecoveryExpired
                    ? const Color(0xFFFFF7ED)
                    : primaryColor.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _pendingRecoveryExpired
                        ? 'This recovery request has expired. Request a new code only if you still need one.'
                        : 'A recovery request is active. Use the same secure page to enter the code; requesting again is disabled until this request expires.',
                    style: const TextStyle(height: 1.45),
                  ),
                  if (!_pendingRecoveryExpired) ...[
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      key: const Key('open-pending-recovery'),
                      onPressed:
                          _openingPendingRecovery ? null : _openPendingRecovery,
                      icon: _openingPendingRecovery
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.open_in_browser_outlined),
                      label: const Text('Open secure recovery page'),
                    ),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(
            height: 18,
          ),
          TextButton.icon(
            onPressed: isLoading
                ? null
                : () {
                    Navigator.pop(
                      context,
                    );
                  },
            icon: const Icon(
              Icons.arrow_back_rounded,
            ),
            label: const Text(
              'Back to Sign In',
              style: TextStyle(
                color: primaryColor,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(
            height: 10,
          ),
          Container(
            padding: const EdgeInsets.all(
              13,
            ),
            decoration: BoxDecoration(
              color: primaryColor.withValues(
                alpha: 0.07,
              ),
              borderRadius: BorderRadius.circular(
                13,
              ),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.verified_user_rounded,
                  color: primaryColor,
                  size: 20,
                ),
                SizedBox(
                  width: 9,
                ),
                Expanded(
                  child: Text(
                    'For your security, the reset link will only be sent to your registered email address.',
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.45,
                      color: Color(
                        0xFF334155,
                      ),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(
            height: 15,
          ),
          Text(
            'One Platform, Many Solutions.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              color: Colors.grey.shade600,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildSuccessContent() {
    final String email = emailController.text.trim().toLowerCase();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: buildServicePayLogo(),
        ),
        const SizedBox(
          height: 2,
        ),
        Container(
          width: 84,
          height: 84,
          decoration: BoxDecoration(
            color: primaryColor.withValues(
              alpha: 0.12,
            ),
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.mark_email_read_outlined,
            color: primaryColor,
            size: 46,
          ),
        ),
        const SizedBox(
          height: 20,
        ),
        const Text(
          'Check your email',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(
              0xFF172033,
            ),
            fontSize: 25,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(
          height: 12,
        ),
        Text(
          'If a ServicePay account exists for $email, a password reset link has been sent.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.grey.shade700,
            fontSize: 14,
            height: 1.5,
          ),
        ),
        const SizedBox(
          height: 17,
        ),
        Container(
          padding: const EdgeInsets.all(
            14,
          ),
          decoration: BoxDecoration(
            color: const Color(
              0xFFFFF7ED,
            ),
            borderRadius: BorderRadius.circular(
              14,
            ),
            border: Border.all(
              color: const Color(
                0xFFFED7AA,
              ),
            ),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.schedule_rounded,
                color: Color(
                  0xFFEA580C,
                ),
              ),
              SizedBox(
                width: 9,
              ),
              Expanded(
                child: Text(
                  'The password reset link expires after 20 minutes. Also check your Spam or Promotions folder.',
                  style: TextStyle(
                    color: Color(
                      0xFF7C2D12,
                    ),
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(
          height: 22,
        ),
        SizedBox(
          height: 54,
          child: ElevatedButton(
            onPressed: () {
              Navigator.pop(
                context,
              );
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: primaryColor,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(
                  14,
                ),
              ),
            ),
            child: const Text(
              'Return to Sign In',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
        const SizedBox(
          height: 12,
        ),
        TextButton(
          onPressed: isLoading
              ? null
              : () {
                  setState(() {
                    emailSent = false;
                  });
                },
          child: const Text(
            'Send another link',
            style: TextStyle(
              color: primaryColor,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(
          height: 8,
        ),
        Text(
          'One Platform, Many Solutions.',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 12,
            color: Colors.grey.shade600,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
