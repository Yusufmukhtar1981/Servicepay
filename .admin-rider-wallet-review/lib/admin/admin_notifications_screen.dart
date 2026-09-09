import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminNotificationsScreen extends StatefulWidget {
  const AdminNotificationsScreen({super.key});

  @override
  State<AdminNotificationsScreen> createState() =>
      _AdminNotificationsScreenState();
}

class _AdminNotificationsScreenState
    extends State<AdminNotificationsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final formKey = GlobalKey<FormState>();

  final userIdController = TextEditingController();
  final titleController = TextEditingController();
  final messageController = TextEditingController();

  bool sendToAllUsers = true;
  bool isSending = false;

  String selectedType = 'GENERAL';

  final List<String> notificationTypes = [
    'GENERAL',
    'DELIVERY',
    'TRANSFER',
    'WALLET',
    'AIRTIME',
    'DATA',
    'CABLE',
    'ELECTRICITY',
    'EXAM_PIN',
    'ID_VERIFICATION',
  ];

  @override
  void dispose() {
    userIdController.dispose();
    titleController.dispose();
    messageController.dispose();
    super.dispose();
  }

  Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token');
  }

  Map<String, dynamic> decodeResponse(String responseBody) {
    try {
      final decoded = jsonDecode(responseBody);

      if (decoded is Map<String, dynamic>) {
        return decoded;
      }

      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }

      return {
        'success': false,
        'message': 'Invalid server response.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'Invalid server response.',
      };
    }
  }

  Future<void> sendNotification() async {
    if (isSending) return;

    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      isSending = true;
    });

    try {
      final token = await getToken();

      if (token == null || token.isEmpty) {
        if (!mounted) return;

        setState(() {
          isSending = false;
        });

        showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );
        return;
      }

      final Uri endpoint;

      final Map<String, dynamic> requestBody = {
        'title': titleController.text.trim(),
        'message': messageController.text.trim(),
        'type': selectedType,
        'referenceType': selectedType,
      };

      if (sendToAllUsers) {
        endpoint = Uri.parse(
          '$baseUrl/notifications/broadcast',
        );
      } else {
        endpoint = Uri.parse(
          '$baseUrl/notifications/send',
        );

        requestBody['userId'] = userIdController.text.trim();
      }

      final response = await http
          .post(
            endpoint,
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode(requestBody),
          )
          .timeout(const Duration(seconds: 30));

      final data = decodeResponse(response.body);

      if (!mounted) return;

      setState(() {
        isSending = false;
      });

      if ((response.statusCode == 200 ||
              response.statusCode == 201) &&
          data['success'] == true) {
        final recipientCount = data['recipientCount'];

        final successMessage = sendToAllUsers &&
                recipientCount != null
            ? 'Notification sent to $recipientCount users.'
            : data['message']?.toString() ??
                'Notification sent successfully.';

        showMessage(successMessage);

        clearForm();
      } else {
        showMessage(
          data['message']?.toString() ??
              'Unable to send notification.',
          isError: true,
        );
      }
    } catch (_) {
      if (!mounted) return;

      setState(() {
        isSending = false;
      });

      showMessage(
        'Unable to connect to the server.',
        isError: true,
      );
    }
  }

  void clearForm() {
    titleController.clear();
    messageController.clear();
    userIdController.clear();

    setState(() {
      selectedType = 'GENERAL';
    });
  }

  void showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).hideCurrentSnackBar();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor:
            isError ? Colors.red : Colors.green,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  String formatType(String type) {
    return type
        .split('_')
        .map(
          (word) =>
              '${word[0]}${word.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  IconData getTypeIcon(String type) {
    switch (type) {
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

  Widget buildRecipientSelector() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: Colors.grey.shade200,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(
            child: buildRecipientButton(
              title: 'All Users',
              icon: Icons.groups_outlined,
              selected: sendToAllUsers,
              onTap: () {
                setState(() {
                  sendToAllUsers = true;
                });
              },
            ),
          ),
          const SizedBox(width: 5),
          Expanded(
            child: buildRecipientButton(
              title: 'Single User',
              icon: Icons.person_outline,
              selected: !sendToAllUsers,
              onTap: () {
                setState(() {
                  sendToAllUsers = false;
                });
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget buildRecipientButton({
    required String title,
    required IconData icon,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Material(
      color: selected ? Colors.green : Colors.transparent,
      borderRadius: BorderRadius.circular(11),
      child: InkWell(
        onTap: isSending ? null : onTap,
        borderRadius: BorderRadius.circular(11),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 13,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 19,
                color: selected
                    ? Colors.white
                    : Colors.grey.shade700,
              ),
              const SizedBox(width: 7),
              Flexible(
                child: Text(
                  title,
                  style: TextStyle(
                    color: selected
                        ? Colors.white
                        : Colors.grey.shade800,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget buildInformationCard() {
    final title = sendToAllUsers
        ? 'Broadcast Notification'
        : 'Direct Notification';

    final description = sendToAllUsers
        ? 'This notification will be sent to every active Servicepay user.'
        : 'Enter the MongoDB user ID of the customer who should receive this notification.';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.green.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: Colors.green.withValues(alpha: 0.25),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            sendToAllUsers
                ? Icons.campaign_outlined
                : Icons.person_pin_outlined,
            color: Colors.green.shade700,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Colors.green.shade800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  description,
                  style: TextStyle(
                    height: 1.4,
                    fontSize: 13,
                    color: Colors.grey.shade700,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('Send Notifications'),
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Clear form',
            onPressed: isSending ? null : clearForm,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: 0.05,
                      ),
                      blurRadius: 12,
                      offset: const Offset(0, 5),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Notification Recipient',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 14),
                    buildRecipientSelector(),
                    const SizedBox(height: 16),
                    buildInformationCard(),
                    if (!sendToAllUsers) ...[
                      const SizedBox(height: 18),
                      TextFormField(
                        controller: userIdController,
                        enabled: !isSending,
                        decoration: InputDecoration(
                          labelText: 'Customer User ID',
                          hintText:
                              'Enter MongoDB user ID',
                          prefixIcon: const Icon(
                            Icons.person_search_outlined,
                          ),
                          border: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(14),
                          ),
                        ),
                        validator: (value) {
                          if (sendToAllUsers) {
                            return null;
                          }

                          if (value == null ||
                              value.trim().isEmpty) {
                            return 'Customer user ID is required.';
                          }

                          if (value.trim().length != 24) {
                            return 'Enter a valid 24-character MongoDB user ID.';
                          }

                          return null;
                        },
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: 0.05,
                      ),
                      blurRadius: 12,
                      offset: const Offset(0, 5),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Notification Details',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 18),
                    DropdownButtonFormField<String>(
                      value: selectedType,
                      decoration: InputDecoration(
                        labelText: 'Notification Type',
                        prefixIcon: Icon(
                          getTypeIcon(selectedType),
                        ),
                        border: OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(14),
                        ),
                      ),
                      items: notificationTypes.map((type) {
                        return DropdownMenuItem<String>(
                          value: type,
                          child: Text(formatType(type)),
                        );
                      }).toList(),
                      onChanged: isSending
                          ? null
                          : (value) {
                              if (value == null) return;

                              setState(() {
                                selectedType = value;
                              });
                            },
                    ),
                    const SizedBox(height: 18),
                    TextFormField(
                      controller: titleController,
                      enabled: !isSending,
                      textCapitalization:
                          TextCapitalization.sentences,
                      decoration: InputDecoration(
                        labelText: 'Title',
                        hintText:
                            'Enter notification title',
                        prefixIcon: const Icon(
                          Icons.title,
                        ),
                        border: OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(14),
                        ),
                      ),
                      validator: (value) {
                        final title = value?.trim() ?? '';

                        if (title.isEmpty) {
                          return 'Notification title is required.';
                        }

                        if (title.length < 3) {
                          return 'Title must contain at least 3 characters.';
                        }

                        if (title.length > 100) {
                          return 'Title must not exceed 100 characters.';
                        }

                        return null;
                      },
                    ),
                    const SizedBox(height: 18),
                    TextFormField(
                      controller: messageController,
                      enabled: !isSending,
                      minLines: 5,
                      maxLines: 8,
                      textCapitalization:
                          TextCapitalization.sentences,
                      decoration: InputDecoration(
                        labelText: 'Message',
                        hintText:
                            'Enter notification message',
                        alignLabelWithHint: true,
                        border: OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(14),
                        ),
                      ),
                      validator: (value) {
                        final message = value?.trim() ?? '';

                        if (message.isEmpty) {
                          return 'Notification message is required.';
                        }

                        if (message.length < 5) {
                          return 'Message must contain at least 5 characters.';
                        }

                        if (message.length > 500) {
                          return 'Message must not exceed 500 characters.';
                        }

                        return null;
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 54,
                child: FilledButton.icon(
                  onPressed:
                      isSending ? null : sendNotification,
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.green,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(14),
                    ),
                  ),
                  icon: isSending
                      ? const SizedBox(
                          width: 21,
                          height: 21,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          sendToAllUsers
                              ? Icons.campaign_outlined
                              : Icons.send_outlined,
                        ),
                  label: Text(
                    isSending
                        ? 'Sending...'
                        : sendToAllUsers
                            ? 'Send to All Users'
                            : 'Send to Customer',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    );
  }
}