// Indian States List
const List<String> indianStates = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

// Employment Status
const List<String> employmentStatus = [
  'Employed',
  'Self-Employed',
  'Student',
  'Unemployed',
  'Retired',
  'Homemaker',
];

// Major Indian Bank IFSC Codes (Sample - can expand)
final Map<String, String> bankIfscMap = {
  'SBIN': 'State Bank of India',
  'HDFC': 'HDFC Bank',
  'ICIC': 'ICICI Bank',
  'AXIS': 'Axis Bank',
  'BKID': 'Bank of India',
  'BKDN': 'Bank of Baroda',
  'UTIB': 'Axis Bank',
  'IDFB': 'IDBI Bank',
  'INDB': 'IndusInd Bank',
  'KOTAK': 'Kotak Mahindra Bank',
  'IDFC': 'IDFC Bank',
  'AMZN': 'Amazon Pay',
  'AIRP': 'Airtel Payments Bank',
  'JAKA': 'Jio Payments Bank',
  'YESB': 'YES Bank',
  'HSBC': 'HSBC Bank',
  'BARC': 'Barclays Bank',
  'UTIS': 'Union Bank of India',
  'PUNB': 'Punjab National Bank',
  'CBIN': 'Central Bank of India',
};

// Commonly used IFSC codes
const List<Map<String, String>> commonIfscCodes = [
  {'code': 'SBIN0001234', 'bank': 'State Bank of India', 'branch': 'Mumbai'},
  {'code': 'HDFC0001234', 'bank': 'HDFC Bank', 'branch': 'Mumbai'},
  {'code': 'ICIC0000001', 'bank': 'ICICI Bank', 'branch': 'Mumbai'},
  {'code': 'AXIS0001234', 'bank': 'Axis Bank', 'branch': 'Mumbai'},
  {'code': 'BKID0001234', 'bank': 'Bank of India', 'branch': 'Mumbai'},
  {'code': 'UTIB0001234', 'bank': 'Axis Bank', 'branch': 'Bangalore'},
];
