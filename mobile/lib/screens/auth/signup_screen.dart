import 'package:flutter/material.dart';
import '../../services/auth_service.dart';
import '../../services/api_client.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _mobileController = TextEditingController();
  final _saIdController = TextEditingController();
  bool _popiaConsent = false;
  bool _creditCheckConsent = true;
  String? _policyVersion;

  @override
  void initState() {
    super.initState();
    AuthService.currentPolicyVersion().then((v) {
      if (mounted) setState(() => _policyVersion = v);
    }).catchError((_) {
      if (mounted) setState(() => _error = 'Could not load the privacy notice. Check your connection.');
    });
  }
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    _mobileController.dispose();
    _saIdController.dispose();
    super.dispose();
  }

  Future<void> _handleSignup() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_popiaConsent || _policyVersion == null) {
      setState(() => _error = 'You need to accept the privacy notice to create an account');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      await AuthService.signup(
        email: _emailController.text.trim(),
        password: _passwordController.text,
        firstName: _firstNameController.text.trim(),
        lastName: _lastNameController.text.trim(),
        mobileNumber: _mobileController.text.replaceAll(' ', ''),
        saIdNumber: _saIdController.text.replaceAll(' ', ''),
        popiaPolicyVersion: _policyVersion!,
        creditCheckConsent: _creditCheckConsent,
      );
      if (mounted) {
        Navigator.pushReplacementNamed(context, '/app');
      }
    } on ApiError catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Network error. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Create Account',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: const Color(0xFF12181F),
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Start your credit journey',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFF6B7684)),
                ),
                const SizedBox(height: 32),

                if (_error != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C)), textAlign: TextAlign.center),
                  ),
                  const SizedBox(height: 16),
                ],

                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _firstNameController,
                        decoration: _inputDecoration('First Name'),
                        validator: (v) => v == null || v.isEmpty ? 'Required' : null,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextFormField(
                        controller: _lastNameController,
                        decoration: _inputDecoration('Last Name'),
                        validator: (v) => v == null || v.isEmpty ? 'Required' : null,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: _inputDecoration('Email'),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Required';
                    if (!v.contains('@')) return 'Invalid email';
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                TextFormField(
                  controller: _mobileController,
                  keyboardType: TextInputType.phone,
                  decoration: _inputDecoration('Mobile (+27...)'),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Required';
                    if (!RegExp(r'^\+27\d{9}$').hasMatch(v.replaceAll(' ', ''))) return 'Use +27 followed by 9 digits';
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                TextFormField(
                  controller: _passwordController,
                  obscureText: true,
                  decoration: _inputDecoration('Password'),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Required';
                    if (v.length < 10) return 'Use at least 10 characters';
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                TextFormField(
                  controller: _saIdController,
                  keyboardType: TextInputType.number,
                  decoration: _inputDecoration('South African ID number').copyWith(
                    helperText: 'Used by the bureaus to find your records. Stored encrypted.',
                    helperMaxLines: 2,
                  ),
                  validator: (v) => isValidSaIdNumber(v ?? '') ? null : 'Check your 13-digit ID number',
                ),
                const SizedBox(height: 16),

                CheckboxListTile(
                  value: _popiaConsent,
                  onChanged: (v) => setState(() => _popiaConsent = v ?? false),
                  activeColor: const Color(0xFF0B7A70),
                  title: Text(
                    'I accept the CrediSync privacy notice (version ${_policyVersion ?? '…'}), required under POPIA',
                    style: const TextStyle(color: Color(0xFF6B7684), fontSize: 13),
                  ),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                ),
                CheckboxListTile(
                  value: _creditCheckConsent,
                  onChanged: (v) => setState(() => _creditCheckConsent = v ?? false),
                  activeColor: const Color(0xFF0B7A70),
                  title: const Text(
                    'Request my credit reports from TransUnion, Experian and XDS. Checking your own report does not affect your score.',
                    style: TextStyle(color: Color(0xFF6B7684), fontSize: 13),
                  ),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                ),
                const SizedBox(height: 24),

                ElevatedButton(
                  onPressed: _loading ? null : _handleSignup,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0B7A70),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: _loading
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Create Account', style: TextStyle(fontSize: 16)),
                ),
                const SizedBox(height: 16),

                TextButton(
                  onPressed: () => Navigator.pushReplacementNamed(context, '/login'),
                  child: const Text('Already have an account? Sign in', style: TextStyle(color: Color(0xFF0B7A70))),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(String label) {
    return InputDecoration(
      labelText: label,
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFE2E6EA))),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFE2E6EA))),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF0B7A70), width: 2)),
    );
  }
}
