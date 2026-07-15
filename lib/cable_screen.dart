import 'package:flutter/material.dart';

class CableScreen extends StatefulWidget {
  const CableScreen({super.key});

  @override
  State<CableScreen> createState() => _CableScreenState();
}

class _CableScreenState extends State<CableScreen> {
  final smartcardController = TextEditingController();

  String selectedProvider = 'DStv';
  String selectedPackage = 'DStv Padi - ₦3,600';

  final Map<String, List<String>> cablePackages = {
    'DStv': [
      'DStv Padi - ₦3,600',
      'DStv Yanga - ₦5,100',
      'DStv Confam - ₦9,300',
      'DStv Compact - ₦15,700',
    ],
    'GOtv': [
      'GOtv Smallie - ₦1,575',
      'GOtv Jinja - ₦3,300',
      'GOtv Jolli - ₦4,850',
      'GOtv Max - ₦7,200',
    ],
    'Startimes': [
      'Nova - ₦1,500',
      'Basic - ₦3,000',
      'Classic - ₦4,500',
      'Super - ₦7,500',
    ],
  };

  @override
  void dispose() {
    smartcardController.dispose();
    super.dispose();
  }

  void buyCable() {
    final smartcard = smartcardController.text.trim();

    if (smartcard.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Ka shigar da Smartcard ko IUC number.'),
        ),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Za a sayi $selectedPackage na $selectedProvider zuwa $smartcard',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final packages = cablePackages[selectedProvider]!;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Cable TV',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Select Provider',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: selectedProvider,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.tv_outlined),
                border: OutlineInputBorder(),
              ),
              items: cablePackages.keys.map((provider) {
                return DropdownMenuItem(
                  value: provider,
                  child: Text(provider),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    selectedProvider = value;
                    selectedPackage = cablePackages[value]!.first;
                  });
                }
              },
            ),
            const SizedBox(height: 22),
            const Text(
              'Select Package',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              key: ValueKey(selectedProvider),
              initialValue: selectedPackage,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.inventory_2_outlined),
                border: OutlineInputBorder(),
              ),
              items: packages.map((package) {
                return DropdownMenuItem(
                  value: package,
                  child: Text(package),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    selectedPackage = value;
                  });
                }
              },
            ),
            const SizedBox(height: 22),
            const Text(
              'Smartcard / IUC Number',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: smartcardController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                hintText: 'Enter Smartcard or IUC number',
                prefixIcon: Icon(Icons.credit_card_outlined),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: buyCable,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text(
                  'Pay Cable TV',
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