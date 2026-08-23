import 'package:flutter/material.dart';

import 'trust_search_screen.dart';

class TrustDashboardEntry extends StatelessWidget {
  const TrustDashboardEntry({super.key});

  static const Color _green = Color(0xFF08783E);
  static const Color _softGreen = Color(0xFFEAF7F0);

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'ServicePay Trust. Verify Before You Pay',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const TrustSearchScreen(),
              ),
            );
          },
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            decoration: BoxDecoration(
              color: _softGreen,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFBCE6CB)),
            ),
            child: const Row(
              children: <Widget>[
                Icon(
                  Icons.shield_outlined,
                  color: _green,
                  size: 26,
                ),
                SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'ServicePay Trust',
                        style: TextStyle(
                          color: Color(0xFF17231D),
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Verify Before You Pay',
                        style: TextStyle(
                          color: _green,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: _green,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
