import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  late Dio _dio;
  static const String baseUrl = 'https://fintech-loan-app-production.up.railway.app/api';
  String? _token;

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
      headers: {
        'Content-Type': 'application/json',
      },
    ));

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (_token != null) {
            options.headers['Authorization'] = 'Bearer $_token';
          }
          return handler.next(options);
        },
        onError: (error, handler) {
          return handler.next(error);
        },
      ),
    );

    _loadToken();
  }

  Future<void> _loadToken() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('auth_token');
  }

  Future<void> setToken(String token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('auth_token', token);
  }

  Future<void> clearToken() async {
    _token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
  }

  bool get isAuthenticated => _token != null;

  // Auth endpoints
  Future<Map<String, dynamic>> signup({
    required String firstName,
    required String lastName,
    required String email,
    required String phone,
    required String password,
    required String confirmPassword,
  }) async {
    try {
      final response = await _dio.post(
        '/auth/signup',
        data: {
          'firstName': firstName,
          'lastName': lastName,
          'email': email,
          'phone': phone,
          'password': password,
          'confirmPassword': confirmPassword,
        },
      );
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await _dio.post(
        '/auth/login',
        data: {
          'email': email,
          'password': password,
        },
      );
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // User endpoints
  Future<Map<String, dynamic>> getUserProfile() async {
    try {
      final response = await _dio.get('/users/profile');
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> updateUserProfile(Map<String, dynamic> data) async {
    try {
      final response = await _dio.put('/users/profile', data: data);
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Loan endpoints
  Future<Map<String, dynamic>> applyLoan({
    required int loanAmount,
    required int tenure,
    required String purpose,
    String loanType = 'Personal Loan',
  }) async {
    try {
      final response = await _dio.post(
        '/loans/apply',
        data: {
          'loanAmount': loanAmount,
          'tenure': tenure,
          'purpose': purpose,
          'loanType': loanType,
        },
      );
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<List<Map<String, dynamic>>> getAllLoans() async {
    try {
      final response = await _dio.get('/loans');
      return List<Map<String, dynamic>>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getLoanDetails(String loanId) async {
    try {
      final response = await _dio.get('/loans/$loanId');
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Full loan application (7-step flow)
  Future<Map<String, dynamic>> applyLoanFull({
    required int loanAmount,
    required int tenure,
    required String purpose,
    required String planType,
    String loanType = 'Personal Loan',
    Map<String, dynamic>? bankDetails,
    Map<String, dynamic>? personalDetails,
  }) async {
    try {
      final response = await _dio.post(
        '/loans/apply-full',
        data: {
          'loanAmount': loanAmount,
          'tenure': tenure,
          'purpose': purpose,
          'loanType': loanType,
          'planType': planType,
          if (bankDetails != null) 'bankDetails': bankDetails,
          if (personalDetails != null) 'personalDetails': personalDetails,
        },
      );
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // KYC endpoints
  Future<Map<String, dynamic>> sendOtp() async {
    try {
      final response = await _dio.post('/kyc/otp/send');
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> verifyOtp(String otp) async {
    try {
      final response = await _dio.post('/kyc/otp/verify', data: {'otp': otp});
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> verifyPan(String panNumber, {String? dob}) async {
    try {
      final response = await _dio.post('/kyc/pan', data: {
        'panNumber': panNumber,
        if (dob != null) 'dob': dob,
      });
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> verifyBank({
    required String accountNumber,
    required String ifscCode,
    required String accountHolder,
  }) async {
    try {
      final response = await _dio.post('/kyc/bank', data: {
        'accountNumber': accountNumber,
        'ifscCode': ifscCode,
        'accountHolder': accountHolder,
      });
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Exception _handleError(DioException error) {
    String message;
    if (error.response?.data is Map) {
      message = (error.response!.data as Map)['error']?.toString() ?? '';
    } else {
      message = '';
    }
    if (message.isEmpty) {
      if (error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.receiveTimeout ||
          error.type == DioExceptionType.sendTimeout) {
        message = 'Request timed out. Check your connection and try again.';
      } else if (error.type == DioExceptionType.connectionError) {
        message = 'No internet connection. Check your network and try again.';
      } else if (error.response?.statusCode == 401) {
        message = 'Session expired. Please log in again.';
      } else if (error.response?.statusCode == 403) {
        message = 'You don\'t have permission to do this.';
      } else if (error.response?.statusCode == 404) {
        message = 'Service not found. Please update the app.';
      } else if (error.response?.statusCode != null && error.response!.statusCode! >= 500) {
        message = 'Server error. Please try again in a moment.';
      } else {
        message = error.message?.isNotEmpty == true ? error.message! : 'Something went wrong. Please try again.';
      }
    }
    return Exception(message);
  }
}
