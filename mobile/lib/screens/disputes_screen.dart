import 'package:material_ui/material_ui.dart';
import '../services/dispute_service.dart';
import '../theme/app_theme.dart';
import 'dispute_review_screen.dart';

class DisputesScreen extends StatefulWidget {
  const DisputesScreen({super.key});

  @override
  State<DisputesScreen> createState() => _DisputesScreenState();
}

class _DisputesScreenState extends State<DisputesScreen> {
  List<Dispute> _disputes = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDisputes();
  }

  Future<void> _loadDisputes() async {
    try {
      final disputes = await DisputeService.getDisputes();
      setState(() {
        _disputes = disputes;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Could not load disputes';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Disputes'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final changed = await Navigator.pushNamed(context, '/dispute-create');
          if (changed == true) _loadDisputes();
        },
        backgroundColor: const Color(0xFF0B7A70),
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF0B7A70)))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Color(0xFF6B7684))))
              : _disputes.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.gavel, size: 48, color: Color(0xFF6B7684)),
                          SizedBox(height: 16),
                          Text('No disputes yet', style: TextStyle(color: Color(0xFF6B7684))),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      color: const Color(0xFF0B7A70),
                      onRefresh: _loadDisputes,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _disputes.length,
                        itemBuilder: (context, index) {
                          final dispute = _disputes[index];
                          final statusTheme = DisputeStatusTheme.forStatus(dispute.status);
                          final card = Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: const Color(0xFFE2E6EA)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      dispute.bureau[0].toUpperCase() + dispute.bureau.substring(1),
                                      style: const TextStyle(color: Color(0xFF12181F), fontWeight: FontWeight.w600),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: statusTheme.background,
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(
                                        dispute.status.replaceAll('_', ' ').toUpperCase(),
                                        style: TextStyle(color: statusTheme.foreground, fontSize: 10, fontWeight: FontWeight.w600),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  dispute.disputeReason.replaceAll('_', ' '),
                                  style: const TextStyle(color: Color(0xFF3F4A57), fontSize: 13),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Created: ${dispute.createdAt}',
                                  style: const TextStyle(color: Color(0xFF6B7684), fontSize: 12),
                                ),
                                if (dispute.isDraft) ...[
                                  const SizedBox(height: 8),
                                  const Text(
                                    'Draft · Tap to review, attach documents and send',
                                    style: TextStyle(color: Color(0xFF0B7A70), fontSize: 12, fontWeight: FontWeight.w600),
                                  ),
                                ],
                              ],
                            ),
                          );
                          if (!dispute.isDraft) return card;
                          return InkWell(
                            borderRadius: BorderRadius.circular(16),
                            onTap: () async {
                              final changed = await Navigator.push<bool>(
                                context,
                                MaterialPageRoute(builder: (_) => DisputeReviewScreen(disputeId: dispute.id)),
                              );
                              if (changed == true) _loadDisputes();
                            },
                            child: card,
                          );
                        },
                      ),
                    ),
    );
  }
}
