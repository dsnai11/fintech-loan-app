import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'selected_product.dart';

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
    int? termsVersion,
    String? referralCode,
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
          if (termsVersion != null) 'acceptedTerms': true,
          if (termsVersion != null) 'termsVersion': termsVersion,
          if (referralCode != null && referralCode.isNotEmpty) 'referralCode': referralCode,
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

  // A 5-minute link to the loan statement page, to open in the phone's browser
  Future<String> getStatementUrl(String loanId) async {
    try {
      final response = await _dio.post('/loans/$loanId/statement-link');
      final path = response.data['path'].toString();
      return baseUrl.replaceFirst(RegExp(r'/api$'), '') + path;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // EMI endpoints
  Future<Map<String, dynamic>> getEmiSchedule(String loanId) async {
    try {
      final response = await _dio.get('/emi/schedule/$loanId');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> payEmi(String loanId, int emiNumber) async {
    try {
      final response = await _dio.post('/emi/initiate/$loanId/$emiNumber');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getForeclosureQuote(String loanId) async {
    try {
      final response = await _dio.get('/emi/foreclosure/$loanId');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> foreclose(String loanId, num expectedAmount) async {
    try {
      final response = await _dio.post(
        '/emi/foreclosure/$loanId',
        data: {'expectedAmount': expectedAmount},
      );
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> forgotPassword(String email) async {
    try {
      await _dio.post('/auth/forgot-password', data: {'email': email});
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Pricing (public: the current rates, fees and the Key Fact Statement for an amount)
  // The most this customer may borrow now (higher for good repeat customers) and why, if not
  Future<Map<String, dynamic>> getRepeatOffer() async {
    try {
      final response = await _dio.get('/loans/repeat-offer');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // What the web portal controls in the app (products, notice, switches, maintenance). No sign-in needed.
  Future<Map<String, dynamic>> getAppSettings() async {
    try {
      final response = await _dio.get('/app-settings');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // The home screen's branding and the offer banners meant for this customer
  Future<Map<String, dynamic>> getHomeContent({String? lang}) async {
    try {
      final response = await _dio.get('/app-home', queryParameters: lang == null ? null : {'lang': lang});
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // The words for one language, and the languages on offer (no sign-in needed)
  Future<Map<String, dynamic>> getStrings(String lang) async {
    try {
      final response = await _dio.get('/app-home/strings', queryParameters: {'lang': lang});
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<List<Map<String, String>>> getLanguages() async {
    try {
      final response = await _dio.get('/app-home/languages');
      final list = (response.data['languages'] as List?) ?? [];
      return list.whereType<Map>().map((m) => m.map((k, v) => MapEntry(k.toString(), v.toString()))).toList();
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Remembers the customer's choice on the server. Only works when signed in; failures are ignored.
  Future<void> setUserLanguage(String code) async {
    try {
      await _dio.put('/users/language', data: {'language': code});
    } catch (_) {}
  }

  // The customer's referral code, rewards and the friends they invited
  Future<Map<String, dynamic>> getReferral() async {
    try {
      final response = await _dio.get('/referrals/me');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Push notifications: the customer's choices, and this phone's address for alerts
  Future<Map<String, dynamic>> getPushPreferences() async {
    try {
      final response = await _dio.get('/push/preferences');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> setPushPreferences(Map<String, bool> choices) async {
    try {
      final response = await _dio.put('/push/preferences', data: choices);
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> unregisterPushToken(String token) async {
    try {
      await _dio.delete('/push/register', data: {'token': token});
    } catch (_) {}
  }

  Future<void> registerPushToken(String token, String platform) async {
    try {
      await _dio.post('/push/register', data: {'token': token, 'platform': platform, 'appVersion': '1.0.0'});
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Sharing bank statements to check income
  Future<Map<String, dynamic>> getIncomeCheck() async {
    try {
      final response = await _dio.get('/income-check/mine');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> startIncomeCheck() async {
    try {
      final response = await _dio.post('/income-check/start');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> incomeCheckStatus(String sessionId) async {
    try {
      final response = await _dio.get('/income-check/status/$sessionId');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> removeIncomeCheck() async {
    try {
      await _dio.delete('/income-check/mine');
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Auto-debit of EMIs
  Future<Map<String, dynamic>> getMyMandates() async {
    try {
      final response = await _dio.get('/mandates/mine');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> startMandate(String loanId, String method) async {
    try {
      final response = await _dio.post('/mandates/start', data: {'loanId': loanId, 'method': method});
      return Map<String, dynamic>.from(response.data['mandate']);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> cancelMandate(String id) async {
    try {
      await _dio.post('/mandates/$id/cancel');
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // The Offers tab
  Future<Map<String, dynamic>> getOffers({String? lang}) async {
    try {
      final response = await _dio.get('/offers', queryParameters: lang == null ? null : {'lang': lang});
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> sendOfferEvent(String id, String type) async {
    try {
      await _dio.post('/offers/$id/event', data: {'type': type});
    } catch (_) {}
  }

  // Tells the company a banner was shown or tapped (for the counts in the portal). Never blocks the screen.
  Future<void> sendBannerEvent(String id, String type) async {
    try {
      await _dio.post('/app-home/event', data: {'id': id, 'type': type});
    } catch (_) {}
  }

  // Messages with the support team
  Future<Map<String, dynamic>?> getSupportThread() async {
    try {
      final response = await _dio.get('/support/thread');
      final t = response.data['thread'];
      return t == null ? null : Map<String, dynamic>.from(t);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> sendSupportMessage(String text, {String? faqId}) async {
    try {
      await _dio.post('/support/messages', data: {'text': text, if (faqId != null) 'faqId': faqId});
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // The AI assistant on the Messages tab: whether it is on and what it says first, "Talk to a person", and thumbs on an answer
  Future<Map<String, dynamic>> getAssistantInfo() async {
    try {
      final response = await _dio.get('/support/assistant');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Back to the assistant, before anyone from the team has replied
  Future<void> resumeAssistant() async {
    try {
      await _dio.post('/support/resume');
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Sends a test notification to this customer's own phone and returns what happened
  Future<Map<String, dynamic>> testPush() async {
    try {
      final response = await _dio.post('/push/test');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> requestPerson() async {
    try {
      await _dio.post('/support/handover');
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> rateAssistantAnswer(String messageId, String value) async {
    try {
      await _dio.post('/support/messages/$messageId/feedback', data: {'value': value});
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // `product` is the home-screen choice inside the loan flow; elsewhere the main product is meant.
  Future<Map<String, dynamic>> getPricing({String product = 'personal'}) async {
    try {
      final response = await _dio.get('/pricing', queryParameters: {'product': product});
      return Map<String, dynamic>.from(response.data['policy']);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // The credit check and the loan offer that comes from it, and the offer if there is a valid one already
  Future<Map<String, dynamic>> checkEligibility({required bool consent}) async {
    try {
      final response = await _dio.post('/loans/check-eligibility', data: {'consent': consent});
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getMyOffer() async {
    try {
      final response = await _dio.get('/loans/my-offer');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<List<Map<String, dynamic>>> getQuotes(int amount, {List<String> optional = const []}) async {
    try {
      final response = await _dio.get('/pricing/quotes', queryParameters: {'amount': amount, 'product': SelectedProduct.key, if (optional.isNotEmpty) 'optional': optional.join(',')});
      return List<Map<String, dynamic>>.from(response.data['quotes']);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getQuote({required int amount, String? plan, int? tenure, List<String> optional = const []}) async {
    try {
      final response = await _dio.get('/pricing/quote', queryParameters: {
        'amount': amount,
        'product': SelectedProduct.key,
        if (optional.isNotEmpty) 'optional': optional.join(','),
        if (plan != null) 'plan': plan,
        if (tenure != null) 'tenure': tenure,
      });
      return Map<String, dynamic>.from(response.data['quote']);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getCoolingOffQuote(String loanId) async {
    try {
      final response = await _dio.get('/emi/cooling-off/$loanId');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> coolOff(String loanId, num expectedAmount) async {
    try {
      final response = await _dio.post('/emi/cooling-off/$loanId', data: {'expectedAmount': expectedAmount});
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Compliance endpoints
  Future<Map<String, dynamic>> getAgreement(String loanId) async {
    try {
      final response = await _dio.get('/compliance/agreement/$loanId');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> acceptAgreement(String loanId, String hash) async {
    try {
      final response = await _dio.post(
        '/compliance/agreement/$loanId/accept',
        data: {'confirmed': true, 'hash': hash},
      );
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getMyData() async {
    try {
      final response = await _dio.get('/compliance/my-data');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> requestDeletion(String reason) async {
    try {
      final response = await _dio.post('/compliance/deletion-request', data: {'reason': reason});
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getDataRequests() async {
    try {
      final response = await _dio.get('/compliance/requests');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Notification endpoints
  Future<Map<String, dynamic>> getNotifications() async {
    try {
      final response = await _dio.get('/notifications');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> markNotificationRead(String id) async {
    try {
      await _dio.post('/notifications/$id/read');
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> markAllNotificationsRead() async {
    try {
      await _dio.post('/notifications/read-all');
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
    List<String> optionalCharges = const [],
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
          'productKey': SelectedProduct.key,
          if (optionalCharges.isNotEmpty) 'optionalCharges': optionalCharges,
          if (bankDetails != null) 'bankDetails': bankDetails,
          if (personalDetails != null) 'personalDetails': personalDetails,
        },
      );
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Account set-up: personal details, the selfie with its blink check, and DigiLocker
  Future<Map<String, dynamic>> saveOnboardingProfile(Map<String, dynamic> body) async {
    try {
      final response = await _dio.put('/onboarding/profile', data: body);
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> livenessChallenge() async {
    try {
      final response = await _dio.post('/onboarding/selfie/challenge');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // The two photos (base64) and what the camera saw of the eyes while the customer blinked
  Future<Map<String, dynamic>> submitSelfie({
    required String challengeId,
    required String before,
    required String after,
    required List<List<num>> samples,
    required int blinks,
  }) async {
    try {
      final response = await _dio.post(
        '/onboarding/selfie',
        data: {'challengeId': challengeId, 'before': before, 'after': after, 'blink': {'samples': samples, 'blinks': blinks}},
        options: Options(sendTimeout: const Duration(seconds: 60), receiveTimeout: const Duration(seconds: 60)),
      );
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // The customer's own selfie, for the profile
  Future<List<int>?> getSelfieBytes() async {
    try {
      final response = await _dio.get<List<int>>('/onboarding/selfie/image', options: Options(responseType: ResponseType.bytes));
      return response.data;
    } on DioException {
      return null;
    }
  }

  Future<Map<String, dynamic>> startDigilocker() async {
    try {
      final response = await _dio.post('/kyc/digilocker/start');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getDigilockerStatus(String sessionId) async {
    try {
      final response = await _dio.get('/kyc/digilocker/status/$sessionId');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Terms and conditions, and what is still to do after signing in
  Future<Map<String, dynamic>> getTerms() async {
    try {
      final response = await _dio.get('/terms');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> acceptTerms(int version) async {
    try {
      await _dio.post('/auth/accept-terms', data: {'version': version});
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getOnboarding() async {
    try {
      final response = await _dio.get('/auth/onboarding');
      return Map<String, dynamic>.from(response.data);
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Phone number check: a code is sent by SMS, then entered
  Future<Map<String, dynamic>> sendOtp() async {
    try {
      final response = await _dio.post('/auth/phone/send');
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> verifyOtp(String otp) async {
    try {
      final response = await _dio.post('/auth/phone/verify', data: {'code': otp});
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
