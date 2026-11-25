import 'package:material_ui/material_ui.dart';
import '../services/credit_profile_service.dart';
import '../services/api_client.dart';
import '../theme/app_theme.dart';

class CreditProfileScreen extends StatefulWidget {
  const CreditProfileScreen({super.key});

  @override
  State<CreditProfileScreen> createState() => _CreditProfileScreenState();
}

class _CreditProfileScreenState extends State<CreditProfileScreen> {
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
        _error = profile == null ? 'No reports yet. Fetch them from the Dashboard.' : null;
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

  String _bureauIcon(String bureau) {
    switch (bureau) {
      case 'transunion':
        return 'TU';
      case 'experian':
        return 'EX';
      case 'xds':
        return 'XD';
      default:
        return '—';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Credit Profile'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF0B7A70)))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Color(0xFF6B7684))))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _buildBureauComparison(),
                      const SizedBox(height: 24),
                      _buildDerogatorySection(),
                    ],
                  ),
                ),
    );
  }

  Widget _buildBureauComparison() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E6EA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Bureau Scores', style: TextStyle(color: Color(0xFF12181F), fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),
          ...(_profile?.bureauScores ?? []).map((bs) => _bureauScoreRow(bs.bureau, bs.score, bs.scoreBand)),
        ],
      ),
    );
  }

  Widget _bureauScoreRow(String bureau, int? score, String? band) {
    final bandTheme = ScoreBandTheme.fromBandString(band);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: const Color(0xFFEFFCF9),
              borderRadius: BorderRadius.circular(8),
            ),
            alignment: Alignment.center,
            child: Text(_bureauIcon(bureau), style: const TextStyle(color: Color(0xFF075C53), fontSize: 12, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(bureau[0].toUpperCase() + bureau.substring(1), style: const TextStyle(color: Color(0xFF12181F), fontSize: 14)),
                if (band != null)
                  Text(band.replaceAll('_', ' '), style: TextStyle(color: bandTheme.foreground, fontSize: 12)),
              ],
            ),
          ),
          Text(
            score?.toString() ?? '—',
            style: const TextStyle(
              color: Color(0xFF12181F),
              fontSize: 20,
              fontWeight: FontWeight.bold,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDerogatorySection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E6EA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Account Summary', style: TextStyle(color: Color(0xFF12181F), fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),
          _summaryRow('Total Accounts', '${_profile?.totalAccounts ?? 0}'),
          _summaryRow('Open Accounts', '${_profile?.openAccounts ?? 0}'),
          _summaryRow('Adverse Accounts', '${_profile?.adverseAccounts ?? 0}', color: const Color(0xFFB91C1C)),
          _summaryRow('Judgements', '${_profile?.judgementsCount ?? 0}'),
          _summaryRow('Defaults', '${_profile?.defaultsCount ?? 0}'),
          _summaryRow('Enquiries (12m)', '${_profile?.enquiriesLast12m ?? 0}'),
          const Divider(color: Color(0xFFE2E6EA), height: 24),
          _summaryRow('Total Exposure', 'R ${(_profile?.totalCreditExposure ?? 0).toStringAsFixed(2)}'),
        ],
      ),
    );
  }

  Widget _summaryRow(String label, String value, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Color(0xFF6B7684), fontSize: 14)),
          Text(
            value,
            style: TextStyle(
              color: color ?? const Color(0xFF12181F),
              fontSize: 14,
              fontWeight: FontWeight.w500,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}
