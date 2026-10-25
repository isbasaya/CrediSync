import 'api_client.dart';

class AuthService {
  static Future<bool> isLoggedIn() async {
    if (!await ApiClient.hasSession()) return false;
    try {
      await ApiClient.get('/me');
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<String> currentPolicyVersion() async {
    final response = await ApiClient.get('/auth/policy');
    return response['popiaPolicyVersion'] as String;
  }

  static Future<AuthResult> login(String email, String password) async {
    final response = await ApiClient.post('/auth/login', body: {'email': email, 'password': password}, auth: false);
    await ApiClient.saveSession(response);
    return AuthResult.fromJson(response['user'] as Map<String, dynamic>);
  }

  static Future<AuthResult> signup({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    required String mobileNumber,
    required String saIdNumber,
    required String popiaPolicyVersion,
    required bool creditCheckConsent,
  }) async {
    final response = await ApiClient.post(
      '/auth/signup',
      auth: false,
      body: {
        'email': email,
        'password': password,
        'firstName': firstName,
        'lastName': lastName,
        'mobileNumber': mobileNumber,
        'saIdNumber': saIdNumber,
        'popiaConsent': true,
        'popiaPolicyVersion': popiaPolicyVersion,
        'creditCheckConsent': creditCheckConsent,
      },
    );
    await ApiClient.saveSession(response);
    return AuthResult.fromJson(response['user'] as Map<String, dynamic>);
  }

  static Future<void> logout() async {
    final refresh = await ApiClient.refreshToken();
    if (refresh != null) {
      try {
        await ApiClient.post('/auth/logout', body: {'refreshToken': refresh}, auth: false);
      } catch (_) {
        // Still clear local tokens; the server session expires on its own.
      }
    }
    await ApiClient.clearSession();
  }
}

class AuthResult {
  final String userId;
  final String email;
  final String firstName;
  final String lastName;
  final bool isVerified;

  AuthResult({required this.userId, required this.email, required this.firstName, required this.lastName, required this.isVerified});

  factory AuthResult.fromJson(Map<String, dynamic> user) => AuthResult(
        userId: user['id'] as String,
        email: user['email'] as String,
        firstName: user['first_name'] as String,
        lastName: user['last_name'] as String,
        isVerified: user['is_verified'] as bool? ?? false,
      );

  String get fullName => '$firstName $lastName';
}

/// Mirrors the server's SA ID check (13 digits, Luhn check digit) so typos are caught before submitting.
bool isValidSaIdNumber(String raw) {
  final id = raw.replaceAll(RegExp(r'\s'), '');
  if (!RegExp(r'^\d{13}$').hasMatch(id)) return false;
  var sum = 0;
  for (var i = 0; i < 13; i++) {
    var d = int.parse(id[12 - i]);
    if (i.isOdd) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 == 0;
}
