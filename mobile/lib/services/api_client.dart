import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class ApiError implements Exception {
  final int statusCode;
  final String code;
  final String message;

  ApiError(this.statusCode, this.message, {this.code = 'request_failed'});

  @override
  String toString() => 'ApiError($statusCode, $code): $message';
}

/// HTTP client for the CrediSync API gateway.
///
/// * Tokens live in the platform keystore (Android Keystore / iOS Keychain)
///   via flutter_secure_storage — never in plain SharedPreferences.
/// * Requests identify as a native client (`X-Client: mobile`) so the
///   gateway returns tokens in the body instead of browser cookies.
/// * A 401 triggers one refresh-token rotation and a retry.
/// * Release builds refuse a non-HTTPS API_BASE_URL.
class ApiClient {
  static const String _configuredBaseUrl = String.fromEnvironment('API_BASE_URL');

  /// Android emulators reach the host machine at 10.0.2.2, not localhost.
  static String get baseUrl {
    if (_configuredBaseUrl.isNotEmpty) {
      if (kReleaseMode && !_configuredBaseUrl.startsWith('https://')) {
        throw StateError('API_BASE_URL must use https in release builds');
      }
      return _configuredBaseUrl;
    }
    if (kReleaseMode) throw StateError('API_BASE_URL must be set for release builds (--dart-define)');
    return defaultTargetPlatform == TargetPlatform.android ? 'http://10.0.2.2:4000/api' : 'http://localhost:4000/api';
  }

  static const _storage = FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));
  static const _accessKey = 'cs_access_token';
  static const _refreshKey = 'cs_refresh_token';
  static const _timeout = Duration(seconds: 30);

  static Future<void> saveSession(Map<String, dynamic> body) async {
    final access = body['accessToken'] as String?;
    final refresh = body['refreshToken'] as String?;
    if (access != null) await _storage.write(key: _accessKey, value: access);
    if (refresh != null) await _storage.write(key: _refreshKey, value: refresh);
  }

  static Future<String?> refreshToken() => _storage.read(key: _refreshKey);

  static Future<void> clearSession() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }

  static Future<bool> hasSession() async => (await _storage.read(key: _refreshKey)) != null;

  static Future<Map<String, String>> _headers({bool auth = true}) async {
    final token = auth ? await _storage.read(key: _accessKey) : null;
    return {
      'Content-Type': 'application/json',
      'X-Client': 'mobile',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  static Future<bool> _refresh() async {
    final refresh = await refreshToken();
    if (refresh == null) return false;
    try {
      final response = await http
          .post(Uri.parse('$baseUrl/auth/refresh'), headers: await _headers(auth: false), body: jsonEncode({'refreshToken': refresh}))
          .timeout(_timeout);
      if (response.statusCode != 200) {
        await clearSession();
        return false;
      }
      await saveSession(jsonDecode(response.body) as Map<String, dynamic>);
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<dynamic> _send(String method, String path, {Object? body, bool auth = true, bool retried = false}) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = await _headers(auth: auth);
    final encoded = body == null ? null : jsonEncode(body);

    late http.Response response;
    try {
      response = await switch (method) {
        'GET' => http.get(uri, headers: headers),
        'PATCH' => http.patch(uri, headers: headers, body: encoded),
        'DELETE' => http.delete(uri, headers: headers),
        _ => http.post(uri, headers: headers, body: encoded),
      }
          .timeout(_timeout);
    } catch (_) {
      throw ApiError(0, 'We can’t reach CrediSync. Check your connection and try again.', code: 'network');
    }

    if (response.statusCode == 401 && auth && !retried && !path.startsWith('/auth/')) {
      if (await _refresh()) return _send(method, path, body: body, auth: auth, retried: true);
    }

    if (response.statusCode >= 400) {
      var code = 'request_failed';
      var message = 'Something went wrong. Please try again.';
      try {
        final decoded = jsonDecode(response.body) as Map<String, dynamic>;
        code = decoded['error'] as String? ?? code;
        message = friendlyMessage(code) ?? (response.statusCode < 500 ? decoded['message'] as String? ?? message : message);
      } catch (_) {}
      throw ApiError(response.statusCode, message, code: code);
    }

    if (response.statusCode == 204 || response.body.isEmpty) return <String, dynamic>{};
    return jsonDecode(response.body);
  }

  static Future<Map<String, dynamic>> get(String path) async => (await _send('GET', path)) as Map<String, dynamic>;
  static Future<List<dynamic>> getList(String path) async => (await _send('GET', path)) as List<dynamic>;
  static Future<Map<String, dynamic>> post(String path, {Map<String, dynamic>? body, bool auth = true}) async =>
      (await _send('POST', path, body: body, auth: auth)) as Map<String, dynamic>;
  static Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) async =>
      (await _send('PATCH', path, body: body)) as Map<String, dynamic>;
  static Future<Map<String, dynamic>> delete(String path) async => (await _send('DELETE', path)) as Map<String, dynamic>;

  static String? friendlyMessage(String code) => const {
        'invalid_credentials': 'That email and password don’t match, or the account is temporarily locked.',
        'account_exists': 'An account already exists for these details. Try signing in.',
        'invalid_sa_id': 'That South African ID number isn’t valid.',
        'email_not_verified': 'Confirm your email address first — check your inbox for our link.',
        'credit_check_consent_required': 'Give CrediSync permission to request your credit reports first.',
        'refresh_too_soon': 'Your reports were refreshed recently. Try again in about an hour.',
        'dispute_already_open': 'There’s already an open dispute for this account.',
        'rate_limit_exceeded': 'Too many attempts. Please wait a minute.',
        'evidence_pending': 'Finish or remove your uploads before sending.',
        'evidence_limit': 'You can attach up to 10 files to a dispute.',
        'evidence_upload_expired': 'This upload expired. Remove it and add the file again.',
        'evidence_not_uploaded': 'We haven’t received this file yet. Try uploading it again.',
        'not_editable': 'This dispute has already been sent, so it can’t be changed.',
      }[code];
}
