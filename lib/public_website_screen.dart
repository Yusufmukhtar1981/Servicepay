import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'login_screen.dart';
import 'register_screen.dart';

import 'pay_by_link_screen.dart';

class PublicWebsiteScreen extends StatefulWidget {
  const PublicWebsiteScreen({super.key});

  @override
  State<PublicWebsiteScreen> createState() => _PublicWebsiteScreenState();
}

class _PublicWebsiteScreenState extends State<PublicWebsiteScreen> {
  @override
  void initState() {
    super.initState();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _openPublicPaymentLink();
    });
  }

  void _openPublicPaymentLink() {
    final code = Uri.base.queryParameters['pay']?.trim();

    if (code == null || code.isEmpty) {
      return;
    }

    if (!mounted) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PayByLinkScreen(
          initialPaymentCode: code,
        ),
      ),
    );
  }

  static const Color primaryGreen = Color(0xFF08783E);
  static const Color darkGreen = Color(0xFF055C30);
  static const Color softGreen = Color(0xFFEAF7F0);
  static const Color pageBackground = Color(0xFFF8FAF9);

  final GlobalKey _homeKey = GlobalKey();
  final GlobalKey _servicesKey = GlobalKey();
  final GlobalKey _aboutKey = GlobalKey();
  final GlobalKey _contactKey = GlobalKey();

  void _openLogin() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const LoginScreen(),
      ),
    );
  }

  void _openRegister() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const RegisterScreen(),
      ),
    );
  }

  Future<void> _scrollTo(GlobalKey key) async {
    final BuildContext? targetContext = key.currentContext;

    if (targetContext == null) {
      return;
    }

    await Scrollable.ensureVisible(
      targetContext,
      duration: const Duration(milliseconds: 650),
      curve: Curves.easeInOutCubic,
      alignment: 0.04,
    );
  }

  Future<void> _openWhatsApp() async {
    final Uri uri = Uri.parse(
      'https://wa.me/2348026114645'
      '?text=Hello%20ServicePay%20Support,%20I%20need%20assistance.',
    );

    final bool launched = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    );

    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Unable to open WhatsApp. Please try again.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: pageBackground,
      body: SelectionArea(
        child: Column(
          children: [
            _header(),
            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  children: [
                    KeyedSubtree(
                      key: _homeKey,
                      child: _hero(),
                    ),
                    KeyedSubtree(
                      key: _servicesKey,
                      child: _services(),
                    ),
                    KeyedSubtree(
                      key: _aboutKey,
                      child: _aboutUs(),
                    ),
                    _whyServicePay(),
                    _howItWorks(),
                    _security(),
                    KeyedSubtree(
                      key: _contactKey,
                      child: _contact(),
                    ),
                    _cta(),
                    _footer(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 14,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 18,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final bool mobile = constraints.maxWidth < 760;

          if (mobile) {
            return Row(
              children: [
                _brand(),
                const Spacer(),
                PopupMenuButton<String>(
                  tooltip: 'Menu',
                  icon: const Icon(
                    Icons.menu_rounded,
                    color: primaryGreen,
                  ),
                  onSelected: (String value) {
                    switch (value) {
                      case 'home':
                        _scrollTo(_homeKey);
                        break;
                      case 'services':
                        _scrollTo(_servicesKey);
                        break;
                      case 'about':
                        _scrollTo(_aboutKey);
                        break;
                      case 'contact':
                        _scrollTo(_contactKey);
                        break;
                      case 'login':
                        _openLogin();
                        break;
                      case 'register':
                        _openRegister();
                        break;
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(
                      value: 'home',
                      child: Text('Home'),
                    ),
                    PopupMenuItem(
                      value: 'services',
                      child: Text('Services'),
                    ),
                    PopupMenuItem(
                      value: 'about',
                      child: Text('About Us'),
                    ),
                    PopupMenuItem(
                      value: 'contact',
                      child: Text('Contact'),
                    ),
                    PopupMenuItem(
                      value: 'login',
                      child: Text('Login'),
                    ),
                    PopupMenuItem(
                      value: 'register',
                      child: Text('Create Account'),
                    ),
                  ],
                ),
              ],
            );
          }

          return Row(
            children: [
              _brand(),
              const Spacer(),
              _navButton(
                'Home',
                () => _scrollTo(_homeKey),
              ),
              _navButton(
                'Services',
                () => _scrollTo(_servicesKey),
              ),
              _navButton(
                'About Us',
                () => _scrollTo(_aboutKey),
              ),
              _navButton(
                'Contact',
                () => _scrollTo(_contactKey),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                onPressed: _openLogin,
                style: OutlinedButton.styleFrom(
                  foregroundColor: primaryGreen,
                  side: const BorderSide(
                    color: primaryGreen,
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 16,
                  ),
                ),
                child: const Text(
                  'Login',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              FilledButton(
                onPressed: _openRegister,
                style: FilledButton.styleFrom(
                  backgroundColor: primaryGreen,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 16,
                  ),
                ),
                child: const Text(
                  'Create Account',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _navButton(
    String title,
    VoidCallback onPressed,
  ) {
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: const Color(0xFF24352B),
        padding: const EdgeInsets.symmetric(
          horizontal: 15,
          vertical: 14,
        ),
      ),
      child: Text(
        title,
        style: const TextStyle(
          fontWeight: FontWeight.w600,
        ),
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
            color: primaryGreen,
            fontSize: 22,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }

  Widget _hero() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 76,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFF8FCF9),
            Color(0xFFEAF7F0),
          ],
        ),
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 1120,
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final bool mobile = constraints.maxWidth < 820;

              final Widget textSide = Column(
                crossAxisAlignment: mobile
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
                      borderRadius: BorderRadius.circular(40),
                      border: Border.all(
                        color: const Color(0xFFDDEBE2),
                      ),
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
                    textAlign: mobile ? TextAlign.center : TextAlign.left,
                    style: TextStyle(
                      color: const Color(0xFF14241B),
                      fontSize: mobile ? 42 : 60,
                      height: 1.05,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 22),
                  ConstrainedBox(
                    constraints: const BoxConstraints(
                      maxWidth: 650,
                    ),
                    child: Text(
                      'Make everyday payments and access essential '
                      'services easily with ServicePay. Buy airtime '
                      'and data, pay bills, make transfers, verify '
                      'your identity, request deliveries and more.',
                      textAlign: mobile ? TextAlign.center : TextAlign.left,
                      style: const TextStyle(
                        color: Colors.black54,
                        fontSize: 17,
                        height: 1.65,
                      ),
                    ),
                  ),
                  const SizedBox(height: 30),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    alignment:
                        mobile ? WrapAlignment.center : WrapAlignment.start,
                    children: [
                      FilledButton.icon(
                        onPressed: _openRegister,
                        style: FilledButton.styleFrom(
                          backgroundColor: primaryGreen,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 25,
                            vertical: 18,
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
                      OutlinedButton.icon(
                        onPressed: _openLogin,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: primaryGreen,
                          side: const BorderSide(
                            color: primaryGreen,
                          ),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 25,
                            vertical: 18,
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
                    ],
                  ),
                ],
              );

              final Widget servicePreview = Container(
                padding: const EdgeInsets.all(28),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(30),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: 0.08,
                      ),
                      blurRadius: 30,
                      offset: const Offset(0, 14),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    SizedBox(
                      width: 68,
                      height: 68,
                      child: Image.asset(
                        'assets/image/servicepay_logo.png',
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) {
                          return const Icon(
                            Icons.account_balance_wallet_rounded,
                            color: primaryGreen,
                            size: 60,
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Everything You Need',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 18),
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
              );

              if (mobile) {
                return Column(
                  children: [
                    textSide,
                    const SizedBox(height: 48),
                    servicePreview,
                  ],
                );
              }

              return Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    flex: 6,
                    child: textSide,
                  ),
                  const SizedBox(width: 60),
                  Expanded(
                    flex: 4,
                    child: servicePreview,
                  ),
                ],
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
      padding: const EdgeInsets.symmetric(
        vertical: 8,
      ),
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
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _services() {
    final services = [
      const _ServiceItem(
        icon: Icons.phone_android_rounded,
        title: 'Airtime',
        description:
            'Recharge MTN, Airtel, Glo and 9mobile numbers quickly from your ServicePay wallet.',
      ),
      const _ServiceItem(
        icon: Icons.network_cell_rounded,
        title: 'Data',
        description:
            'Purchase convenient data bundles for supported mobile networks.',
      ),
      const _ServiceItem(
        icon: Icons.lightbulb_rounded,
        title: 'Electricity',
        description:
            'Pay electricity bills and manage prepaid or supported meter payments.',
      ),
      const _ServiceItem(
        icon: Icons.swap_horiz_rounded,
        title: 'Money Transfer',
        description:
            'Transfer money securely to other ServicePay users and supported bank accounts.',
      ),
      const _ServiceItem(
        icon: Icons.account_balance_wallet_rounded,
        title: 'Wallet Funding',
        description:
            'Fund your ServicePay wallet and use your balance across available services.',
      ),
      const _ServiceItem(
        icon: Icons.badge_rounded,
        title: 'NIN Verification',
        description:
            'Access secure NIN verification and identity-related services.',
      ),
      const _ServiceItem(
        icon: Icons.local_shipping_rounded,
        title: 'Delivery & Logistics',
        description:
            'Request delivery services and connect with ServicePay delivery operations.',
      ),
      const _ServiceItem(
        icon: Icons.school_rounded,
        title: 'Exam PIN',
        description:
            'Purchase supported examination PINs conveniently from your account.',
      ),
      const _ServiceItem(
        icon: Icons.volunteer_activism_rounded,
        title: 'ServicePay Amana',
        description:
            'Purpose-controlled support for important family and community needs.',
        comingSoon: true,
      ),
      const _ServiceItem(
        icon: Icons.live_tv_rounded,
        title: 'Cable TV',
        description:
            'Pay for supported television subscriptions directly from ServicePay.',
        comingSoon: true,
      ),
      const _ServiceItem(
        icon: Icons.flight_takeoff_rounded,
        title: 'Flight Booking',
        description:
            'A convenient way to access future flight booking services.',
        comingSoon: true,
      ),
    ];

    return _section(
      title: 'Our Services',
      subtitle:
          'Essential everyday services brought together on one simple platform.',
      child: LayoutBuilder(
        builder: (context, constraints) {
          final int columns = constraints.maxWidth >= 960
              ? 3
              : constraints.maxWidth >= 620
                  ? 2
                  : 1;

          final double cardWidth =
              (constraints.maxWidth - ((columns - 1) * 18)) / columns;

          return Wrap(
            spacing: 18,
            runSpacing: 18,
            children: services
                .map(
                  (service) => SizedBox(
                    width: cardWidth,
                    child: _serviceCard(service),
                  ),
                )
                .toList(),
          );
        },
      ),
    );
  }

  Widget _serviceCard(
    _ServiceItem service,
  ) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE5ECE8),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.025),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: softGreen,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(
                  service.icon,
                  color: primaryGreen,
                ),
              ),
              const Spacer(),
              if (service.comingSoon)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF5E6),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'Coming Soon',
                    style: TextStyle(
                      color: Color(0xFF9A6700),
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            service.title,
            style: const TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 9),
          Text(
            service.description,
            style: const TextStyle(
              color: Colors.black54,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 16),
          TextButton.icon(
            onPressed: service.comingSoon ? null : _openLogin,
            style: TextButton.styleFrom(
              foregroundColor: primaryGreen,
              padding: EdgeInsets.zero,
            ),
            icon: Icon(
              service.comingSoon
                  ? Icons.schedule_rounded
                  : Icons.arrow_forward_rounded,
              size: 18,
            ),
            label: Text(
              service.comingSoon ? 'Available Soon' : 'Login to Use Service',
            ),
          ),
        ],
      ),
    );
  }

  Widget _aboutUs() {
    return Container(
      width: double.infinity,
      color: Colors.white,
      child: _section(
        title: 'About ServicePay',
        subtitle:
            'Making everyday digital services simpler and more accessible.',
        child: Column(
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 850,
              ),
              child: const Text(
                'ServicePay is a digital service platform built to '
                'make everyday payments and essential services simple, '
                'convenient and accessible.\n\n'
                'From airtime and data purchases to electricity payments, '
                'money transfers, identity verification and delivery '
                'services, ServicePay brings multiple solutions together '
                'in one secure platform.\n\n'
                'Our goal is to reduce the stress of using different '
                'platforms for everyday needs by giving individuals and '
                'businesses a simple place to access trusted digital '
                'services. We are committed to reliability, innovation, '
                'customer satisfaction and creating opportunities as '
                'ServicePay continues to grow across Nigeria and beyond.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 17,
                  height: 1.75,
                  color: Colors.black54,
                ),
              ),
            ),
            const SizedBox(height: 50),
            LayoutBuilder(
              builder: (context, constraints) {
                final bool mobile = constraints.maxWidth < 700;

                final mission = _aboutCard(
                  icon: Icons.flag_rounded,
                  title: 'Our Mission',
                  text: 'To simplify everyday services through secure, '
                      'reliable and innovative digital solutions while '
                      'creating opportunities for individuals and businesses.',
                );

                final vision = _aboutCard(
                  icon: Icons.visibility_rounded,
                  title: 'Our Vision',
                  text: 'To become one of Africa’s most trusted and widely '
                      'used digital service platforms.',
                );

                if (mobile) {
                  return Column(
                    children: [
                      mission,
                      const SizedBox(height: 18),
                      vision,
                    ],
                  );
                }

                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: mission),
                    const SizedBox(width: 18),
                    Expanded(child: vision),
                  ],
                );
              },
            ),
            const SizedBox(height: 55),
            const Text(
              'Our Core Values',
              style: TextStyle(
                fontSize: 25,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 25),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 14,
              runSpacing: 14,
              children: [
                _valueChip(
                  Icons.verified_rounded,
                  'Trust',
                ),
                _valueChip(
                  Icons.touch_app_rounded,
                  'Simplicity',
                ),
                _valueChip(
                  Icons.lightbulb_outline_rounded,
                  'Innovation',
                ),
                _valueChip(
                  Icons.speed_rounded,
                  'Reliability',
                ),
                _valueChip(
                  Icons.favorite_outline_rounded,
                  'Customer First',
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _aboutCard({
    required IconData icon,
    required String title,
    required String text,
  }) {
    return Container(
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: softGreen,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        children: [
          Container(
            width: 62,
            height: 62,
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              color: primaryGreen,
              size: 30,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            title,
            style: const TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.black54,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }

  Widget _valueChip(
    IconData icon,
    String label,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 18,
        vertical: 13,
      ),
      decoration: BoxDecoration(
        color: softGreen,
        borderRadius: BorderRadius.circular(40),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            color: primaryGreen,
            size: 20,
          ),
          const SizedBox(width: 9),
          Text(
            label,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _whyServicePay() {
    final items = [
      const _WhyItem(
        icon: Icons.bolt_rounded,
        title: 'Fast',
        text: 'A simple experience designed for everyday transactions.',
      ),
      const _WhyItem(
        icon: Icons.security_rounded,
        title: 'Secure',
        text: 'Account authentication and transaction security controls.',
      ),
      const _WhyItem(
        icon: Icons.apps_rounded,
        title: 'Convenient',
        text: 'Multiple essential services accessible from one account.',
      ),
      const _WhyItem(
        icon: Icons.support_agent_rounded,
        title: 'Customer Support',
        text: 'Dedicated assistance when you need help with ServicePay.',
      ),
    ];

    return Container(
      width: double.infinity,
      color: const Color(0xFFF6F9F7),
      child: _section(
        title: 'Why ServicePay?',
        subtitle:
            'One account. Multiple services. Simple transactions. Reliable support.',
        child: LayoutBuilder(
          builder: (context, constraints) {
            final int columns = constraints.maxWidth >= 850 ? 4 : 2;

            final double width = constraints.maxWidth < 520
                ? constraints.maxWidth
                : (constraints.maxWidth - ((columns - 1) * 18)) / columns;

            return Wrap(
              spacing: 18,
              runSpacing: 28,
              children: items
                  .map(
                    (item) => SizedBox(
                      width: width,
                      child: Column(
                        children: [
                          Container(
                            width: 62,
                            height: 62,
                            decoration: const BoxDecoration(
                              color: softGreen,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              item.icon,
                              color: primaryGreen,
                            ),
                          ),
                          const SizedBox(height: 15),
                          Text(
                            item.title,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            item.text,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.black54,
                              height: 1.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            );
          },
        ),
      ),
    );
  }

  Widget _howItWorks() {
    return _section(
      title: 'How ServicePay Works',
      subtitle: 'Start accessing ServicePay services in a few simple steps.',
      child: LayoutBuilder(
        builder: (context, constraints) {
          final steps = [
            const _StepItem(
              number: '1',
              title: 'Create an Account',
              text: 'Register with your basic information.',
            ),
            const _StepItem(
              number: '2',
              title: 'Fund Your Wallet',
              text: 'Add funds securely to your ServicePay wallet.',
            ),
            const _StepItem(
              number: '3',
              title: 'Choose a Service',
              text:
                  'Select the service you want and complete your transaction.',
            ),
          ];

          final bool mobile = constraints.maxWidth < 700;

          if (mobile) {
            return Column(
              children: steps
                  .map(
                    (step) => Padding(
                      padding: const EdgeInsets.only(
                        bottom: 30,
                      ),
                      child: _stepCard(step),
                    ),
                  )
                  .toList(),
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: steps
                .map(
                  (step) => Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                      ),
                      child: _stepCard(step),
                    ),
                  ),
                )
                .toList(),
          );
        },
      ),
    );
  }

  Widget _stepCard(
    _StepItem step,
  ) {
    return Column(
      children: [
        Container(
          width: 54,
          height: 54,
          decoration: const BoxDecoration(
            color: primaryGreen,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            step.number,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          step.title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          step.text,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.black54,
            height: 1.5,
          ),
        ),
      ],
    );
  }

  Widget _security() {
    return Container(
      width: double.infinity,
      color: darkGreen,
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 72,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 850,
          ),
          child: Column(
            children: [
              const Icon(
                Icons.verified_user_rounded,
                color: Colors.white,
                size: 58,
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
              const SizedBox(height: 15),
              Text(
                'ServicePay uses account authentication, '
                'transaction controls and secure backend '
                'processing to help protect customer accounts '
                'and transactions.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.82),
                  fontSize: 16,
                  height: 1.65,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _contact() {
    return _section(
      title: 'Contact ServicePay',
      subtitle:
          'Need help or have a question? Our support team is ready to assist you.',
      child: LayoutBuilder(
        builder: (context, constraints) {
          final bool mobile = constraints.maxWidth < 700;

          final supportCard = _contactCard(
            icon: Icons.chat_rounded,
            title: 'WhatsApp Support',
            description: 'Chat with ServicePay Support for assistance with '
                'your account, transactions and available services.',
            actionText: 'Chat on WhatsApp',
            onPressed: _openWhatsApp,
          );

          final accountCard = _contactCard(
            icon: Icons.person_add_alt_1_rounded,
            title: 'New to ServicePay?',
            description: 'Create your ServicePay account and start using '
                'available services from one platform.',
            actionText: 'Create Account',
            onPressed: _openRegister,
          );

          if (mobile) {
            return Column(
              children: [
                supportCard,
                const SizedBox(height: 18),
                accountCard,
              ],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: supportCard,
              ),
              const SizedBox(width: 18),
              Expanded(
                child: accountCard,
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _contactCard({
    required IconData icon,
    required String title,
    required String description,
    required String actionText,
    required VoidCallback onPressed,
  }) {
    return Container(
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: const Color(0xFFE5ECE8),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: softGreen,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              color: primaryGreen,
              size: 30,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            description,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.black54,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 22),
          FilledButton(
            onPressed: onPressed,
            style: FilledButton.styleFrom(
              backgroundColor: primaryGreen,
            ),
            child: Text(
              actionText,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _cta() {
    return Container(
      width: double.infinity,
      color: softGreen,
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
          const SizedBox(height: 14),
          const Text(
            'Create your ServicePay account and access everyday '
            'services from one place.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.black54,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 26),
          FilledButton.icon(
            onPressed: _openRegister,
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
        vertical: 72,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 1120,
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
                  maxWidth: 720,
                ),
                child: Text(
                  subtitle,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 16,
                    height: 1.55,
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
      color: const Color(0xFF0C1E14),
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 44,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 1120,
          ),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 42,
                    height: 42,
                    child: Image.asset(
                      'assets/image/servicepay_logo.png',
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) {
                        return const Icon(
                          Icons.account_balance_wallet_rounded,
                          color: Colors.white,
                        );
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Text(
                    'ServicePay',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Text(
                'One Platform, Many Solutions.',
                style: TextStyle(
                  color: Colors.white70,
                ),
              ),
              const SizedBox(height: 24),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 8,
                children: [
                  TextButton(
                    onPressed: () => _scrollTo(_servicesKey),
                    child: const Text(
                      'Services',
                      style: TextStyle(
                        color: Colors.white70,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => _scrollTo(_aboutKey),
                    child: const Text(
                      'About Us',
                      style: TextStyle(
                        color: Colors.white70,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => _scrollTo(_contactKey),
                    child: const Text(
                      'Contact',
                      style: TextStyle(
                        color: Colors.white70,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: _openLogin,
                    child: const Text(
                      'Login',
                      style: TextStyle(
                        color: Colors.white70,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              const Divider(
                color: Colors.white12,
              ),
              const SizedBox(height: 16),
              Text(
                '© ${DateTime.now().year} ServicePay. '
                'All rights reserved.',
                textAlign: TextAlign.center,
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

class _ServiceItem {
  final IconData icon;
  final String title;
  final String description;
  final bool comingSoon;

  const _ServiceItem({
    required this.icon,
    required this.title,
    required this.description,
    this.comingSoon = false,
  });
}

class _WhyItem {
  final IconData icon;
  final String title;
  final String text;

  const _WhyItem({
    required this.icon,
    required this.title,
    required this.text,
  });
}

class _StepItem {
  final String number;
  final String title;
  final String text;

  const _StepItem({
    required this.number,
    required this.title,
    required this.text,
  });
}
