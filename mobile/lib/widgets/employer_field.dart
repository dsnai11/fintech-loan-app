import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import 'tr_text.dart';

// "Where do you work": a text box that suggests employers from the company's own list while the customer types.
// The customer can still type any name; the list only saves typing and keeps spellings consistent.
class EmployerField extends StatefulWidget {
  final TextEditingController controller;
  final String hint;
  final bool asLabel; // show the text as a floating label instead of a hint
  final bool suggest; // false for a business name, where an employer list does not apply
  final int maxLength;
  const EmployerField({Key? key, required this.controller, required this.hint, this.asLabel = false, this.suggest = true, this.maxLength = 100}) : super(key: key);

  @override
  State<EmployerField> createState() => _EmployerFieldState();
}

class _EmployerFieldState extends State<EmployerField> {
  final _focus = FocusNode();
  Timer? _wait;
  List<String> _names = [];
  String _lastAsked = '';

  @override
  void dispose() {
    _wait?.cancel();
    _focus.dispose();
    super.dispose();
  }

  void _changed(String v) {
    _wait?.cancel();
    final q = v.trim();
    if (!widget.suggest || q.length < 2) {
      if (_names.isNotEmpty) setState(() => _names = []);
      return;
    }
    _wait = Timer(const Duration(milliseconds: 300), () => _ask(q));
  }

  Future<void> _ask(String q) async {
    if (q == _lastAsked) return;
    _lastAsked = q;
    try {
      final r = await context.read<ApiService>().searchEmployers(q);
      if (!mounted || widget.controller.text.trim() != q) return;
      setState(() => _names = r.take(5).toList());
    } catch (_) {
      if (mounted) setState(() => _names = []);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      TextField(
        controller: widget.controller,
        focusNode: _focus,
        maxLength: widget.maxLength,
        textCapitalization: TextCapitalization.words,
        onChanged: _changed,
        decoration: InputDecoration(counterText: '', hintText: widget.asLabel ? null : widget.hint, labelText: widget.asLabel ? widget.hint : null),
      ),
      if (_names.isNotEmpty && _focus.hasFocus)
        Container(
          margin: const EdgeInsets.only(top: 6),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: kLine)),
          child: Column(children: [
            for (var i = 0; i < _names.length; i++) ...[
              if (i > 0) const Divider(height: 1),
              InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () {
                  widget.controller.text = _names[i];
                  widget.controller.selection = TextSelection.collapsed(offset: _names[i].length);
                  _lastAsked = _names[i];
                  setState(() => _names = []);
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(children: [
                    const Icon(Icons.business_rounded, size: 18, color: kMuted),
                    const SizedBox(width: 10),
                    Expanded(child: Text(_names[i], maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, color: kInk))),
                  ]),
                ),
              ),
            ],
          ]),
        ),
    ]);
  }
}
