import 'package:flutter/material.dart';
import 'admin_platform_configuration_screen.dart';

import 'admin_airtime_to_cash_screen.dart';
import 'admin_amana_screen.dart';
import 'admin_data_pricing_screen.dart';
import 'admin_delivery_management_screen.dart';
import 'admin_empowerment_screen.dart';
import 'admin_kyc_screen.dart';
import 'admin_manual_funding_screen.dart';
import 'admin_notifications_screen.dart';
import 'admin_product_commission_screen.dart';
import 'admin_riders_screen.dart';
import 'admin_rider_wallet_screen.dart';
import 'admin_rider_withdrawals_screen.dart';
import 'admin_settings_screen.dart';
import 'admin_transactions_screen.dart';
import 'users_screen.dart';
import 'staff_management_screen.dart';
import 'admin_control_center_screen.dart';
import 'admin_partner_screen.dart';
import 'admin_business_withdrawals_screen.dart';
import 'admin_business_partners_screen.dart';

import 'admin_bank_reconciliation_screen.dart';
import 'admin_transaction_requery_screen.dart';
import 'admin_fintech_operations_screen.dart';
import 'admin_cards_screen.dart';
import 'admin_solar_screen.dart';
import 'admin_phone_financing_screen.dart';
import 'admin_customer_support_screen.dart';
import 'admin_customer_360_screen.dart';
import 'admin_privacy_requests_screen.dart';
// AUTO-GENERATED SAFE REGISTRY.
// Generated only from ServicePay strict verified screens.
// Do not manually add unverified screens here.

const Map<String, String> controlCenterModuleIds = <String, String>{
  'Audit Logs': 'audit-logs',
  'Security Events': 'security-events',
  'Access Logs': 'access-logs',
  'Data Exports': 'data-exports',
  'Backups': 'backups',
  'Privacy Controls': 'privacy-controls',
  'Executive Dashboard': 'executive-dashboard',
  'Service Performance': 'service-performance',
  'Transaction Analytics': 'transaction-analytics',
  'Customer Analytics': 'customer-analytics',
};

String? controlCenterModuleIdForTitle(String title) =>
    controlCenterModuleIds[title];

Widget? fintechScreenForTitle(String title) {
  if (title == 'Privacy Controls' || title == 'Account Deletion Requests') {
    return const AdminPrivacyRequestsScreen();
  }
  final String? controlCenterModuleId = controlCenterModuleIdForTitle(title);
  if (controlCenterModuleId != null) {
    return AdminControlCenterScreen(initialModuleId: controlCenterModuleId);
  }

  switch (title) {
    case 'Customer 360':
      return const AdminCustomer360Screen();
    case 'Customer Support':
    case 'Support / Tickets':
    case 'Complaints':
      return const AdminCustomerSupportScreen();
    case 'Account Restrictions':
    case 'Wallet Holds & Releases':
    case 'Failed Transactions':
    case 'Virtual Accounts':
    case 'Dedicated Accounts':
    case 'Fraud Monitoring':
    case 'Blacklist / Watchlist':
    case 'Device & Login Risk':
    case 'Refunds':
    case 'Reversals':
    case 'Bank Partners':
    case 'Switching / Routing':
    case 'Disputes':
      return AdminFintechOperationsScreen(module: title);
    case 'Cards Management':
      return const AdminCardsScreen();
    case 'Transaction Limits':
      return const AdminPlatformConfigurationScreen(
        initialSection: 'Service Limits',
      );
    case 'Transaction Requery':
      return const AdminTransactionRequeryScreen();

    case 'Bank Reconciliation':
      return const AdminBankReconciliationScreen();

    case 'Agent Commissions':
      return AdminProductCommissionScreen();
    case 'Airtime To Cash':
      return AdminAirtimeToCashScreen();
    case 'All Transactions':
      return AdminTransactionsScreen();
    case 'Amana':
      return AdminAmanaScreen();
    case 'ServicePay Solar':
      return const AdminSolarScreen();
    case 'Phone Financing':
      return const AdminPhoneFinancingScreen();
    case 'Commissions':
      return AdminProductCommissionScreen();
    case 'Commissions Setup':
      return AdminProductCommissionScreen();
    case 'Customers':
      return AdminUsersScreen();

    case 'Customer Wallets':
      return AdminUsersScreen();
    case 'Deliveries':
      return AdminDeliveryManagementScreen();
    case 'Empowerment':
      return AdminEmpowermentScreen();

    case 'Beneficiaries':
      return AdminEmpowermentScreen();
    case 'Feature Toggles':
      return AdminSettingsScreen();
    case 'General Settings':
      return AdminSettingsScreen();
    case 'KYC Management':
      return AdminKycScreen();
    case 'Notifications':
      return AdminNotificationsScreen();
    case 'Riders':
      return AdminRidersScreen();
    case 'Rider Wallets':
      return const AdminRiderWalletScreen();
    case 'Rider Withdrawals':
      return const AdminRiderWithdrawalsScreen();
    case 'Roles & Permissions':
      return StaffManagementScreen();
    case 'Service Pricing':
      return AdminDataPricingScreen();
    case 'Staff Management':
      return StaffManagementScreen();
    case 'Wallet Funding':
      return AdminManualFundingScreen();
    case 'Maintenance Mode':
      return AdminPlatformConfigurationScreen(
        initialSection: 'Maintenance Mode',
      );
    case 'Service Limits':
      return AdminPlatformConfigurationScreen(initialSection: 'Service Limits');
    case 'Transaction Fees':
      return AdminPlatformConfigurationScreen(
        initialSection: 'Transaction Fees',
      );
    case 'Legal & Policies':
      return AdminPlatformConfigurationScreen(
        initialSection: 'Legal & Policies',
      );
    case 'Core Ledger':
      return AdminTransactionsScreen();

    case 'General Ledger':
      return AdminTransactionsScreen();

    case 'Business Wallets':
      return AdminPartnerScreen();
    case 'Business Partners':
    case 'Business Accounts':
      return const AdminBusinessPartnersScreen();

    case 'Wallet Credit / Debit':
      return AdminControlCenterScreen();

    case 'Balance Adjustments':
      return AdminControlCenterScreen();

    case 'Settlement Accounts':
      return AdminBusinessWithdrawalsScreen();

    default:
      return null;
  }
}
