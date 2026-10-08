import 'dart:async';
import 'dart:convert';
import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import 'setup_scaffold.dart';

// The selfie, with a check that a real person is in front of the camera. The front camera watches the face. The
// customer holds still until a photo is taken, then blinks twice. The app records how open the eyes are while
// they blink, takes a second photo, and sends both photos and the eye readings to the server, which checks them.
class SelfieLivenessScreen extends StatefulWidget {
  final int step;
  final bool fromProfile;
  const SelfieLivenessScreen({Key? key, this.step = 3, this.fromProfile = false}) : super(key: key);

  @override
  State<SelfieLivenessScreen> createState() => _SelfieLivenessScreenState();
}

enum _Phase { starting, noCamera, aligning, blinking, uploading, failed, done }

class _SelfieLivenessScreenState extends State<SelfieLivenessScreen> {
  static const _openAt = 0.6;
  static const _closedAt = 0.3;
  static const _blinksNeeded = 2;
  static const _orientations = {
    DeviceOrientation.portraitUp: 0,
    DeviceOrientation.landscapeLeft: 90,
    DeviceOrientation.portraitDown: 180,
    DeviceOrientation.landscapeRight: 270,
  };

  CameraController? _cam;
  CameraDescription? _desc;
  final FaceDetector _detector = FaceDetector(options: FaceDetectorOptions(enableClassification: true, performanceMode: FaceDetectorMode.fast));
  _Phase _phase = _Phase.starting;
  String _message = 'Starting the camera...';
  String? _error;

  bool _busy = false;
  int _lastRun = 0;
  int _steady = 0;
  String? _before;
  String? _challengeId;

  // Blink recording
  final Stopwatch _clock = Stopwatch();
  final List<List<num>> _samples = [];
  int _blinks = 0;
  int? _closedSince;
  int _lastFaceAt = 0;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  @override
  void dispose() {
    _stopStream();
    _cam?.dispose();
    _detector.close();
    super.dispose();
  }

  Future<void> _boot() async {
    setState(() {
      _phase = _Phase.starting;
      _message = 'Starting the camera...';
      _error = null;
      _steady = 0;
      _before = null;
      _samples.clear();
      _blinks = 0;
      _closedSince = null;
    });
    try {
      final cams = await availableCameras();
      if (cams.isEmpty) throw CameraException('none', 'No camera found');
      _desc = cams.firstWhere((c) => c.lensDirection == CameraLensDirection.front, orElse: () => cams.first);
      final old = _cam;
      _cam = CameraController(
        _desc!,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: defaultTargetPlatform == TargetPlatform.android ? ImageFormatGroup.nv21 : ImageFormatGroup.bgra8888,
      );
      await old?.dispose();
      await _cam!.initialize();
      await _cam!.startImageStream(_onFrame);
      if (!mounted) return;
      setState(() {
        _phase = _Phase.aligning;
        _message = 'Put your face in the circle and look at the camera';
      });
    } on CameraException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.noCamera;
        _error = (e.code == 'CameraAccessDenied' || e.code == 'CameraAccessDeniedWithoutPrompt' || e.code == 'CameraAccessRestricted')
            ? 'We need the camera for this step. Allow camera access for this app in your phone settings, then try again.'
            : 'The camera could not be started. Please try again.';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.noCamera;
        _error = 'The camera could not be started. Please try again.';
      });
    }
  }

  Future<void> _stopStream() async {
    try {
      if (_cam != null && _cam!.value.isStreamingImages) await _cam!.stopImageStream();
    } catch (_) {}
  }

  // Turns a camera frame into what the face detector reads.
  InputImage? _toInputImage(CameraImage image) {
    final cam = _cam;
    final desc = _desc;
    if (cam == null || desc == null) return null;
    InputImageRotation? rotation;
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      rotation = InputImageRotationValue.fromRawValue(desc.sensorOrientation);
    } else {
      final comp = _orientations[cam.value.deviceOrientation];
      if (comp == null) return null;
      final r = desc.lensDirection == CameraLensDirection.front ? (desc.sensorOrientation + comp) % 360 : (desc.sensorOrientation - comp + 360) % 360;
      rotation = InputImageRotationValue.fromRawValue(r);
    }
    if (rotation == null) return null;
    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (format == null) return null;
    if (defaultTargetPlatform == TargetPlatform.android && format != InputImageFormat.nv21) return null;
    if (defaultTargetPlatform == TargetPlatform.iOS && format != InputImageFormat.bgra8888) return null;
    if (image.planes.length != 1) return null;
    final plane = image.planes.first;
    return InputImage.fromBytes(
      bytes: plane.bytes,
      metadata: InputImageMetadata(size: Size(image.width.toDouble(), image.height.toDouble()), rotation: rotation, format: format, bytesPerRow: plane.bytesPerRow),
    );
  }

  Future<void> _onFrame(CameraImage image) async {
    if (_busy || (_phase != _Phase.aligning && _phase != _Phase.blinking)) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _lastRun < 110) return;
    _lastRun = now;
    _busy = true;
    try {
      final input = _toInputImage(image);
      if (input == null) return;
      final faces = await _detector.processImage(input);
      if (!mounted) return;
      if (_phase == _Phase.aligning) {
        await _whileAligning(faces);
      } else if (_phase == _Phase.blinking) {
        await _whileBlinking(faces);
      }
    } catch (_) {
      // a frame that cannot be read is skipped
    } finally {
      _busy = false;
    }
  }

  // Wait for one face with both eyes open, held steady, then take the first photo.
  Future<void> _whileAligning(List<Face> faces) async {
    if (faces.isEmpty) {
      _steady = 0;
      _setMessage('Put your face in the circle and look at the camera');
      return;
    }
    if (faces.length > 1) {
      _steady = 0;
      _setMessage('Only you should be in the picture');
      return;
    }
    final f = faces.first;
    final open = ((f.leftEyeOpenProbability ?? 0) + (f.rightEyeOpenProbability ?? 0)) / 2;
    if (open < 0.7) {
      _steady = 0;
      _setMessage('Keep your eyes open and look at the camera');
      return;
    }
    _setMessage('Hold still...');
    if (++_steady < 8) return;
    _steady = -1000; // only once
    await _takeFirstPhoto();
  }

  Future<void> _takeFirstPhoto() async {
    try {
      await _cam!.stopImageStream();
      final shot = await _cam!.takePicture();
      _before = base64Encode(await shot.readAsBytes());
      final c = await context.read<ApiService>().livenessChallenge();
      _challengeId = c['challengeId'].toString();
      _samples.clear();
      _blinks = 0;
      _closedSince = null;
      _clock
        ..reset()
        ..start();
      _lastFaceAt = 0;
      if (!mounted) return;
      setState(() {
        _phase = _Phase.blinking;
        _message = 'Now blink twice';
      });
      await _cam!.startImageStream(_onFrame);
    } catch (e) {
      _fail(e is CameraException ? 'The camera had a problem. Please try again.' : friendlyError(e));
    }
  }

  // Record how open the eyes are and count blinks: eyes open, then shut, then open again.
  Future<void> _whileBlinking(List<Face> faces) async {
    final t = _clock.elapsedMilliseconds;
    if (t > 16000) return _fail('We did not see you blink. Try again in good light, with your face in the circle.');
    if (faces.length == 1 && faces.first.leftEyeOpenProbability != null && faces.first.rightEyeOpenProbability != null) {
      final l = faces.first.leftEyeOpenProbability!;
      final r = faces.first.rightEyeOpenProbability!;
      _lastFaceAt = t;
      if (_samples.length < 600 && (_samples.isEmpty || t > (_samples.last[0] as int))) _samples.add([t, double.parse(l.toStringAsFixed(3)), double.parse(r.toStringAsFixed(3))]);
      final avg = (l + r) / 2;
      if (avg <= _closedAt) {
        _closedSince ??= t;
      } else if (avg >= _openAt && _closedSince != null) {
        if (t - _closedSince! <= 1500) {
          _blinks++;
          HapticFeedback.selectionClick();
          if (mounted) setState(() => _message = _blinks >= _blinksNeeded ? 'Got it' : 'Once more');
        }
        _closedSince = null;
      }
      // The check needs to run for a moment and end with the eyes open.
      if (_blinks >= _blinksNeeded && t >= 1700 && avg >= _openAt) await _finish();
    } else if (t - _lastFaceAt > 2500 && t > 3000) {
      _fail('We lost sight of your face. Keep it in the circle and try again.');
    }
  }

  Future<void> _finish() async {
    if (_phase != _Phase.blinking) return;
    setState(() {
      _phase = _Phase.uploading;
      _message = 'Checking...';
    });
    try {
      await _cam!.stopImageStream();
      final shot = await _cam!.takePicture();
      final after = base64Encode(await shot.readAsBytes());
      await context.read<ApiService>().submitSelfie(challengeId: _challengeId!, before: _before!, after: after, samples: _samples, blinks: _blinks);
      HapticFeedback.mediumImpact();
      if (!mounted) return;
      setState(() {
        _phase = _Phase.done;
        _message = 'Photo verified';
      });
      await Future.delayed(const Duration(milliseconds: 900));
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      _fail(friendlyError(e));
    }
  }

  void _fail(String why) {
    if (!mounted || _phase == _Phase.failed || _phase == _Phase.done) return;
    _stopStream();
    HapticFeedback.heavyImpact();
    setState(() {
      _phase = _Phase.failed;
      _error = why;
    });
  }

  void _setMessage(String m) {
    if (mounted && _message != m) setState(() => _message = m);
  }

  @override
  Widget build(BuildContext context) {
    final active = _phase == _Phase.aligning || _phase == _Phase.blinking || _phase == _Phase.uploading;
    return SetupScaffold(
      step: widget.step,
      canSkip: !widget.fromProfile && _phase != _Phase.uploading,
      title: 'Take a quick selfie',
      subtitle: 'This shows it is really you. Stay in good light, take off glasses or a mask, and blink when asked.',
      bottom: (_phase == _Phase.failed || _phase == _Phase.noCamera) ? ElevatedButton(onPressed: _boot, child: const Text('Try again')) : null,
      body: Column(
        children: [
          Center(child: _preview(active)),
          const SizedBox(height: 22),
          if (_phase == _Phase.failed || _phase == _Phase.noCamera)
            Text(_error ?? 'Something went wrong', textAlign: TextAlign.center, style: const TextStyle(fontSize: 14.5, height: 1.5, color: Color(0xFFB91C1C)))
          else
            Text(_message, textAlign: TextAlign.center, style: TextStyle(fontSize: _phase == _Phase.blinking ? 22 : 16, fontWeight: FontWeight.w700, color: _phase == _Phase.done ? kGreen : const Color(0xFF111827))),
          if (_phase == _Phase.blinking)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                for (var i = 0; i < _blinksNeeded; i++) Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: Icon(i < _blinks ? Icons.visibility_rounded : Icons.visibility_outlined, size: 28, color: i < _blinks ? kGreen : const Color(0xFF9CA3AF))),
              ]),
            ),
        ],
      ),
    );
  }

  Widget _preview(bool active) {
    const size = 270.0;
    final ring = _phase == _Phase.done ? kGreen : _phase == _Phase.blinking ? kNavy : const Color(0xFFD1D5DB);
    return Container(
      width: size + 12,
      height: size + 12,
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: ring, width: 4)),
      child: ClipOval(
        child: SizedBox(
          width: size,
          height: size,
          child: (active && _cam != null && _cam!.value.isInitialized)
              ? FittedBox(
                  fit: BoxFit.cover,
                  child: SizedBox(
                    width: _cam!.value.previewSize!.height,
                    height: _cam!.value.previewSize!.width,
                    child: CameraPreview(_cam!),
                  ),
                )
              : Container(color: const Color(0xFFF3F4F6), child: Icon(_phase == _Phase.done ? Icons.check_rounded : Icons.face_retouching_natural_rounded, size: 90, color: _phase == _Phase.done ? kGreen : const Color(0xFF9CA3AF))),
        ),
      ),
    );
  }
}
