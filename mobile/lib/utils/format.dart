// Indian digit grouping, e.g. 250000 -> ₹2,50,000
String formatMoney(num value) {
  final n = value.round();
  return '₹${n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{2})+(\d)(?!\d))'), (m) => '${m[1]},')}';
}

// 15 -> "15", 15.5 -> "15.5"
String formatPercent(num value) => value % 1 == 0 ? value.toStringAsFixed(0) : value.toStringAsFixed(1);

num asNum(dynamic v) => v is num ? v : (num.tryParse(v?.toString() ?? '') ?? 0);
