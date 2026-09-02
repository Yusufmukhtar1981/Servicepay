import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'airtime_data_screen.dart';
import 'cards_screen.dart';
import 'empowerment_screen.dart';
import 'group_wallet_screen.dart';
import 'keke_order_screen.dart';
import 'logistics_screen.dart';
import 'marketplace/marketplace_screen.dart';
import 'business_wallet_screen.dart';

Widget? miniAppScreenForRouteKey(String routeKey) {
  switch (routeKey.trim()) {
    case 'cards':
      return const CardsScreen();
    case 'empowerment':
      return const EmpowermentScreen();
    case 'businessWallet':
      return const BusinessWalletScreen();
    case 'delivery':
      return const LogisticsScreen();
    case 'airtimeData':
      return const AirtimeDataScreen();
    case 'groupWallet':
      return const GroupWalletScreen();
    case 'marketplace':
      return const MarketplaceScreen();
    case 'transport':
      return const KekeOrderScreen();
    default:
      return null;
  }
}

class MiniAppsScreen extends StatefulWidget {
  const MiniAppsScreen({
    super.key,
  });

  @override
  State<MiniAppsScreen> createState() => _MiniAppsScreenState();
}

class _MiniAppsScreenState extends State<MiniAppsScreen> {
  static const String _baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  String errorMessage = '';
  String searchText = '';
  String selectedCategory = 'All';

  List<Map<String, dynamic>> apps = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    loadMiniApps();
  }

  Future<void> loadMiniApps() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final response = await http.get(
        Uri.parse(
          '$_baseUrl/mini-apps',
        ),
        headers: const {
          'Accept': 'application/json',
        },
      ).timeout(
        const Duration(
          seconds: 30,
        ),
      );

      final dynamic decoded = jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map &&
          decoded['success'] == true) {
        final dynamic raw = decoded['data'];

        final List<Map<String, dynamic>> loaded = raw is List
            ? raw
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(
                    item,
                  ),
                )
                .toList()
            : <Map<String, dynamic>>[];

        if (!mounted) {
          return;
        }

        setState(() {
          apps = loaded;
          isLoading = false;
        });

        return;
      }

      throw Exception(
        decoded is Map
            ? (decoded['message']?.toString() ?? 'Unable to load Mini Apps.')
            : 'Unable to load Mini Apps.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        errorMessage = 'Unable to load Mini Apps right now.';
      });
    }
  }

  List<String> get categories {
    final values = <String>{
      'All',
      ...apps.map(
        (app) => app['category']?.toString() ?? 'Services',
      ),
    }.toList();

    return values;
  }

  List<Map<String, dynamic>> get filteredApps {
    return apps.where((app) {
      final name = app['name']?.toString().toLowerCase() ?? '';

      final description = app['description']?.toString().toLowerCase() ?? '';

      final category = app['category']?.toString() ?? 'Services';

      final q = searchText.trim().toLowerCase();

      final matchesSearch =
          q.isEmpty || name.contains(q) || description.contains(q);

      final matchesCategory =
          selectedCategory == 'All' || category == selectedCategory;

      return matchesSearch && matchesCategory;
    }).toList();
  }

  IconData iconFor(
    String? icon,
  ) {
    switch (icon) {
      case 'credit_card':
        return Icons.credit_card_rounded;

      case 'volunteer_activism':
        return Icons.volunteer_activism_rounded;

      case 'business':
        return Icons.business_center_rounded;

      case 'local_shipping':
        return Icons.local_shipping_rounded;

      case 'signal_cellular_alt':
        return Icons.signal_cellular_alt_rounded;

      case 'groups':
        return Icons.groups_rounded;

      case 'storefront':
        return Icons.storefront_rounded;

      case 'directions_car':
        return Icons.directions_car_rounded;

      default:
        return Icons.apps_rounded;
    }
  }

  void openApp(
    Map<String, dynamic> app,
  ) {
    final status = app['status']?.toString() ?? 'ACTIVE';

    if (status != 'ACTIVE') {
      return;
    }

    final Widget? screen = miniAppScreenForRouteKey(
      app['routeKey']?.toString() ?? '',
    );

    if (screen == null) {
      return;
    }

    Navigator.of(context).push(
      MaterialPageRoute<void>(
        settings: RouteSettings(
          name: '/mini-apps/${app['slug'] ?? app['routeKey']}',
        ),
        builder: (_) => screen,
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF101828),
        title: const Text(
          'Mini Apps',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: loadMiniApps,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadMiniApps,
        child: isLoading
            ? const Center(
                child: CircularProgressIndicator(),
              )
            : errorMessage.isNotEmpty
                ? ListView(
                    padding: const EdgeInsets.all(
                      24,
                    ),
                    children: [
                      const SizedBox(
                        height: 100,
                      ),
                      Icon(
                        Icons.cloud_off_rounded,
                        size: 58,
                        color: Colors.grey.shade500,
                      ),
                      const SizedBox(
                        height: 16,
                      ),
                      Text(
                        errorMessage,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(
                        height: 20,
                      ),
                      FilledButton(
                        onPressed: loadMiniApps,
                        child: const Text(
                          'Try Again',
                        ),
                      ),
                    ],
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(
                      20,
                      20,
                      20,
                      36,
                    ),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(
                          20,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(
                            0xFF08783E,
                          ),
                          borderRadius: BorderRadius.circular(
                            24,
                          ),
                        ),
                        child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              Icons.apps_rounded,
                              color: Colors.white,
                              size: 34,
                            ),
                            SizedBox(
                              height: 16,
                            ),
                            Text(
                              'ServicePay Mini Apps',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(
                              height: 8,
                            ),
                            Text(
                              'One ServicePay account. Many services and digital experiences.',
                              style: TextStyle(
                                color: Color(
                                  0xFFE3F8EA,
                                ),
                                fontSize: 14,
                                height: 1.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(
                        height: 20,
                      ),
                      TextField(
                        onChanged: (value) {
                          setState(() {
                            searchText = value;
                          });
                        },
                        decoration: InputDecoration(
                          hintText: 'Search Mini Apps',
                          prefixIcon: const Icon(
                            Icons.search_rounded,
                          ),
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(
                              18,
                            ),
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                      const SizedBox(
                        height: 16,
                      ),
                      SizedBox(
                        height: 42,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: categories.length,
                          separatorBuilder: (_, __) => const SizedBox(
                            width: 8,
                          ),
                          itemBuilder: (context, index) {
                            final category = categories[index];

                            final selected = category == selectedCategory;

                            return ChoiceChip(
                              label: Text(category),
                              selected: selected,
                              onSelected: (_) {
                                setState(() {
                                  selectedCategory = category;
                                });
                              },
                            );
                          },
                        ),
                      ),
                      const SizedBox(
                        height: 24,
                      ),
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'Discover',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          Text(
                            '${filteredApps.length} apps',
                            style: TextStyle(
                              color: Colors.grey.shade600,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(
                        height: 14,
                      ),
                      GridView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        itemCount: filteredApps.length,
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                          childAspectRatio: 0.92,
                        ),
                        itemBuilder: (context, index) {
                          final app = filteredApps[index];

                          final name = app['name']?.toString() ?? 'Mini App';

                          final description =
                              app['description']?.toString() ?? '';

                          final status = app['status']?.toString() ?? 'ACTIVE';

                          final isComingSoon = status != 'ACTIVE';
                           final hasDestination =
                               miniAppScreenForRouteKey(
                                 app['routeKey']?.toString() ?? '',
                               ) !=
                               null;
                           final isUnavailable =
                               isComingSoon || !hasDestination;

                          return InkWell(
                             key: Key(
                               'mini-app-${app['slug'] ?? index}',
                             ),
                            borderRadius: BorderRadius.circular(
                              22,
                            ),
                             onTap: isUnavailable
                                 ? null
                                 : () => openApp(app),
                            child: Container(
                              padding: const EdgeInsets.all(
                                16,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(
                                  22,
                                ),
                                border: Border.all(
                                  color: const Color(
                                    0xFFE7ECE9,
                                  ),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    width: 52,
                                    height: 52,
                                    decoration: BoxDecoration(
                                      color: const Color(
                                        0xFFEAF7F0,
                                      ),
                                      borderRadius: BorderRadius.circular(
                                        16,
                                      ),
                                    ),
                                    child: Icon(
                                      iconFor(
                                        app['icon']?.toString(),
                                      ),
                                      color: const Color(
                                        0xFF08783E,
                                      ),
                                    ),
                                  ),
                                  const Spacer(),
                                  Text(
                                    name,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(
                                    height: 6,
                                  ),
                                  Text(
                                    description,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      height: 1.35,
                                      color: Colors.grey.shade600,
                                    ),
                                  ),
                                  const SizedBox(
                                    height: 10,
                                  ),
                                  Text(
                                     isUnavailable
                                         ? 'Coming soon'
                                         : 'Available',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                       color: isUnavailable
                                          ? Colors.orange.shade800
                                          : const Color(
                                              0xFF08783E,
                                            ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ],
                  ),
      ),
    );
  }
}
