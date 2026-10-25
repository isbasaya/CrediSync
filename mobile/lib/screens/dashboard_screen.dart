import 'package:flutter/material.dart';
import '../services/credit_profile_service.dart';
import '../services/auth_service.dart';
import '../services/api_client.dart';
import '../theme/app_theme.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  CreditProfile? _profile;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    try {
      final profile = await CreditProfileService.getProfile();
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _error = profile == null ? 'No reports yet. Pull down to fetch your credit reports from all three bureaus.' : null;
        _loading = false;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    try {
      final profile = await CreditProfileService.refreshProfile();
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _loading = false;
        _error = null;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              final navigator = Navigator.of(context);
              await AuthService.logout();
              navigator.pushReplacementNamed('/login');
            },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF0B7A70)))
          : _error != null
              ? RefreshIndicator(
                  color: const Color(0xFF0B7A70),
                  onRefresh: _refresh,
                  child: ListView(
                    padding: const EdgeInsets.all(32),
                    children: [Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF6B7684)))],
                  ),
                )
              : RefreshIndicator(
                  color: const Color(0xFF0B7A70),
                  onRefresh: _refresh,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _buildScoreCard(),
                        const SizedBox(height: 16),
                        _buildStatsRow(),
                        const SizedBox(height: 16),
                        _buildBankReadiness(),
                      ],
                    ),
                  ),
                ),
    );
  }

  Widget _buildScoreCard() {
    final score = _profile?.unifiedScore ?? 0;
    final band = _profile?.unifiedScoreBand ?? '—';

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: const Color(0xFFEFFCF9),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        children: [
          const Text('Credit Score', style: TextStyle(color: Color(0xFF6B7684), fontSize: 14)),
          const SizedBox(height: 8),
          Text(
            score > 0 ? '$score' : '—',
            style: const TextStyle(
              color: Color(0xFF12181F),
              fontSize: 56,
              fontWeight: FontWeight.bold,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 8),
          Builder(builder: (context) {
            final bandTheme = ScoreBandTheme.fromBandString(band == '—' ? null : band);
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: bandTheme.background,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                band.replaceAll('_', ' ').toUpperCase(),
                style: TextStyle(color: bandTheme.foreground, fontSize: 12, fontWeight: FontWeight.w600),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildStatsRow() {
    return Row(
      children: [
        Expanded(
          child: _statCard('Accounts', '${_profile?.totalAccounts ?? 0}'),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _statCard('Open', '${_profile?.openAccounts ?? 0}'),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _statCard('Adverse', '${_profile?.adverseAccounts ?? 0}', color: const Color(0xFFB91C1C)),
        ),
      ],
    );
  }

  Widget _statCard(String label, String value, {Color? color}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E6EA)),
      ),
      child: Column(
        children: [
          Text(label, style: const TextStyle(color: Color(0xFF6B7684), fontSize: 12)),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              color: color ?? const Color(0xFF12181F),
              fontSize: 24,
              fontWeight: FontWeight.bold,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBankReadiness() {
    final score = _profile?.bankReadinessScore;
    final tier = _profile?.bankReadinessTier;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E6EA)),
      ),
      child: Row(
        children: [
          const Icon(Icons.account_balance, color: Color(0xFF0B7A70)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Bank Readiness', style: TextStyle(color: Color(0xFF12181F), fontSize: 14)),
                Text(
                  tier != null ? tier.replaceAll('_', ' ').toUpperCase() : 'Not calculated',
                  style: const TextStyle(color: Color(0xFF6B7684), fontSize: 12),
                ),
              ],
            ),
          ),
          if (score != null)
            Text(
              '${score.toStringAsFixed(0)}/100',
              style: const TextStyle(
                color: Color(0xFF0B7A70),
                fontSize: 18,
                fontWeight: FontWeight.bold,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
        ],
      ),
    );
  }
}
