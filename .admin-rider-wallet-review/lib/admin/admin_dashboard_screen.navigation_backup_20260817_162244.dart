import 'package:flutter/material.dart';

import 'admin_dashboard_legacy_screen.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  int _selectedIndex = 0;
  String _search = '';

  static const Color _primary = Color(0xFF08783E);
  static const Color _dark = Color(0xFF10231A);

  final List<_FintechSection> _sections = const [
    _FintechSection(
      title: 'Customers & Identity',
      icon: Icons.people_alt_rounded,
      items: [
        _FintechItem('Customers', Icons.people_alt_outlined),
        _FintechItem('KYC Management', Icons.verified_user_outlined),
        _FintechItem('KYB / Business Verification', Icons.business_outlined),
        _FintechItem('NIN / ID Verification', Icons.badge_outlined),
        _FintechItem(
            'Customer Tiers & Limits', Icons.stacked_bar_chart_outlined),
        _FintechItem('Account Restrictions', Icons.block_outlined),
        _FintechItem('Beneficiaries', Icons.group_add_outlined),
      ],
    ),
    _FintechSection(
      title: 'Wallets & Core Banking',
      icon: Icons.account_balance_wallet_rounded,
      items: [
        _FintechItem('Customer Wallets', Icons.account_balance_wallet_outlined),
        _FintechItem('Business Wallets', Icons.business_center_outlined),
        _FintechItem('Core Ledger', Icons.menu_book_outlined),
        _FintechItem('General Ledger', Icons.account_tree_outlined),
        _FintechItem('Wallet Credit / Debit', Icons.swap_vert_circle_outlined),
        _FintechItem('Wallet Holds & Releases', Icons.lock_clock_outlined),
        _FintechItem('Balance Adjustments', Icons.tune_outlined),
        _FintechItem('Settlement Accounts', Icons.account_balance_outlined),
      ],
    ),
    _FintechSection(
      title: 'Payments & Transactions',
      icon: Icons.payments_rounded,
      items: [
        _FintechItem('All Transactions', Icons.receipt_long_outlined),
        _FintechItem('ServicePay Transfers', Icons.swap_horiz_outlined),
        _FintechItem('Bank Transfers', Icons.account_balance_outlined),
        _FintechItem('Withdrawals', Icons.outbox_outlined),
        _FintechItem('Wallet Funding', Icons.add_card_outlined),
        _FintechItem('Pay By Link', Icons.link_outlined),
        _FintechItem('Request Money', Icons.request_quote_outlined),
        _FintechItem('Bulk Payments', Icons.payments_outlined),
        _FintechItem('Scheduled Payments', Icons.schedule_outlined),
        _FintechItem('Failed Transactions', Icons.error_outline),
      ],
    ),
    _FintechSection(
      title: 'Bills & Digital Services',
      icon: Icons.apps_rounded,
      items: [
        _FintechItem('Airtime', Icons.phone_android_outlined),
        _FintechItem('Data', Icons.wifi_outlined),
        _FintechItem('Electricity', Icons.electric_bolt_outlined),
        _FintechItem('Cable TV', Icons.tv_outlined),
        _FintechItem('Exam PIN', Icons.school_outlined),
        _FintechItem('Airtime To Cash', Icons.currency_exchange_outlined),
        _FintechItem('Service Pricing', Icons.price_change_outlined),
        _FintechItem('Provider Management', Icons.hub_outlined),
        _FintechItem('Product Availability', Icons.toggle_on_outlined),
      ],
    ),
    _FintechSection(
      title: 'Banking Infrastructure',
      icon: Icons.account_balance_rounded,
      items: [
        _FintechItem('Virtual Accounts', Icons.account_balance_wallet_outlined),
        _FintechItem('Dedicated Accounts', Icons.credit_card_outlined),
        _FintechItem('USSD Management', Icons.dialpad_outlined),
        _FintechItem('Cards Management', Icons.credit_card_rounded),
        _FintechItem('Bank Partners', Icons.handshake_outlined),
        _FintechItem('Payment Providers', Icons.api_outlined),
        _FintechItem('Switching / Routing', Icons.alt_route_outlined),
      ],
    ),
    _FintechSection(
      title: 'Risk, Fraud & Compliance',
      icon: Icons.security_rounded,
      items: [
        _FintechItem('Fraud Monitoring', Icons.gpp_maybe_outlined),
        _FintechItem('AML Monitoring', Icons.policy_outlined),
        _FintechItem('Suspicious Transactions', Icons.warning_amber_outlined),
        _FintechItem('Transaction Limits', Icons.speed_outlined),
        _FintechItem('Blacklist / Watchlist', Icons.person_off_outlined),
        _FintechItem('Device & Login Risk', Icons.phonelink_lock_outlined),
        _FintechItem('Compliance Cases', Icons.folder_special_outlined),
        _FintechItem('Regulatory Reports', Icons.description_outlined),
      ],
    ),
    _FintechSection(
      title: 'Disputes & Operations',
      icon: Icons.support_agent_rounded,
      items: [
        _FintechItem('Disputes', Icons.report_problem_outlined),
        _FintechItem('Chargebacks', Icons.keyboard_return_outlined),
        _FintechItem('Refunds', Icons.currency_exchange_outlined),
        _FintechItem('Reversals', Icons.undo_outlined),
        _FintechItem('Complaints', Icons.support_agent_outlined),
        _FintechItem('Transaction Requery', Icons.manage_search_outlined),
        _FintechItem('Manual Resolution', Icons.build_circle_outlined),
      ],
    ),
    _FintechSection(
      title: 'Reconciliation & Settlement',
      icon: Icons.fact_check_rounded,
      items: [
        _FintechItem('Daily Reconciliation', Icons.fact_check_outlined),
        _FintechItem('Provider Reconciliation', Icons.compare_arrows_outlined),
        _FintechItem('Bank Reconciliation', Icons.account_balance_outlined),
        _FintechItem('Settlement Batches', Icons.inventory_2_outlined),
        _FintechItem('Settlement Exceptions', Icons.rule_outlined),
        _FintechItem('Unmatched Transactions', Icons.help_center_outlined),
      ],
    ),
    _FintechSection(
      title: 'Treasury & Finance',
      icon: Icons.savings_rounded,
      items: [
        _FintechItem('Treasury', Icons.savings_outlined),
        _FintechItem('Liquidity', Icons.waterfall_chart_outlined),
        _FintechItem('Revenue', Icons.trending_up_outlined),
        _FintechItem('Fees', Icons.price_check_outlined),
        _FintechItem('Commissions', Icons.percent_outlined),
        _FintechItem('Profit & Loss', Icons.analytics_outlined),
        _FintechItem(
            'Provider Balances', Icons.account_balance_wallet_outlined),
        _FintechItem('Financial Reports', Icons.assessment_outlined),
      ],
    ),
    _FintechSection(
      title: 'Agents & Distribution',
      icon: Icons.groups_rounded,
      items: [
        _FintechItem('Zonal Managers', Icons.hub_outlined),
        _FintechItem('State Managers', Icons.location_city_outlined),
        _FintechItem('Aggregators', Icons.groups_outlined),
        _FintechItem('Agent Performance', Icons.insights_outlined),
        _FintechItem('Agent Commissions', Icons.monetization_on_outlined),
        _FintechItem('Agent Locator', Icons.location_on_outlined),
      ],
    ),
    _FintechSection(
      title: 'ServicePay Business',
      icon: Icons.domain_rounded,
      items: [
        _FintechItem('Business Accounts', Icons.business_outlined),
        _FintechItem('Merchants', Icons.storefront_outlined),
        _FintechItem('Empowerment', Icons.volunteer_activism_outlined),
        _FintechItem('Amana', Icons.favorite_border_outlined),
        _FintechItem('Group Wallet / Ajo', Icons.groups_2_outlined),
        _FintechItem('Merchant Collections', Icons.point_of_sale_outlined),
      ],
    ),
    _FintechSection(
      title: 'Delivery & Logistics',
      icon: Icons.local_shipping_rounded,
      items: [
        _FintechItem('Deliveries', Icons.local_shipping_outlined),
        _FintechItem('Riders', Icons.delivery_dining_outlined),
        _FintechItem('Rider Verification', Icons.verified_outlined),
        _FintechItem('Rider Wallets', Icons.account_balance_wallet_outlined),
        _FintechItem('Rider Withdrawals', Icons.payments_outlined),
        _FintechItem('Delivery Pricing', Icons.price_change_outlined),
        _FintechItem('Delivery States', Icons.map_outlined),
      ],
    ),
    _FintechSection(
      title: 'Staff & Administration',
      icon: Icons.admin_panel_settings_rounded,
      items: [
        _FintechItem('Staff Management', Icons.badge_outlined),
        _FintechItem('Roles & Permissions', Icons.manage_accounts_outlined),
        _FintechItem('Departments', Icons.corporate_fare_outlined),
        _FintechItem('Approvals', Icons.approval_outlined),
        _FintechItem('Maker / Checker', Icons.rule_folder_outlined),
        _FintechItem('Login Activity', Icons.login_outlined),
        _FintechItem('Admin Sessions', Icons.devices_outlined),
      ],
    ),
    _FintechSection(
      title: 'Communication',
      icon: Icons.campaign_rounded,
      items: [
        _FintechItem('Notifications', Icons.notifications_outlined),
        _FintechItem('Bulk Email', Icons.mark_email_read_outlined),
        _FintechItem('SMS', Icons.sms_outlined),
        _FintechItem('Push Notifications', Icons.notifications_active_outlined),
        _FintechItem('Announcements', Icons.campaign_outlined),
        _FintechItem('Customer Support', Icons.headset_mic_outlined),
      ],
    ),
    _FintechSection(
      title: 'Technology & Integrations',
      icon: Icons.developer_board_rounded,
      items: [
        _FintechItem('API Management', Icons.api_outlined),
        _FintechItem('API Clients', Icons.devices_other_outlined),
        _FintechItem('Webhooks', Icons.webhook_outlined),
        _FintechItem('API Keys', Icons.key_outlined),
        _FintechItem('Provider Health', Icons.monitor_heart_outlined),
        _FintechItem('System Health', Icons.health_and_safety_outlined),
        _FintechItem('Error Logs', Icons.bug_report_outlined),
        _FintechItem('Background Jobs', Icons.settings_suggest_outlined),
      ],
    ),
    _FintechSection(
      title: 'Audit & Security',
      icon: Icons.shield_rounded,
      items: [
        _FintechItem('Audit Logs', Icons.history_outlined),
        _FintechItem('Security Events', Icons.security_outlined),
        _FintechItem('Access Logs', Icons.manage_search_outlined),
        _FintechItem('Data Exports', Icons.file_download_outlined),
        _FintechItem('Backups', Icons.backup_outlined),
        _FintechItem('Privacy Controls', Icons.privacy_tip_outlined),
      ],
    ),
    _FintechSection(
      title: 'Reports & Analytics',
      icon: Icons.analytics_rounded,
      items: [
        _FintechItem('Executive Dashboard', Icons.dashboard_outlined),
        _FintechItem('Transaction Analytics', Icons.analytics_outlined),
        _FintechItem('Customer Analytics', Icons.people_outline),
        _FintechItem('Revenue Analytics', Icons.trending_up_outlined),
        _FintechItem('Service Performance', Icons.speed_outlined),
        _FintechItem('Manager Performance', Icons.leaderboard_outlined),
        _FintechItem('Download Reports', Icons.download_outlined),
      ],
    ),
    _FintechSection(
      title: 'Platform Configuration',
      icon: Icons.settings_rounded,
      items: [
        _FintechItem('General Settings', Icons.settings_outlined),
        _FintechItem('Feature Toggles', Icons.toggle_on_outlined),
        _FintechItem('Transaction Fees', Icons.price_change_outlined),
        _FintechItem('Commissions Setup', Icons.percent_outlined),
        _FintechItem('Service Limits', Icons.tune_outlined),
        _FintechItem('Maintenance Mode', Icons.engineering_outlined),
        _FintechItem('App Versions', Icons.system_update_outlined),
        _FintechItem('Legal & Policies', Icons.gavel_outlined),
      ],
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F5),
      body: SafeArea(
        child: Column(
          children: [
            _topBar(),
            _navigationBar(),
            Expanded(
              child: IndexedStack(
                index: _selectedIndex,
                children: [
                  const LegacyAdminDashboardScreen(),
                  _fintechControlCenter(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _topBar() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
      decoration: const BoxDecoration(
        color: _dark,
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final mobile = constraints.maxWidth < 700;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.account_balance_rounded,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'ServicePay Admin',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 21,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Fintech Operations & Control Centre',
                          style: TextStyle(
                            color: Color(0xFFBBD1C5),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (!mobile)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFF143B2A),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: const Color(0xFF2E6248),
                        ),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.circle,
                            size: 9,
                            color: Color(0xFF4ADE80),
                          ),
                          SizedBox(width: 7),
                          Text(
                            'FINTECH CONTROL',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _navigationBar() {
    return Material(
      color: Colors.white,
      elevation: 1,
      child: Row(
        children: [
          Expanded(
            child: _navButton(
              index: 0,
              icon: Icons.dashboard_outlined,
              label: 'Current Dashboard',
            ),
          ),
          Expanded(
            child: _navButton(
              index: 1,
              icon: Icons.account_balance_outlined,
              label: 'Fintech Control Center',
            ),
          ),
        ],
      ),
    );
  }

  Widget _navButton({
    required int index,
    required IconData icon,
    required String label,
  }) {
    final active = _selectedIndex == index;

    return InkWell(
      onTap: () => setState(() => _selectedIndex = index),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: active ? _primary : Colors.transparent,
              width: 3,
            ),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 20,
              color: active ? _primary : Colors.grey.shade600,
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: active ? _primary : Colors.grey.shade700,
                  fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _fintechControlCenter() {
    final q = _search.trim().toLowerCase();

    final filteredSections = _sections
        .map(
          (section) => _FintechSection(
            title: section.title,
            icon: section.icon,
            items: section.items.where((item) {
              if (q.isEmpty) return true;
              return item.title.toLowerCase().contains(q) ||
                  section.title.toLowerCase().contains(q);
            }).toList(),
          ),
        )
        .where((section) => section.items.isNotEmpty)
        .toList();

    final totalModules =
        _sections.fold<int>(0, (sum, section) => sum + section.items.length);

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final crossAxisCount = width >= 1500
            ? 4
            : width >= 1050
                ? 3
                : width >= 650
                    ? 2
                    : 1;

        return ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [
                    Color(0xFF08783E),
                    Color(0xFF0B5F35),
                  ],
                ),
                borderRadius: BorderRadius.circular(20),
              ),
              child: LayoutBuilder(
                builder: (context, c) {
                  final mobile = c.maxWidth < 650;

                  final intro = Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Fintech Control Center',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 25,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 7),
                      Text(
                        '$totalModules operational and governance modules organised for a full fintech company.',
                        style: const TextStyle(
                          color: Color(0xFFD7F2E3),
                          height: 1.4,
                        ),
                      ),
                    ],
                  );

                  final stats = Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _miniStat('${_sections.length}', 'Departments'),
                      _miniStat('$totalModules', 'Modules'),
                      _miniStat('24/7', 'Operations'),
                    ],
                  );

                  if (mobile) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        intro,
                        const SizedBox(height: 18),
                        stats,
                      ],
                    );
                  }

                  return Row(
                    children: [
                      Expanded(child: intro),
                      stats,
                    ],
                  );
                },
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              onChanged: (value) => setState(() => _search = value),
              decoration: InputDecoration(
                hintText:
                    'Search KYC, wallet, ledger, fraud, settlement, API...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.isEmpty
                    ? null
                    : IconButton(
                        onPressed: () => setState(() => _search = ''),
                        icon: const Icon(Icons.close),
                      ),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 18),
            if (filteredSections.isEmpty)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(
                  child: Text('No fintech module found.'),
                ),
              ),
            ...filteredSections.map(
              (section) => Padding(
                padding: const EdgeInsets.only(bottom: 18),
                child: _sectionCard(
                  section,
                  crossAxisCount,
                ),
              ),
            ),
            const SizedBox(height: 30),
          ],
        );
      },
    );
  }

  Widget _miniStat(String value, String label) {
    return Container(
      constraints: const BoxConstraints(minWidth: 82),
      padding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 9,
      ),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFFD7F2E3),
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionCard(
    _FintechSection section,
    int crossAxisCount,
  ) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE5ECE8),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: const Color(0xFFE9F7EF),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  section.icon,
                  color: _primary,
                  size: 22,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Text(
                  section.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                    color: _dark,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 9,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFF0F4F2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${section.items.length}',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: _dark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 15),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: section.items.length,
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: crossAxisCount,
              childAspectRatio: crossAxisCount == 1 ? 5.6 : 4.2,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
            ),
            itemBuilder: (context, index) {
              final item = section.items[index];

              return Material(
                color: const Color(0xFFF7FAF8),
                borderRadius: BorderRadius.circular(13),
                child: InkWell(
                  borderRadius: BorderRadius.circular(13),
                  onTap: () => _moduleInfo(item.title),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 9,
                    ),
                    child: Row(
                      children: [
                        Icon(
                          item.icon,
                          color: _primary,
                          size: 20,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            item.title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 12.5,
                              color: _dark,
                            ),
                          ),
                        ),
                        const Icon(
                          Icons.chevron_right,
                          size: 18,
                          color: Colors.grey,
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  void _moduleInfo(String title) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 9),
                const Text(
                  'This module is now represented inside the ServicePay Fintech Control Center. Existing operational screens remain untouched in the Current Dashboard and existing admin navigation.',
                  style: TextStyle(
                    height: 1.45,
                    color: Colors.black54,
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                      setState(() => _selectedIndex = 0);
                    },
                    icon: const Icon(Icons.dashboard_outlined),
                    label: const Text('Open Current Dashboard'),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _FintechSection {
  final String title;
  final IconData icon;
  final List<_FintechItem> items;

  const _FintechSection({
    required this.title,
    required this.icon,
    required this.items,
  });
}

class _FintechItem {
  final String title;
  final IconData icon;

  const _FintechItem(this.title, this.icon);
}
