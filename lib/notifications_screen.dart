import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  bool isUpdating = false;

  String errorMessage = '';
  int unreadCount = 0;

  List<Map<String, dynamic>> notifications = [];

  @override
  void initState() {
    super.initState();
    loadNotifications();
  }

  Future<String?> _getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token');
  }

  Future<void> loadNotifications() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        if (!mounted) return;

        setState(() {
          isLoading = false;
          errorMessage = 'Your login session has expired. Please log in again.';
        });
        return;
      }

      final response = await http.get(
        Uri.parse('$baseUrl/notifications'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 30));

      final Map<String, dynamic> data =
          jsonDecode(response.body) as Map<String, dynamic>;

      if (!mounted) return;

      if (response.statusCode == 200 && data['success'] == true) {
        final List<dynamic> notificationList =
            data['notifications'] as List<dynamic>? ?? [];

        setState(() {
          notifications = notificationList
              .map(
                (item) => Map<String, dynamic>.from(
                  item as Map,
                ),
              )
              .toList();

          unreadCount = data['unreadCount'] is int
              ? data['unreadCount'] as int
              : int.tryParse('${data['unreadCount']}') ?? 0;

          isLoading = false;
          errorMessage = '';
        });
      } else {
        setState(() {
          isLoading = false;
          errorMessage =
              data['message']?.toString() ??
              'Unable to load notifications.';
        });
      }
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = 'Unable to connect to the server.';
      });
    }
  }

  Future<void> markAsRead(String notificationId) async {
    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );
        return;
      }

      final response = await http.put(
        Uri.parse('$baseUrl/notifications/read/$notificationId'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 30));

      final Map<String, dynamic> data =
          jsonDecode(response.body) as Map<String, dynamic>;

      if (!mounted) return;

      if (response.statusCode == 200 && data['success'] == true) {
        setState(() {
          final index = notifications.indexWhere(
            (notification) =>
                notification['_id']?.toString() == notificationId,
          );

          if (index != -1) {
            notifications[index]['isRead'] = true;
            notifications[index]['readAt'] =
                DateTime.now().toIso8601String();
          }

          if (unreadCount > 0) {
            unreadCount--;
          }
        });
      } else {
        _showMessage(
          data['message']?.toString() ??
              'Unable to update notification.',
          isError: true,
        );
      }
    } catch (error) {
      if (!mounted) return;

      _showMessage(
        'Unable to connect to the server.',
        isError: true,
      );
    }
  }

  Future<void> markAllAsRead() async {
    if (unreadCount == 0 || isUpdating) return;

    setState(() {
      isUpdating = true;
    });

    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        if (!mounted) return;

        setState(() {
          isUpdating = false;
        });

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );
        return;
      }

      final response = await http.put(
        Uri.parse('$baseUrl/notifications/read-all'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 30));

      final Map<String, dynamic> data =
          jsonDecode(response.body) as Map<String, dynamic>;

      if (!mounted) return;

      if (response.statusCode == 200 && data['success'] == true) {
        setState(() {
          for (final notification in notifications) {
            notification['isRead'] = true;
            notification['readAt'] =
                DateTime.now().toIso8601String();
          }

          unreadCount = 0;
          isUpdating = false;
        });

        _showMessage('All notifications marked as read.');
      } else {
        setState(() {
          isUpdating = false;
        });

        _showMessage(
          data['message']?.toString() ??
              'Unable to update notifications.',
          isError: true,
        );
      }
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isUpdating = false;
      });

      _showMessage(
        'Unable to connect to the server.',
        isError: true,
      );
    }
  }

  Future<void> deleteNotification(String notificationId) async {
    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );
        return;
      }

      final notification = notifications.firstWhere(
        (item) => item['_id']?.toString() == notificationId,
        orElse: () => <String, dynamic>{},
      );

      final wasUnread = notification['isRead'] != true;

      final response = await http.delete(
        Uri.parse('$baseUrl/notifications/$notificationId'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 30));

      final Map<String, dynamic> data =
          jsonDecode(response.body) as Map<String, dynamic>;

      if (!mounted) return;

      if (response.statusCode == 200 && data['success'] == true) {
        setState(() {
          notifications.removeWhere(
            (item) => item['_id']?.toString() == notificationId,
          );

          if (wasUnread && unreadCount > 0) {
            unreadCount--;
          }
        });

        _showMessage('Notification deleted.');
      } else {
        _showMessage(
          data['message']?.toString() ??
              'Unable to delete notification.',
          isError: true,
        );
      }
    } catch (error) {
      if (!mounted) return;

      _showMessage(
        'Unable to connect to the server.',
        isError: true,
      );
    }
  }

  Future<void> deleteAllNotifications() async {
    if (notifications.isEmpty || isUpdating) return;

    final shouldDelete = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Delete all notifications?'),
          content: const Text(
            'This action will permanently delete all your notifications.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext, false);
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext, true);
              },
              child: const Text('Delete All'),
            ),
          ],
        );
      },
    );

    if (shouldDelete != true) return;

    setState(() {
      isUpdating = true;
    });

    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        if (!mounted) return;

        setState(() {
          isUpdating = false;
        });

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );
        return;
      }

      final response = await http.delete(
        Uri.parse('$baseUrl/notifications'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 30));

      final Map<String, dynamic> data =
          jsonDecode(response.body) as Map<String, dynamic>;

      if (!mounted) return;

      if (response.statusCode == 200 && data['success'] == true) {
        setState(() {
          notifications.clear();
          unreadCount = 0;
          isUpdating = false;
        });

        _showMessage('All notifications deleted.');
      } else {
        setState(() {
          isUpdating = false;
        });

        _showMessage(
          data['message']?.toString() ??
              'Unable to delete notifications.',
          isError: true,
        );
      }
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isUpdating = false;
      });

      _showMessage(
        'Unable to connect to the server.',
        isError: true,
      );
    }
  }

  void _showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).hideCurrentSnackBar();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red : Colors.green,
      ),
    );
  }

  String formatDate(dynamic value) {
    if (value == null) return '';

    final date = DateTime.tryParse(value.toString());

    if (date == null) return '';

    final localDate = date.toLocal();

    final day = localDate.day.toString().padLeft(2, '0');
    final month = localDate.month.toString().padLeft(2, '0');
    final year = localDate.year.toString();

    final hour = localDate.hour.toString().padLeft(2, '0');
    final minute = localDate.minute.toString().padLeft(2, '0');

    return '$day/$month/$year $hour:$minute';
  }

  IconData getNotificationIcon(String type) {
    switch (type.toUpperCase()) {
      case 'DELIVERY':
        return Icons.local_shipping_outlined;

      case 'TRANSFER':
        return Icons.swap_horiz;

      case 'WALLET':
        return Icons.account_balance_wallet_outlined;

      case 'AIRTIME':
        return Icons.phone_android;

      case 'DATA':
        return Icons.wifi;

      case 'CABLE':
        return Icons.tv_outlined;

      case 'ELECTRICITY':
        return Icons.bolt_outlined;

      case 'EXAM_PIN':
        return Icons.school_outlined;

      case 'ID_VERIFICATION':
        return Icons.verified_user_outlined;

      default:
        return Icons.notifications_outlined;
    }
  }

  Color getNotificationColor(String type) {
    switch (type.toUpperCase()) {
      case 'DELIVERY':
        return Colors.orange;

      case 'TRANSFER':
        return Colors.blue;

      case 'WALLET':
        return Colors.green;

      case 'AIRTIME':
        return Colors.purple;

      case 'DATA':
        return Colors.indigo;

      case 'CABLE':
        return Colors.deepOrange;

      case 'ELECTRICITY':
        return Colors.amber.shade800;

      case 'EXAM_PIN':
        return Colors.teal;

      case 'ID_VERIFICATION':
        return Colors.blueGrey;

      default:
        return Colors.grey.shade700;
    }
  }

  Widget buildNotificationCard(Map<String, dynamic> notification) {
    final notificationId = notification['_id']?.toString() ?? '';
    final title =
        notification['title']?.toString() ?? 'Notification';
    final message = notification['message']?.toString() ?? '';
    final type = notification['type']?.toString() ?? 'GENERAL';
    final isRead = notification['isRead'] == true;

    final color = getNotificationColor(type);

    return Dismissible(
      key: ValueKey(notificationId),
      direction: DismissDirection.endToStart,
      confirmDismiss: (_) async {
        return await showDialog<bool>(
              context: context,
              builder: (dialogContext) {
                return AlertDialog(
                  title: const Text('Delete notification?'),
                  content: const Text(
                    'Are you sure you want to delete this notification?',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () {
                        Navigator.pop(dialogContext, false);
                      },
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      onPressed: () {
                        Navigator.pop(dialogContext, true);
                      },
                      child: const Text('Delete'),
                    ),
                  ],
                );
              },
            ) ??
            false;
      },
      onDismissed: (_) {
        deleteNotification(notificationId);
      },
      background: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 24),
        alignment: Alignment.centerRight,
        decoration: BoxDecoration(
          color: Colors.red,
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Icon(
          Icons.delete_outline,
          color: Colors.white,
        ),
      ),
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        elevation: isRead ? 0 : 2,
        color: isRead
            ? Colors.white
            : color.withValues(alpha: 0.08),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: isRead
                ? Colors.grey.shade200
                : color.withValues(alpha: 0.35),
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            if (!isRead && notificationId.isNotEmpty) {
              markAsRead(notificationId);
            }
          },
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    getNotificationIcon(type),
                    color: color,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment:
                            CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              title,
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: isRead
                                    ? FontWeight.w600
                                    : FontWeight.bold,
                              ),
                            ),
                          ),
                          if (!isRead)
                            Container(
                              width: 9,
                              height: 9,
                              margin: const EdgeInsets.only(
                                top: 5,
                                left: 8,
                              ),
                              decoration: BoxDecoration(
                                color: color,
                                shape: BoxShape.circle,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        message,
                        style: TextStyle(
                          fontSize: 14,
                          height: 1.4,
                          color: Colors.grey.shade700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Text(
                            type.replaceAll('_', ' '),
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: color,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            formatDate(notification['createdAt']),
                            style: TextStyle(
                              fontSize: 11,
                              color: Colors.grey.shade600,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey.shade50,
      appBar: AppBar(
        title: Row(
          children: [
            const Text('Notifications'),
            if (unreadCount > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 3,
                ),
                decoration: BoxDecoration(
                  color: Colors.red,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  unreadCount.toString(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            enabled: !isUpdating,
            onSelected: (value) {
              if (value == 'read-all') {
                markAllAsRead();
              } else if (value == 'delete-all') {
                deleteAllNotifications();
              }
            },
            itemBuilder: (context) {
              return [
                PopupMenuItem<String>(
                  value: 'read-all',
                  enabled: unreadCount > 0,
                  child: const Row(
                    children: [
                      Icon(Icons.done_all),
                      SizedBox(width: 10),
                      Text('Mark all as read'),
                    ],
                  ),
                ),
                PopupMenuItem<String>(
                  value: 'delete-all',
                  enabled: notifications.isNotEmpty,
                  child: const Row(
                    children: [
                      Icon(
                        Icons.delete_outline,
                        color: Colors.red,
                      ),
                      SizedBox(width: 10),
                      Text(
                        'Delete all',
                        style: TextStyle(color: Colors.red),
                      ),
                    ],
                  ),
                ),
              ];
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadNotifications,
        child: isLoading
            ? const Center(
                child: CircularProgressIndicator(),
              )
            : errorMessage.isNotEmpty
            ? ListView(
                physics:
                    const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                children: [
                  const SizedBox(height: 100),
                  Icon(
                    Icons.cloud_off_outlined,
                    size: 70,
                    color: Colors.grey.shade400,
                  ),
                  const SizedBox(height: 20),
                  Text(
                    errorMessage,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 16,
                      color: Colors.grey.shade700,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Center(
                    child: FilledButton.icon(
                      onPressed: loadNotifications,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Try Again'),
                    ),
                  ),
                ],
              )
            : notifications.isEmpty
            ? ListView(
                physics:
                    const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                children: [
                  const SizedBox(height: 120),
                  Icon(
                    Icons.notifications_none,
                    size: 80,
                    color: Colors.grey.shade400,
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'No notifications yet',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Important account updates will appear here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.grey.shade600,
                    ),
                  ),
                ],
              )
            : ListView.builder(
                physics:
                    const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(
                  16,
                  16,
                  16,
                  30,
                ),
                itemCount: notifications.length,
                itemBuilder: (context, index) {
                  return buildNotificationCard(
                    notifications[index],
                  );
                },
              ),
      ),
    );
  }
}