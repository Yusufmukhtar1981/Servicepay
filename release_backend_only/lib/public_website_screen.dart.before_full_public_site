import 'package:flutter/material.dart';

import 'login_screen.dart';
import 'register_screen.dart';

class PublicWebsiteScreen extends StatelessWidget {
  const PublicWebsiteScreen({super.key});

  static const Color primaryGreen = Color(0xFF08783E);
  static const Color darkGreen = Color(0xFF055C30);
  static const Color softGreen = Color(0xFFEAF7F0);

  void _openLogin(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const LoginScreen(),
      ),
    );
  }

  void _openRegister(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const RegisterScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SelectionArea(
        child: SingleChildScrollView(
          child: Column(
            children: [
              _header(context),
              _hero(context),
              _services(),
              _whyServicePay(),
              _howItWorks(),
              _security(),
              _cta(context),
              _footer(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 16,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final bool small = constraints.maxWidth < 720;

          return Row(
            children: [
              _brand(),
              const Spacer(),
              if (!small) ...[
                TextButton(
                  onPressed: () {},
                  child: const Text('Services'),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: () {},
                  child: const Text('About'),
                ),
                const SizedBox(width: 8),
              ],
              OutlinedButton(
                onPressed: () => _openLogin(context),
                style: OutlinedButton.styleFrom(
                  foregroundColor: primaryGreen,
                  side: const BorderSide(
                    color: primaryGreen,
                  ),
                ),
                child: const Text('Login'),
              ),
              const SizedBox(width: 10),
              FilledButton(
                onPressed: () => _openRegister(context),
                style: FilledButton.styleFrom(
                  backgroundColor: primaryGreen,
                ),
                child: Text(
                  small ? 'Register' : 'Create Account',
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _brand() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 44,
          height: 44,
          child: Image.asset(
            'assets/image/servicepay_logo.png',
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) {
              return Container(
                decoration: BoxDecoration(
                  color: primaryGreen,
                  borderRadius: BorderRadius.circular(13),
                ),
                alignment: Alignment.center,
                child: const Text(
                  'S',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 25,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(width: 10),
        const Text(
          'ServicePay',
          style: TextStyle(
            fontSize: 22,
            color: primaryGreen,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }

  Widget _hero(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFF5FBF7),
            Color(0xFFEAF7F0),
          ],
        ),
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 72,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 1100,
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final bool small = constraints.maxWidth < 800;

              final content = [
                Expanded(
                  flex: small ? 0 : 6,
                  child: Column(
                    crossAxisAlignment: small
                        ? CrossAxisAlignment.center
                        : CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(30),
                        ),
                        child: const Text(
                          'Simple • Fast • Reliable',
                          style: TextStyle(
                            color: primaryGreen,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(height: 22),
                      Text(
                        'One Platform,\nMany Solutions.',
                        textAlign: small ? TextAlign.center : TextAlign.left,
                        style: TextStyle(
                          fontSize: small ? 42 : 58,
                          height: 1.05,
                          fontWeight: FontWeight.w900,
                          color: const Color(0xFF12221A),
                        ),
                      ),
                      const SizedBox(height: 22),
                      Text(
                        'Make everyday payments and access essential '
                        'services easily with ServicePay. Buy airtime '
                        'and data, pay bills, make transfers, verify '
                        'your identity, request deliveries and more.',
                        textAlign: small ? TextAlign.center : TextAlign.left,
                        style: const TextStyle(
                          fontSize: 18,
                          height: 1.65,
                          color: Colors.black54,
                        ),
                      ),
                      const SizedBox(height: 30),
                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        alignment:
                            small ? WrapAlignment.center : WrapAlignment.start,
                        children: [
                          SizedBox(
                            height: 54,
                            child: FilledButton.icon(
                              onPressed: () => _openRegister(context),
                              style: FilledButton.styleFrom(
                                backgroundColor: primaryGreen,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 25,
                                ),
                              ),
                              icon: const Icon(
                                Icons.person_add_alt_1_rounded,
                              ),
                              label: const Text(
                                'Create Free Account',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                          SizedBox(
                            height: 54,
                            child: OutlinedButton.icon(
                              onPressed: () => _openLogin(context),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: primaryGreen,
                                side: const BorderSide(
                                  color: primaryGreen,
                                ),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 25,
                                ),
                              ),
                              icon: const Icon(
                                Icons.login_rounded,
                              ),
                              label: const Text(
                                'Login to ServicePay',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (!small) const SizedBox(width: 60),
                Expanded(
                  flex: small ? 0 : 4,
                  child: Container(
                    margin: EdgeInsets.only(
                      top: small ? 50 : 0,
                    ),
                    padding: const EdgeInsets.all(28),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(30),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.08),
                          blurRadius: 28,
                          offset: const Offset(0, 14),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.account_balance_wallet_rounded,
                          color: primaryGreen,
                          size: 70,
                        ),
                        const SizedBox(height: 20),
                        const Text(
                          'Everything You Need',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 23,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 20),
                        _miniFeature(
                          Icons.phone_android_rounded,
                          'Airtime & Data',
                        ),
                        _miniFeature(
                          Icons.lightbulb_rounded,
                          'Electricity Bills',
                        ),
                        _miniFeature(
                          Icons.swap_horiz_rounded,
                          'Money Transfers',
                        ),
                        _miniFeature(
                          Icons.badge_rounded,
                          'NIN Verification',
                        ),
                        _miniFeature(
                          Icons.local_shipping_rounded,
                          'Delivery Services',
                        ),
                      ],
                    ),
                  ),
                ),
              ];

              if (small) {
                return Column(
                  children: content
                      .where((widget) =>
                          widget is! SizedBox || widget.width == null)
                      .toList(),
                );
              }

              return Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: content,
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _miniFeature(
    IconData icon,
    String title,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: const BoxDecoration(
              color: softGreen,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              color: primaryGreen,
              size: 21,
            ),
          ),
          const SizedBox(width: 12),
          Text(
            title,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _services() {
    const services = [
      (
        Icons.phone_android_rounded,
        'Airtime',
        'Recharge any supported network quickly and conveniently.'
      ),
      (
        Icons.network_cell_rounded,
        'Data',
        'Buy affordable data bundles for your preferred network.'
      ),
      (
        Icons.lightbulb_rounded,
        'Electricity',
        'Pay electricity bills and manage your meter payments.'
      ),
      (
        Icons.swap_horiz_rounded,
        'Transfers',
        'Send money securely to ServicePay users and supported banks.'
      ),
      (
        Icons.badge_rounded,
        'NIN Verification',
        'Access secure identity verification services.'
      ),
      (
        Icons.local_shipping_rounded,
        'Delivery',
        'Request convenient delivery and logistics services.'
      ),
    ];

    return _section(
      title: 'Everything in One Place',
      subtitle:
          'ServicePay brings essential everyday services together on one simple platform.',
      child: LayoutBuilder(
        builder: (context, constraints) {
          final int columns = constraints.maxWidth >= 950
              ? 3
              : constraints.maxWidth >= 620
                  ? 2
                  : 1;

          final double width =
              (constraints.maxWidth - ((columns - 1) * 18)) / columns;

          return Wrap(
            spacing: 18,
            runSpacing: 18,
            children: services.map((item) {
              return SizedBox(
                width: width,
                child: _serviceCard(
                  item.$1,
                  item.$2,
                  item.$3,
                ),
              );
            }).toList(),
          );
        },
      ),
    );
  }

  Widget _serviceCard(
    IconData icon,
    String title,
    String description,
  ) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE6ECE8),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: softGreen,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(
              icon,
              color: primaryGreen,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            title,
            style: const TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 9),
          Text(
            description,
            style: const TextStyle(
              height: 1.5,
              color: Colors.black54,
            ),
          ),
        ],
      ),
    );
  }

  Widget _whyServicePay() {
    return Container(
      width: double.infinity,
      color: const Color(0xFFF7FAF8),
      child: _section(
        title: 'Why ServicePay?',
        subtitle:
            'Designed to make everyday transactions simple, convenient and reliable.',
        child: LayoutBuilder(
          builder: (context, constraints) {
            const items = [
              (
                Icons.bolt_rounded,
                'Fast',
                'Complete everyday transactions with a simple experience.'
              ),
              (
                Icons.security_rounded,
                'Secure',
                'Your account and transactions are protected with security controls.'
              ),
              (
                Icons.apps_rounded,
                'Convenient',
                'Access multiple essential services from one account.'
              ),
              (
                Icons.support_agent_rounded,
                'Support',
                'Our support team is available when you need assistance.'
              ),
            ];

            return Wrap(
              spacing: 20,
              runSpacing: 20,
              children: items.map((item) {
                return SizedBox(
                  width: constraints.maxWidth >= 850
                      ? (constraints.maxWidth - 60) / 4
                      : constraints.maxWidth >= 500
                          ? (constraints.maxWidth - 20) / 2
                          : constraints.maxWidth,
                  child: Column(
                    children: [
                      Container(
                        width: 60,
                        height: 60,
                        decoration: const BoxDecoration(
                          color: softGreen,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          item.$1,
                          color: primaryGreen,
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        item.$2,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 7),
                      Text(
                        item.$3,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.black54,
                          height: 1.5,
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            );
          },
        ),
      ),
    );
  }

  Widget _howItWorks() {
    return _section(
      title: 'Get Started in Minutes',
      subtitle:
          'Create your ServicePay account and start accessing services in three simple steps.',
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: _StepCard(
              number: '1',
              title: 'Create Account',
              text: 'Register using your basic information.',
            ),
          ),
          SizedBox(width: 18),
          Expanded(
            child: _StepCard(
              number: '2',
              title: 'Fund Your Wallet',
              text: 'Add funds securely to your ServicePay wallet.',
            ),
          ),
          SizedBox(width: 18),
          Expanded(
            child: _StepCard(
              number: '3',
              title: 'Choose a Service',
              text: 'Start paying, buying and accessing services.',
            ),
          ),
        ],
      ),
    );
  }

  Widget _security() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 70,
      ),
      color: darkGreen,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 900,
          ),
          child: Column(
            children: [
              const Icon(
                Icons.verified_user_rounded,
                color: Colors.white,
                size: 55,
              ),
              const SizedBox(height: 18),
              const Text(
                'Built with Security in Mind',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 31,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 14),
              Text(
                'ServicePay uses account authentication, transaction '
                'controls and secure backend processing to help protect '
                'your account and transactions.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.82),
                  height: 1.6,
                  fontSize: 16,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _cta(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 70,
      ),
      child: Column(
        children: [
          const Text(
            'Ready to Get Started?',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 34,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Create your ServicePay account and access everyday services from one place.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.black54,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 25),
          FilledButton.icon(
            onPressed: () => _openRegister(context),
            style: FilledButton.styleFrom(
              backgroundColor: primaryGreen,
              padding: const EdgeInsets.symmetric(
                horizontal: 30,
                vertical: 18,
              ),
            ),
            icon: const Icon(
              Icons.arrow_forward_rounded,
            ),
            label: const Text(
              'Create Your Account',
              style: TextStyle(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _section({
    required String title,
    required String subtitle,
    required Widget child,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 70,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 1100,
          ),
          child: Column(
            children: [
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 12),
              ConstrainedBox(
                constraints: const BoxConstraints(
                  maxWidth: 700,
                ),
                child: Text(
                  subtitle,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 16,
                    height: 1.5,
                    color: Colors.black54,
                  ),
                ),
              ),
              const SizedBox(height: 42),
              child,
            ],
          ),
        ),
      ),
    );
  }

  Widget _footer() {
    return Container(
      width: double.infinity,
      color: const Color(0xFF0D1E15),
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 36,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 1100,
          ),
          child: Column(
            children: [
              _brand(),
              const SizedBox(height: 15),
              const Text(
                'One Platform, Many Solutions.',
                style: TextStyle(
                  color: Colors.white70,
                ),
              ),
              const SizedBox(height: 22),
              const Divider(
                color: Colors.white12,
              ),
              const SizedBox(height: 16),
              Text(
                '© ${DateTime.now().year} ServicePay. All rights reserved.',
                style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StepCard extends StatelessWidget {
  final String number;
  final String title;
  final String text;

  const _StepCard({
    required this.number,
    required this.title,
    required this.text,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 52,
          height: 52,
          decoration: const BoxDecoration(
            color: Color(0xFF08783E),
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            number,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 17,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.black54,
            height: 1.5,
          ),
        ),
      ],
    );
  }
}
