import 'package:flutter/material.dart';
import '../services/dispute_service.dart';
import '../services/api_client.dart';

class DisputeCreateScreen extends StatefulWidget {
  const DisputeCreateScreen({super.key});

  @override
  State<DisputeCreateScreen> createState() => _DisputeCreateScreenState();
}

class _DisputeCreateScreenState extends State<DisputeCreateScreen> {
  final _formKey = GlobalKey<FormState>();
  final _descriptionController = TextEditingController();
  String _selectedBureau = 'transunion';
  String _selectedReason = 'not_my_account';
  bool _loading = false;

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

    try {
      await DisputeService.createDispute(
        bureauAccountId: 'pending-account-id',
        bureau: _selectedBureau,
        reason: _selectedReason,
        description: _descriptionController.text.trim(),
        maskedSaId: '********',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Dispute created successfully')),
        );
        Navigator.pop(context);
      }
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
              const Text('Bureau', style: TextStyle(color: Color(0xFF12181F), fontSize: 14)),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: _selectedBureau,
                dropdownColor: Colors.white,
                decoration: _inputDecoration(),
                items: const [
                  DropdownMenuItem(value: 'transunion', child: Text('TransUnion', style: TextStyle(color: Color(0xFF12181F)))),
                  DropdownMenuItem(value: 'experian', child: Text('Experian', style: TextStyle(color: Color(0xFF12181F)))),
                  DropdownMenuItem(value: 'xds', child: Text('XDS', style: TextStyle(color: Color(0xFF12181F)))),
                ],
                onChanged: (v) => setState(() => _selectedBureau = v ?? 'transunion'),
              ),
              const SizedBox(height: 16),

              const Text('Reason', style: TextStyle(color: Color(0xFF12181F), fontSize: 14)),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: _selectedReason,
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
                onPressed: _loading ? null : _handleSubmit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0B7A70),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: _loading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Submit Dispute', style: TextStyle(fontSize: 16)),
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
