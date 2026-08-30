import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'login_screen.dart';
import 'reset_transaction_pin_screen.dart';
import 'transaction_pin_screen.dart';
import 'change_transaction_pin_screen.dart';
import 'security_utils.dart';
import 'package:url_launcher/url_launcher.dart';

import 'referral_screen.dart';
import 'kyc_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, this.client});
  final http.Client? client;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Future<void> openServicePayWhatsApp() async {
    const phone = '2349136151515';
    const message =
        'Hello ServicePay Support, I need assistance with my account.';

    final uri = Uri.parse(
      'https://wa.me/$phone?text=${Uri.encodeComponent(message)}',
    );

    final opened = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    );

    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Unable to open WhatsApp. Please try again.'),
        ),
      );
    }
  }

  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF2E7D32);

  bool isLoading = true;
  bool isRefreshing = false;
  bool isLoggingOut = false;
  bool isKycLoading = true;
  bool isPhotoUploading = false;

  String errorMessage = '';

  Map<String, dynamic> user = {};
  Map<String, dynamic> kycSummary = {};
  Map<String, dynamic> kycLimits = {};
  final ImagePicker imagePicker = ImagePicker();
  late final http.Client _client;
  late final bool _ownsClient;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
    loadProfile();
    loadKycSummary();
  }

  @override
  void dispose() {
    if (_ownsClient) _client.close();
    super.dispose();
  }

  Future<void> loadKycSummary() async {
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = prefs.getString('auth_token') ?? '';
      if (token.trim().isEmpty) return;
      final http.Response response = await _client.get(
        Uri.parse('$baseUrl/kyc/status'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 30));
      final dynamic decoded = _decodeResponse(response.body);
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map &&
          decoded['success'] == true) {
        final dynamic rawKyc = decoded['kyc'];
        final dynamic rawLimits = decoded['servicepayLimits'];
        if (mounted) {
          setState(() {
            kycSummary = rawKyc is Map
                ? Map<String, dynamic>.from(rawKyc)
                : <String, dynamic>{};
            kycLimits = rawLimits is Map
                ? Map<String, dynamic>.from(rawLimits)
                : <String, dynamic>{};
          });
        }
      }
    } catch (_) {
      // Profile remains usable when KYC status is temporarily unavailable.
    } finally {
      if (mounted) setState(() => isKycLoading = false);
    }
  }

  Future<void> loadProfile({
    bool showRefreshLoader = false,
  }) async {
    if (!mounted) return;

    setState(() {
      if (showRefreshLoader) {
        isRefreshing = true;
      } else {
        isLoading = true;
      }

      errorMessage = '';
    });

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      final String token = prefs.getString('auth_token') ?? '';

      if (token.trim().isEmpty) {
        throw Exception(
          'Your login session has expired. Please log in again.',
        );
      }

      final http.Response response = await _client.get(
        Uri.parse('$baseUrl/auth/profile'),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final Map<String, dynamic> loadedUser = _extractUser(decoded);

        await _saveUserLocally(
          loadedUser,
        );

        if (!mounted) return;

        setState(() {
          user = loadedUser;
        });
      } else {
        throw Exception(
          _extractMessage(
            decoded,
            fallback: 'Unable to load your profile.',
          ),
        );
      }
    } catch (error) {
      if (!mounted) return;

      setState(() {
        errorMessage = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          isRefreshing = false;
        });
      }
    }
  }

  dynamic _decodeResponse(
    String body,
  ) {
    if (body.trim().isEmpty) {
      return null;
    }

    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  Map<String, dynamic> _extractUser(
    dynamic data,
  ) {
    if (data is Map) {
      if (data['user'] is Map) {
        return Map<String, dynamic>.from(
          data['user'],
        );
      }

      if (data['data'] is Map && data['data']['user'] is Map) {
        return Map<String, dynamic>.from(
          data['data']['user'],
        );
      }

      return Map<String, dynamic>.from(
        data,
      );
    }

    return {};
  }

  String _extractMessage(
    dynamic data, {
    required String fallback,
  }) {
    if (data is Map) {
      final dynamic message =
          data['message'] ?? data['error'] ?? data['detail'];

      if (message != null && message.toString().trim().isNotEmpty) {
        return message.toString();
      }
    }

    return fallback;
  }

  Future<void> _saveUserLocally(
    Map<String, dynamic> userData,
  ) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    final String fullName = _text(userData['fullName']);

    final String phone = _text(userData['phone']);

    final String email = _text(userData['email']);

    final String role = _text(userData['role']);

    final String status = _text(userData['status']);

    final double walletBalance = _toDouble(
      userData['walletBalance'],
    );

    await prefs.setString(
      'user_name',
      fullName,
    );

    await prefs.setString(
      'full_name',
      fullName,
    );

    await prefs.setString(
      'user_phone',
      phone,
    );

    await prefs.setString(
      'user_email',
      email,
    );

    await prefs.setString(
      'user_role',
      role,
    );

    await prefs.setString(
      'user_status',
      status,
    );

    await prefs.setDouble(
      'wallet_balance',
      walletBalance,
    );

    await prefs.setBool(
      'transaction_pin_set',
      userData['transactionPinSet'] == true,
    );
  }

  String _text(
    dynamic value, {
    String fallback = '',
  }) {
    if (value == null) {
      return fallback;
    }

    final String result = value.toString().trim();

    return result.isEmpty ? fallback : result;
  }

  double _toDouble(
    dynamic value,
  ) {
    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value.toString().replaceAll(',', '').trim(),
        ) ??
        0;
  }

  String _formatRole(
    String role,
  ) {
    final String cleanRole = role.replaceAll('_', ' ').trim().toLowerCase();

    if (cleanRole.isEmpty) {
      return 'Customer';
    }

    return cleanRole
        .split(' ')
        .where(
          (word) => word.isNotEmpty,
        )
        .map(
          (word) => '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }

  String get fullName => _text(
        user['fullName'],
        fallback: 'Servicepay Customer',
      );

  String get phone => _text(
        user['phone'],
        fallback: 'Not provided',
      );

  String get email => _text(
        user['email'],
        fallback: 'Not provided',
      );

  String get role => _formatRole(
        _text(
          user['role'],
          fallback: 'CUSTOMER',
        ),
      );

  String get status => _text(
        user['status'],
        fallback: 'ACTIVE',
      ).toUpperCase();

  String get servicePayId => _text(
        user['id'] ?? user['_id'] ?? user['customerId'],
        fallback: 'Not available',
      );

  String get profilePhotoUrl => _text(user['profilePhotoUrl']);

  bool get phoneVerified =>
      user['phoneVerified'] == true || user['isPhoneVerified'] == true;

  bool get emailVerified =>
      user['emailVerified'] == true || user['isEmailVerified'] == true;

  String get kycLevel =>
      _text(kycSummary['level'], fallback: 'TIER_1').toUpperCase();

  String get kycStatus =>
      _text(kycSummary['status'], fallback: 'NOT_STARTED').toUpperCase();

  String get kycRequestedLevel =>
      _text(kycSummary['requestedLevel'], fallback: kycLevel).toUpperCase();

  String get kycReviewReason => _text(
        kycSummary['reviewReason'] ?? kycSummary['rejectionReason'],
      );

  Map<String, dynamic> get kycDocuments => kycSummary['documents'] is Map
      ? Map<String, dynamic>.from(kycSummary['documents'] as Map)
      : <String, dynamic>{};

  Map<String, dynamic> get kycIdentity => kycSummary['identity'] is Map
      ? Map<String, dynamic>.from(kycSummary['identity'] as Map)
      : <String, dynamic>{};

  Future<void> pickProfilePhoto() async {
    if (isPhotoUploading) return;
    final XFile? picked = await imagePicker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1200,
      imageQuality: 88,
    );
    if (picked == null || !mounted) return;

    setState(() => isPhotoUploading = true);
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = prefs.getString('auth_token') ?? '';
      final http.MultipartRequest request = http.MultipartRequest(
        'PATCH',
        Uri.parse('$baseUrl/auth/profile/photo'),
      )
        ..headers['Accept'] = 'application/json'
        ..headers['Authorization'] = 'Bearer $token'
        ..files.add(
          http.MultipartFile.fromBytes(
            'photo',
            await picked.readAsBytes(),
            filename: picked.name,
          ),
        );
      final http.StreamedResponse streamed = await _client.send(request);
      final String body = await streamed.stream.bytesToString();
      final dynamic decoded = _decodeResponse(body);
      if (streamed.statusCode < 200 ||
          streamed.statusCode >= 300 ||
          decoded is! Map ||
          decoded['success'] != true) {
        throw Exception(
          _extractMessage(decoded, fallback: 'Unable to update profile photo.'),
        );
      }
      final String url = _text(
        decoded['profilePhotoUrl'] ??
            (decoded['user'] is Map
                ? decoded['user']['profilePhotoUrl']
                : null),
      );
      if (mounted) {
        setState(() {
          if (url.isNotEmpty) user['profilePhotoUrl'] = url;
        });
        _showMessage('Profile photo updated successfully.', isError: false);
      }
    } catch (error) {
      if (mounted) {
        _showMessage(
          error.toString().replaceFirst('Exception: ', ''),
          isError: true,
        );
      }
    } finally {
      if (mounted) setState(() => isPhotoUploading = false);
    }
  }

  String get state => _text(
        user['state'],
        fallback: 'Not provided',
      );

  String get lga => _text(
        user['lga'],
        fallback: 'Not provided',
      );

  String get zone => _text(
        user['zone'],
        fallback: 'Not provided',
      );

  double get walletBalance => _toDouble(
        user['walletBalance'],
      );

  String get initials {
    final List<String> words = fullName
        .trim()
        .split(' ')
        .where(
          (word) => word.isNotEmpty,
        )
        .toList();

    if (words.isEmpty) {
      return 'S';
    }

    if (words.length == 1) {
      return words.first[0].toUpperCase();
    }

    return '${words.first[0]}${words.last[0]}'.toUpperCase();
  }

  void _showMessage(
    String message, {
    required bool isError,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError ? const Color(0xFFDC2626) : primaryGreen,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Future<void> openEditProfile() async {
    final bool? updated = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _EditProfileSheet(
          currentUser: user,
        );
      },
    );

    if (updated == true) {
      await loadProfile(
        showRefreshLoader: true,
      );
    }
  }

  Future<void> openCreateTransactionPin() async {
    final bool? updated = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TransactionPinScreen(client: widget.client),
      ),
    );

    if (updated == true) {
      await loadProfile(
        showRefreshLoader: true,
      );
    }
  }

  Future<void> openChangeTransactionPin() async {
    final updated = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
          builder: (_) => ChangeTransactionPinScreen(client: widget.client)),
    );
    if (updated == true) await loadProfile(showRefreshLoader: true);
  }

  Future<void> openResetTransactionPin() async {
    final updated = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
          builder: (_) => ResetTransactionPinScreen(client: widget.client)),
    );
    if (updated == true) await loadProfile(showRefreshLoader: true);
  }

  Future<void> openChangePassword() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _ChangePasswordSheet(client: widget.client);
      },
    );
  }

  Future<void> logout() async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          title: const Text(
            'Log out?',
            style: TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          content: const Text(
            'Are you sure you want to log out of your Servicepay account?',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(
                  context,
                  false,
                );
              },
              child: const Text(
                'Cancel',
              ),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(
                  context,
                  true,
                );
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFDC2626),
                foregroundColor: Colors.white,
              ),
              child: const Text(
                'Log Out',
              ),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return;
    }

    if (!mounted) return;

    setState(() {
      isLoggingOut = true;
    });

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      await prefs.remove(
        'auth_token',
      );

      await prefs.remove(
        'user_id',
      );

      await prefs.remove(
        'user_name',
      );

      await prefs.remove(
        'full_name',
      );

      await prefs.remove(
        'user_phone',
      );

      await prefs.remove(
        'user_email',
      );

      await prefs.remove(
        'user_role',
      );

      await prefs.remove(
        'user_status',
      );

      await prefs.remove(
        'wallet_balance',
      );

      await prefs.remove(
        'transaction_pin_set',
      );

      if (!mounted) return;

      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(
          builder: (_) => const LoginScreen(),
        ),
        (route) => false,
      );
    } catch (_) {
      if (!mounted) return;

      setState(() {
        isLoggingOut = false;
      });

      _showMessage(
        'Unable to log out. Please try again.',
        isError: true,
      );
    }
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Profile',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh Profile',
            onPressed: isRefreshing
                ? null
                : () {
                    loadProfile(
                      showRefreshLoader: true,
                    );
                  },
            icon: isRefreshing
                ? const SizedBox(
                    width: 21,
                    height: 21,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2.3,
                    ),
                  )
                : const Icon(
                    Icons.refresh_rounded,
                  ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(
                color: primaryGreen,
              ),
            )
          : errorMessage.isNotEmpty
              ? _ProfileErrorState(
                  message: errorMessage,
                  onRetry: loadProfile,
                )
              : RefreshIndicator(
                  color: primaryGreen,
                  onRefresh: () async => Future.wait<void>([
                    loadProfile(showRefreshLoader: true),
                    loadKycSummary(),
                  ]),
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(
                      14,
                      16,
                      14,
                      34,
                    ),
                    children: [
                      _ProfileHeader(
                        initials: initials,
                        photoUrl: profilePhotoUrl,
                        fullName: fullName,
                        phone: phone,
                        role: role,
                        status: status,
                        isPhotoUploading: isPhotoUploading,
                        onPhotoTap: pickProfilePhoto,
                      ),
                      const SizedBox(height: 14),
                      _WalletSummaryCard(
                        balance: walletBalance,
                      ),
                      const SizedBox(height: 14),
                      _KycTierCard(
                        isLoading: isKycLoading,
                        level: kycLevel,
                        requestedLevel: kycRequestedLevel,
                        status: kycStatus,
                        limits: kycLimits,
                        identity: kycIdentity,
                        documents: kycDocuments,
                        reviewReason: kycReviewReason,
                        onTap: () async {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => const KycScreen(),
                            ),
                          );
                          await loadKycSummary();
                        },
                      ),
                      const SizedBox(height: 18),
                      const _ProfileSectionTitle(
                        title: 'Personal Information',
                      ),
                      const SizedBox(height: 10),
                      _ProfileInfoCard(
                        children: [
                          _ProfileInfoRow(
                            icon: Icons.person_outline_rounded,
                            label: 'Full Name',
                            value: fullName,
                          ),
                          _ProfileInfoRow(
                            icon: Icons.phone_outlined,
                            label: 'Phone Number',
                            value: phone,
                            badge: phoneVerified ? 'Verified' : null,
                          ),
                          _ProfileInfoRow(
                            icon: Icons.email_outlined,
                            label: 'Email',
                            value: email,
                            badge: emailVerified ? 'Verified' : null,
                          ),
                          _ProfileInfoRow(
                            icon: Icons.fingerprint_rounded,
                            label: 'ServicePay ID',
                            value: servicePayId,
                          ),
                          _ProfileInfoRow(
                            icon: Icons.badge_outlined,
                            label: 'Account Type',
                            value: role,
                          ),
                          _ProfileInfoRow(
                            icon: Icons.verified_user_outlined,
                            label: 'Account Status',
                            value: status,
                            valueColor: status == 'ACTIVE'
                                ? primaryGreen
                                : const Color(
                                    0xFFDC2626,
                                  ),
                            showDivider: false,
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      const _ProfileSectionTitle(
                        title: 'Location Information',
                      ),
                      const SizedBox(height: 10),
                      _ProfileInfoCard(
                        children: [
                          _ProfileInfoRow(
                            icon: Icons.map_outlined,
                            label: 'Zone',
                            value: zone,
                          ),
                          _ProfileInfoRow(
                            icon: Icons.location_city_outlined,
                            label: 'State',
                            value: state,
                          ),
                          _ProfileInfoRow(
                            icon: Icons.location_on_outlined,
                            label: 'LGA',
                            value: lga,
                            showDivider: false,
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      const _ProfileSectionTitle(
                        title: 'Account & Security',
                      ),
                      const SizedBox(height: 10),
                      _ProfileActionCard(
                        children: [
                          _ProfileActionTile(
                            icon: Icons.edit_outlined,
                            title: 'Edit Profile',
                            subtitle: 'Update your personal information',
                            onTap: openEditProfile,
                          ),
                          if (user['transactionPinSet'] == true) ...[
                            _ProfileActionTile(
                              icon: Icons.pin_outlined,
                              title: 'Change Transaction PIN',
                              subtitle: 'Update your 4-digit transaction PIN',
                              onTap: openChangeTransactionPin,
                            ),
                            _ProfileActionTile(
                              icon: Icons.lock_reset_rounded,
                              title: 'Forgot/Reset PIN',
                              subtitle:
                                  'Verify your password to reset your PIN',
                              onTap: openResetTransactionPin,
                            ),
                          ] else
                            _ProfileActionTile(
                              icon: Icons.pin_outlined,
                              title: 'Create Transaction PIN',
                              subtitle: 'Create a 4-digit PIN for transactions',
                              onTap: openCreateTransactionPin,
                            ),
                          _ProfileActionTile(
                            icon: Icons.lock_outline_rounded,
                            title: 'Change Password',
                            subtitle:
                                'Use a strong password unique to ServicePay',
                            onTap: openChangePassword,
                          ),
                          const _SecurityAvailabilityNote(),
                          _ProfileActionTile(
                            icon: Icons.card_giftcard_rounded,
                            title: 'My Referral',
                            subtitle: 'View, copy and share your referral code',
                            iconColor: const Color(0xFF08783E),
                            onTap: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const ReferralScreen(),
                                ),
                              );
                            },
                          ),
                          _ProfileActionTile(
                            icon: Icons.chat_rounded,
                            title: 'WhatsApp Support',
                            subtitle:
                                '09136151515 • Chat with ServicePay Support',
                            iconColor: const Color(0xFF25D366),
                            onTap: openServicePayWhatsApp,
                          ),
                          _ProfileActionTile(
                            icon: Icons.logout_rounded,
                            title: 'Log Out',
                            subtitle: 'Sign out of your account',
                            iconColor: const Color(
                              0xFFDC2626,
                            ),
                            titleColor: const Color(
                              0xFFDC2626,
                            ),
                            showDivider: false,
                            onTap: isLoggingOut ? null : logout,
                            trailing: isLoggingOut
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Color(
                                        0xFFDC2626,
                                      ),
                                    ),
                                  )
                                : null,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  final String initials;
  final String photoUrl;
  final String fullName;
  final String phone;
  final String role;
  final String status;
  final bool isPhotoUploading;
  final VoidCallback onPhotoTap;

  const _ProfileHeader({
    required this.initials,
    required this.photoUrl,
    required this.fullName,
    required this.phone,
    required this.role,
    required this.status,
    required this.isPhotoUploading,
    required this.onPhotoTap,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF2E7D32),
            Color(0xFF43A047),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF2E7D32).withValues(
              alpha: 0.22,
            ),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          Semantics(
            button: true,
            label: 'Change profile photo',
            child: InkWell(
              key: const Key('profile-photo-button'),
              onTap: isPhotoUploading ? null : onPhotoTap,
              customBorder: const CircleBorder(),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: 88,
                    height: 88,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.18),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.45),
                        width: 2,
                      ),
                    ),
                    clipBehavior: Clip.antiAlias,
                    alignment: Alignment.center,
                    child: isPhotoUploading
                        ? const CircularProgressIndicator(color: Colors.white)
                        : photoUrl.isNotEmpty
                            ? Image.network(
                                photoUrl,
                                width: 88,
                                height: 88,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) =>
                                    _InitialsAvatar(initials: initials),
                              )
                            : _InitialsAvatar(initials: initials),
                  ),
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: Container(
                      width: 29,
                      height: 29,
                      decoration: BoxDecoration(
                        color: const Color(0xFF0F5F34),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                      child: const Icon(
                        Icons.camera_alt_rounded,
                        color: Colors.white,
                        size: 15,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 13),
          Text(
            fullName,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            phone,
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 13),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: [
              _HeaderBadge(
                text: role,
                icon: Icons.person_rounded,
              ),
              _HeaderBadge(
                text: status,
                icon: Icons.check_circle_outline_rounded,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeaderBadge extends StatelessWidget {
  final String text;
  final IconData icon;

  const _HeaderBadge({
    required this.text,
    required this.icon,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 11,
        vertical: 7,
      ),
      decoration: BoxDecoration(
        color: Colors.white.withValues(
          alpha: 0.17,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            color: Colors.white,
            size: 15,
          ),
          const SizedBox(width: 5),
          Text(
            text,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _InitialsAvatar extends StatelessWidget {
  const _InitialsAvatar({required this.initials});
  final String initials;

  @override
  Widget build(BuildContext context) => Center(
        child: Text(
          initials,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 30,
            fontWeight: FontWeight.w900,
          ),
        ),
      );
}

class _KycTierCard extends StatelessWidget {
  const _KycTierCard({
    required this.isLoading,
    required this.level,
    required this.requestedLevel,
    required this.status,
    required this.limits,
    required this.identity,
    required this.documents,
    required this.reviewReason,
    required this.onTap,
  });

  final bool isLoading;
  final String level;
  final String requestedLevel;
  final String status;
  final Map<String, dynamic> limits;
  final Map<String, dynamic> identity;
  final Map<String, dynamic> documents;
  final String reviewReason;
  final VoidCallback onTap;

  int get tierNumber => int.tryParse(level.replaceAll(RegExp(r'\D'), '')) ?? 1;

  String _money(dynamic value) {
    final num amount = value is num ? value : num.tryParse('$value') ?? 0;
    final String digits = amount.round().toString();
    final StringBuffer output = StringBuffer();
    for (int index = 0; index < digits.length; index++) {
      if (index > 0 && (digits.length - index) % 3 == 0) output.write(',');
      output.write(digits[index]);
    }
    return '₦$output';
  }

  String get statusLabel => status
      .toLowerCase()
      .split('_')
      .map((word) =>
          word.isEmpty ? word : '${word[0].toUpperCase()}${word.substring(1)}')
      .join(' ');

  Color get statusColor {
    if (status == 'VERIFIED') return const Color(0xFF166534);
    if (status == 'REJECTED' || status == 'NEEDS_MORE_INFORMATION') {
      return const Color(0xFFB45309);
    }
    if (status == 'PENDING' || status == 'UNDER_REVIEW') {
      return const Color(0xFF1D4ED8);
    }
    return const Color(0xFF64748B);
  }

  List<String> get missingRequirements {
    final List<String> missing = <String>[];
    if (identity['ninVerified'] != true && identity['bvnVerified'] != true) {
      missing.add('Verify your NIN or BVN');
    }
    if (tierNumber >= 2) {
      if (documents['idDocumentUploaded'] != true) {
        missing.add('Upload a government ID');
      }
      if (documents['selfieUploaded'] != true) {
        missing.add('Upload a verification selfie');
      }
    }
    if (tierNumber >= 3 && documents['proofOfAddressUploaded'] != true) {
      missing.add('Upload proof of address');
    }
    return missing;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('profile-kyc-tier-card'),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFDDE7DF)),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x0F0F3D24),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: isLoading
          ? const SizedBox(
              height: 110,
              child: Center(
                child: CircularProgressIndicator(
                  color: Color(0xFF2E7D32),
                  strokeWidth: 2,
                ),
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: const Color(0xFFE8F5E9),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(
                        Icons.workspace_premium_rounded,
                        color: Color(0xFF2E7D32),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Verification tier',
                            style: TextStyle(
                              color: Color(0xFF64748B),
                              fontSize: 12,
                            ),
                          ),
                          Text(
                            'Tier $tierNumber',
                            style: const TextStyle(
                              color: Color(0xFF17211A),
                              fontSize: 19,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: statusColor.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        statusLabel,
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: List<Widget>.generate(3, (int index) {
                    final int step = index + 1;
                    final bool active = step <= tierNumber;
                    return Expanded(
                      child: Container(
                        key: Key('kyc-tier-step-$step'),
                        height: 6,
                        margin: EdgeInsets.only(right: step == 3 ? 0 : 6),
                        decoration: BoxDecoration(
                          color: active
                              ? const Color(0xFF2E7D32)
                              : const Color(0xFFE2E8F0),
                          borderRadius: BorderRadius.circular(20),
                        ),
                      ),
                    );
                  }),
                ),
                if (requestedLevel != level) ...[
                  const SizedBox(height: 10),
                  Text(
                    'Upgrade request: ${requestedLevel.replaceAll('_', ' ')}',
                    style: const TextStyle(
                      color: Color(0xFF1D4ED8),
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
                if (limits.isNotEmpty) ...[
                  const SizedBox(height: 15),
                  Row(
                    children: [
                      Expanded(
                        child: _LimitItem(
                          label: 'Per transaction',
                          value: _money(limits['perTransaction']),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _LimitItem(
                          label: 'Daily limit',
                          value: _money(limits['daily']),
                        ),
                      ),
                    ],
                  ),
                ],
                if (reviewReason.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    reviewReason,
                    style: const TextStyle(
                      color: Color(0xFFB45309),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ] else if (missingRequirements.isNotEmpty &&
                    status != 'PENDING' &&
                    status != 'UNDER_REVIEW') ...[
                  const SizedBox(height: 12),
                  Text(
                    missingRequirements.first,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12,
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    key: const Key('manage-kyc-button'),
                    onPressed: onTap,
                    icon: const Icon(Icons.verified_user_outlined, size: 18),
                    label: Text(
                      tierNumber < 3 ? 'Manage or upgrade KYC' : 'View KYC',
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF2E7D32),
                      side: const BorderSide(color: Color(0xFFB7D6BE)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _LimitItem extends StatelessWidget {
  const _LimitItem({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(11),
        decoration: BoxDecoration(
          color: const Color(0xFFF6F8F7),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(color: Color(0xFF64748B), fontSize: 10),
            ),
            const SizedBox(height: 3),
            Text(
              value,
              style: const TextStyle(
                color: Color(0xFF17211A),
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      );
}

class _SecurityAvailabilityNote extends StatelessWidget {
  const _SecurityAvailabilityNote();

  @override
  Widget build(BuildContext context) => Container(
        key: const Key('security-availability-note'),
        padding: const EdgeInsets.fromLTRB(10, 13, 10, 14),
        decoration: const BoxDecoration(
          border: Border(
            bottom: BorderSide(color: Color(0xFFE8ECE8)),
          ),
        ),
        child: const Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              Icons.devices_other_rounded,
              size: 20,
              color: Color(0xFF64748B),
            ),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                'Biometric approval and device/session management are not '
                'available for this account yet. Your password and transaction '
                'PIN remain the active security controls.',
                style: TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 11,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ),
      );
}

class _WalletSummaryCard extends StatelessWidget {
  final double balance;

  const _WalletSummaryCard({
    required this.balance,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE8ECE8),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: const Color(0xFFE8F5E9),
              borderRadius: BorderRadius.circular(
                15,
              ),
            ),
            child: const Icon(
              Icons.account_balance_wallet_rounded,
              color: Color(0xFF2E7D32),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Wallet Balance',
                  style: TextStyle(
                    color: Color(0xFF777D78),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '₦${balance.toStringAsFixed(2)}',
                  style: const TextStyle(
                    color: Color(0xFF171A18),
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.verified_user_rounded,
            color: Color(0xFF2E7D32),
          ),
        ],
      ),
    );
  }
}

class _ProfileSectionTitle extends StatelessWidget {
  final String title;

  const _ProfileSectionTitle({
    required this.title,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Text(
      title,
      style: const TextStyle(
        color: Color(0xFF171A18),
        fontSize: 17,
        fontWeight: FontWeight.w800,
      ),
    );
  }
}

class _ProfileInfoCard extends StatelessWidget {
  final List<Widget> children;

  const _ProfileInfoCard({
    required this.children,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 15,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE8ECE8),
        ),
      ),
      child: Column(
        children: children,
      ),
    );
  }
}

class _ProfileInfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;
  final bool showDivider;
  final String? badge;

  const _ProfileInfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
    this.showDivider = true,
    this.badge,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        vertical: 14,
      ),
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(
                bottom: BorderSide(
                  color: Color(0xFFE8ECE8),
                ),
              )
            : null,
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: const Color(0xFFE8F5E9),
              borderRadius: BorderRadius.circular(
                12,
              ),
            ),
            child: Icon(
              icon,
              color: const Color(0xFF2E7D32),
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: Color(0xFF777D78),
                    fontSize: 11,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  style: TextStyle(
                    color: valueColor ??
                        const Color(
                          0xFF171A18,
                        ),
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          if (badge != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFE8F5E9),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                badge!,
                style: const TextStyle(
                  color: Color(0xFF2E7D32),
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ProfileActionCard extends StatelessWidget {
  final List<Widget> children;

  const _ProfileActionCard({
    required this.children,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE8ECE8),
        ),
      ),
      child: Column(
        children: children,
      ),
    );
  }
}

class _ProfileActionTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final Color? iconColor;
  final Color? titleColor;
  final bool showDivider;
  final Widget? trailing;

  const _ProfileActionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.iconColor,
    this.titleColor,
    this.showDivider = true,
    this.trailing,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: 8,
          vertical: 14,
        ),
        decoration: BoxDecoration(
          border: showDivider
              ? const Border(
                  bottom: BorderSide(
                    color: Color(0xFFE8ECE8),
                  ),
                )
              : null,
        ),
        child: Row(
          children: [
            Container(
              width: 41,
              height: 41,
              decoration: BoxDecoration(
                color: (iconColor ??
                        const Color(
                          0xFF2E7D32,
                        ))
                    .withValues(
                  alpha: 0.10,
                ),
                borderRadius: BorderRadius.circular(
                  13,
                ),
              ),
              child: Icon(
                icon,
                color: iconColor ??
                    const Color(
                      0xFF2E7D32,
                    ),
                size: 21,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: titleColor ??
                          const Color(
                            0xFF171A18,
                          ),
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: Color(0xFF777D78),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            trailing ??
                const Icon(
                  Icons.arrow_forward_ios_rounded,
                  color: Color(0xFF9CA3AF),
                  size: 15,
                ),
          ],
        ),
      ),
    );
  }
}

class _EditProfileSheet extends StatefulWidget {
  final Map<String, dynamic> currentUser;

  const _EditProfileSheet({
    required this.currentUser,
  });

  @override
  State<_EditProfileSheet> createState() => _EditProfileSheetState();
}

class _EditProfileSheetState extends State<_EditProfileSheet> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF2E7D32);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  late final TextEditingController fullNameController;

  late final TextEditingController phoneController;

  late final TextEditingController emailController;

  late final TextEditingController stateController;

  late final TextEditingController lgaController;

  late final TextEditingController zoneController;

  bool isSaving = false;

  @override
  void initState() {
    super.initState();

    fullNameController = TextEditingController(
      text: _text(
        widget.currentUser['fullName'],
      ),
    );

    phoneController = TextEditingController(
      text: _text(
        widget.currentUser['phone'],
      ),
    );

    emailController = TextEditingController(
      text: _text(
        widget.currentUser['email'],
      ),
    );

    stateController = TextEditingController(
      text: _text(
        widget.currentUser['state'],
      ),
    );

    lgaController = TextEditingController(
      text: _text(
        widget.currentUser['lga'],
      ),
    );

    zoneController = TextEditingController(
      text: _text(
        widget.currentUser['zone'],
      ),
    );
  }

  String _text(dynamic value) {
    return value?.toString().trim() ?? '';
  }

  @override
  void dispose() {
    fullNameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    stateController.dispose();
    lgaController.dispose();
    zoneController.dispose();
    super.dispose();
  }

  dynamic _decode(
    String body,
  ) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  String _message(
    dynamic data,
  ) {
    if (data is Map) {
      final dynamic value = data['message'] ?? data['error'];

      if (value != null) {
        return value.toString();
      }
    }

    return 'Unable to update profile.';
  }

  Future<void> saveProfile() async {
    if (!formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      isSaving = true;
    });

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      final String token = prefs.getString(
            'auth_token',
          ) ??
          '';

      final http.Response response = await http
          .put(
            Uri.parse(
              '$baseUrl/auth/profile',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'fullName': fullNameController.text.trim(),
              'phone': phoneController.text.trim(),
              'email': emailController.text.trim(),
              'state': stateController.text.trim(),
              'lga': lgaController.text.trim(),
              'zone': zoneController.text.trim(),
            }),
          )
          .timeout(
            const Duration(
              seconds: 30,
            ),
          );

      final dynamic decoded = _decode(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            const SnackBar(
              content: Text(
                'Profile updated successfully.',
              ),
              backgroundColor: primaryGreen,
              behavior: SnackBarBehavior.floating,
            ),
          );

        Navigator.pop(
          context,
          true,
        );
      } else {
        throw Exception(
          _message(decoded),
        );
      }
    } catch (error) {
      if (!mounted) return;

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              error.toString().replaceFirst(
                    'Exception: ',
                    '',
                  ),
            ),
            backgroundColor: const Color(
              0xFFDC2626,
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );
    } finally {
      if (mounted) {
        setState(() {
          isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: EdgeInsets.only(
        left: 18,
        right: 18,
        top: 18,
        bottom: MediaQuery.of(context).viewInsets.bottom + 22,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(26),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 46,
                    height: 5,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(
                        20,
                      ),
                    ),
                  ),
                ),
                const SizedBox(
                  height: 19,
                ),
                const Text(
                  'Edit Profile',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(
                  height: 18,
                ),
                _ProfileTextField(
                  controller: fullNameController,
                  label: 'Full Name',
                  icon: Icons.person_outline_rounded,
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Full name is required.';
                    }

                    return null;
                  },
                ),
                const SizedBox(
                  height: 12,
                ),
                _ProfileTextField(
                  controller: phoneController,
                  label: 'Phone Number',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                  validator: (value) {
                    if (value == null || value.trim().length < 10) {
                      return 'Enter a valid phone number.';
                    }

                    return null;
                  },
                ),
                const SizedBox(
                  height: 12,
                ),
                _ProfileTextField(
                  controller: emailController,
                  label: 'Email',
                  icon: Icons.email_outlined,
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(
                  height: 12,
                ),
                _ProfileTextField(
                  controller: zoneController,
                  label: 'Zone',
                  icon: Icons.map_outlined,
                ),
                const SizedBox(
                  height: 12,
                ),
                _ProfileTextField(
                  controller: stateController,
                  label: 'State',
                  icon: Icons.location_city_outlined,
                ),
                const SizedBox(
                  height: 12,
                ),
                _ProfileTextField(
                  controller: lgaController,
                  label: 'LGA',
                  icon: Icons.location_on_outlined,
                ),
                const SizedBox(
                  height: 20,
                ),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: isSaving ? null : saveProfile,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: primaryGreen,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(
                          14,
                        ),
                      ),
                    ),
                    child: isSaving
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.3,
                              color: Colors.white,
                            ),
                          )
                        : const Text(
                            'Save Changes',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ChangePasswordSheet extends StatefulWidget {
  const _ChangePasswordSheet({this.client});
  final http.Client? client;

  @override
  State<_ChangePasswordSheet> createState() => _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends State<_ChangePasswordSheet> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF2E7D32);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController currentPasswordController =
      TextEditingController();

  final TextEditingController newPasswordController = TextEditingController();

  final TextEditingController confirmPasswordController =
      TextEditingController();

  bool hideCurrentPassword = true;
  bool hideNewPassword = true;
  bool hideConfirmPassword = true;
  bool isSaving = false;
  late final http.Client _client;
  late final bool _ownsClient;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
  }

  @override
  void dispose() {
    currentPasswordController.dispose();

    newPasswordController.dispose();

    confirmPasswordController.dispose();
    if (_ownsClient) _client.close();

    super.dispose();
  }

  dynamic _decode(
    String body,
  ) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  String _message(
    dynamic data,
  ) {
    if (data is Map) {
      final dynamic value = data['message'] ?? data['error'];

      if (value != null) {
        return value.toString();
      }
    }

    return 'Unable to change password.';
  }

  Future<void> changePassword() async {
    if (isSaving) return;
    if (!formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      isSaving = true;
    });

    try {
      final String token = await readAuthToken() ?? '';
      if (token.isEmpty) {
        throw Exception(
            'Your login session has expired. Please sign in again.');
      }

      final http.Response response = await _client
          .put(
            Uri.parse(
              '$baseUrl/auth/change-password',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'currentPassword': currentPasswordController.text,
              'newPassword': newPasswordController.text,
              'confirmPassword': confirmPasswordController.text,
            }),
          )
          .timeout(
            const Duration(
              seconds: 30,
            ),
          );

      final dynamic decoded = _decode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map &&
          decoded['success'] == true) {
        if (!mounted) return;

        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              content: Text(
                _message(decoded),
              ),
              backgroundColor: primaryGreen,
              behavior: SnackBarBehavior.floating,
            ),
          );

        Navigator.pop(context);
      } else {
        throw Exception(
          _message(decoded),
        );
      }
    } catch (error) {
      if (!mounted) return;

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              error.toString().replaceFirst(
                    'Exception: ',
                    '',
                  ),
            ),
            backgroundColor: const Color(
              0xFFDC2626,
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );
    } finally {
      if (mounted) {
        setState(() {
          isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: EdgeInsets.only(
        left: 18,
        right: 18,
        top: 18,
        bottom: MediaQuery.of(context).viewInsets.bottom + 22,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(26),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 46,
                    height: 5,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(
                        20,
                      ),
                    ),
                  ),
                ),
                const SizedBox(
                  height: 19,
                ),
                const Text(
                  'Change Password',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(
                  height: 18,
                ),
                _PasswordField(
                  controller: currentPasswordController,
                  label: 'Current Password',
                  obscureText: hideCurrentPassword,
                  onToggle: () {
                    setState(() {
                      hideCurrentPassword = !hideCurrentPassword;
                    });
                  },
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Enter your current password.';
                    }

                    return null;
                  },
                ),
                const SizedBox(
                  height: 12,
                ),
                _PasswordField(
                  controller: newPasswordController,
                  label: 'New Password',
                  obscureText: hideNewPassword,
                  onToggle: () {
                    setState(() {
                      hideNewPassword = !hideNewPassword;
                    });
                  },
                  validator: (value) {
                    if (value == null || !isStrongPassword(value)) {
                      return 'Password must be 8+ characters and include uppercase, lowercase, number and special character.';
                    }

                    return null;
                  },
                ),
                const SizedBox(
                  height: 12,
                ),
                _PasswordField(
                  controller: confirmPasswordController,
                  label: 'Confirm New Password',
                  obscureText: hideConfirmPassword,
                  onToggle: () {
                    setState(() {
                      hideConfirmPassword = !hideConfirmPassword;
                    });
                  },
                  validator: (value) {
                    if (value != newPasswordController.text) {
                      return 'Passwords do not match.';
                    }

                    return null;
                  },
                ),
                const SizedBox(
                  height: 20,
                ),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    key: const Key('change-password-submit'),
                    onPressed: isSaving ? null : changePassword,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: primaryGreen,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(
                          14,
                        ),
                      ),
                    ),
                    child: isSaving
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.3,
                              color: Colors.white,
                            ),
                          )
                        : const Text(
                            'Change Password',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfileTextField extends StatelessWidget {
  final TextEditingController controller;

  final String label;
  final IconData icon;

  final TextInputType? keyboardType;

  final String? Function(String?)? validator;

  const _ProfileTextField({
    required this.controller,
    required this.label,
    required this.icon,
    this.keyboardType,
    this.validator,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      validator: validator,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(
          icon,
          color: const Color(0xFF2E7D32),
        ),
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFFE8ECE8),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFF2E7D32),
            width: 1.4,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFFDC2626),
          ),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFFDC2626),
            width: 1.4,
          ),
        ),
      ),
    );
  }
}

class _PasswordField extends StatelessWidget {
  final TextEditingController controller;

  final String label;
  final bool obscureText;
  final VoidCallback onToggle;

  final String? Function(String?)? validator;

  const _PasswordField({
    required this.controller,
    required this.label,
    required this.obscureText,
    required this.onToggle,
    required this.validator,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return TextFormField(
      controller: controller,
      obscureText: obscureText,
      validator: validator,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: const Icon(
          Icons.lock_outline_rounded,
          color: Color(0xFF2E7D32),
        ),
        suffixIcon: IconButton(
          onPressed: onToggle,
          icon: Icon(
            obscureText
                ? Icons.visibility_outlined
                : Icons.visibility_off_outlined,
          ),
        ),
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFFE8ECE8),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFF2E7D32),
            width: 1.4,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFFDC2626),
          ),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: Color(0xFFDC2626),
            width: 1.4,
          ),
        ),
      ),
    );
  }
}

class _ProfileErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ProfileErrorState({
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(22),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(
              18,
            ),
            border: Border.all(
              color: const Color(0xFFFECACA),
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.error_outline_rounded,
                color: Color(0xFFDC2626),
                size: 50,
              ),
              const SizedBox(
                height: 13,
              ),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF6B7280),
                  height: 1.4,
                ),
              ),
              const SizedBox(
                height: 17,
              ),
              ElevatedButton.icon(
                onPressed: onRetry,
                icon: const Icon(
                  Icons.refresh_rounded,
                ),
                label: const Text(
                  'Try Again',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
