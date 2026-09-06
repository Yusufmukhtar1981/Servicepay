import 'package:flutter/material.dart';

import 'admin_airtime_to_cash_screen.dart';
import 'admin_amana_screen.dart';
import 'admin_data_pricing_screen.dart';
import 'admin_delivery_screen.dart';
import 'admin_empowerment_screen.dart';
import 'admin_kyc_screen.dart';
import 'admin_manual_funding_screen.dart';
import 'admin_notifications_screen.dart';
import 'admin_product_commission_screen.dart';
import 'admin_riders_screen.dart';
import 'admin_settings_screen.dart';
import 'admin_transactions_screen.dart';
import 'users_screen.dart';
import 'staff_management_screen.dart';

// AUTO-GENERATED SAFE REGISTRY.
// Generated only from ServicePay strict verified screens.
// Do not manually add unverified screens here.

Widget? fintechScreenForTitle(String title) {
  switch (title) {
    case 'Agent Commissions':
      return AdminProductCommissionScreen();
    case 'Airtime To Cash':
      return AdminAirtimeToCashScreen();
    case 'All Transactions':
      return AdminTransactionsScreen();
    case 'Amana':
      return AdminAmanaScreen();
    case 'Commissions':
      return AdminProductCommissionScreen();
    case 'Commissions Setup':
      return AdminProductCommissionScreen();
    case 'Customers':
      return AdminUsersScreen();
    case 'Deliveries':
      return AdminDeliveryScreen();
    case 'Empowerment':
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
    case 'Roles & Permissions':
      return StaffManagementScreen();
    case 'Service Pricing':
      return AdminDataPricingScreen();
    case 'Staff Management':
      return StaffManagementScreen();
    case 'Wallet Funding':
      return AdminManualFundingScreen();
    default:
      return null;
  }
}
