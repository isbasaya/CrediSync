import 'package:material_ui/material_ui.dart';
import 'dashboard_screen.dart';
import 'credit_profile_screen.dart';
import 'disputes_screen.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _currentIndex = 0;

  final _screens = const [
    DashboardScreen(),
    CreditProfileScreen(),
    DisputesScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_currentIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (i) => setState(() => _currentIndex = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined, color: Color(0xFF6B7684)),
            selectedIcon: Icon(Icons.dashboard, color: Color(0xFF075C53)),
            label: 'Dashboard',
          ),
          NavigationDestination(
            icon: Icon(Icons.credit_score_outlined, color: Color(0xFF6B7684)),
            selectedIcon: Icon(Icons.credit_score, color: Color(0xFF075C53)),
            label: 'Credit',
          ),
          NavigationDestination(
            icon: Icon(Icons.gavel_outlined, color: Color(0xFF6B7684)),
            selectedIcon: Icon(Icons.gavel, color: Color(0xFF075C53)),
            label: 'Disputes',
          ),
        ],
      ),
    );
  }
}
