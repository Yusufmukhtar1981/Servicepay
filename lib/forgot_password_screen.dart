import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class ForgotPasswordScreen
    extends StatefulWidget {
  const ForgotPasswordScreen({
    super.key,
  });

  @override
  State<ForgotPasswordScreen>
      createState() =>
          _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState
    extends State<ForgotPasswordScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryColor =
      Color(0xFF0F766E);

  final GlobalKey<FormState> formKey =
      GlobalKey<FormState>();

  final TextEditingController
      emailController =
      TextEditingController();

  bool isLoading = false;
  bool emailSent = false;

  @override
  void dispose() {
    emailController.dispose();
    super.dispose();
  }

  String? validateEmail(
    String? value,
  ) {
    final String email =
        value?.trim().toLowerCase() ?? '';

    if (email.isEmpty) {
      return 'Enter your registered email address.';
    }

    final RegExp emailPattern =
        RegExp(
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
    final String body =
        response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{
        'success': false,
        'message':
            'The server returned an empty response.',
      };
    }

    try {
      final dynamic decoded =
          jsonDecode(body);

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
      'message':
          'The server returned an invalid response.',
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
          behavior:
              SnackBarBehavior.floating,
          duration:
              const Duration(
            seconds: 5,
          ),
          backgroundColor:
              isError
                  ? Colors.red.shade700
                  : primaryColor,
        ),
      );
  }

  Future<void> sendResetLink() async {
    final bool valid =
        formKey.currentState
                ?.validate() ??
            false;

    if (!valid || isLoading) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      isLoading = true;
    });

    try {
      final Uri endpoint =
          Uri.parse(
        '$baseUrl/auth/forgot-password',
      );

      final http.Response response =
          await http
              .post(
                endpoint,
                headers: const {
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                },
                body: jsonEncode({
                  'email':
                      emailController
                          .text
                          .trim()
                          .toLowerCase(),
                }),
              )
              .timeout(
                const Duration(
                  seconds: 120,
                ),
              );

      final Map<String, dynamic> result =
          decodeResponse(response);

      if (!mounted) {
        return;
      }

      final String serverMessage =
          result['message']
                  ?.toString()
                  .trim() ??
              '';

      final bool success =
          response.statusCode >= 200 &&
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
        filterQuality:
            FilterQuality.high,
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
              textAlign:
                  TextAlign.center,
              style: TextStyle(
                fontSize: 32,
                fontWeight:
                    FontWeight.w900,
                color: primaryColor,
              ),
            ),
          );
        },
      ),
    );
  }

  InputDecoration
      buildEmailDecoration() {
    return InputDecoration(
      labelText:
          'Registered email address',
      hintText:
          'customer@example.com',
      prefixIcon: const Icon(
        Icons.email_outlined,
      ),
      filled: true,
      fillColor:
          const Color(
        0xFFF8FAFC,
      ),
      border:
          OutlineInputBorder(
        borderRadius:
            BorderRadius.circular(
          14,
        ),
      ),
      enabledBorder:
          OutlineInputBorder(
        borderRadius:
            BorderRadius.circular(
          14,
        ),
        borderSide:
            const BorderSide(
          color:
              Color(
            0xFFE2E8F0,
          ),
        ),
      ),
      focusedBorder:
          OutlineInputBorder(
        borderRadius:
            BorderRadius.circular(
          14,
        ),
        borderSide:
            const BorderSide(
          color:
              primaryColor,
          width: 2,
        ),
      ),
      errorBorder:
          OutlineInputBorder(
        borderRadius:
            BorderRadius.circular(
          14,
        ),
        borderSide:
            const BorderSide(
          color: Colors.red,
        ),
      ),
      focusedErrorBorder:
          OutlineInputBorder(
        borderRadius:
            BorderRadius.circular(
          14,
        ),
        borderSide:
            const BorderSide(
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
      backgroundColor:
          const Color(
        0xFFF4F7F9,
      ),
      appBar: AppBar(
        title:
            const Text(
          'Forgot Password',
          style: TextStyle(
            fontWeight:
                FontWeight.w800,
          ),
        ),
        centerTitle: true,
        backgroundColor:
            Colors.white,
        foregroundColor:
            const Color(
          0xFF172033,
        ),
        elevation: 0,
        surfaceTintColor:
            Colors.white,
      ),
      body: SafeArea(
        child: Center(
          child:
              SingleChildScrollView(
            padding:
                const EdgeInsets.all(
              22,
            ),
            child:
                ConstrainedBox(
              constraints:
                  const BoxConstraints(
                maxWidth: 460,
              ),
              child:
                  Container(
                decoration:
                    BoxDecoration(
                  color:
                      Colors.white,
                  borderRadius:
                      BorderRadius.circular(
                    26,
                  ),
                  border:
                      Border.all(
                    color:
                        const Color(
                      0xFFE2E8F0,
                    ),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color:
                          Colors.black.withValues(
                        alpha:
                            0.07,
                      ),
                      blurRadius:
                          24,
                      offset:
                          const Offset(
                        0,
                        10,
                      ),
                    ),
                  ],
                ),
                child:
                    Padding(
                  padding:
                      const EdgeInsets.fromLTRB(
                    28,
                    20,
                    28,
                    30,
                  ),
                  child:
                      emailSent
                          ? buildSuccessContent()
                          : buildRequestForm(),
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
        crossAxisAlignment:
            CrossAxisAlignment.stretch,
        children: [
          Center(
            child:
                buildServicePayLogo(),
          ),
          const SizedBox(
            height: 2,
          ),
          const Text(
            'Reset your password',
            textAlign:
                TextAlign.center,
            style: TextStyle(
              color:
                  Color(
                0xFF172033,
              ),
              fontSize: 25,
              fontWeight:
                  FontWeight.w900,
            ),
          ),
          const SizedBox(
            height: 9,
          ),
          Text(
            'Enter the email address registered with your ServicePay account. We will send you a secure password reset link.',
            textAlign:
                TextAlign.center,
            style: TextStyle(
              color:
                  Colors.grey.shade600,
              fontSize: 14,
              height: 1.5,
            ),
          ),
          const SizedBox(
            height: 28,
          ),
          TextFormField(
            controller:
                emailController,
            enabled: !isLoading,
            keyboardType:
                TextInputType
                    .emailAddress,
            textInputAction:
                TextInputAction.done,
            autofillHints: const [
              AutofillHints.email,
            ],
            validator:
                validateEmail,
            onFieldSubmitted: (_) {
              if (!isLoading) {
                sendResetLink();
              }
            },
            decoration:
                buildEmailDecoration(),
          ),
          const SizedBox(
            height: 22,
          ),
          SizedBox(
            height: 54,
            child:
                ElevatedButton.icon(
              onPressed:
                  isLoading
                      ? null
                      : sendResetLink,
              style:
                  ElevatedButton.styleFrom(
                backgroundColor:
                    primaryColor,
                foregroundColor:
                    Colors.white,
                disabledBackgroundColor:
                    primaryColor.withValues(
                  alpha: 0.45,
                ),
                elevation: 0,
                shape:
                    RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius.circular(
                    14,
                  ),
                ),
              ),
              icon:
                  isLoading
                      ? const SizedBox(
                          width:
                              22,
                          height:
                              22,
                          child:
                              CircularProgressIndicator(
                            strokeWidth:
                                2.4,
                            color:
                                Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.send_rounded,
                        ),
              label: Text(
                isLoading
                    ? 'Sending...'
                    : 'Send Reset Link',
                style:
                    const TextStyle(
                  fontSize: 16,
                  fontWeight:
                      FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(
            height: 18,
          ),
          TextButton.icon(
            onPressed:
                isLoading
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
                fontWeight:
                    FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(
            height: 10,
          ),
          Container(
            padding:
                const EdgeInsets.all(
              13,
            ),
            decoration:
                BoxDecoration(
              color:
                  primaryColor.withValues(
                alpha: 0.07,
              ),
              borderRadius:
                  BorderRadius.circular(
                13,
              ),
            ),
            child:
                const Row(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons
                      .verified_user_rounded,
                  color:
                      primaryColor,
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
                      color:
                          Color(
                        0xFF334155,
                      ),
                      fontWeight:
                          FontWeight.w600,
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
            textAlign:
                TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              color:
                  Colors.grey.shade600,
              fontWeight:
                  FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildSuccessContent() {
    final String email =
        emailController.text
            .trim()
            .toLowerCase();

    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.stretch,
      children: [
        Center(
          child:
              buildServicePayLogo(),
        ),
        const SizedBox(
          height: 2,
        ),
        Container(
          width: 84,
          height: 84,
          decoration:
              BoxDecoration(
            color:
                primaryColor.withValues(
              alpha: 0.12,
            ),
            shape: BoxShape.circle,
          ),
          child:
              const Icon(
            Icons
                .mark_email_read_outlined,
            color: primaryColor,
            size: 46,
          ),
        ),
        const SizedBox(
          height: 20,
        ),
        const Text(
          'Check your email',
          textAlign:
              TextAlign.center,
          style: TextStyle(
            color:
                Color(
              0xFF172033,
            ),
            fontSize: 25,
            fontWeight:
                FontWeight.w900,
          ),
        ),
        const SizedBox(
          height: 12,
        ),
        Text(
          'If a ServicePay account exists for $email, a password reset link has been sent.',
          textAlign:
              TextAlign.center,
          style: TextStyle(
            color:
                Colors.grey.shade700,
            fontSize: 14,
            height: 1.5,
          ),
        ),
        const SizedBox(
          height: 17,
        ),
        Container(
          padding:
              const EdgeInsets.all(
            14,
          ),
          decoration:
              BoxDecoration(
            color:
                const Color(
              0xFFFFF7ED,
            ),
            borderRadius:
                BorderRadius.circular(
              14,
            ),
            border:
                Border.all(
              color:
                  const Color(
                0xFFFED7AA,
              ),
            ),
          ),
          child:
              const Row(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.schedule_rounded,
                color:
                    Color(
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
                    color:
                        Color(
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
          child:
              ElevatedButton(
            onPressed: () {
              Navigator.pop(
                context,
              );
            },
            style:
                ElevatedButton.styleFrom(
              backgroundColor:
                  primaryColor,
              foregroundColor:
                  Colors.white,
              elevation: 0,
              shape:
                  RoundedRectangleBorder(
                borderRadius:
                    BorderRadius.circular(
                  14,
                ),
              ),
            ),
            child:
                const Text(
              'Return to Sign In',
              style: TextStyle(
                fontSize: 16,
                fontWeight:
                    FontWeight.w800,
              ),
            ),
          ),
        ),
        const SizedBox(
          height: 12,
        ),
        TextButton(
          onPressed:
              isLoading
                  ? null
                  : () {
                      setState(() {
                        emailSent =
                            false;
                      });
                    },
          child:
              const Text(
            'Send another link',
            style: TextStyle(
              color:
                  primaryColor,
              fontWeight:
                  FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(
          height: 8,
        ),
        Text(
          'One Platform, Many Solutions.',
          textAlign:
              TextAlign.center,
          style: TextStyle(
            fontSize: 12,
            color:
                Colors.grey.shade600,
            fontWeight:
                FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
