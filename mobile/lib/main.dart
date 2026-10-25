import 'package:flutter/material.dart';
import 'screens/splash_screen.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/signup_screen.dart';
import 'screens/app_shell.dart';
import 'screens/dashboard_screen.dart';
import 'screens/credit_profile_screen.dart';
import 'screens/disputes_screen.dart';
import 'screens/dispute_create_screen.dart';
import 'services/auth_service.dart';
import 'theme/app_theme.dart';

void main() {
  runApp(const CrediSyncApp());
}

class CrediSyncApp extends StatelessWidget {
  const CrediSyncApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CrediSync',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      home: const _AppRoot(),
      routes: {
        '/login': (context) => const LoginScreen(),
        '/signup': (context) => const SignupScreen(),
        '/app': (context) => const AppShell(),
        '/dashboard': (context) => const DashboardScreen(),
        '/credit-profile': (context) => const CreditProfileScreen(),
        '/disputes': (context) => const DisputesScreen(),
        '/dispute-create': (context) => const DisputeCreateScreen(),
      },
    );
  }
}

class _AppRoot extends StatelessWidget {
  const _AppRoot();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: AuthService.isLoggedIn(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const SplashScreen();
        }
        return snapshot.data == true ? const AppShell() : const LoginScreen();
      },
    );
  }
}
