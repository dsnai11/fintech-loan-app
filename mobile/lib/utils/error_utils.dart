String friendlyError(dynamic e) {
  final s = e is Exception ? e.toString().replaceFirst('Exception: ', '') : e.toString();
  // Extract backend "error" field from raw JSON (fallback for un-processed exceptions)
  final match = RegExp(r'"error"\s*:\s*"([^"]+)"').firstMatch(s);
  if (match != null) return match.group(1)!;
  // Already-clean messages from _handleError pass through unchanged
  if (s.contains('DioException') || s.contains('validateStatus') || s.length > 200) {
    return 'Something went wrong. Please try again.';
  }
  if (s.isEmpty) return 'Something went wrong. Please try again.';
  return s;
}
