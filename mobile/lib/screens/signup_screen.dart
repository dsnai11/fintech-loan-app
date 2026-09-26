import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../main.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({Key? key}) : super(key: key);

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  bool _agreedToTerms = false;

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _signup() async {
    if (!_agreedToTerms) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please agree to terms and conditions')),
      );
      return;
    }
    final auth = context.read<AuthService>();
    final success = await auth.signup(
      firstName: _firstNameController.text.trim(),
      lastName: _lastNameController.text.trim(),
      email: _emailController.text.trim(),
      phone: _phoneController.text.trim(),
      password: _passwordController.text,
      confirmPassword: _confirmPasswordController.text,
    );
    if (success && mounted) {
      Navigator.of(context).pushReplacementNamed('/home');
    }
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: Color(0xFF6B7280),
            letterSpacing: 0.8,
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return Scaffold(
      backgroundColor: kNavy,
      body: Column(
        children: [
          // ── Navy header ──────────────────────────────────────────
          SizedBox(
            height: size.height * 0.28,
            child: SafeArea(
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    RichText(
                      text: const TextSpan(
                        children: [
                          TextSpan(
                            text: 'Fintech',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 28,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          TextSpan(
                            text: 'LOAN',
                            style: TextStyle(
                              color: kGreen,
                              fontSize: 28,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Create your account',
                      style: TextStyle(color: Colors.white70, fontSize: 14),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // ── White card ───────────────────────────────────────────
          Expanded(
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Name row
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _label('FIRST NAME'),
                              TextField(
                                controller: _firstNameController,
                                decoration: const InputDecoration(hintText: 'Rahul'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _label('LAST NAME'),
                              TextField(
                                controller: _lastNameController,
                                decoration: const InputDecoration(hintText: 'Sharma'),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    _label('EMAIL ADDRESS'),
                    TextField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(
                        hintText: 'rahul@example.com',
                        prefixIcon: Icon(Icons.email_outlined, size: 20, color: Color(0xFF9CA3AF)),
                      ),
                    ),
                    const SizedBox(height: 16),

                    _label('MOBILE NUMBER'),
                    TextField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(
                        hintText: '9876543210',
                        prefixIcon: Padding(
                          padding: EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                          child: Text('+91', style: TextStyle(fontWeight: FontWeight.w600, color: kNavy)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    _label('PASSWORD'),
                    TextField(
                      controller: _passwordController,
                      obscureText: _obscurePassword,
                      decoration: InputDecoration(
                        hintText: 'Min 8 characters',
                        prefixIcon: const Icon(Icons.lock_outline, size: 20, color: Color(0xFF9CA3AF)),
                        suffixIcon: IconButton(
                          icon: Icon(
                            _obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                            size: 20,
                            color: const Color(0xFF9CA3AF),
                          ),
                          onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    _label('CONFIRM PASSWORD'),
                    TextField(
                      controller: _confirmPasswordController,
                      obscureText: _obscureConfirm,
                      decoration: InputDecoration(
                        hintText: 'Re-enter password',
                        prefixIcon: const Icon(Icons.lock_outline, size: 20, color: Color(0xFF9CA3AF)),
                        suffixIcon: IconButton(
                          icon: Icon(
                            _obscureConfirm ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                            size: 20,
                            color: const Color(0xFF9CA3AF),
                          ),
                          onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Terms checkbox
                    GestureDetector(
                      onTap: () => setState(() => _agreedToTerms = !_agreedToTerms),
                      child: Row(
                        children: [
                          Container(
                            width: 20,
                            height: 20,
                            decoration: BoxDecoration(
                              color: _agreedToTerms ? kNavy : Colors.white,
                              border: Border.all(
                                  color: _agreedToTerms ? kNavy : const Color(0xFFD1D5DB)),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: _agreedToTerms
                                ? const Icon(Icons.check, size: 14, color: Colors.white)
                                : null,
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Text(
                              'I agree to the Terms & Privacy Policy',
                              style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Error
                    Consumer<AuthService>(
                      builder: (context, auth, _) {
                        if (auth.error == null) return const SizedBox.shrink();
                        return Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFEF2F2),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: const Color(0xFFFCA5A5)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 18),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(auth.error!,
                                    style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
                              ),
                            ],
                          ),
                        );
                      },
                    ),

                    // Create account button
                    Consumer<AuthService>(
                      builder: (context, auth, _) => SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: auth.isLoading ? null : _signup,
                          child: auth.isLoading
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white),
                                )
                              : const Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text('Create Account'),
                                    SizedBox(width: 8),
                                    Icon(Icons.arrow_forward, size: 18),
                                  ],
                                ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // SSL badge
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: const [
                        Icon(Icons.shield_outlined, size: 14, color: kGreen),
                        SizedBox(width: 6),
                        Text('256-bit SSL encrypted & secure',
                            style: TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                      ],
                    ),
                    const SizedBox(height: 16),

                    Center(
                      child: GestureDetector(
                        onTap: () => Navigator.pop(context),
                        child: RichText(
                          text: const TextSpan(
                            text: 'Already have an account? ',
                            style: TextStyle(color: Color(0xFF6B7280), fontSize: 14),
                            children: [
                              TextSpan(
                                text: 'Sign In',
                                style: TextStyle(
                                    color: kNavy, fontWeight: FontWeight.w700),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
