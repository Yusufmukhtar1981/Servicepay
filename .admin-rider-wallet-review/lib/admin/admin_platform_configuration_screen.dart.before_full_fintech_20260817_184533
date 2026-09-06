import 'package:flutter/material.dart';

class AdminPlatformConfigurationScreen extends StatelessWidget {
  final String initialSection;

  const AdminPlatformConfigurationScreen({
    super.key,
    this.initialSection = 'Platform Configuration',
  });

  static const Color _primary = Color(0xFF08783E);
  static const Color _dark = Color(0xFF10231A);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F5),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: _dark,
        title: Text(
          initialSection,
          style: const TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          _header(),
          const SizedBox(height: 18),
          if (initialSection == 'Maintenance Mode')
            _maintenanceMode(context)
          else if (initialSection == 'Service Limits')
            _serviceLimits(context)
          else if (initialSection == 'Transaction Fees')
            _transactionFees(context)
          else if (initialSection == 'Legal & Policies')
            _legalPolicies(context)
          else ...[
            _configurationTile(
              context,
              title: 'Maintenance Mode',
              subtitle:
                  'Control platform maintenance readiness and customer-facing service availability.',
              icon: Icons.engineering_outlined,
            ),
            _configurationTile(
              context,
              title: 'Service Limits',
              subtitle:
                  'Manage transaction and operational limits by service and customer tier.',
              icon: Icons.speed_outlined,
            ),
            _configurationTile(
              context,
              title: 'Transaction Fees',
              subtitle:
                  'Prepare central administration of charges, fees and pricing rules.',
              icon: Icons.price_change_outlined,
            ),
            _configurationTile(
              context,
              title: 'Legal & Policies',
              subtitle:
                  'Manage policy documents, terms, privacy and regulatory notices.',
              icon: Icons.gavel_outlined,
            ),
          ],
        ],
      ),
    );
  }

  Widget _header() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF08783E),
            Color(0xFF0B5F35),
          ],
        ),
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.admin_panel_settings_outlined,
            color: Colors.white,
            size: 30,
          ),
          SizedBox(height: 12),
          Text(
            'Platform Configuration',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          SizedBox(height: 5),
          Text(
            'Central governance controls for ServicePay fintech operations.',
            style: TextStyle(
              color: Color(0xFFD7F2E3),
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _maintenanceMode(BuildContext context) {
    return Column(
      children: [
        _statusBanner(
          title: 'Maintenance Mode',
          message:
              'The administration page is ready. Backend enforcement will be connected only after the ServicePay settings API is verified.',
          icon: Icons.engineering_outlined,
        ),
        const SizedBox(height: 14),
        _readOnlyControl(
          title: 'Global Maintenance',
          value: 'Backend status not yet connected',
          icon: Icons.public_off_outlined,
        ),
        _readOnlyControl(
          title: 'Customer App',
          value: 'Controlled by existing production configuration',
          icon: Icons.phone_android_outlined,
        ),
        _readOnlyControl(
          title: 'Admin Portal',
          value: 'Operational',
          icon: Icons.admin_panel_settings_outlined,
        ),
        _readOnlyControl(
          title: 'API Services',
          value: 'No change made from this page',
          icon: Icons.api_outlined,
        ),
      ],
    );
  }

  Widget _serviceLimits(BuildContext context) {
    return Column(
      children: [
        _statusBanner(
          title: 'Service Limits',
          message:
              'This page is ready for Tier 1, Tier 2, Tier 3 and product limits. Existing production limits remain untouched.',
          icon: Icons.speed_outlined,
        ),
        const SizedBox(height: 14),
        _limitCard(
          'Customer Tier 1',
          'Daily / transaction limits',
          Icons.looks_one_outlined,
        ),
        _limitCard(
          'Customer Tier 2',
          'Daily / transaction limits',
          Icons.looks_two_outlined,
        ),
        _limitCard(
          'Customer Tier 3',
          'Daily / transaction limits',
          Icons.looks_3_outlined,
        ),
        _limitCard(
          'Transfers',
          'ServicePay and bank transfer limits',
          Icons.swap_horiz_outlined,
        ),
        _limitCard(
          'Wallet Funding',
          'Funding thresholds and operational controls',
          Icons.account_balance_wallet_outlined,
        ),
        _limitCard(
          'Bills & Services',
          'Airtime, data and other service controls',
          Icons.receipt_long_outlined,
        ),
      ],
    );
  }

  Widget _transactionFees(BuildContext context) {
    return Column(
      children: [
        _statusBanner(
          title: 'Transaction Fees',
          message:
              'Central fee administration interface created. Existing pricing and commissions are not overwritten.',
          icon: Icons.price_change_outlined,
        ),
        const SizedBox(height: 14),
        _feeCard(
          'ServicePay Transfer',
          Icons.swap_horiz_outlined,
        ),
        _feeCard(
          'Bank Transfer',
          Icons.account_balance_outlined,
        ),
        _feeCard(
          'Wallet Funding',
          Icons.add_card_outlined,
        ),
        _feeCard(
          'Withdrawal',
          Icons.outbox_outlined,
        ),
        _feeCard(
          'Airtime & Data',
          Icons.phone_android_outlined,
        ),
        _feeCard(
          'Merchant Payments',
          Icons.storefront_outlined,
        ),
      ],
    );
  }

  Widget _legalPolicies(BuildContext context) {
    return Column(
      children: [
        _statusBanner(
          title: 'Legal & Policies',
          message:
              'Governance centre for ServicePay legal documents and customer disclosures.',
          icon: Icons.gavel_outlined,
        ),
        const SizedBox(height: 14),
        _policyCard(
          'Privacy Policy',
          'Customer privacy and data-handling policy',
          Icons.privacy_tip_outlined,
        ),
        _policyCard(
          'Terms & Conditions',
          'Platform terms and customer agreement',
          Icons.description_outlined,
        ),
        _policyCard(
          'KYC / AML Policy',
          'Customer due-diligence and financial crime controls',
          Icons.verified_user_outlined,
        ),
        _policyCard(
          'Complaints Policy',
          'Customer complaints and dispute handling',
          Icons.support_agent_outlined,
        ),
        _policyCard(
          'Data Protection',
          'Data governance and access controls',
          Icons.shield_outlined,
        ),
        _policyCard(
          'Regulatory Notices',
          'Operational and compliance disclosures',
          Icons.account_balance_outlined,
        ),
      ],
    );
  }

  Widget _statusBanner({
    required String title,
    required String message,
    required IconData icon,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFFDDE8E1),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: const Color(0xFFE9F7EF),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: _primary,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: _dark,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  message,
                  style: const TextStyle(
                    color: Colors.black54,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _readOnlyControl({
    required String title,
    required String value,
    required IconData icon,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Icon(
            icon,
            color: _primary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.lock_outline,
            color: Colors.grey,
            size: 19,
          ),
        ],
      ),
    );
  }

  Widget _configurationTile(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.all(15),
        leading: Container(
          width: 45,
          height: 45,
          decoration: BoxDecoration(
            color: const Color(0xFFE9F7EF),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(
            icon,
            color: _primary,
          ),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 5),
          child: Text(subtitle),
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => AdminPlatformConfigurationScreen(
                initialSection: title,
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _limitCard(
    String title,
    String subtitle,
    IconData icon,
  ) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Icon(
            icon,
            color: _primary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const Chip(
            label: Text(
              'API Pending',
              style: TextStyle(fontSize: 10),
            ),
          ),
        ],
      ),
    );
  }

  Widget _feeCard(
    String title,
    IconData icon,
  ) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Icon(
            icon,
            color: _primary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const Text(
            'Existing configuration preserved',
            style: TextStyle(
              color: Colors.black45,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  Widget _policyCard(
    String title,
    String subtitle,
    IconData icon,
  ) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Icon(
            icon,
            color: _primary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.chevron_right,
            color: Colors.grey,
          ),
        ],
      ),
    );
  }
}
