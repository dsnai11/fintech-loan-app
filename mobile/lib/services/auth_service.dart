import 'package:flutter/material.dart';
import 'api_service.dart';
import 'app_lock.dart';
import '../utils/error_utils.dart';

class AuthService extends ChangeNotifier {
  final ApiService _apiService;

  String? _token;
  Map<String, dynamic>? _user;
  bool _isLoading = false;
  String? _error;

  AuthService(this._apiService);

  // Getters
  bool get isAuthenticated => _apiService.isAuthenticated;
  bool get isLoading => _isLoading;
  String? get error => _error;
  Map<String, dynamic>? get user => _user;
  String? get token => _token;

  Future<bool> signup({
    required String firstName,
    required String lastName,
    required String email,
    required String phone,
    required String password,
    required String confirmPassword,
    int? termsVersion,
    String? referralCode,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _apiService.signup(
        firstName: firstName,
        lastName: lastName,
        email: email,
        phone: phone,
        password: password,
        confirmPassword: confirmPassword,
        termsVersion: termsVersion,
        referralCode: referralCode,
      );

      _token = response['token'];
      _user = response['user'];

      await _apiService.setToken(_token!);
      notifyListeners();

      return true;
    } catch (e) {
      _error = friendlyError(e);
      notifyListeners();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Set when the server wants an SMS code before it will sign this phone in (a phone the account has not used before)
  Map<String, dynamic>? pendingDevice;

  // Finishes a sign-in that needed the new-phone check
  Future<void> completeDeviceLogin(Map<String, dynamic> response) async {
    _token = response['token'];
    _user = response['user'];
    pendingDevice = null;
    await _apiService.setToken(_token!);
    notifyListeners();
  }

  Future<bool> login({
    required String email,
    required String password,
  }) async {
    pendingDevice = null;
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _apiService.login(
        email: email,
        password: password,
      );

      if (response['deviceVerificationRequired'] == true) {
        pendingDevice = {'deviceToken': response['deviceToken'], 'phone': response['phone'], 'message': response['message']};
        return false;
      }

      _token = response['token'];
      _user = response['user'];

      await _apiService.setToken(_token!);
      notifyListeners();

      return true;
    } catch (e) {
      _error = friendlyError(e);
      notifyListeners();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    _token = null;
    _user = null;
    await _apiService.clearToken();
    await AppLock.instance.removePin(); // the PIN belongs to the signed-in customer
    notifyListeners();
  }

  Future<void> loadUserProfile() async {
    try {
      _user = await _apiService.getUserProfile();
      notifyListeners();
    } catch (e) {
      _error = friendlyError(e);
      notifyListeners();
    }
  }
}
