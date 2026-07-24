import 'package:flutter/material.dart';

class ElectricityScreen extends StatefulWidget {
  const ElectricityScreen({super.key});

  @override
  State<ElectricityScreen> createState() => _ElectricityScreenState();
}

class _ElectricityScreenState extends State<ElectricityScreen> {
  final meterController = TextEditingController();
  final amountController = TextEditingController();

  String selectedDisco = 'KEDCO';
  String selectedMeterType = 'Prepaid';

  final List<String> discos = [
    'KEDCO',
    'AEDC',
    'IKEDC',
    'EKEDC',
    'PHED',
    'IBEDC',
    'JED',
    'BEDC',
    'EEDC',
    'YEDC',
  ];

  final List<String> meterTypes = [
    'Prepaid',
    'Postpaid',
  ];

  @override
  void dispose() {
    meterController.dispose();
    amountController.dispose();
    super.dispose();
  }

  void payElectricity() {
    final meterNumber = meterController.text.trim();
    final amount = amountController.text.trim();

    if (meterNumber.isEmpty || amount.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Ka shigar da meter number da adadin kuɗi.',
          ),
        ),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Za a biya ₦$amount na $selectedDisco '
          'zuwa meter $meterNumber ($selectedMeterType)',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Electricity',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Select Electricity Company',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: selectedDisco,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.electric_bolt_outlined),
                border: OutlineInputBorder(),
              ),
              items: discos.map((disco) {
                return DropdownMenuItem(
                  value: disco,
                  child: Text(disco),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    selectedDisco = value;
                  });
                }
              },
            ),
            const SizedBox(height: 22),
            const Text(
              'Meter Type',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: selectedMeterType,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.speed_outlined),
                border: OutlineInputBorder(),
              ),
              items: meterTypes.map((meterType) {
                return DropdownMenuItem(
                  value: meterType,
                  child: Text(meterType),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    selectedMeterType = value;
                  });
                }
              },
            ),
            const SizedBox(height: 22),
            const Text(
              'Meter Number',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: meterController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                hintText: 'Enter meter number',
                prefixIcon: Icon(Icons.numbers_outlined),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 22),
            const Text(
              'Amount',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: amountController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                hintText: 'Enter amount',
                prefixText: '₦ ',
                prefixIcon: Icon(Icons.payments_outlined),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: payElectricity,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text(
                  'Pay Electricity',
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