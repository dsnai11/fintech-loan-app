import 'package:flutter/material.dart';
import 'api_service.dart';

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
      );

      _token = response['token'];
      _user = response['user'];

      await _apiService.setToken(_token!);
      notifyListeners();

      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> login({
    required String email,
    required String password,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _apiService.login(
        email: email,
        password: password,
      );

      _token = response['token'];
      _user = response['user'];

      await _apiService.setToken(_token!);
      notifyListeners();

      return true;
    } catch (e) {
      _error = e.toString();
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
    notifyListeners();
  }

  Future<void> loadUserProfile() async {
    try {
      _user = await _apiService.getUserProfile();
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }
}
