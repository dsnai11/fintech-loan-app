// The loan product the customer chose on the home screen. The pricing, quotes and application that follow
// all use it, so each product's own limits and rate apply throughout the flow.
class SelectedProduct {
  static String key = 'personal';
  static String name = 'Personal Loan';

  static void choose(String productKey, String productName) {
    key = productKey;
    name = productName;
  }

  static void reset() => choose('personal', 'Personal Loan');
}
