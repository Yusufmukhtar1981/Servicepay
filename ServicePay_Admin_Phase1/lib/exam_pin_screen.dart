import 'package:flutter/material.dart';

class ExamPinScreen extends StatefulWidget {
  const ExamPinScreen({super.key});

  @override
  State<ExamPinScreen> createState() => _ExamPinScreenState();
}

class _ExamPinScreenState extends State<ExamPinScreen> {
  final quantityController = TextEditingController(text: '1');

  String selectedExam = 'WAEC';
  String selectedProduct = 'WAEC Result Checker';

  final Map<String, List<String>> examProducts = {
    'WAEC': [
      'WAEC Result Checker',
      'WAEC Registration PIN',
    ],
    'NECO': [
      'NECO Result Checker',
      'NECO Registration PIN',
    ],
    'NABTEB': [
      'NABTEB Result Checker',
    ],
    'JAMB': [
      'JAMB ePIN',
      'JAMB Result Checker',
    ],
  };

  @override
  void dispose() {
    quantityController.dispose();
    super.dispose();
  }

  void buyExamPin() {
    final quantity = int.tryParse(quantityController.text.trim());

    if (quantity == null || quantity < 1) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Ka shigar da adadi mai inganci.'),
        ),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Za a sayi $quantity na $selectedProduct.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final products = examProducts[selectedExam]!;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Exam PIN',
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
              'Select Exam',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: selectedExam,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.school_outlined),
                border: OutlineInputBorder(),
              ),
              items: examProducts.keys.map((exam) {
                return DropdownMenuItem(
                  value: exam,
                  child: Text(exam),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    selectedExam = value;
                    selectedProduct = examProducts[value]!.first;
                  });
                }
              },
            ),
            const SizedBox(height: 22),
            const Text(
              'Select Product',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              key: ValueKey(selectedExam),
              initialValue: selectedProduct,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.confirmation_number_outlined),
                border: OutlineInputBorder(),
              ),
              items: products.map((product) {
                return DropdownMenuItem(
                  value: product,
                  child: Text(product),
                );
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    selectedProduct = value;
                  });
                }
              },
            ),
            const SizedBox(height: 22),
            const Text(
              'Quantity',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: quantityController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                hintText: 'Enter quantity',
                prefixIcon: Icon(Icons.numbers_outlined),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: buyExamPin,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text(
                  'Buy Exam PIN',
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