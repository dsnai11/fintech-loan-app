String friendlyError(dynamic e) {
  final s = e.toString();
  // Extract the backend "error" field from Dio response body
  final match = RegExp(r'"error"\s*:\s*"([^"]+)"').firstMatch(s);
  if (match != null) return match.group(1)!;
  // Map common HTTP/network errors to plain English
  if (s.contains('404')) return 'Service not found. Please update the app.';
  if (s.contains('401') || s.contains('Unauthorized')) return 'Session expired. Please log in again.';
  if (s.contains('403') || s.contains('Forbidden')) return 'You don\'t have permission to do this.';
  if (s.contains('400') || s.contains('Bad Request')) return 'Invalid details. Please check your inputs.';
  if (s.contains('500') || s.contains('Internal Server')) return 'Server error. Please try again in a moment.';
  if (s.contains('SocketException') || s.contains('Failed host lookup') || s.contains('Network')) {
    return 'No internet connection. Check your network and try again.';
  }
  if (s.contains('TimeoutException') || s.contains('timeout')) {
    return 'Request timed out. Check your connection and try again.';
  }
  if (s.contains('Connection refused') || s.contains('connection refused')) {
    return 'Cannot reach server. Please try again later.';
  }
  // If it's already a short human-readable string, use it
  if (s.length <= 120 && !s.contains('DioException') && !s.contains('validateStatus')) return s;
  return 'Something went wrong. Please try again.';
}
