import 'api_client.dart';

class AuthService {
  static Future<bool> isLoggedIn() async {
    try {
      await ApiClient.get('/auth/me');
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<AuthResult> login(String email, String password) async {
    final response = await ApiClient.post('/auth/login', body: {
      'email': email,
      'password': password,
    });

    final token = response['accessToken'] as String;
    await ApiClient.setToken(token);

    final user = response['user'] as Map<String, dynamic>;
    return AuthResult(
      token: token,
      userId: user['id'] as String,
      email: user['email'] as String,
      firstName: user['first_name'] as String,
      lastName: user['last_name'] as String,
    );
  }

  static Future<AuthResult> signup({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    required String mobileNumber,
    required String saIdHash,
    required bool popiaConsent,
  }) async {
    final response = await ApiClient.post('/auth/signup', body: {
      'email': email,
      'password': password,
      'firstName': firstName,
      'lastName': lastName,
      'mobileNumber': mobileNumber,
      'saIdHash': saIdHash,
      'popiaConsent': popiaConsent,
    });

    final token = response['accessToken'] as String;
    await ApiClient.setToken(token);

    final user = response['user'] as Map<String, dynamic>;
    return AuthResult(
      token: token,
      userId: user['id'] as String,
      email: user['email'] as String,
      firstName: user['first_name'] as String,
      lastName: user['last_name'] as String,
    );
  }

  static Future<void> logout() async {
    await ApiClient.clearToken();
  }
}

class AuthResult {
  final String token;
  final String userId;
  final String email;
  final String firstName;
  final String lastName;

  AuthResult({
    required this.token,
    required this.userId,
    required this.email,
    required this.firstName,
    required this.lastName,
  });

  String get fullName => '$firstName $lastName';
}
