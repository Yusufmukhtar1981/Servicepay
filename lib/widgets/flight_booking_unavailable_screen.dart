import 'package:flutter/material.dart';

/// An honest entry point until a real airline integration is available.
/// This screen deliberately has no booking or payment actions.
class FlightBookingUnavailableScreen extends StatelessWidget {
  const FlightBookingUnavailableScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const Color green = Color(0xFF08783E);
    return Scaffold(
      backgroundColor: const Color(0xFFF7FBF8),
      appBar: AppBar(
        title: const Text('Flight Booking'),
        backgroundColor: Colors.white,
        foregroundColor: green,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                children: <Widget>[
                  const SizedBox(height: 32),
                  const CircleAvatar(
                    radius: 42,
                    backgroundColor: Color(0xFFE6F5EC),
                    child: Icon(Icons.flight_takeoff_rounded,
                        color: green, size: 38),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Coming soon',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: green, fontSize: 24, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Real flight search and booking will be available when '
                    'an airline provider is connected.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: Color(0xFF405348), fontSize: 16, height: 1.5),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'This page cannot create a booking or take payment.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 28),
                  FilledButton.icon(
                    onPressed: () => Navigator.of(context).maybePop(),
                    style: FilledButton.styleFrom(backgroundColor: green),
                    icon: const Icon(Icons.arrow_back_rounded),
                    label: const Text('Back to services'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
