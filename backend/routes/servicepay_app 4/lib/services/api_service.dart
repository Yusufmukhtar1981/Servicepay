import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static Future<Map<String,String>> _headers() async {
    final prefs=await SharedPreferences.getInstance();
    final token=prefs.getString('auth_token') ?? '';
    return {'Content-Type':'application/json','Authorization':'Bearer $token'};
  }
  static Future<Map<String,dynamic>> buyAirtime({required String network,required String phone,required String amount}) async {
    final response=await http.post(Uri.parse('$baseUrl/clubkonnect/airtime'),headers:await _headers(),body:jsonEncode({'network':network,'phone':phone,'amount':amount}));
    final decoded=jsonDecode(response.body);
    if(decoded is Map<String,dynamic>) return decoded;
    return {'success':false,'message':'Invalid server response.'};
  }
}
