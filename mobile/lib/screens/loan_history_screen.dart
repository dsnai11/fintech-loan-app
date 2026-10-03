import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/api_service.dart';
import '../utils/error_utils.dart';
import 'loan_detail_screen.dart';

class LoanHistoryScreen extends StatefulWidget {
  const LoanHistoryScreen({Key? key}) : super(key: key);

  @override
  State<LoanHistoryScreen> createState() => _LoanHistoryScreenState();
}

class _LoanHistoryScreenState extends State<LoanHistoryScreen> {
  List<Map<String, dynamic>> _loans = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchLoans();
  }

  Future<void> _fetchLoans() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = context.read<ApiService>();
      final loans = await api.getAllLoans();
      setState(() { _loans = loans; _loading = false; });
    } catch (e) {
      setState(() { _error = friendlyError(e); _loading = false; });
    }
  }

  String _fmtMoney(dynamic v) {
    if (v == null) return '₹—';
    final n = (v is num) ? v.toInt() : int.tryParse(v.toString()) ?? 0;
    return '₹${n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{2})+(\d)(?!\d))'), (m) => '${m[1]},')}';
  }

  String _fmtDate(String? iso) {
    if (iso == null) return '—';
    try {
      final d = DateTime.parse(iso);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${d.day} ${months[d.month-1]} ${d.year}';
    } catch (_) { return iso; }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'disbursed': return kGreen;
      case 'approved': return const Color(0xFF3B82F6);
      case 'rejected': return const Color(0xFFEF4444);
      case 'under_review': return const Color(0xFFF59E0B);
      default: return const Color(0xFF6B7280);
    }
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'disbursed': return 'Disbursed';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      case 'under_review': return 'Under Review';
      case 'submitted': return 'Submitted';
      case 'closed': return 'Closed';
      default: return status;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBg,
      body: Column(
        children: [
          // Header
          Container(
            color: kNavy,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                child: Row(
                  children: [
                    GestureDetector(
                      onTap: () => Navigator.pop(context),
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.arrow_back_ios_new_rounded,
                            color: Colors.white, size: 18),
                      ),
                    ),
                    const SizedBox(width: 14),
                    const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Loan History',
                            style: TextStyle(color: Colors.white, fontSize: 20,
                                fontWeight: FontWeight.w700)),
                        Text('All your loan applications',
                            style: TextStyle(color: Colors.white60, fontSize: 12)),
                      ],
                    ),
                    const Spacer(),
                    GestureDetector(
                      onTap: _fetchLoans,
                      child: const Icon(Icons.refresh_rounded, color: Colors.white60, size: 22),
                    ),
                  ],
                ),
              ),
            ),
          ),

          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: kNavy))
                : _error != null
                    ? _buildError()
                    : _loans.isEmpty
                        ? _buildEmpty()
                        : RefreshIndicator(
                            onRefresh: _fetchLoans,
                            color: kNavy,
                            child: ListView.builder(
                              padding: const EdgeInsets.all(16),
                              itemCount: _loans.length,
                              itemBuilder: (_, i) => _buildCard(_loans[i]),
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildCard(Map<String, dynamic> loan) {
    final status = loan['status'] ?? 'submitted';
    final statusColor = _statusColor(status);

    final repayable = status == 'disbursed' || status == 'closed';

    return GestureDetector(
      onTap: repayable
          ? () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => LoanDetailScreen(loan: loan)),
              )
          : null,
      child: Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top row
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: kNavy.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.description_rounded, color: kNavy, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(loan['loanType'] ?? 'Personal Loan',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14,
                              color: Color(0xFF111827))),
                      Text('Applied: ${_fmtDate(loan['applicationDate'] ?? loan['createdAt'])}',
                          style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(_statusLabel(status),
                      style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.w700)),
                ),
              ],
            ),
          ),
          const Divider(height: 20, color: Color(0xFFF3F4F6), indent: 16, endIndent: 16),

          // Details row
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
            child: Row(
              children: [
                _stat('Amount', _fmtMoney(loan['loanAmount'])),
                _stat('EMI', _fmtMoney(loan['monthlyEMI'])),
                _stat('Tenure', '${loan['tenure']} mo'),
                _stat('Rate', '${loan['interestRate'] ?? 15}%'),
              ],
            ),
          ),
          if (repayable)
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Text('View EMI schedule & pay  ›',
                  style: TextStyle(color: kNavy, fontSize: 12, fontWeight: FontWeight.w700)),
            ),
        ],
      ),
      ),
    );
  }

  Widget _stat(String label, String value) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 10, color: Color(0xFF9CA3AF),
                  fontWeight: FontWeight.w600, letterSpacing: 0.5)),
          const SizedBox(height: 3),
          Text(value,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700,
                  color: Color(0xFF111827))),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: kNavy.withOpacity(0.06),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.description_outlined, color: kNavy, size: 40),
          ),
          const SizedBox(height: 16),
          const Text('No loans yet',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF111827))),
          const SizedBox(height: 6),
          const Text('Your loan applications will appear here.',
              style: TextStyle(color: Color(0xFF6B7280), fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.wifi_off_rounded, color: Color(0xFF9CA3AF), size: 48),
          const SizedBox(height: 12),
          Text('Could not load loans\n${_error ?? ''}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF6B7280), fontSize: 13)),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: _fetchLoans, child: const Text('Retry')),
        ],
      ),
    );
  }
}
