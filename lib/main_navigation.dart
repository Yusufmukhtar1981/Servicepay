import 'package:flutter/material.dart';

import 'dashboard_screen.dart';
import 'profile_screen.dart';
import 'transactions_screen.dart';
import 'wallet_screen.dart';

class MainNavigation extends StatefulWidget {
  const MainNavigation({
    super.key,
  });

  @override
  State<MainNavigation> createState() =>
      _MainNavigationState();
}

class _MainNavigationState
    extends State<MainNavigation> {
  static const Color primaryGreen =
      Color(0xFF08783E);

  int currentIndex = 0;

  final List<Widget> pages = const [
    DashboardScreen(),
    TransactionsScreen(),
    WalletScreen(),
    ProfileScreen(),
  ];

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      extendBody: false,
      body: IndexedStack(
        index: currentIndex,
        children: pages,
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        minimum:
            const EdgeInsets.fromLTRB(
          10,
          0,
          10,
          8,
        ),
        child: Container(
          height: 78,
          padding:
              const EdgeInsets.symmetric(
            horizontal: 7,
            vertical: 6,
          ),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius:
                BorderRadius.circular(
              22,
            ),
            border: Border.all(
              color: const Color(
                0xFFE7EAEF,
              ),
            ),
            boxShadow: const [
              BoxShadow(
                color: Color(
                  0x24101828,
                ),
                blurRadius: 24,
                offset: Offset(
                  0,
                  10,
                ),
              ),
            ],
          ),
          child: Row(
            crossAxisAlignment:
                CrossAxisAlignment.stretch,
            children: [
              buildNavigationItem(
                index: 0,
                icon:
                    Icons.home_outlined,
                activeIcon:
                    Icons.home_rounded,
                label: 'Home',
              ),
              buildNavigationItem(
                index: 1,
                icon: Icons
                    .receipt_long_outlined,
                activeIcon: Icons
                    .receipt_long_rounded,
                label: 'Transactions',
              ),
              buildNavigationItem(
                index: 2,
                icon: Icons
                    .account_balance_wallet_outlined,
                activeIcon: Icons
                    .account_balance_wallet_rounded,
                label: 'Wallet',
              ),
              buildNavigationItem(
                index: 3,
                icon: Icons
                    .person_outline_rounded,
                activeIcon:
                    Icons.person_rounded,
                label: 'Profile',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget buildNavigationItem({
    required int index,
    required IconData icon,
    required IconData activeIcon,
    required String label,
  }) {
    final bool selected =
        currentIndex == index;

    return Expanded(
      child: Padding(
        padding:
            const EdgeInsets.symmetric(
          horizontal: 2,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () {
              setState(() {
                currentIndex = index;
              });
            },
            borderRadius:
                BorderRadius.circular(
              18,
            ),
            child: AnimatedContainer(
              duration:
                  const Duration(
                milliseconds: 220,
              ),
              curve: Curves.easeOut,
              padding:
                  const EdgeInsets.symmetric(
                horizontal: 2,
                vertical: 5,
              ),
              decoration:
                  BoxDecoration(
                color: selected
                    ? const Color(
                        0xFFEAF7F0,
                      )
                    : Colors.transparent,
                borderRadius:
                    BorderRadius.circular(
                  18,
                ),
              ),
              child: Column(
                mainAxisSize:
                    MainAxisSize.min,
                mainAxisAlignment:
                    MainAxisAlignment.center,
                children: [
                  AnimatedContainer(
                    duration:
                        const Duration(
                      milliseconds: 220,
                    ),
                    width:
                        selected ? 31 : 27,
                    height:
                        selected ? 31 : 27,
                    decoration:
                        BoxDecoration(
                      color: selected
                          ? primaryGreen
                          : Colors.transparent,
                      shape:
                          BoxShape.circle,
                    ),
                    alignment:
                        Alignment.center,
                    child: Icon(
                      selected
                          ? activeIcon
                          : icon,
                      color: selected
                          ? Colors.white
                          : const Color(
                              0xFF667085,
                            ),
                      size:
                          selected ? 19 : 21,
                    ),
                  ),
                  const SizedBox(
                    height: 3,
                  ),
                  SizedBox(
                    width:
                        double.infinity,
                    child: Text(
                      label,
                      maxLines: 1,
                      textAlign:
                          TextAlign.center,
                      overflow:
                          TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: label ==
                                'Transactions'
                            ? 9
                            : 10,
                        height: 1,
                        fontWeight:
                            selected
                                ? FontWeight.w800
                                : FontWeight.w600,
                        color: selected
                            ? primaryGreen
                            : const Color(
                                0xFF667085,
                              ),
                      ),
                    ),
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
