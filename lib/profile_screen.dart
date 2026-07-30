import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'login_screen.dart';
import 'transaction_pin_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF2E7D32);

  bool isLoading = true;
  bool isRefreshing = false;
  bool isLoggingOut = false;

  String errorMessage = '';

  Map<String, dynamic> user = {};

  @override
  void initState() {
    super.initState();
    loadProfile();
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

      final http.Response response = await http.get(
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
      if (!mounted) return;

      setState(() {
        isLoading = false;
        isRefreshing = false;
      });
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

  Future<void> openTransactionPin() async {
    final bool? created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => const TransactionPinScreen(),
      ),
    );

    if (created == true) {
      await loadProfile(
        showRefreshLoader: true,
      );
    }
  }

  Future<void> openChangePassword() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return const _ChangePasswordSheet();
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
                  onRefresh: () {
                    return loadProfile(
                      showRefreshLoader: true,
                    );
                  },
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
                        fullName: fullName,
                        phone: phone,
                        role: role,
                        status: status,
                      ),
                      const SizedBox(height: 14),
                      _WalletSummaryCard(
                        balance: walletBalance,
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
                          ),
                          _ProfileInfoRow(
                            icon: Icons.email_outlined,
                            label: 'Email',
                            value: email,
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
                        title: 'Account Settings',
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
                          _ProfileActionTile(
                            icon: Icons.pin_outlined,
                            title: user['transactionPinSet'] == true
                                ? 'Transaction PIN'
                                : 'Create Transaction PIN',
                            subtitle: user['transactionPinSet'] == true
                                ? 'Your transaction PIN is active'
                                : 'Create a 4-digit PIN for transactions',
                            onTap: openTransactionPin,
                          ),
                          _ProfileActionTile(
                            icon: Icons.lock_outline_rounded,
                            title: 'Change Password',
                            subtitle: 'Update your account password',
                            onTap: openChangePassword,
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
  final String fullName;
  final String phone;
  final String role;
  final String status;

  const _ProfileHeader({
    required this.initials,
    required this.fullName,
    required this.phone,
    required this.role,
    required this.status,
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
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              color: Colors.white.withValues(
                alpha: 0.18,
              ),
              shape: BoxShape.circle,
              border: Border.all(
                color: Colors.white.withValues(
                  alpha: 0.45,
                ),
                width: 2,
              ),
            ),
            alignment: Alignment.center,
            child: Text(
              initials,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 30,
                fontWeight: FontWeight.w900,
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

  const _ProfileInfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
    this.showDivider = true,
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
      if (!mounted) return;

      setState(() {
        isSaving = false;
      });
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
  const _ChangePasswordSheet();

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

  @override
  void dispose() {
    currentPasswordController.dispose();

    newPasswordController.dispose();

    confirmPasswordController.dispose();

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

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            const SnackBar(
              content: Text(
                'Password changed successfully.',
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
      if (!mounted) return;

      setState(() {
        isSaving = false;
      });
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
                    if (value == null || value.length < 6) {
                      return 'Password must contain at least 6 characters.';
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
