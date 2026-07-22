import 'package:flutter/material.dart';

class DataScreen extends StatefulWidget {
  const DataScreen({super.key});

  @override
  State<DataScreen> createState() => _DataScreenState();
}

class _DataScreenState extends State<DataScreen> {
  final phoneController = TextEditingController();

  String selectedNetwork = 'MTN';
  String selectedPlan = '1GB - ₦500';

  final Map<String, List<String>> dataPlans = {
    'MTN': [
      '500MB - ₦250',
      '1GB - ₦500',
      '2GB - ₦1000',
      '5GB - ₦2500',
    ],
    'Airtel': [
      '500MB - ₦300',
      '1GB - ₦600',
      '2GB - ₦1200',
      '5GB - ₦2800',
    ],
    'Glo': [
      '1GB - ₦450',
      '2GB - ₦900',
      '5GB - ₦2200',
    ],
    '9mobile': [
      '500MB - ₦300',
      '1GB - ₦600',
      '2GB - ₦1150',
    ],
  };

  @override
  void dispose() {
    phoneController.dispose();
    super.dispose();
  }

  void buyData() {
    final phone = phoneController.text.trim();

    if (phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Ka shigar da lambar waya.'),
        ),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Za a sayi $selectedPlan na $selectedNetwork zuwa $phone',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final plans = dataPlans[selectedNetwork]!;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Buy Data',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Select Network',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: selectedNetwork,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.sim_card_outlined),
                border: OutlineInputBorder(),
              ),
              items: dataPlans.keys.map((network) {
                return DropdownMenuItem(
                  value: network,
                  child: Text(network),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    selectedNetwork = value;
                    selectedPlan = dataPlans[value]!.first;
                  });
                }
              },
            ),
            const SizedBox(height: 22),
            const Text(
              'Select Data Plan',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: selectedPlan,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.data_usage_outlined),
                border: OutlineInputBorder(),
              ),
              items: plans.map((plan) {
                return DropdownMenuItem(
                  value: plan,
                  child: Text(plan),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    selectedPlan = value;
                  });
                }
              },
            ),
            const SizedBox(height: 22),
            const Text(
              'Phone Number',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: phoneController,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                hintText: '08012345678',
                prefixIcon: Icon(Icons.phone_outlined),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: buyData,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text(
                  'Buy Data',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}