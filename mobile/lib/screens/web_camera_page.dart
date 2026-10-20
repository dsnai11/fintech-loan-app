import 'dart:typed_data';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart' hide Text;
import '../main.dart';
import '../widgets/tr_text.dart';

// A camera inside the web page: asks the browser for the camera, shows what it sees, and takes a JPEG photo. Used by the
// website for the selfie and the Aadhaar card, because the plain photo picker only opens a file chooser on a computer.
// Pops with the photo bytes, with an empty list when the person chooses to pick a file instead, or with null when they close it.
class WebCameraPage extends StatefulWidget {
  final String title;
  final String hint;
  final bool front; // the selfie camera (true) or the camera facing away from the person (false)
  final bool card; // draw a card-shaped frame instead of a face-shaped one
  const WebCameraPage({Key? key, required this.title, required this.hint, this.front = true, this.card = false}) : super(key: key);

  @override
  State<WebCameraPage> createState() => _WebCameraPageState();
}

class _WebCameraPageState extends State<WebCameraPage> {
  CameraController? _controller;
  Uint8List? _photo;
  String? _error;
  bool _starting = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() { _starting = true; _error = null; });
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        setState(() { _error = 'No camera was found on this device. You can choose a photo from your files instead.'; _starting = false; });
        return;
      }
      final want = widget.front ? CameraLensDirection.front : CameraLensDirection.back;
      final cam = cameras.firstWhere((c) => c.lensDirection == want, orElse: () => cameras.first);
      final controller = CameraController(cam, ResolutionPreset.high, enableAudio: false);
      await controller.initialize();
      if (!mounted) { await controller.dispose(); return; }
      setState(() { _controller = controller; _starting = false; });
    } on CameraException catch (e) {
      final denied = e.code.toLowerCase().contains('denied') || e.code.toLowerCase().contains('notallowed');
      setState(() {
        _error = denied
            ? 'The camera is blocked. Click the camera or lock icon next to the web address, allow the camera, then press "Try again".'
            : 'We could not start the camera (${e.code}). Another program may be using it. You can choose a photo from your files instead.';
        _starting = false;
      });
    } catch (_) {
      setState(() { _error = 'We could not start the camera. You can choose a photo from your files instead.'; _starting = false; });
    }
  }

  Future<void> _take() async {
    final c = _controller;
    if (c == null || _busy) return;
    setState(() => _busy = true);
    try {
      final f = await c.takePicture();
      final bytes = await f.readAsBytes();
      if (mounted) setState(() => _photo = bytes);
    } catch (_) {
      if (mounted) setState(() => _error = 'The photo could not be taken. Please try again.');
    }
    if (mounted) setState(() => _busy = false);
  }

  Widget _frame() => IgnorePointer(
        child: widget.card
            ? Center(child: FractionallySizedBox(widthFactor: 0.82, child: AspectRatio(aspectRatio: 1.586, child: Container(decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(14))))))
            : Center(child: FractionallySizedBox(heightFactor: 0.8, child: AspectRatio(aspectRatio: 0.78, child: Container(decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(200)))))),
      );

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text(widget.title), leading: IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.of(context).pop(null))),
      body: SafeArea(
        child: Column(children: [
          Expanded(
            child: _starting
                ? const Center(child: CircularProgressIndicator(color: Colors.white))
                : _error != null && _photo == null
                    ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 15, height: 1.5))))
                    : _photo != null
                        ? Center(child: Image.memory(_photo!, fit: BoxFit.contain))
                        : (c == null ? const SizedBox() : Stack(fit: StackFit.expand, children: [Center(child: CameraPreview(c)), _frame()])),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 18),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (_photo == null && _error == null && !_starting) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(widget.hint, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70, fontSize: 13.5, height: 1.4))),
              Wrap(alignment: WrapAlignment.center, spacing: 10, runSpacing: 8, children: [
                if (_photo != null) ...[
                  OutlinedButton(style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54)), onPressed: () => setState(() { _photo = null; _error = null; }), child: const Text('Retake')),
                  ElevatedButton(style: ElevatedButton.styleFrom(backgroundColor: kGreen, foregroundColor: Colors.white), onPressed: () => Navigator.of(context).pop(_photo), child: const Text('Use this photo')),
                ] else if (_error != null) ...[
                  ElevatedButton(onPressed: _start, child: const Text('Try again')),
                  OutlinedButton(style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54)), onPressed: () => Navigator.of(context).pop(Uint8List(0)), child: const Text('Choose a photo instead')),
                ] else if (!_starting) ...[
                  ElevatedButton.icon(style: ElevatedButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colors.black), onPressed: _busy ? null : _take, icon: const Icon(Icons.photo_camera_rounded), label: Text(_busy ? 'Taking...' : 'Take photo')),
                  TextButton(onPressed: () => Navigator.of(context).pop(Uint8List(0)), child: const Text('Choose a photo instead', style: TextStyle(color: Colors.white70))),
                ],
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}
