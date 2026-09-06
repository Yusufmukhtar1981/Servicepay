import 'package:flutter/material.dart';

class AdminSettingsScreen extends StatefulWidget {
  const AdminSettingsScreen({super.key});

  @override
  State<AdminSettingsScreen> createState() => _AdminSettingsScreenState();
}

class _AdminSettingsScreenState extends State<AdminSettingsScreen> {
  static const Color _primary = Color(0xFF08783E);
  static const Color _dark = Color(0xFF12372A);
  static const Color _soft = Color(0xFFF2F8F4);

  String _search = '';

  final List<_ControlSection> _sections = const [
    _ControlSection(
      title: 'Platform Control',
      subtitle: 'Global ServicePay operating controls',
      icon: Icons.dashboard_customize_rounded,
      items: [
        _ControlItem(
          title: 'Feature Control Center',
          subtitle:
              'Enable or disable Airtime, Data, Bills, Marketplace, Delivery and other services.',
          icon: Icons.toggle_on_rounded,
          keywords: 'features services enable disable control',
        ),
        _ControlItem(
          title: 'System Maintenance',
          subtitle:
              'Maintenance mode, service availability and emergency platform controls.',
          icon: Icons.engineering_rounded,
          keywords: 'maintenance emergency downtime system',
        ),
        _ControlItem(
          title: 'Service Availability',
          subtitle:
              'Control which products and services are available to customers.',
          icon: Icons.power_settings_new_rounded,
          keywords: 'service availability live offline',
        ),
      ],
    ),
    _ControlSection(
      title: 'Money & Transactions',
      subtitle: 'Wallet, payments and transaction governance',
      icon: Icons.account_balance_wallet_rounded,
      items: [
        _ControlItem(
          title: 'Wallet Controls',
          subtitle:
              'Wallet funding, debit, credit, withdrawal and wallet operation policies.',
          icon: Icons.wallet_rounded,
          keywords: 'wallet funding debit credit withdrawal',
        ),
        _ControlItem(
          title: 'Transaction Limits',
          subtitle:
              'Configure minimum, maximum, daily and tier-based transaction limits.',
          icon: Icons.speed_rounded,
          keywords: 'transaction limits tier daily maximum minimum',
        ),
        _ControlItem(
          title: 'Transfer Controls',
          subtitle:
              'ServicePay transfer, withdrawal and payment transfer policies.',
          icon: Icons.swap_horiz_rounded,
          keywords: 'transfer withdrawal payment',
        ),
        _ControlItem(
          title: 'Fees & Charges',
          subtitle: 'Manage platform fees and configurable service charges.',
          icon: Icons.percent_rounded,
          keywords: 'fees charges commission',
        ),
      ],
    ),
    _ControlSection(
      title: 'Pricing & Revenue',
      subtitle: 'Control margins, pricing and company revenue',
      icon: Icons.payments_rounded,
      items: [
        _ControlItem(
          title: 'Data Pricing',
          subtitle: 'Manage data selling prices and ServicePay markup.',
          icon: Icons.signal_cellular_alt_rounded,
          keywords: 'data pricing markup',
        ),
        _ControlItem(
          title: 'Airtime Pricing',
          subtitle: 'Manage Airtime margins, discounts and service pricing.',
          icon: Icons.phone_android_rounded,
          keywords: 'airtime pricing markup discount',
        ),
        _ControlItem(
          title: 'Commission Management',
          subtitle:
              'Configure commissions for Aggregators, State Managers and Zonal Managers.',
          icon: Icons.hub_rounded,
          keywords: 'commission aggregator state zonal manager earnings',
        ),
        _ControlItem(
          title: 'ServicePay Revenue',
          subtitle: 'Review and configure platform revenue rules and margins.',
          icon: Icons.trending_up_rounded,
          keywords: 'profit revenue margin earnings',
        ),
      ],
    ),
    _ControlSection(
      title: 'Compliance & Verification',
      subtitle: 'Identity, KYC, KYB and regulatory controls',
      icon: Icons.verified_user_rounded,
      items: [
        _ControlItem(
          title: 'KYC Controls',
          subtitle:
              'Configure Tier 1, Tier 2 and Tier 3 verification requirements.',
          icon: Icons.badge_rounded,
          keywords: 'kyc tier verification identity',
        ),
        _ControlItem(
          title: 'KYB Controls',
          subtitle:
              'Business verification and organisation onboarding requirements.',
          icon: Icons.business_center_rounded,
          keywords: 'kyb business verification organization',
        ),
        _ControlItem(
          title: 'ID Verification',
          subtitle: 'Manage NIN and other identity verification services.',
          icon: Icons.fingerprint_rounded,
          keywords: 'nin id verification identity',
        ),
        _ControlItem(
          title: 'Risk & Compliance',
          subtitle:
              'Risk controls, suspicious activity rules and compliance configuration.',
          icon: Icons.gpp_good_rounded,
          keywords: 'risk compliance fraud aml',
        ),
      ],
    ),
    _ControlSection(
      title: 'Marketplace',
      subtitle: 'Seller, product and commerce controls',
      icon: Icons.storefront_rounded,
      items: [
        _ControlItem(
          title: 'Marketplace Control',
          subtitle:
              'Control Marketplace availability, seller access and product operations.',
          icon: Icons.store_mall_directory_rounded,
          keywords: 'marketplace seller store product',
        ),
        _ControlItem(
          title: 'Marketplace Commission',
          subtitle: 'Set ServicePay commission and seller settlement rules.',
          icon: Icons.price_change_rounded,
          keywords: 'marketplace commission seller settlement',
        ),
        _ControlItem(
          title: 'Seller Governance',
          subtitle:
              'Seller approval, suspension and Marketplace operating policies.',
          icon: Icons.manage_accounts_rounded,
          keywords: 'seller approve suspend marketplace',
        ),
      ],
    ),
    _ControlSection(
      title: 'Delivery & Riders',
      subtitle: 'Logistics and rider operations',
      icon: Icons.delivery_dining_rounded,
      items: [
        _ControlItem(
          title: 'Delivery Controls',
          subtitle:
              'Manage delivery availability, pricing and supported locations.',
          icon: Icons.local_shipping_rounded,
          keywords: 'delivery logistics price state location',
        ),
        _ControlItem(
          title: 'Rider Controls',
          subtitle:
              'Rider verification, availability and operational policies.',
          icon: Icons.two_wheeler_rounded,
          keywords: 'rider driver verification delivery',
        ),
        _ControlItem(
          title: 'Delivery Commission',
          subtitle: 'Configure rider and ServicePay delivery revenue split.',
          icon: Icons.pie_chart_rounded,
          keywords: 'delivery rider commission split',
        ),
      ],
    ),
    _ControlSection(
      title: 'Special Products',
      subtitle: 'ServicePay ecosystem products',
      icon: Icons.apps_rounded,
      items: [
        _ControlItem(
          title: 'Empowerment',
          subtitle:
              'Control organisations, programmes, beneficiaries and disbursements.',
          icon: Icons.volunteer_activism_rounded,
          keywords: 'empowerment grants beneficiaries program',
        ),
        _ControlItem(
          title: 'ServicePay Amana',
          subtitle:
              'Manage controlled-purpose payments and verified fulfilment.',
          icon: Icons.handshake_rounded,
          keywords: 'amana controlled payment family support',
        ),
        _ControlItem(
          title: 'Airtime to Cash',
          subtitle:
              'Configure Airtime-to-Cash availability and operating rules.',
          icon: Icons.currency_exchange_rounded,
          keywords: 'airtime cash conversion',
        ),
        _ControlItem(
          title: 'Keke Fare',
          subtitle:
              'Configure Keke Fare service availability and operational settings.',
          icon: Icons.electric_rickshaw_rounded,
          keywords: 'keke fare transport',
        ),
      ],
    ),
    _ControlSection(
      title: 'Users & Organisation',
      subtitle: 'People, roles and platform access',
      icon: Icons.groups_rounded,
      items: [
        _ControlItem(
          title: 'Role & Permission Control',
          subtitle:
              'HEAD OFFICE, Staff, Zonal, State, Aggregator and customer permissions.',
          icon: Icons.admin_panel_settings_rounded,
          keywords: 'roles permissions staff head office',
        ),
        _ControlItem(
          title: 'User Account Policies',
          subtitle:
              'Account activation, suspension, blocking and customer access rules.',
          icon: Icons.person_off_rounded,
          keywords: 'user customer suspend block account',
        ),
        _ControlItem(
          title: 'Staff Security',
          subtitle: 'Administrative access and staff security policy controls.',
          icon: Icons.security_rounded,
          keywords: 'staff security admin access',
        ),
      ],
    ),
    _ControlSection(
      title: 'Notifications & Communication',
      subtitle: 'Customer and operational communication',
      icon: Icons.notifications_active_rounded,
      items: [
        _ControlItem(
          title: 'Push Notifications',
          subtitle: 'Global notification behaviour and customer alerts.',
          icon: Icons.notifications_rounded,
          keywords: 'notification push alert',
        ),
        _ControlItem(
          title: 'Email Configuration',
          subtitle:
              'ServicePay email identity, transactional mail and communication settings.',
          icon: Icons.email_rounded,
          keywords: 'email smtp resend notification',
        ),
        _ControlItem(
          title: 'Support Channels',
          subtitle:
              'Configure customer support and escalation contact information.',
          icon: Icons.support_agent_rounded,
          keywords: 'support whatsapp phone email contact',
        ),
      ],
    ),
    _ControlSection(
      title: 'Security',
      subtitle: 'Core fintech security controls',
      icon: Icons.shield_rounded,
      items: [
        _ControlItem(
          title: 'Transaction PIN',
          subtitle: 'Configure PIN enforcement for sensitive transactions.',
          icon: Icons.pin_rounded,
          keywords: 'pin transaction security',
        ),
        _ControlItem(
          title: 'Session & Authentication',
          subtitle:
              'Authentication, session and account access security policies.',
          icon: Icons.lock_person_rounded,
          keywords: 'login authentication session password',
        ),
        _ControlItem(
          title: 'Fraud Protection',
          subtitle:
              'Fraud-prevention rules and sensitive transaction protection.',
          icon: Icons.policy_rounded,
          keywords: 'fraud protection risk suspicious',
        ),
        _ControlItem(
          title: 'Admin Audit Trail',
          subtitle:
              'Track important administrative changes and privileged actions.',
          icon: Icons.fact_check_rounded,
          keywords: 'audit logs admin activities',
        ),
      ],
    ),
    _ControlSection(
      title: 'System',
      subtitle: 'Platform-level configuration and health',
      icon: Icons.settings_suggest_rounded,
      items: [
        _ControlItem(
          title: 'API & Provider Configuration',
          subtitle:
              'Manage provider availability and operational integration controls.',
          icon: Icons.api_rounded,
          keywords: 'api provider integration clubkonnect squad',
        ),
        _ControlItem(
          title: 'System Health',
          subtitle:
              'Monitor API, database and critical platform service status.',
          icon: Icons.monitor_heart_rounded,
          keywords: 'health api database server',
        ),
        _ControlItem(
          title: 'Environment Information',
          subtitle:
              'View ServicePay deployment and platform configuration information.',
          icon: Icons.cloud_rounded,
          keywords: 'environment render deployment version',
        ),
        _ControlItem(
          title: 'Danger Zone',
          subtitle: 'Highly restricted platform-wide actions for Head Office.',
          icon: Icons.warning_amber_rounded,
          keywords: 'danger reset emergency restricted',
          danger: true,
        ),
      ],
    ),
  ];

  List<_ControlSection> get _filteredSections {
    final q = _search.trim().toLowerCase();

    if (q.isEmpty) return _sections;

    final result = <_ControlSection>[];

    for (final section in _sections) {
      final items = section.items.where((item) {
        final haystack = '${section.title} ${section.subtitle} '
                '${item.title} ${item.subtitle} ${item.keywords}'
            .toLowerCase();

        return haystack.contains(q);
      }).toList();

      if (items.isNotEmpty) {
        result.add(
          _ControlSection(
            title: section.title,
            subtitle: section.subtitle,
            icon: section.icon,
            items: items,
          ),
        );
      }
    }

    return result;
  }

  void _openControl(_ControlItem item) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return SafeArea(
          child: Container(
            margin: const EdgeInsets.all(14),
            padding: const EdgeInsets.fromLTRB(
              20,
              18,
              20,
              24,
            ),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(26),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: item.danger ? const Color(0xFFFFEEEE) : _soft,
                        borderRadius: BorderRadius.circular(15),
                      ),
                      child: Icon(
                        item.icon,
                        color: item.danger ? Colors.red : _primary,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        item.title,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Text(
                  item.subtitle,
                  style: TextStyle(
                    color: Colors.grey.shade700,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 18),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(15),
                  decoration: BoxDecoration(
                    color: item.danger
                        ? const Color(0xFFFFF4F4)
                        : const Color(0xFFF6F8F7),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Text(
                    item.danger
                        ? 'Restricted Head Office control. Connect this item only to an existing verified backend action.'
                        : 'This control is part of the unified ServicePay Settings architecture. Existing ServicePay modules remain the source of truth.',
                    style: TextStyle(
                      color: item.danger
                          ? Colors.red.shade800
                          : Colors.grey.shade800,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final sections = _filteredSections;

    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: _primary,
        foregroundColor: Colors.white,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'ServicePay Control Center',
              style: TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
            Text(
              'Head Office Settings',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          16,
          16,
          16,
          30,
        ),
        children: [
          _heroCard(),
          const SizedBox(height: 16),
          _searchBox(),
          const SizedBox(height: 18),
          if (sections.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 60),
              child: Center(
                child: Column(
                  children: [
                    Icon(
                      Icons.search_off_rounded,
                      size: 52,
                      color: Colors.grey,
                    ),
                    SizedBox(height: 12),
                    Text(
                      'No settings found',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ...sections.map(_sectionWidget),
        ],
      ),
    );
  }

  Widget _heroCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF08783E),
            Color(0xFF12372A),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.admin_panel_settings_rounded,
            color: Colors.white,
            size: 35,
          ),
          SizedBox(height: 16),
          Text(
            'One Control Center.\nThe Entire ServicePay Platform.',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              height: 1.15,
              fontWeight: FontWeight.w900,
            ),
          ),
          SizedBox(height: 10),
          Text(
            'Centralised governance for services, money, pricing, compliance, security, Marketplace, Delivery and platform operations.',
            style: TextStyle(
              color: Color(0xFFE5F4EB),
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _searchBox() {
    return TextField(
      onChanged: (value) {
        setState(() {
          _search = value;
        });
      },
      decoration: InputDecoration(
        hintText: 'Search settings, services or controls...',
        prefixIcon: const Icon(Icons.search_rounded),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide(
            color: Colors.grey.shade200,
          ),
        ),
      ),
    );
  }

  Widget _sectionWidget(
    _ControlSection section,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: _soft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  section.icon,
                  color: _primary,
                  size: 20,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      section.title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: _dark,
                      ),
                    ),
                    Text(
                      section.subtitle,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: Colors.grey.shade600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: Colors.grey.shade200,
              ),
            ),
            child: Column(
              children: [
                for (int i = 0; i < section.items.length; i++) ...[
                  _itemTile(section.items[i]),
                  if (i != section.items.length - 1)
                    Divider(
                      height: 1,
                      indent: 70,
                      color: Colors.grey.shade200,
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _itemTile(_ControlItem item) {
    final color = item.danger ? Colors.red : _primary;

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 14,
        vertical: 6,
      ),
      leading: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: item.danger ? const Color(0xFFFFEEEE) : _soft,
          borderRadius: BorderRadius.circular(13),
        ),
        child: Icon(
          item.icon,
          color: color,
          size: 21,
        ),
      ),
      title: Text(
        item.title,
        style: TextStyle(
          fontWeight: FontWeight.w700,
          color: item.danger ? Colors.red.shade800 : const Color(0xFF1B1F1D),
        ),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Text(
          item.subtitle,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 11.5,
            height: 1.35,
            color: Colors.grey.shade600,
          ),
        ),
      ),
      trailing: Icon(
        Icons.chevron_right_rounded,
        color: Colors.grey.shade400,
      ),
      onTap: () => _openControl(item),
    );
  }
}

class _ControlSection {
  final String title;
  final String subtitle;
  final IconData icon;
  final List<_ControlItem> items;

  const _ControlSection({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.items,
  });
}

class _ControlItem {
  final String title;
  final String subtitle;
  final IconData icon;
  final String keywords;
  final bool danger;

  const _ControlItem({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.keywords,
    this.danger = false,
  });
}
