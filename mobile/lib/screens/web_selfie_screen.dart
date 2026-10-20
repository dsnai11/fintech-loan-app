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
import 'web_camera_page.dart';

// The selfie in a web browser. The phone app watches the eyes for a blink; a browser cannot do that, so here the customer sends one
// clear photo and a person at the company looks at it. Their account carries on while it is checked.
class WebSelfieScreen extends StatefulWidget {
  final int step;
  final bool fromProfile;
  const WebSelfieScreen({Key? key, this.step = 4, this.fromProfile = false}) : super(key: key);

  @override
  State<WebSelfieScreen> createState() => _WebSelfieScreenState();
}

class _WebSelfieScreenState extends State<WebSelfieScreen> {
  Uint8List? _photo;
  bool _busy = false;
  bool _done = false;
  String? _error;

  Future<void> _pick(ImageSource source) async {
    // In a browser the plain "camera" option only opens a file chooser on a computer, so use the camera inside the page
    if (source == ImageSource.camera) {
      final r = await Navigator.of(context).push<Uint8List>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => const WebCameraPage(title: 'Take your selfie', hint: 'Look at the camera in good light, without glasses or a mask, and keep your face inside the oval.', front: true)));
      if (r == null) return;
      if (r.isNotEmpty) { if (mounted) setState(() { _photo = r; _error = null; }); return; }
      source = ImageSource.gallery;
    }
    try {
      final f = await ImagePicker().pickImage(source: source, preferredCameraDevice: CameraDevice.front, maxWidth: 1280, imageQuality: 80);
      if (f == null) return;
      final bytes = await f.readAsBytes();
      if (mounted) setState(() { _photo = bytes; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = 'We could not open the camera or the photos. Check that your browser is allowed to use them.');
    }
  }

  Future<void> _send() async {
    final photo = _photo;
    if (photo == null) return;
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<ApiService>().submitSelfieUpload(base64Encode(photo));
      if (mounted) setState(() => _done = true);
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
      title: 'Send a selfie',
      subtitle: 'A clear photo of your face, in good light, without glasses or a mask. Our team will look at it.',
      bottom: _done
          ? ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Continue'))
          : (_photo == null ? null : ElevatedButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending...' : 'Use this photo'))),
      body: Column(children: [
        Center(
          child: Container(
            width: 270,
            height: 270,
            decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: _done ? kGreen : const Color(0xFFD1D5DB), width: 4)),
            padding: const EdgeInsets.all(6),
            child: ClipOval(
              child: _photo != null
                  ? Image.memory(_photo!, fit: BoxFit.cover, width: 258, height: 258)
                  : Container(color: const Color(0xFFF3F4F6), child: const Icon(Icons.face_retouching_natural_rounded, size: 90, color: Color(0xFF9CA3AF))),
            ),
          ),
        ),
        const SizedBox(height: 22),
        if (_done)
          const Text('Thank you. Our team will look at your photo. You can carry on in the meantime.', textAlign: TextAlign.center, style: TextStyle(fontSize: 15, height: 1.5, fontWeight: FontWeight.w600, color: kGreen))
        else ...[
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: Color(0xFFB91C1C)))),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            OutlinedButton.icon(onPressed: _busy ? null : () => _pick(ImageSource.camera), icon: const Icon(Icons.photo_camera_rounded, size: 18), label: Text(_photo == null ? 'Take a photo' : 'Take again')),
            const SizedBox(width: 10),
            OutlinedButton.icon(onPressed: _busy ? null : () => _pick(ImageSource.gallery), icon: const Icon(Icons.photo_library_rounded, size: 18), label: const Text('Choose a photo')),
          ]),
        ],
      ]),
    );
  }
}
