import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import '../widgets/tr_text.dart';
import 'setup_scaffold.dart';

// A photo of the customer's Aadhaar card. Every customer sends one. A person at the company compares the face on the card
// with the selfie, so the photo has to be clear and show the whole card. Works the same on the phone and in a browser.
class AadhaarCardScreen extends StatefulWidget {
  final int step;
  final bool fromProfile;
  const AadhaarCardScreen({Key? key, this.step = 3, this.fromProfile = false}) : super(key: key);

  @override
  State<AadhaarCardScreen> createState() => _AadhaarCardScreenState();
}

class _AadhaarCardScreenState extends State<AadhaarCardScreen> {
  Uint8List? _photo;
  bool _busy = false;
  bool _done = false;
  String? _error;
  String _result = '';

  Future<void> _pick(ImageSource source) async {
    try {
      final f = await ImagePicker().pickImage(source: source, preferredCameraDevice: CameraDevice.rear, maxWidth: 1600, imageQuality: 85);
      if (f == null) return;
      final bytes = await f.readAsBytes();
      if (mounted) setState(() { _photo = bytes; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = 'We could not open the camera or the photos. Check that this app is allowed to use them.');
    }
  }

  Future<void> _send() async {
    final photo = _photo;
    if (photo == null) return;
    setState(() { _busy = true; _error = null; });
    try {
      final r = await context.read<ApiService>().submitAadhaarCard(base64Encode(photo));
      final status = ((r['aadhaarCard'] as Map?)?['status'] ?? '').toString();
      if (!mounted) return;
      if (status == 'rejected') {
        // The automatic check could not match the card with the selfie: say why, and let them try again
        setState(() { _error = (r['message'] ?? 'Please send a clearer photo of your Aadhaar card.').toString(); _photo = null; });
      } else {
        setState(() { _done = true; _result = status; });
      }
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return SetupScaffold(
      step: widget.step,
      canSkip: !widget.fromProfile && !_done && !_busy,
      title: 'Photo of your Aadhaar card',
      subtitle: 'Place the card on a plain surface in good light, with your photo and all four corners in view. We check it is an Aadhaar card, then the camera opens for a quick blink check and we compare your face with the card.',
      bottom: _done
          ? ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Continue'))
          : (_photo == null ? null : ElevatedButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending...' : 'Use this photo'))),
      body: Column(children: [
        Center(
          child: Container(
            width: double.infinity,
            constraints: const BoxConstraints(maxWidth: 420),
            height: 230,
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: _done ? kGreen : const Color(0xFFD1D5DB), width: 3)),
            clipBehavior: Clip.antiAlias,
            child: _photo != null
                ? Image.memory(_photo!, fit: BoxFit.cover)
                : Container(color: const Color(0xFFF3F4F6), child: const Icon(Icons.badge_outlined, size: 80, color: Color(0xFF9CA3AF))),
          ),
        ),
        const SizedBox(height: 18),
        if (_done)
          Text(_result == 'passed' ? 'Your Aadhaar card photo is verified.' : 'Thank you. Next we take your selfie and compare it with the card.', textAlign: TextAlign.center, style: TextStyle(fontSize: 15, height: 1.5, fontWeight: FontWeight.w600, color: kGreen))
        else ...[
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: Color(0xFFB91C1C)))),
          Wrap(alignment: WrapAlignment.center, spacing: 10, runSpacing: 8, children: [
            OutlinedButton.icon(onPressed: _busy ? null : () => _pick(ImageSource.camera), icon: const Icon(Icons.photo_camera_rounded, size: 18), label: Text(_photo == null ? 'Take a photo' : 'Take again')),
            OutlinedButton.icon(onPressed: _busy ? null : () => _pick(ImageSource.gallery), icon: const Icon(Icons.photo_library_rounded, size: 18), label: const Text('Choose a photo')),
          ]),
          const SizedBox(height: 16),
          const Text('Your photo is stored securely and used only to verify your identity. You can hide the first 8 digits of the Aadhaar number if you like; we only need your photo and name.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, height: 1.45, color: Color(0xFF6B7280))),
        ],
      ]),
    );
  }
}
