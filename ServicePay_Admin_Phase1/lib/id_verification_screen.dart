import 'package:flutter/material.dart';

class IdVerificationScreen extends StatelessWidget {
  const IdVerificationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'ID Verification',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Select Verification Type',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Choose the identity document you want to verify.',
              style: TextStyle(
                fontSize: 15,
                color: Colors.grey,
              ),
            ),
            const SizedBox(height: 24),

            _verificationCard(
              context: context,
              icon: Icons.badge_outlined,
              title: 'NIN Verification',
              subtitle: 'Verify a National Identification Number',
              price: '₦200',
            ),

            _verificationCard(
              context: context,
              icon: Icons.account_balance_wallet_outlined,
              title: 'BVN Verification',
              subtitle: 'Verify a Bank Verification Number',
              price: '₦300',
            ),

            _verificationCard(
              context: context,
              icon: Icons.directions_car_outlined,
              title: 'Driver\'s Licence',
              subtitle: 'Verify a Nigerian driver\'s licence',
              price: '₦300',
            ),

            _verificationCard(
              context: context,
              icon: Icons.flight_outlined,
              title: 'International Passport',
              subtitle: 'Verify an international passport',
              price: '₦500',
            ),

            _verificationCard(
              context: context,
              icon: Icons.how_to_vote_outlined,
              title: 'Voter\'s Card',
              subtitle: 'Verify a permanent voter\'s card',
              price: '₦250',
            ),
          ],
        ),
      ),
    );
  }

  Widget _verificationCard({
    required BuildContext context,
    required IconData icon,
    required String title,
    required String subtitle,
    required String price,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 10,
        ),
        leading: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: Colors.green.shade50,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(
            icon,
            color: Colors.green,
            size: 28,
          ),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 5),
          child: Text(subtitle),
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              price,
              style: const TextStyle(
                color: Colors.green,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 4),
            const Icon(
              Icons.arrow_forward_ios,
              size: 16,
            ),
          ],
        ),
        onTap: () {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('$title selected'),
              behavior: SnackBarBehavior.floating,
            ),
          );
        },
      ),
    );
  }
}