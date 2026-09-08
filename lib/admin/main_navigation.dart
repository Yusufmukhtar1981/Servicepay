import 'package:flutter/material.dart';

import 'admin_dashboard_screen.dart';
import 'admin_manual_funding_screen.dart';
import 'admin_notifications_screen.dart';
import 'admin_bulk_email_screen.dart';
import 'admin_customer_support_screen.dart';
import 'admin_kyc_review_screen.dart';
import 'admin_empowerment_screen.dart';
import 'admin_amana_screen.dart';
import 'admin_control_center_screen.dart';
import 'admin_customer_withdrawals_screen.dart';
import 'admin_delivery_management_screen.dart';
import '../logistics/logistics_operations_screens.dart';
import 'admin_list_workspaces.dart';
import 'admin_marketplace_screen.dart';
import 'admin_phone_financing_screen.dart';
import 'admin_airtime_to_cash_screen.dart';
import 'admin_branch_management_screen.dart';
import 'admin_solar_screen.dart';
import 'admin_permissions.dart';
import 'admin_roles_permissions_screen.dart';
import 'admin_session_service.dart';
import 'login_screen.dart';
import 'executive_management_screen.dart';
import 'admin_feature_controls_screen.dart';

class AdminMainNavigation extends StatefulWidget {
  const AdminMainNavigation({super.key, this.sessionService});

  final AdminSessionService? sessionService;

  static List<String> visibleDestinationLabels(AdminAccess access) {
    return _AdminMainNavigationState.destinations
        .where((_AdminDestination item) =>
            (item.label != 'Executive Management' ||
                (const {
                      'HEAD_OFFICE',
                      'HEAD_OFFICE_ADMIN',
                      'SUPER_ADMIN',
                      'ADMIN'
                    }.contains(access.role) &&
                    access.isFullAccess)) &&
            access.hasAny(item.permissions) &&
            (item.label != 'Control' || access.role == 'HEAD_OFFICE'))
        .map((_AdminDestination item) => item.label)
        .toList();
  }

  @override
  State<AdminMainNavigation> createState() => _AdminMainNavigationState();
}

class _AdminMainNavigationState extends State<AdminMainNavigation>
    with WidgetsBindingObserver {
  int currentIndex = 0;
  AdminAccess? access;
  String? refreshError;
  late final AdminSessionService sessionService;
  final GlobalKey<ExecutiveManagementScreenState> executiveManagementKey =
      GlobalKey<ExecutiveManagementScreenState>();

  static const List<_AdminDestination> destinations = <_AdminDestination>[
    _AdminDestination(
        'Dashboard',
        Icons.dashboard_outlined,
        Icons.dashboard_rounded,
        <String>[AdminPermissions.dashboardView],
        AdminDashboardScreen()),
    _AdminDestination(
        'Executive Management',
        Icons.insights_outlined,
        Icons.insights,
        <String>[AdminPermissions.staffView],
        ExecutiveManagementScreen()),
    _AdminDestination(
        'Branch Management',
        Icons.account_tree_outlined,
        Icons.account_tree,
        <String>[
          AdminPermissions.branchesView,
          AdminPermissions.branchDashboardView,
          AdminPermissions.branchesApprovalsView,
        ],
        AdminBranchManagementScreen()),
    _AdminDestination(
        'Funding',
        Icons.account_balance_wallet_outlined,
        Icons.account_balance_wallet_rounded,
        <String>[AdminPermissions.fundingView],
        AdminManualFundingScreen()),
    _AdminDestination('Users', Icons.people_outline, Icons.people,
        <String>[AdminPermissions.usersView], AdminUsersScreen()),
    _AdminDestination(
        'Transactions',
        Icons.receipt_long_outlined,
        Icons.receipt_long,
        <String>[AdminPermissions.transactionsView],
        AdminTransactionsScreen()),
    _AdminDestination(
        'Notifications',
        Icons.notifications_outlined,
        Icons.notifications_rounded,
        <String>[AdminPermissions.notificationsView],
        AdminNotificationsScreen()),
    _AdminDestination(
        'Email Center',
        Icons.mark_email_unread_outlined,
        Icons.mark_email_unread_rounded,
        <String>[AdminPermissions.communicationsView],
        AdminBulkEmailScreen()),
    _AdminDestination(
        'Support',
        Icons.support_agent_outlined,
        Icons.support_agent_rounded,
        <String>[AdminPermissions.supportView],
        AdminCustomerSupportScreen()),
    _AdminDestination(
        'Control',
        Icons.admin_panel_settings_outlined,
        Icons.admin_panel_settings_rounded,
        <String>[AdminPermissions.dashboardView],
        AdminControlCenterScreen()),
    _AdminDestination(
        'Feature Controls',
        Icons.toggle_on_outlined,
        Icons.toggle_on,
        <String>[AdminPermissions.settingsView],
        AdminFeatureControlsScreen()),
    _AdminDestination(
        'Withdrawals',
        Icons.payments_outlined,
        Icons.payments_rounded,
        <String>[AdminPermissions.withdrawalsView],
        AdminCustomerWithdrawalsScreen()),
    _AdminDestination(
        'Airtime Cash',
        Icons.currency_exchange_outlined,
        Icons.currency_exchange_rounded,
        <String>[AdminPermissions.airtimeToCashView],
        AdminAirtimeToCashScreen()),
    _AdminDestination(
        'Delivery',
        Icons.local_shipping_outlined,
        Icons.local_shipping,
        <String>[AdminPermissions.deliveryView],
        AdminDeliveryManagementScreen()),
    _AdminDestination(
        'Logistics',
        Icons.local_shipping_outlined,
        Icons.local_shipping_rounded,
        <String>[
          AdminPermissions.logisticsView,
          AdminPermissions.logisticsManage
        ],
        AdminLogisticsScreen()),
    _AdminDestination(
        'Marketplace',
        Icons.storefront_outlined,
        Icons.storefront,
        <String>[AdminPermissions.marketplaceView],
        AdminMarketplaceScreen()),
    _AdminDestination(
        'Phone Finance',
        Icons.phone_android_outlined,
        Icons.phone_android,
        <String>[AdminPermissions.phoneFinancingView],
        AdminPhoneFinancingScreen()),
    _AdminDestination('KYC', Icons.verified_user_outlined, Icons.verified_user,
        <String>[AdminPermissions.kycView], AdminKycReviewScreen()),
    _AdminDestination(
        'Empowerment',
        Icons.volunteer_activism_outlined,
        Icons.volunteer_activism,
        <String>[AdminPermissions.empowermentView],
        AdminEmpowermentScreen()),
    _AdminDestination(
        'Amana',
        Icons.shopping_basket_outlined,
        Icons.shopping_basket,
        <String>[AdminPermissions.amanaView],
        AdminAmanaScreen()),
    _AdminDestination('Solar', Icons.solar_power_outlined, Icons.solar_power,
        <String>[AdminPermissions.solarView], AdminSolarScreen()),
    _AdminDestination(
        'Staff & Roles',
        Icons.manage_accounts_outlined,
        Icons.manage_accounts,
        <String>[AdminPermissions.rolesView, AdminPermissions.staffView],
        AdminRolesPermissionsScreen()),
  ];

  static List<String> _visibleDestinationLabels(AdminAccess access) {
    return AdminMainNavigation.visibleDestinationLabels(access);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    sessionService = widget.sessionService ?? AdminSessionService();
    _refreshAccess();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshAccess();
    }
  }

  Future<void> _refreshAccess() async {
    setState(() => refreshError = null);
    try {
      final AdminAccess value = await sessionService.refresh();
      if (mounted) setState(() => access = value);
    } on AdminSessionExpiredException {
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(builder: (_) => const AdminLoginScreen()),
        (Route<dynamic> route) => false,
      );
    } catch (_) {
      if (mounted) {
        setState(() => refreshError = 'Unable to refresh your admin session.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (refreshError != null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(refreshError!),
              const SizedBox(height: 12),
              OutlinedButton(
                  onPressed: _refreshAccess, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (access == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final List<String> labels = _visibleDestinationLabels(access!);
    final List<_AdminDestination> allowed = destinations
        .where((_AdminDestination item) => labels.contains(item.label))
        .toList();
    if (allowed.isEmpty) {
      return const Scaffold(
        body: Center(
            child: Text('No Admin modules are assigned to this account.')),
      );
    }
    if (currentIndex >= allowed.length) currentIndex = 0;
    final int executiveIndex = allowed.indexWhere(
        (_AdminDestination item) => item.label == 'Executive Management');
    final int dashboardIndex = allowed
        .indexWhere((_AdminDestination item) => item.label == 'Dashboard');
    void openAdminDashboard() {
      if (dashboardIndex < 0) return;
      setState(() => currentIndex = dashboardIndex);
    }

    void openExecutiveManagement({bool createSvp = false}) {
      if (executiveIndex < 0) return;
      setState(() => currentIndex = executiveIndex);
      if (createSvp) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          executiveManagementKey.currentState?.openCreate();
        });
      }
    }

    final wide = MediaQuery.sizeOf(context).width >= 900;
    return Scaffold(
      body: Row(
        children: [
          if (wide)
            _DesktopAdminNavigation(
              destinations: allowed,
              currentIndex: currentIndex,
              onSelect: (index) => setState(() => currentIndex = index),
            ),
          Expanded(
            child: IndexedStack(
              index: currentIndex,
              children: allowed.map((_AdminDestination item) {
                if (item.label == 'Dashboard') {
                  return AdminDashboardScreen(
                    showExecutiveManagement: executiveIndex >= 0,
                    onOpenExecutiveManagement: openExecutiveManagement,
                    onCreateSvp: () => openExecutiveManagement(createSvp: true),
                  );
                }
                if (item.label == 'Executive Management') {
                  return ExecutiveManagementScreen(
                    key: executiveManagementKey,
                    onBackToAdminDashboard: openAdminDashboard,
                  );
                }
                return item.page;
              }).toList(),
            ),
          ),
        ],
      ),
      bottomNavigationBar: wide
          ? null
          : _MobileAdminNavigation(
              destinations: allowed,
              currentIndex: currentIndex,
              onSelect: (index) => setState(() => currentIndex = index),
            ),
    );
  }
}

class _DesktopAdminNavigation extends StatelessWidget {
  const _DesktopAdminNavigation({
    required this.destinations,
    required this.currentIndex,
    required this.onSelect,
  });

  final List<_AdminDestination> destinations;
  final int currentIndex;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) => Material(
        color: const Color(0xFFE6F0ED),
        child: SizedBox(
          width: 248,
          child: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 10),
              child: Column(
                children: List.generate(destinations.length, (index) {
                  final item = destinations[index];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: ListTile(
                      selected: currentIndex == index,
                      selectedTileColor: Colors.white,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                      leading: Icon(
                          currentIndex == index ? item.activeIcon : item.icon),
                      title: Text(item.label,
                          style: const TextStyle(
                              fontSize: 12, fontWeight: FontWeight.w700)),
                      onTap: () => onSelect(index),
                    ),
                  );
                }),
              ),
            ),
          ),
        ),
      );
}

class _MobileAdminNavigation extends StatelessWidget {
  const _MobileAdminNavigation({
    required this.destinations,
    required this.currentIndex,
    required this.onSelect,
  });

  final List<_AdminDestination> destinations;
  final int currentIndex;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        elevation: 10,
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
            child: Row(
              children: List.generate(destinations.length, (index) {
                final item = destinations[index];
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    selected: currentIndex == index,
                    avatar: Icon(
                        currentIndex == index ? item.activeIcon : item.icon,
                        size: 18),
                    label: Text(item.label),
                    onSelected: (_) => onSelect(index),
                  ),
                );
              }),
            ),
          ),
        ),
      );
}

class _AdminDestination {
  const _AdminDestination(
    this.label,
    this.icon,
    this.activeIcon,
    this.permissions,
    this.page,
  );

  final String label;
  final IconData icon;
  final IconData activeIcon;
  final List<String> permissions;
  final Widget page;
}
