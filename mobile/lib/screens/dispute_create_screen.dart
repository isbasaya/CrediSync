import 'package:material_ui/material_ui.dart';
import '../services/dispute_service.dart';
import '../services/api_client.dart';
import '../services/credit_profile_service.dart';
import 'dispute_review_screen.dart';

class DisputeCreateScreen extends StatefulWidget {
  const DisputeCreateScreen({super.key});

  @override
  State<DisputeCreateScreen> createState() => _DisputeCreateScreenState();
}

class _DisputeCreateScreenState extends State<DisputeCreateScreen> {
  final _formKey = GlobalKey<FormState>();
  final _descriptionController = TextEditingController();
  String? _selectedRecordId;
  String _selectedReason = 'not_my_account';
  bool _loading = false;
  List<_RecordOption>? _options;
  String? _loadError;

  static const _bureauLabels = {'transunion': 'TransUnion', 'experian': 'Experian', 'xds': 'XDS'};

  @override
  void initState() {
    super.initState();
    CreditProfileService.getAccounts().then((accounts) {
      if (!mounted) return;
      setState(() {
        _options = [
          for (final a in accounts)
            for (final r in a.reportedBy)
              _RecordOption(r.accountId, '${a.creditorName} · ${_bureauLabels[r.bureau] ?? r.bureau} · ${r.status.replaceAll('_', ' ')}'),
        ];
        if (_options!.isNotEmpty) _selectedRecordId = _options!.first.accountId;
      });
    }).catchError((Object e) {
      if (mounted) setState(() => _loadError = e is ApiError ? e.message : 'Could not load your accounts');
    });
  }

  final _reasons = const [
    'not_my_account',
    'incorrect_balance',
    'incorrect_status',
    'paid_but_reflecting_outstanding',
    'duplicate_listing',
    'identity_theft_fraud',
    'settled_in_full_not_updated',
    'prescribed_debt',
    'incorrect_personal_details',
  ];

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _loading = true);

    if (_selectedRecordId == null) return;

    try {
      final draft = await DisputeService.createDispute(
        bureauAccountId: _selectedRecordId!,
        reason: _selectedReason,
        description: _descriptionController.text.trim(),
      );
      if (!mounted) return;
      // The draft is saved; review, attach evidence and send (or keep) on the next screen.
      await Navigator.pushReplacement<bool, bool>(
        context,
        MaterialPageRoute(builder: (_) => DisputeReviewScreen(disputeId: draft.id)),
        result: true,
      );
    } on ApiError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: const Color(0xFFB91C1C)),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to create dispute')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('New Dispute'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Which bureau record is wrong?', style: TextStyle(color: Color(0xFF12181F), fontSize: 14)),
              const SizedBox(height: 8),
              if (_loadError != null)
                Text(_loadError!, style: const TextStyle(color: Color(0xFFB91C1C)))
              else if (_options == null)
                const LinearProgressIndicator(color: Color(0xFF0B7A70))
              else if (_options!.isEmpty)
                const Text('No accounts yet. Fetch your credit reports first.', style: TextStyle(color: Color(0xFF6B7684)))
              else
                DropdownButtonFormField<String>(
                  initialValue: _selectedRecordId,
                  isExpanded: true,
                  dropdownColor: Colors.white,
                  decoration: _inputDecoration(),
                  items: _options!
                      .map((o) => DropdownMenuItem(
                            value: o.accountId,
                            child: Text(o.label, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Color(0xFF12181F))),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedRecordId = v),
                ),
              const SizedBox(height: 16),

              const Text('Reason', style: TextStyle(color: Color(0xFF12181F), fontSize: 14)),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _selectedReason,
                dropdownColor: Colors.white,
                decoration: _inputDecoration(),
                items: _reasons.map((r) => DropdownMenuItem(
                  value: r,
                  child: Text(r.replaceAll('_', ' '), style: const TextStyle(color: Color(0xFF12181F))),
                )).toList(),
                onChanged: (v) => setState(() => _selectedReason = v ?? 'not_my_account'),
              ),
              const SizedBox(height: 16),

              const Text('Description', style: TextStyle(color: Color(0xFF12181F), fontSize: 14)),
              const SizedBox(height: 8),
              TextFormField(
                controller: _descriptionController,
                maxLines: 5,
                decoration: _inputDecoration(),
                validator: (v) {
                  if (v == null || v.trim().length < 20) return 'Please provide at least 20 characters';
                  return null;
                },
              ),
              const SizedBox(height: 24),

              ElevatedButton(
                onPressed: _loading || _selectedRecordId == null ? null : _handleSubmit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0B7A70),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: _loading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Preview letter', style: TextStyle(fontSize: 16)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration() {
    return InputDecoration(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFE2E6EA))),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFE2E6EA))),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF0B7A70), width: 2)),
    );
  }
}

class _RecordOption {
  final String accountId;
  final String label;
  const _RecordOption(this.accountId, this.label);
}
