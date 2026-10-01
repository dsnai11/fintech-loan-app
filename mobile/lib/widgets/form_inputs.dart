import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../main.dart';

// ═══════════════════════════════════════════════════════════════════
// 📅 DATE PICKER INPUT
// ═══════════════════════════════════════════════════════════════════

class DatePickerField extends StatefulWidget {
  final String label;
  final String? hint;
  final DateTime? initialDate;
  final DateTime? firstDate;
  final DateTime? lastDate;
  final ValueChanged<DateTime?> onChanged;
  final String? Function(DateTime?)? validator;
  final bool isRequired;

  const DatePickerField({
    Key? key,
    required this.label,
    this.hint,
    this.initialDate,
    this.firstDate,
    this.lastDate,
    required this.onChanged,
    this.validator,
    this.isRequired = true,
  }) : super(key: key);

  @override
  State<DatePickerField> createState() => _DatePickerFieldState();
}

class _DatePickerFieldState extends State<DatePickerField> {
  DateTime? _selectedDate;
  String? _error;

  @override
  void initState() {
    super.initState();
    _selectedDate = widget.initialDate;
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate ?? DateTime.now(),
      firstDate: widget.firstDate ?? DateTime(1950),
      lastDate: widget.lastDate ?? DateTime.now(),
    );
    if (picked != null) {
      setState(() {
        _selectedDate = picked;
        _error = widget.validator?.call(picked);
      });
      widget.onChanged(picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildLabel(widget.label, widget.isRequired),
        GestureDetector(
          onTap: _pickDate,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: _error != null ? const Color(0xFFEF4444) : const Color(0xFFE5E7EB),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.calendar_today_rounded,
                  size: 18,
                  color: _error != null ? const Color(0xFFEF4444) : const Color(0xFF9CA3AF),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    _selectedDate != null
                        ? DateFormat('dd MMM yyyy').format(_selectedDate!)
                        : (widget.hint ?? 'Select date'),
                    style: TextStyle(
                      fontSize: 15,
                      color: _selectedDate != null ? const Color(0xFF374151) : const Color(0xFF9CA3AF),
                      fontWeight: _selectedDate != null ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 6),
          Text(
            _error!,
            style: const TextStyle(color: Color(0xFFEF4444), fontSize: 12),
          ),
        ] else ...[
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📝 DROPDOWN INPUT
// ═══════════════════════════════════════════════════════════════════

class DropdownField<T> extends StatefulWidget {
  final String label;
  final List<DropdownItem<T>> items;
  final T? value;
  final ValueChanged<T?> onChanged;
  final String Function(T?) displayText;
  final bool isRequired;
  final String? hint;

  const DropdownField({
    Key? key,
    required this.label,
    required this.items,
    required this.onChanged,
    required this.displayText,
    this.value,
    this.isRequired = true,
    this.hint,
  }) : super(key: key);

  @override
  State<DropdownField<T>> createState() => _DropdownFieldState<T>();
}

class _DropdownFieldState<T> extends State<DropdownField<T>> {
  late T? _selected;

  @override
  void initState() {
    super.initState();
    _selected = widget.value;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildLabel(widget.label, widget.isRequired),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE5E7EB)),
          ),
          child: DropdownButton<T?>(
            value: _selected,
            isExpanded: true,
            underline: const SizedBox(),
            hint: Text(widget.hint ?? 'Select ${widget.label.toLowerCase()}'),
            items: [
              if (_selected == null)
                DropdownMenuItem<T?>(
                  value: null,
                  child: Text(widget.hint ?? 'Select ${widget.label.toLowerCase()}'),
                ),
              ...widget.items.map((item) => DropdownMenuItem<T?>(
                    value: item.value,
                    child: Text(item.label),
                  )),
            ],
            onChanged: (newValue) {
              setState(() => _selected = newValue);
              widget.onChanged(newValue);
            },
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

class DropdownItem<T> {
  final T value;
  final String label;

  DropdownItem({required this.value, required this.label});
}

// ═══════════════════════════════════════════════════════════════════
// 📞 PHONE INPUT
// ═══════════════════════════════════════════════════════════════════

class PhoneInputField extends StatefulWidget {
  final String label;
  final TextEditingController controller;
  final ValueChanged<String>? onChanged;
  final String? Function(String?)? validator;
  final bool isRequired;

  const PhoneInputField({
    Key? key,
    required this.label,
    required this.controller,
    this.onChanged,
    this.validator,
    this.isRequired = true,
  }) : super(key: key);

  @override
  State<PhoneInputField> createState() => _PhoneInputFieldState();
}

class _PhoneInputFieldState extends State<PhoneInputField> {
  String? _error;
  bool _isValid = false;

  void _validate(String value) {
    setState(() {
      _error = widget.validator?.call(value);
      _isValid = value.length == 10 && RegExp(r'^\d{10}$').hasMatch(value);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildLabel(widget.label, widget.isRequired),
        TextField(
          controller: widget.controller,
          keyboardType: TextInputType.phone,
          maxLength: 10,
          onChanged: (value) {
            _validate(value);
            widget.onChanged?.call(value);
          },
          decoration: InputDecoration(
            hintText: '9876543210',
            counterText: '',
            prefixIcon: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
              child: Text(
                '+91',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                  color: _error != null ? const Color(0xFFEF4444) : kNavy,
                ),
              ),
            ),
            suffixIcon: _isValid
                ? const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 20)
                : null,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(
                color: _error != null ? const Color(0xFFEF4444) : const Color(0xFFE5E7EB),
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(
                color: _error != null ? const Color(0xFFEF4444) : const Color(0xFFE5E7EB),
              ),
            ),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 6),
          Text(_error!, style: const TextStyle(color: Color(0xFFEF4444), fontSize: 12)),
        ] else ...[
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// 💰 LOAN AMOUNT SLIDER
// ═══════════════════════════════════════════════════════════════════

class LoanAmountSlider extends StatefulWidget {
  final String label;
  final double minAmount;
  final double maxAmount;
  final double initialAmount;
  final ValueChanged<double> onChanged;
  final bool isRequired;

  const LoanAmountSlider({
    Key? key,
    required this.label,
    required this.minAmount,
    required this.maxAmount,
    required this.initialAmount,
    required this.onChanged,
    this.isRequired = true,
  }) : super(key: key);

  @override
  State<LoanAmountSlider> createState() => _LoanAmountSliderState();
}

class _LoanAmountSliderState extends State<LoanAmountSlider> {
  late double _selectedAmount;

  @override
  void initState() {
    super.initState();
    _selectedAmount = widget.initialAmount;
  }

  String _formatAmount(double amount) {
    if (amount >= 100000) {
      return '₹${(amount / 100000).toStringAsFixed(1)}L';
    } else if (amount >= 1000) {
      return '₹${(amount / 1000).toStringAsFixed(0)}K';
    }
    return '₹${amount.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildLabel(widget.label, widget.isRequired),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFF9FAFB),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE5E7EB)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Loan Amount',
                    style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
                  ),
                  Text(
                    _formatAmount(_selectedAmount),
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: kNavy,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Slider(
                value: _selectedAmount,
                min: widget.minAmount,
                max: widget.maxAmount,
                activeColor: kNavy,
                inactiveColor: const Color(0xFFE5E7EB),
                onChanged: (newValue) {
                  setState(() => _selectedAmount = newValue);
                  widget.onChanged(newValue);
                },
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _formatAmount(widget.minAmount),
                    style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF)),
                  ),
                  Text(
                    _formatAmount(widget.maxAmount),
                    style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF)),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🔐 PASSWORD STRENGTH INDICATOR
// ═══════════════════════════════════════════════════════════════════

class PasswordStrengthField extends StatefulWidget {
  final String label;
  final TextEditingController controller;
  final ValueChanged<String>? onChanged;
  final bool isRequired;

  const PasswordStrengthField({
    Key? key,
    required this.label,
    required this.controller,
    this.onChanged,
    this.isRequired = true,
  }) : super(key: key);

  @override
  State<PasswordStrengthField> createState() => _PasswordStrengthFieldState();
}

class _PasswordStrengthFieldState extends State<PasswordStrengthField> {
  bool _obscureText = true;
  PasswordStrength _strength = PasswordStrength.weak;

  PasswordStrength _calculateStrength(String password) {
    if (password.isEmpty) return PasswordStrength.weak;

    int score = 0;
    if (password.length >= 8) score++;
    if (password.contains(RegExp(r'[a-z]'))) score++;
    if (password.contains(RegExp(r'[A-Z]'))) score++;
    if (password.contains(RegExp(r'[0-9]'))) score++;
    if (password.contains(RegExp(r'[!@#$%^&*(),.?":{}|<>]'))) score++;

    if (score <= 2) return PasswordStrength.weak;
    if (score <= 3) return PasswordStrength.medium;
    if (score <= 4) return PasswordStrength.good;
    return PasswordStrength.strong;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildLabel(widget.label, widget.isRequired),
        TextField(
          controller: widget.controller,
          obscureText: _obscureText,
          onChanged: (value) {
            setState(() => _strength = _calculateStrength(value));
            widget.onChanged?.call(value);
          },
          decoration: InputDecoration(
            hintText: 'Min 8 characters',
            prefixIcon: const Icon(Icons.lock_outline, size: 20, color: Color(0xFF9CA3AF)),
            suffixIcon: IconButton(
              icon: Icon(
                _obscureText ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                size: 20,
                color: const Color(0xFF9CA3AF),
              ),
              onPressed: () => setState(() => _obscureText = !_obscureText),
            ),
          ),
        ),
        const SizedBox(height: 8),
        if (widget.controller.text.isNotEmpty) ...[
          Row(
            children: [
              Expanded(
                child: LinearProgressIndicator(
                  value: _strength.index / 3,
                  backgroundColor: const Color(0xFFE5E7EB),
                  valueColor: AlwaysStoppedAnimation(_strength.color),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                _strength.label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: _strength.color,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

enum PasswordStrength {
  weak,
  medium,
  good,
  strong,
}

extension PasswordStrengthExt on PasswordStrength {
  String get label {
    switch (this) {
      case PasswordStrength.weak:
        return 'Weak';
      case PasswordStrength.medium:
        return 'Medium';
      case PasswordStrength.good:
        return 'Good';
      case PasswordStrength.strong:
        return 'Strong';
    }
  }

  Color get color {
    switch (this) {
      case PasswordStrength.weak:
        return const Color(0xFFEF4444);
      case PasswordStrength.medium:
        return const Color(0xFFF59E0B);
      case PasswordStrength.good:
        return const Color(0xFF3B82F6);
      case PasswordStrength.strong:
        return const Color(0xFF10B981);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📋 HELPERS
// ═══════════════════════════════════════════════════════════════════

Widget _buildLabel(String text, bool isRequired) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: RichText(
      text: TextSpan(
        text: text,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: Color(0xFF374151),
          letterSpacing: 0.5,
        ),
        children: isRequired
            ? [
                const TextSpan(
                  text: ' *',
                  style: TextStyle(color: Color(0xFFEF4444)),
                ),
              ]
            : [],
      ),
    ),
  );
}
