import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static Future<Map<String, dynamic>> buyAirtime({
    required String network,
    required String phone,
    required String amount,
  }) async {
    final response = await http.post(
      Uri.parse("$baseUrl/clubkonnect/airtime"),
      headers: {
        "Content-Type": "application/json",
      },
      body: jsonEncode({
        "network": network,
        "phone": phone,
        "amount": amount,
      }),
    );

    return jsonDecode(response.body);
  }
}
