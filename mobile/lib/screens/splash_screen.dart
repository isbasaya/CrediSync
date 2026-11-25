import 'package:material_ui/material_ui.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              'CrediSync',
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    color: const Color(0xFF12181F),
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 16),
            const CircularProgressIndicator(
              color: Color(0xFF0B7A70),
            ),
          ],
        ),
      ),
    );
  }
}
