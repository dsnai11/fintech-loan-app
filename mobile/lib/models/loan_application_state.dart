class LoanApplicationState {
  final int loanAmount;
  final int tenure;
  final String planType; // 'one_time' | '3_emi' | '6_emi'
  String gender;
  String pincode;
  String address;
  String email;
  String accountHolder;
  String accountNumber;
  String ifscCode;

  LoanApplicationState({
    required this.loanAmount,
    required this.tenure,
    required this.planType,
    this.gender = 'Male',
    this.pincode = '',
    this.address = '',
    this.email = '',
    this.accountHolder = '',
    this.accountNumber = '',
    this.ifscCode = '',
  });
}
