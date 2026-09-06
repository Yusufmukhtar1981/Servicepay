import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../login_screen.dart';
import '../logistics/logistics_operations_screens.dart';

import 'admin_amana_screen.dart';
import 'admin_dashboard_screen.dart';
import 'admin_delivery_management_screen.dart';
import 'admin_keke_fare_screen.dart';
import 'admin_manual_funding_screen.dart';
import 'admin_notifications_screen.dart';
import 'admin_bulk_email_screen.dart';
import 'admin_rider_withdrawals_screen.dart';
import 'admin_rider_wallet_screen.dart';
import 'admin_riders_screen.dart';
import 'staff_management_screen.dart';
import 'admin_control_center_screen.dart';

import 'admin_airtime_to_cash_screen.dart';

import 'admin_business_withdrawals_screen.dart';
import 'admin_kyc_screen.dart';
import 'admin_empowerment_screen.dart';
import 'admin_partner_screen.dart';
import 'admin_partner_applications_screen.dart';
import 'admin_business_partners_screen.dart';
import 'admin_branch_management_screen.dart';

import 'admin_cards_screen.dart';

import 'admin_marketplace_screen.dart';
import 'admin_data_pricing_screen.dart';
import 'admin_phone_financing_screen.dart';
import 'admin_solar_screen.dart';
import 'admin_customer_support_screen.dart';
import 'admin_customer_360_screen.dart';
import 'admin_transactions_screen.dart';
import 'admin_transaction_intelligence_screen.dart';
import 'admin_permissions.dart';
import 'admin_roles_permissions_screen.dart';
import 'admin_privacy_requests_screen.dart';

const Set<String> fullAccessAdminRoles = <String>{
  'HEAD_OFFICE',
  'ADMIN',
  'SUPER_ADMIN',
  'HEAD_OFFICE_ADMIN',
};

@visibleForTesting
bool canAccessAdminNavigationModule({
  required String role,
  required Set<String> permissions,
  required String permission,
}) {
  return fullAccessAdminRoles.contains(role) ||
      permissions.contains(permission.toLowerCase());
}

class AdminMainNavigation extends StatefulWidget {
  const AdminMainNavigation({super.key});

  @override
  State<AdminMainNavigation> createState() => _AdminMainNavigationState();
}

class _AdminMainNavigationState extends State<AdminMainNavigation> {
  int currentIndex = 0;

  bool isLoading = true;

  String adminRole = '';
  String staffRoleName = '';
  String staffRoleDisplayName = '';
  String staffDepartment = '';

  Set<String> permissions = <String>{};

  List<Widget> pages = <Widget>[];

  List<BottomNavigationBarItem> items = <BottomNavigationBarItem>[];

  @override
  void initState() {
    super.initState();

    loadAccessAndConfigureNavigation();
  }

  String normalizeRole(String? value) {
    return (value ?? '').trim().toUpperCase().replaceAll(
          RegExp(r'[\s-]+'),
          '_',
        );
  }

  String normalizePermission(String? value) {
    return (value ?? '').trim().toLowerCase();
  }

  bool get isHeadOffice {
    return fullAccessAdminRoles.contains(adminRole);
  }

  bool get isStaff {
    return adminRole == 'STAFF';
  }

  bool hasPermission(String permission) {
    if (isHeadOffice) {
      return true;
    }

    return permissions.contains(normalizePermission(permission));
  }

  bool hasAnyPermission(List<String> requiredPermissions) {
    if (isHeadOffice) {
      return true;
    }

    return requiredPermissions.any(hasPermission);
  }

  void addNavigationPage({
    required Widget page,
    required IconData icon,
    required IconData activeIcon,
    required String label,
  }) {
    pages.add(page);

    items.add(
      BottomNavigationBarItem(
        icon: Icon(icon),
        activeIcon: Icon(activeIcon),
        label: label,
      ),
    );
  }

  void configureNavigation() {
    pages = <Widget>[];
    items = <BottomNavigationBarItem>[];

    /*
     * =====================================================
     * DASHBOARD
     * =====================================================
     */
    if (isHeadOffice || hasPermission('dashboard.view')) {
      addNavigationPage(
        page: const AdminDashboardScreen(),
        icon: Icons.dashboard_outlined,
        activeIcon: Icons.dashboard_rounded,
        label: 'Dashboard',
      );
    }

    // Branch configuration and manager controls are restricted to Head Office.
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminBranchManagementScreen(
          canManage: true,
          canViewReports: true,
          canViewApprovals: true,
        ),
        icon: Icons.account_tree_outlined,
        activeIcon: Icons.account_tree,
        label: 'Branch Management',
      );
    }

    /*
     * =====================================================
     * TRANSACTIONS
     * =====================================================
     *
     * These are intentionally separate destinations:
     * operational transaction records versus transaction
     * intelligence and reconciliation analysis.
     */
    if (canAccessAdminNavigationModule(
      role: adminRole,
      permissions: permissions,
      permission: AdminPermissions.transactionsView,
    )) {
      addNavigationPage(
        page: const AdminTransactionsScreen(),
        icon: Icons.receipt_long_outlined,
        activeIcon: Icons.receipt_long_rounded,
        label: 'Transactions',
      );
    }

    if (canAccessAdminNavigationModule(
      role: adminRole,
      permissions: permissions,
      permission: AdminPermissions.transactionIntelligenceView,
    )) {
      addNavigationPage(
        page: const AdminTransactionIntelligenceScreen(),
        icon: Icons.insights_outlined,
        activeIcon: Icons.insights_rounded,
        label: 'Transaction Intelligence',
      );
    }

    if (isHeadOffice || hasPermission(AdminPermissions.customer360View)) {
      addNavigationPage(
        page: const AdminCustomer360Screen(),
        icon: Icons.person_search_outlined,
        activeIcon: Icons.person_search_rounded,
        label: 'Customer 360',
      );
    }

    /*
     * =====================================================
     * SERVICEPAY SOLAR - HEAD OFFICE ONLY
     * =====================================================
     */
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminSolarScreen(),
        icon: Icons.solar_power_outlined,
        activeIcon: Icons.solar_power_rounded,
        label: 'ServicePay Solar',
      );

      addNavigationPage(
        page: const AdminPhoneFinancingScreen(),
        icon: Icons.phone_android_outlined,
        activeIcon: Icons.phone_android_rounded,
        label: 'Phone Financing',
      );
    }

    /*
     * =====================================================
     * AMANA
     * =====================================================
     */
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminAmanaScreen(),
        icon: Icons.volunteer_activism_outlined,
        activeIcon: Icons.volunteer_activism_rounded,
        label: 'Amana',
      );
    }

    /*
   * ============================================================
   * AIRTIME TO CASH
   * ============================================================
   */
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminAirtimeToCashScreen(),
        icon: Icons.currency_exchange_outlined,
        activeIcon: Icons.currency_exchange_rounded,
        label: 'Airtime Cash',
      );
    }

    /*
     * =====================================================
     * DELIVERY
     * =====================================================
     */
    if (isHeadOffice || hasPermission('delivery.view')) {
      addNavigationPage(
        page: const AdminDeliveryManagementScreen(),
        icon: Icons.local_shipping_outlined,
        activeIcon: Icons.local_shipping_rounded,
        label: 'Delivery',
      );
    }

    /*
     * =====================================================
     * INTERSTATE LOGISTICS
     * =====================================================
     */
    if (isHeadOffice ||
        hasAnyPermission(const <String>[
          AdminPermissions.logisticsView,
          AdminPermissions.logisticsManage,
        ])) {
      addNavigationPage(
        page: const AdminLogisticsScreen(),
        icon: Icons.route_outlined,
        activeIcon: Icons.route_rounded,
        label: 'Logistics',
      );
    }

    /*
     * =====================================================
     * RIDERS
     * =====================================================
     */
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminRidersScreen(),
        icon: Icons.delivery_dining_outlined,
        activeIcon: Icons.delivery_dining_rounded,
        label: 'Riders',
      );
      addNavigationPage(
        page: const AdminRiderWalletScreen(),
        icon: Icons.account_balance_wallet_outlined,
        activeIcon: Icons.account_balance_wallet_rounded,
        label: 'Rider Wallets',
      );
    }

    /*
     * =====================================================
     * KEKE FARE
     * =====================================================
     *
     * Restricted to Head Office.
     */
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminKekeFareScreen(),
        icon: Icons.electric_rickshaw_outlined,
        activeIcon: Icons.electric_rickshaw_rounded,
        label: 'Keke Fare',
      );
    }

    /*
     * =====================================================
     * RIDER WITHDRAWALS
     * =====================================================
     *
     * Restricted to Head Office.
     */
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminRiderWithdrawalsScreen(),
        icon: Icons.payments_outlined,
        activeIcon: Icons.payments_rounded,
        label: 'Withdrawals',
      );
    }

    /*
     * ============================================================
     * MARKETPLACE
     * ============================================================
     * Product moderation is restricted to Head Office.
     */
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminMarketplaceScreen(),
        icon: Icons.storefront_outlined,
        activeIcon: Icons.storefront_rounded,
        label: 'Marketplace',
      );
    }

    /*
     * =====================================================
     * WALLET / FINANCE
     * =====================================================
     */
    if (isHeadOffice ||
        hasAnyPermission(const <String>[
          'wallets.view',
          'wallets.fund',
          'wallets.adjust',
          'finance.view',
          'finance.reconcile',
        ])) {
      addNavigationPage(
        page: const AdminManualFundingScreen(),
        icon: Icons.account_balance_wallet_outlined,
        activeIcon: Icons.account_balance_wallet_rounded,
        label: 'Wallet',
      );
    }

    /*
     * =====================================================
     * SUPPORT / TICKETS
     * =====================================================
     */
    if (isHeadOffice || hasPermission('support.view')) {
      addNavigationPage(
        page: const AdminCustomerSupportScreen(),
        icon: Icons.support_agent_outlined,
        activeIcon: Icons.support_agent_rounded,
        label: 'Support / Tickets',
      );
    }

    if (isHeadOffice || hasPermission(AdminPermissions.privacyView)) {
      addNavigationPage(
        page: const AdminPrivacyRequestsScreen(),
        icon: Icons.privacy_tip_outlined,
        activeIcon: Icons.privacy_tip_rounded,
        label: 'Account Requests',
      );
    }

    /*
     * =====================================================
     * NOTIFICATIONS
     * =====================================================
     */
    if (isHeadOffice ||
        hasAnyPermission(const <String>[
          'notifications.view',
          'notifications.create',
          'notifications.send',
        ])) {
      addNavigationPage(
        page: const AdminNotificationsScreen(),
        icon: Icons.notifications_outlined,
        activeIcon: Icons.notifications_rounded,
        label: 'Notifications',
      );
    }

    /*
     * =====================================================
     * COMMUNICATIONS / CUSTOMER EMAIL
     * =====================================================
     */
    if (isHeadOffice ||
        hasAnyPermission(const <String>[
          'communications.view',
          'email_campaign.create',
          'email_campaign.send',
          'email_campaign.history_view',
          'notifications.view',
          'notifications.create',
          'notifications.send',
        ])) {
      addNavigationPage(
        page: const AdminBulkEmailScreen(),
        icon: Icons.forum_outlined,
        activeIcon: Icons.forum_rounded,
        label: 'Communications',
      );
      addNavigationPage(
        page: const AdminBulkEmailScreen(),
        icon: Icons.mark_email_unread_outlined,
        activeIcon: Icons.mark_email_unread_rounded,
        label: 'Customer Email',
      );
      addNavigationPage(
        page: const AdminBulkEmailScreen(),
        icon: Icons.history_outlined,
        activeIcon: Icons.history_rounded,
        label: 'Email History',
      );
    }

    /*
     * ============================================================
     * KYC REVIEW - HEAD OFFICE ONLY
     * ============================================================
     */
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminKycScreen(),
        icon: Icons.verified_user_outlined,
        activeIcon: Icons.verified_user_rounded,
        label: 'KYC',
      );
    }

    // ================================================================
    // BUSINESS PARTNER MANAGEMENT
    if (isHeadOffice || hasPermission('business_partners.view')) {
      addNavigationPage(
        page: const AdminBusinessPartnersScreen(),
        icon: Icons.domain_outlined,
        activeIcon: Icons.domain_rounded,
        label: 'ServicePay Business Partner',
      );
    }

    // PARTNER API MANAGEMENT - HEAD OFFICE ONLY
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminPartnerScreen(),
        icon: Icons.handshake_outlined,
        activeIcon: Icons.handshake_rounded,
        label: 'Partners',
      );
    }

    // PARTNER APPLICATIONS - HEAD OFFICE ONLY
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminPartnerApplicationsScreen(),
        icon: Icons.assignment_outlined,
        activeIcon: Icons.assignment_turned_in_rounded,
        label: 'Applications',
      );
    }

    // EMPOWERMENT - HEAD OFFICE ONLY
    // ================================================================
    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminEmpowermentScreen(),
        icon: Icons.volunteer_activism_outlined,
        activeIcon: Icons.volunteer_activism_rounded,
        label: 'Empowerment',
      );
    }

    /*
     * =====================================================
     * STAFF
     * =====================================================
     */
    if (isHeadOffice ||
        hasAnyPermission(const <String>[
          'staff.view',
          'staff.create',
          'staff.update',
          'staff.suspend',
          'roles.view',
          'roles.create',
          'roles.update',
        ])) {
      addNavigationPage(
        page: const StaffManagementScreen(),
        icon: Icons.groups_outlined,
        activeIcon: Icons.groups_rounded,
        label: 'Staff',
      );
    }

    if (isHeadOffice || hasPermission('roles.view')) {
      addNavigationPage(
        page: AdminRolesPermissionsScreen(
          access: AdminAccess(role: adminRole, permissions: permissions),
        ),
        icon: Icons.manage_accounts_outlined,
        activeIcon: Icons.manage_accounts_rounded,
        label: 'Roles & Permissions',
      );
    }

    /*
     * =====================================================
     * SETTINGS
     * =====================================================
     *
     * Always shown to authorized admin/staff
     * for profile/account/logout access.
     */
    addNavigationPage(
      page: const AdminBusinessWithdrawalsScreen(),
      icon: Icons.account_balance_wallet_outlined,
      activeIcon: Icons.account_balance_wallet_rounded,
      label: 'Business Withdrawals',
    );

    addNavigationPage(
      page: const AdminControlCenterScreen(),
      icon: Icons.settings_outlined,
      activeIcon: Icons.settings_rounded,
      label: 'Settings',
    );

    if (isHeadOffice) {
      addNavigationPage(
        page: const AdminCardsScreen(),
        icon: Icons.credit_card_outlined,
        activeIcon: Icons.credit_card_rounded,
        label: 'Cards',
      );
    }

    addNavigationPage(
      page: const AdminDataPricingScreen(),
      icon: Icons.sell_outlined,
      activeIcon: Icons.sell_rounded,
      label: 'Data Pricing',
    );

    addNavigationPage(
      page: const AdminDataPricingScreen(),
      icon: Icons.sell_outlined,
      activeIcon: Icons.sell_rounded,
      label: 'Data Pricing',
    );

    if (currentIndex >= pages.length) {
      currentIndex = 0;
    }
  }

  Future<void> loadAccessAndConfigureNavigation() async {
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      final String role = normalizeRole(
        prefs.getString('user_role') ??
            prefs.getString('admin_role') ??
            prefs.getString('role'),
      );

      final List<String> savedPermissions =
          prefs.getStringList('staff_permissions') ??
              prefs.getStringList('admin_effective_permissions') ??
              <String>[];

      final Set<String> normalizedPermissions = savedPermissions
          .map(normalizePermission)
          .where((String value) => value.isNotEmpty)
          .toSet();

      const Set<String> allowedAdminRoles = <String>{
        'HEAD_OFFICE',
        'ADMIN',
        'SUPER_ADMIN',
        'HEAD_OFFICE_ADMIN',
        'STAFF',
        'ZONAL_MANAGER',
        'STATE_MANAGER',
      };

      if (!allowedAdminRoles.contains(role)) {
        await prefs.clear();

        if (!mounted) {
          return;
        }

        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
          (Route<dynamic> route) => false,
        );

        return;
      }

      if (!mounted) {
        return;
      }

      setState(() {
        adminRole = role;

        staffRoleName = prefs.getString('staff_role_name') ?? '';

        staffRoleDisplayName = prefs.getString('staff_role_display_name') ?? '';

        staffDepartment = prefs.getString('staff_department') ?? '';

        permissions = normalizedPermissions;

        currentIndex = 0;

        configureNavigation();

        isLoading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
      });
    }
  }

  String get accountLabel {
    if (isHeadOffice) {
      return 'Head Office';
    }

    if (staffRoleDisplayName.isNotEmpty) {
      return staffRoleDisplayName;
    }

    if (staffRoleName.isNotEmpty) {
      return staffRoleName.replaceAll('_', ' ');
    }

    return 'ServicePay Staff';
  }

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    if (pages.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('ServicePay Admin')),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'No authorized admin pages are available for this account.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ),
        ),
      );
    }

    final int safeIndex = currentIndex >= pages.length ? 0 : currentIndex;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          accountLabel,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        actions: <Widget>[
          if (isStaff && staffDepartment.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F5EC),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    staffDepartment.replaceAll('_', ' '),
                    style: const TextStyle(
                      color: Color(0xFF159447),
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
      body: IndexedStack(index: safeIndex, children: pages),
      bottomNavigationBar: SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            void selectModule(int index) {
              if (index < 0 || index >= pages.length) {
                return;
              }

              setState(() {
                currentIndex = index;
              });
            }

            final bool isDesktop = kIsWeb ||
                defaultTargetPlatform == TargetPlatform.windows ||
                defaultTargetPlatform == TargetPlatform.macOS ||
                defaultTargetPlatform == TargetPlatform.linux;
            if (isDesktop && constraints.maxWidth >= 700) {
              return AdminDesktopModuleNavigation(
                items: items,
                currentIndex: safeIndex,
                onTap: selectModule,
              );
            }

            return SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SizedBox(
                width: items.length * 76.0,
                child: BottomNavigationBar(
                  currentIndex: safeIndex,
                  type: BottomNavigationBarType.fixed,
                  selectedItemColor: const Color(0xFF0F766E),
                  unselectedItemColor: const Color(0xFF94A3B8),
                  backgroundColor: Colors.white,
                  selectedFontSize: 10,
                  unselectedFontSize: 9,
                  onTap: selectModule,
                  items: items,
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class AdminDesktopModuleNavigation extends StatefulWidget {
  const AdminDesktopModuleNavigation({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onTap,
  });

  final List<BottomNavigationBarItem> items;
  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  State<AdminDesktopModuleNavigation> createState() =>
      _AdminDesktopModuleNavigationState();
}

class _AdminDesktopModuleNavigationState
    extends State<AdminDesktopModuleNavigation> {
  static const double _itemWidth = 76.0;
  static const double _scrollStep = 304.0;
  static const Duration _scrollDuration = Duration(milliseconds: 260);

  final ScrollController _scrollController = ScrollController();
  bool _isAnimating = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_handleScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _ensureSelectedVisible(animate: false);
      if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  void didUpdateWidget(AdminDesktopModuleNavigation oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.currentIndex != widget.currentIndex ||
        oldWidget.items.length != widget.items.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _ensureSelectedVisible();
      });
    }
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_handleScroll)
      ..dispose();
    super.dispose();
  }

  void _handleScroll() {
    if (mounted) {
      setState(() {});
    }
  }

  bool get _canScrollLeft =>
      _scrollController.hasClients && _scrollController.offset > 0.5;

  bool get _canScrollRight =>
      _scrollController.hasClients &&
      _scrollController.offset <
          _scrollController.position.maxScrollExtent - 0.5;

  Future<void> scrollBy(double delta) async {
    if (!_scrollController.hasClients || _isAnimating) {
      return;
    }

    final ScrollPosition position = _scrollController.position;
    final double target = (position.pixels + delta).clamp(
      0.0,
      position.maxScrollExtent,
    );
    if ((target - position.pixels).abs() < 0.5) {
      return;
    }

    _isAnimating = true;
    try {
      await _scrollController.animateTo(
        target,
        duration: _scrollDuration,
        curve: Curves.easeOutCubic,
      );
    } finally {
      _isAnimating = false;
    }
  }

  void _ensureSelectedVisible({bool animate = true}) {
    if (!_scrollController.hasClients ||
        widget.currentIndex < 0 ||
        widget.currentIndex >= widget.items.length) {
      return;
    }

    final ScrollPosition position = _scrollController.position;
    final double itemStart = widget.currentIndex * _itemWidth;
    final double itemEnd = itemStart + _itemWidth;
    double target = position.pixels;

    if (itemStart < position.pixels) {
      target = itemStart;
    } else if (itemEnd > position.pixels + position.viewportDimension) {
      target = itemEnd - position.viewportDimension;
    }

    target = target.clamp(0.0, position.maxScrollExtent);
    if ((target - position.pixels).abs() < 0.5) {
      return;
    }

    if (animate) {
      _scrollController.animateTo(
        target,
        duration: _scrollDuration,
        curve: Curves.easeOutCubic,
      );
    } else {
      _scrollController.jumpTo(target);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      elevation: 12,
      child: SizedBox(
        height: 64,
        child: Row(
          children: <Widget>[
            _ModuleScrollArrow(
              key: const Key('admin-modules-scroll-left'),
              icon: Icons.chevron_left_rounded,
              tooltip: 'Previous modules',
              enabled: _canScrollLeft,
              onScroll: () => scrollBy(-_scrollStep),
            ),
            Expanded(
              child: Scrollbar(
                controller: _scrollController,
                thumbVisibility: true,
                child: SingleChildScrollView(
                  key: const Key('admin-modules-scroll-view'),
                  controller: _scrollController,
                  scrollDirection: Axis.horizontal,
                  child: SizedBox(
                    width: widget.items.length * _itemWidth,
                    child: BottomNavigationBar(
                      currentIndex: widget.currentIndex,
                      type: BottomNavigationBarType.fixed,
                      selectedItemColor: const Color(0xFF0F766E),
                      unselectedItemColor: const Color(0xFF94A3B8),
                      backgroundColor: Colors.white,
                      selectedFontSize: 10,
                      unselectedFontSize: 9,
                      onTap: widget.onTap,
                      items: widget.items,
                    ),
                  ),
                ),
              ),
            ),
            _ModuleScrollArrow(
              key: const Key('admin-modules-scroll-right'),
              icon: Icons.chevron_right_rounded,
              tooltip: 'More modules',
              enabled: _canScrollRight,
              onScroll: () => scrollBy(_scrollStep),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModuleScrollArrow extends StatefulWidget {
  const _ModuleScrollArrow({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.enabled,
    required this.onScroll,
  });

  final IconData icon;
  final String tooltip;
  final bool enabled;
  final VoidCallback onScroll;

  @override
  State<_ModuleScrollArrow> createState() => _ModuleScrollArrowState();
}

class _ModuleScrollArrowState extends State<_ModuleScrollArrow> {
  Timer? _repeatTimer;
  bool _isHovered = false;

  void _startRepeating() {
    if (!widget.enabled) {
      return;
    }
    widget.onScroll();
    _repeatTimer?.cancel();
    _repeatTimer = Timer.periodic(const Duration(milliseconds: 320), (_) {
      if (widget.enabled) {
        widget.onScroll();
      } else {
        _stopRepeating();
      }
    });
  }

  void _stopRepeating() {
    _repeatTimer?.cancel();
    _repeatTimer = null;
  }

  @override
  void dispose() {
    _stopRepeating();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: widget.tooltip,
      child: MouseRegion(
        cursor: widget.enabled
            ? SystemMouseCursors.click
            : SystemMouseCursors.basic,
        onEnter: (_) {
          if (widget.enabled) {
            setState(() {
              _isHovered = true;
            });
          }
        },
        onExit: (_) {
          if (_isHovered) {
            setState(() {
              _isHovered = false;
            });
          }
        },
        child: GestureDetector(
          onTap: widget.enabled ? widget.onScroll : null,
          onLongPressStart: widget.enabled ? (_) => _startRepeating() : null,
          onLongPressEnd: widget.enabled ? (_) => _stopRepeating() : null,
          onLongPressCancel: widget.enabled ? _stopRepeating : null,
          child: AnimatedOpacity(
            duration: const Duration(milliseconds: 180),
            opacity: widget.enabled ? 1 : 0.35,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              width: 52,
              height: double.infinity,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: _isHovered ? const Color(0xFFE8F5F1) : Colors.white,
                border: const Border(
                  left: BorderSide(color: Color(0xFFE6EFEB)),
                  right: BorderSide(color: Color(0xFFE6EFEB)),
                ),
              ),
              child: Icon(
                widget.icon,
                size: 27,
                color: widget.enabled
                    ? const Color(0xFF0F766E)
                    : const Color(0xFF98A2B3),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
