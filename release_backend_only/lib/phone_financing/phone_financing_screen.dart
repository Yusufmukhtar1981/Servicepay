import 'package:flutter/material.dart';
import 'phone_financing_api.dart';
import 'phone_financing_models.dart';

const _green = Color(0xFF08783E);
const _ink = Color(0xFF173126);
String _money(num n) => '₦${n.toStringAsFixed(2).replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+\.)'), (m) => '${m[1]},')}';
List<Map<String, dynamic>> _rows(Map<String, dynamic>? data, String key) => data?[key] is List ? (data![key] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

class PhoneFinancingScreen extends StatefulWidget {
  const PhoneFinancingScreen({super.key, this.api});
  final PhoneFinancingApi? api;
  @override State<PhoneFinancingScreen> createState() => _PhoneFinancingScreenState();
}
class _PhoneFinancingScreenState extends State<PhoneFinancingScreen> {
  late final PhoneFinancingApi api;
  int tab = 0; late Future<Map<String, dynamic>> products, applications, finance;
  @override void initState() { super.initState(); api = widget.api ?? PhoneFinancingApi(); _reload(); }
  void _reload() { products = api.products(); applications = api.applications(); finance = api.finance(); }
  void refresh() => setState(_reload);
  @override Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F9F6),
    body: SafeArea(child: IndexedStack(index: tab, children: [
      _Catalogue(api: api, products: products, refresh: refresh, onApplications: () => setState(() => tab = 1)),
      _Applications(api: api, future: applications, refresh: refresh),
      _Finance(api: api, future: finance, refresh: refresh),
    ])),
    bottomNavigationBar: NavigationBar(selectedIndex: tab, indicatorColor: const Color(0xFFDDF2E4), onDestinationSelected: (i) => setState(() => tab = i), destinations: const [
      NavigationDestination(icon: Icon(Icons.phone_android_outlined), selectedIcon: Icon(Icons.phone_android), label: 'Phones'),
      NavigationDestination(icon: Icon(Icons.description_outlined), selectedIcon: Icon(Icons.description), label: 'Applications'),
      NavigationDestination(icon: Icon(Icons.event_note_outlined), selectedIcon: Icon(Icons.event_note), label: 'My finance'),
    ]),
  );
}

class _Catalogue extends StatelessWidget {
  const _Catalogue({required this.api, required this.products, required this.refresh, required this.onApplications});
  final PhoneFinancingApi api; final Future<Map<String, dynamic>> products; final VoidCallback refresh, onApplications;
  @override Widget build(BuildContext context) => RefreshIndicator(onRefresh: () async => refresh(), color: _green, child: ListView(padding: const EdgeInsets.fromLTRB(20, 18, 20, 30), children: [
    Row(children: [IconButton(onPressed: () => Navigator.maybePop(context), icon: const Icon(Icons.arrow_back)), const Expanded(child: Text('Phone Financing', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: _ink))), IconButton(onPressed: onApplications, icon: const Icon(Icons.description_outlined, color: _green))]),
    const SizedBox(height: 12),
    Container(padding: const EdgeInsets.all(22), decoration: BoxDecoration(color: _green, borderRadius: BorderRadius.circular(26)), child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(Icons.verified_user_outlined, color: Color(0xFFFFD76B), size: 32), SizedBox(height: 14),
      Text('Own the phone you want.', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900)),
      SizedBox(height: 7), Text('Clear pricing, a simple application, and manageable weekly payments. No surprises.', style: TextStyle(color: Color(0xFFD9F1E2), height: 1.4)),
    ])),
    const SizedBox(height: 26), const Text('Available phones', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: _ink)), const SizedBox(height: 4),
    const Text('Every price and payment is calculated from the active product.', style: TextStyle(color: Color(0xFF66776C))),
    const SizedBox(height: 14), FutureBuilder<Map<String, dynamic>>(future: products, builder: (context, snap) {
      if (snap.connectionState != ConnectionState.done) return const _LoadingCards();
      if (snap.hasError) return _State(message: snap.error.toString(), retry: refresh);
      final list = _rows(snap.data, 'products'); if (list.isEmpty) return const _State(message: 'No phones are available right now.');
      return Column(children: list.map((j) => _ProductCard(
        product: PhoneProduct.fromJson(j),
        onTap: () => Navigator.push(context, MaterialPageRoute(
          builder: (_) => _ProductDetails(product: PhoneProduct.fromJson(j), api: api, onSubmitted: refresh),
        )),
      )).toList());
    }),
  ]));
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.onTap}); final PhoneProduct product; final VoidCallback onTap;
  @override Widget build(BuildContext context) => Card(color: Colors.white, elevation: 0, margin: const EdgeInsets.only(bottom: 13), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: const BorderSide(color: Color(0xFFDDEBE1))), child: InkWell(borderRadius: BorderRadius.circular(20), onTap: onTap, child: Padding(padding: const EdgeInsets.all(15), child: Row(children: [
    Container(width: 78, height: 90, decoration: BoxDecoration(color: const Color(0xFFEAF7F0), borderRadius: BorderRadius.circular(15)), child: product.images.isNotEmpty ? ClipRRect(borderRadius: BorderRadius.circular(15), child: Image.network(product.images.first, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.phone_android, color: _green, size: 35))) : const Icon(Icons.phone_android, color: _green, size: 35)),
    const SizedBox(width: 14), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${product.brand} ${product.name}', style: const TextStyle(fontWeight: FontWeight.w900, color: _ink, fontSize: 16)), const SizedBox(height: 5), Text('${product.specifications['storage'] ?? 'Storage not listed'} · ${product.specifications['ram'] ?? 'RAM not listed'}', style: const TextStyle(color: Color(0xFF6A7D70))), const SizedBox(height: 8), Text('${_money(product.weekly)} weekly', style: const TextStyle(color: _green, fontWeight: FontWeight.w900)), Text('${product.stock} in stock', style: const TextStyle(fontSize: 11, color: Color(0xFF7C8E82)))])), const Icon(Icons.chevron_right, color: _green)
  ]))));
}

class _ProductDetails extends StatelessWidget {
  const _ProductDetails({required this.product, required this.api, required this.onSubmitted}); final PhoneProduct product; final PhoneFinancingApi api; final VoidCallback onSubmitted;
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Phone details')), body: ListView(padding: const EdgeInsets.all(20), children: [
    Container(height: 190, decoration: BoxDecoration(color: const Color(0xFFEAF7F0), borderRadius: BorderRadius.circular(24)), child: product.images.isNotEmpty ? Image.network(product.images.first, fit: BoxFit.contain) : const Icon(Icons.phone_android, size: 90, color: _green)),
    const SizedBox(height: 20), Text('${product.brand} ${product.name}', style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w900, color: _ink)), Text(product.description, style: const TextStyle(color: Color(0xFF63766A), height: 1.4)),
    const SizedBox(height: 20), _priceGrid(product), const SizedBox(height: 18), _specs(product),
    const Text('Weekly quote is the financed remainder after deposit divided by installments. The final scheduled payment may differ by a few kobo after server rounding.', style: TextStyle(fontSize: 12, color: Color(0xFF68796E))),
    if (product.minimumKycTier.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text('This phone requires verified ${product.minimumKycTier.replaceAll('_', ' ')} KYC before approval.', style: const TextStyle(color: Color(0xFF68796E)))),
    const SizedBox(height: 22),
    FilledButton.icon(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _ApplicationForm(product: product, api: api, onSubmitted: onSubmitted))), style: FilledButton.styleFrom(backgroundColor: _green, minimumSize: const Size.fromHeight(54)), icon: const Icon(Icons.assignment_outlined), label: const Text('Apply for this phone')),
  ]));
}
Widget _priceGrid(PhoneProduct p) => Container(
  padding: const EdgeInsets.all(16),
  decoration: BoxDecoration(color: const Color(0xFFF0F7F2), borderRadius: BorderRadius.circular(18)),
  child: Wrap(runSpacing: 16, children: <Widget>[
    _stat('Cash price', _money(p.cashPrice)), _stat('Financed price', _money(p.financedPrice)),
    _stat('Deposit', _money(p.deposit)), _stat('Weekly payment', _money(p.weekly)),
    _stat('Duration', '${p.weeklyInstallments} weeks'), _stat('Stock', '${p.stock} available'),
  ].map((w) => SizedBox(width: 160, child: w)).toList()),
);
Widget _stat(String label, String value) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF6B7F72))), const SizedBox(height: 3), Text(value, style: const TextStyle(fontWeight: FontWeight.w900, color: _ink))]);
Widget _specs(PhoneProduct p) => Wrap(spacing: 8, runSpacing: 8, children: p.specifications.entries.map((e) => Chip(label: Text('${e.key}: ${e.value}'), backgroundColor: Colors.white)).toList());

class _ApplicationForm extends StatefulWidget {
  const _ApplicationForm({required this.product, required this.api, required this.onSubmitted}); final PhoneProduct product; final PhoneFinancingApi api; final VoidCallback onSubmitted;
  @override State<_ApplicationForm> createState() => _ApplicationFormState();
}
class _ApplicationFormState extends State<_ApplicationForm> {
  final form = GlobalKey<FormState>(); final occupation = TextEditingController(), income = TextEditingController(), address = TextEditingController(), state = TextEditingController(), lga = TextEditingController(), employer = TextEditingController(); String duration = ''; bool consent = false, busy = false; 
  @override void dispose() { for (final c in [occupation,income,address,state,lga,employer]) { c.dispose(); } super.dispose(); }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Your application')), body: Form(key: form, child: ListView(padding: const EdgeInsets.all(20), children: [
    Text('Apply for ${widget.product.brand} ${widget.product.name}', style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: _ink)), const SizedBox(height: 5), Text('We use these details to review your payment plan.', style: const TextStyle(color: Color(0xFF68796E))), const SizedBox(height: 20),
    _field(occupation, 'Occupation', Icons.work_outline), _field(income, 'Monthly income', Icons.payments_outlined, keyboard: TextInputType.number), _field(address, 'Residential address', Icons.home_outlined), _field(state, 'State', Icons.map_outlined), _field(lga, 'LGA', Icons.location_city_outlined), _field(employer, 'Employer (optional)', Icons.business_outlined, required: false),
    DropdownButtonFormField<String>(value: duration.isEmpty ? null : duration, decoration: const InputDecoration(labelText: 'Preferred duration', prefixIcon: Icon(Icons.date_range_outlined)), items: (widget.product.durationOptionsWeeks.isEmpty ? [widget.product.weeklyInstallments] : widget.product.durationOptionsWeeks).map((v) => DropdownMenuItem(value: v.toString(), child: Text('$v weeks'))).toList(), onChanged: (v) => setState(() => duration = v ?? ''), validator: (v) => v == null ? 'Choose a duration' : null),
    if (duration.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text('Quoted weekly payment: ${_money(widget.product.weeklyFor(int.parse(duration)))}', style: const TextStyle(color: _green, fontWeight: FontWeight.w900))),
    const Padding(padding: EdgeInsets.only(top: 4), child: Text('The final scheduled payment can vary by a few kobo after server rounding.', style: TextStyle(fontSize: 12, color: Color(0xFF68796E)))),
    const SizedBox(height: 12), CheckboxListTile(contentPadding: EdgeInsets.zero, value: consent, onChanged: (v) => setState(() => consent = v ?? false), title: const Text('I confirm these details are accurate and I agree to the phone financing terms.'), controlAffinity: ListTileControlAffinity.leading),
    const SizedBox(height: 15), FilledButton(onPressed: busy ? null : _submit, style: FilledButton.styleFrom(backgroundColor: _green, minimumSize: const Size.fromHeight(52)), child: busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Submit application')),
  ])));
  Widget _field(TextEditingController c, String label, IconData icon, {TextInputType? keyboard, bool required = true}) => Padding(padding: const EdgeInsets.only(bottom: 13), child: TextFormField(controller: c, keyboardType: keyboard, decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon)), validator: required ? (v) => v == null || v.trim().isEmpty ? 'Enter $label' : null : null));
  Future<void> _submit() async { if (!consent || !(form.currentState?.validate() ?? false)) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Complete the form and accept the consent statement.'))); return; } setState(() => busy = true); try { await widget.api.submit({'productId': widget.product.id, 'occupation': occupation.text.trim(), 'monthlyIncome': double.parse(income.text.trim().replaceAll(',', '')), 'residentialAddress': address.text.trim(), 'state': state.text.trim(), 'lga': lga.text.trim(), 'employer': employer.text.trim(), 'preferredDurationWeeks': int.parse(duration), 'consentAccepted': true, 'consent': true}); if (!mounted) return; widget.onSubmitted(); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Application submitted for review.'), backgroundColor: _green)); Navigator.popUntil(context, (r) => r.isFirst); } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); } finally { if (mounted) setState(() => busy = false); } }
}

class _Applications extends StatelessWidget {
  const _Applications({required this.api, required this.future, required this.refresh});
  final PhoneFinancingApi api; final Future<Map<String, dynamic>> future; final VoidCallback refresh;
  @override Widget build(BuildContext context) => _Page(title: 'My applications', refresh: refresh, child: FutureBuilder<Map<String, dynamic>>(future: future, builder: (context, snap) {
    if (snap.connectionState != ConnectionState.done) return const _LoadingCards();
    if (snap.hasError) return _State(message: snap.error.toString(), retry: refresh);
    final items = _rows(snap.data, 'applications'); if (items.isEmpty) return const _State(message: 'You have not started a phone application yet.');
    return Column(children: items.map((j) => _ApplicationTile(api: api, item: PhoneApplication.fromJson(j), refresh: refresh)).toList());
  }));
}
class _ApplicationTile extends StatelessWidget {
  const _ApplicationTile({required this.api, required this.item, required this.refresh}); final PhoneFinancingApi api; final PhoneApplication item; final VoidCallback refresh;
  @override Widget build(BuildContext context) { final p = item.product; return Card(color: Colors.white, elevation: 0, margin: const EdgeInsets.only(bottom: 12), child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Row(children: [Expanded(child: Text(p == null ? 'Phone application' : '${p.brand} ${p.name}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: _ink))), _Status(item.status)]), const SizedBox(height: 6), Text(item.reference.isEmpty ? 'Application under review' : item.reference, style: const TextStyle(color: Color(0xFF6A7B70), fontSize: 12)),
    if (item.input.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text('${item.input['occupation'] ?? ''} · ${item.input['monthlyIncome'] == null ? '' : _money(num.tryParse('${item.input['monthlyIncome']}') ?? 0)} · ${item.input['preferredDurationWeeks'] ?? ''} weeks', style: const TextStyle(color: Color(0xFF63766A), fontSize: 12))),
    if (item.depositRequired > 0) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Deposit: ${_money(item.depositPaid)} paid of ${_money(item.depositRequired)} required', style: const TextStyle(fontWeight: FontWeight.w700, color: _ink))),
    if (item.history.isNotEmpty) ...[const SizedBox(height: 14), ...item.history.reversed.take(3).map((h) => ListTile(contentPadding: EdgeInsets.zero, dense: true, leading: const Icon(Icons.check_circle_outline, color: _green, size: 20), title: Text('${h['status'] ?? ''}'.replaceAll('_', ' ')), subtitle: Text('${h['note'] ?? ''}')))],
    if (item.status == 'AWAITING_DEPOSIT') Align(alignment: Alignment.centerRight, child: FilledButton(onPressed: () => _pay(context), style: FilledButton.styleFrom(backgroundColor: _green), child: Text('Pay deposit ${_money(item.depositRequired - item.depositPaid)}')))
  ]))); }
  Future<void> _pay(BuildContext context) async { final amount = item.depositRequired - item.depositPaid; final result = await _paymentDialog(context, 'Pay your deposit', amount); if (result == null) return; try { final key = await api.pendingKey('deposit_${item.id}'); await api.deposit(item.id, amount, result, key); await api.completeKey('deposit_${item.id}'); if (context.mounted) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Deposit payment submitted.'), backgroundColor: _green)); refresh(); } } catch (e) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); } }
}

class _Finance extends StatelessWidget {
  const _Finance({required this.api, required this.future, required this.refresh}); final PhoneFinancingApi api; final Future<Map<String, dynamic>> future; final VoidCallback refresh;
  @override Widget build(BuildContext context) => _Page(title: 'My finance', refresh: refresh, child: FutureBuilder<Map<String, dynamic>>(future: future, builder: (context, snap) {
    if (snap.connectionState != ConnectionState.done) return const _LoadingCards();
    if (snap.hasError) return _State(message: snap.error.toString(), retry: refresh);
    final items = _rows(snap.data, 'finance'); if (items.isEmpty) return const _State(message: 'Your weekly schedule will appear here after handover.');
    return Column(children: items.map((j) => _FinanceCard(api: api, finance: PhoneFinance.fromJson(j), refresh: refresh)).toList());
  }));
}
class _FinanceCard extends StatelessWidget {
  const _FinanceCard({required this.api, required this.finance, required this.refresh}); final PhoneFinancingApi api; final PhoneFinance finance; final VoidCallback refresh;
  @override Widget build(BuildContext context) { final next = finance.schedule.cast<Map<String, dynamic>?>().firstWhere((r) => r?['status'] != 'PAID', orElse: () => null); final double amount = next == null ? 0 : num.tryParse('${next['amount']}')?.toDouble() ?? 0; return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Container(padding: const EdgeInsets.all(19), decoration: BoxDecoration(color: _green, borderRadius: BorderRadius.circular(24)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [const Expanded(child: Text('Phone finance summary', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 18))), _Status(finance.status, light: true)]), const SizedBox(height: 22),
      Text(_money(finance.outstanding), style: const TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w900)), const Text('remaining balance', style: TextStyle(color: Color(0xFFD9F1E2))), const SizedBox(height: 18),
      LinearProgressIndicator(value: finance.total == 0 ? 0 : (finance.paid / finance.total).clamp(0, 1), backgroundColor: const Color(0xFF4B9B6D), color: const Color(0xFFFFD76B)), const SizedBox(height: 9), Text('${_money(finance.paid)} paid of ${_money(finance.total)}', style: const TextStyle(color: Color(0xFFE5F5EA)))
    ])), const SizedBox(height: 20), Text('Weekly schedule', style: const TextStyle(color: _ink, fontSize: 19, fontWeight: FontWeight.w900)), const SizedBox(height: 8),
    if (finance.schedule.isEmpty) const Text('No schedule available yet.') else ...finance.schedule.map((r) => Card(
      color: Colors.white, elevation: 0, child: ListTile(
        leading: Icon(r['status'] == 'PAID' ? Icons.check_circle : Icons.calendar_today_outlined, color: r['status'] == 'PAID' ? _green : const Color(0xFF87988D)),
        title: Text('Installment ${r['installmentNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text('${r['status'] ?? 'PENDING'} · ${r['dueDate'] ?? ''}'),
        trailing: Text(_money(num.tryParse('${r['amount']}') ?? 0), style: const TextStyle(fontWeight: FontWeight.w900)),
      ),
    )),
    if (finance.device.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 14), child: Text('Device: ${finance.device['reference'] ?? finance.device['serialNumber'] ?? 'Assigned device'}${finance.device['status'] == null ? '' : ' · ${finance.device['status']}'}', style: const TextStyle(color: Color(0xFF63766A)))),
    if (finance.id.isNotEmpty) ExpansionTile(title: const Text('Payment history', style: TextStyle(fontWeight: FontWeight.w800)), children: [
      FutureBuilder<Map<String, dynamic>>(future: api.payments(finance.id), builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator(color: _green));
        if (snap.hasError) return Padding(padding: const EdgeInsets.all(12), child: Text(snap.error.toString()));
        final paid = _rows(snap.data, 'payments'); if (paid.isEmpty) return const Padding(padding: EdgeInsets.all(12), child: Text('No payments recorded yet.'));
        return Column(children: paid.map((p) => ListTile(dense: true, title: Text('${p['type'] ?? 'Payment'} · ${_money(num.tryParse('${p['amount']}') ?? 0)}'), subtitle: Text('${p['reference'] ?? ''} · ${p['createdAt'] ?? ''}'))).toList());
      }),
    ]),
    if (next != null && amount > 0) SizedBox(width: double.infinity, child: FilledButton(onPressed: () => _pay(context, amount), style: FilledButton.styleFrom(backgroundColor: _green, minimumSize: const Size.fromHeight(52)), child: Text('Pay exact weekly amount · ${_money(amount)}'))),
  ]); }
  Future<void> _pay(BuildContext context, double amount) async { final pin = await _paymentDialog(context, 'Confirm weekly payment', amount); if (pin == null) return; try { final key = await api.pendingKey('installment_${finance.id}'); await api.pay(finance.id, amount, pin, key); await api.completeKey('installment_${finance.id}'); if (context.mounted) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Weekly payment submitted.'), backgroundColor: _green)); refresh(); } } catch (e) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); } }
}

class _Page extends StatelessWidget {
  const _Page({required this.title, required this.child, required this.refresh}); final String title; final Widget child; final VoidCallback refresh;
  @override Widget build(BuildContext context) => RefreshIndicator(onRefresh: () async => refresh(), color: _green, child: ListView(padding: const EdgeInsets.fromLTRB(20, 18, 20, 30), children: [Row(children: [IconButton(onPressed: () => Navigator.maybePop(context), icon: const Icon(Icons.arrow_back)), Expanded(child: Text(title, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: _ink))), IconButton(onPressed: refresh, icon: const Icon(Icons.refresh, color: _green))]), const SizedBox(height: 16), child]));
}
class _Status extends StatelessWidget {
  const _Status(this.value, {this.light = false}); final String value; final bool light;
  @override Widget build(BuildContext context) => Container(padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6), decoration: BoxDecoration(color: light ? const Color(0xFF3B9461) : const Color(0xFFE3F4E8), borderRadius: BorderRadius.circular(20)), child: Text(value.replaceAll('_', ' '), style: TextStyle(color: light ? Colors.white : _green, fontSize: 11, fontWeight: FontWeight.w800)));
}
class _LoadingCards extends StatelessWidget { const _LoadingCards(); @override Widget build(BuildContext context) => Column(children: List.generate(3, (i) => Container(height: 110, margin: const EdgeInsets.only(bottom: 12), decoration: BoxDecoration(color: const Color(0xFFE6EEE8), borderRadius: BorderRadius.circular(20))))); }
class _State extends StatelessWidget { const _State({required this.message, this.retry}); final String message; final VoidCallback? retry; @override Widget build(BuildContext context) => Container(padding: const EdgeInsets.all(25), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)), child: Column(children: [const Icon(Icons.phone_android_outlined, color: _green, size: 38), const SizedBox(height: 10), Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF66776C))), if (retry != null) TextButton(onPressed: retry, child: const Text('Try again'))])); }
Future<String?> _paymentDialog(BuildContext context, String title, double amount) { final pin = TextEditingController(); return showDialog<String>(context: context, builder: (context) => AlertDialog(title: Text(title), content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Exact amount: ${_money(amount)}', style: const TextStyle(fontWeight: FontWeight.w900, color: _green)), const SizedBox(height: 15), TextField(controller: pin, autofocus: true, obscureText: true, keyboardType: TextInputType.number, maxLength: 4, decoration: const InputDecoration(labelText: 'Transaction PIN', prefixIcon: Icon(Icons.lock_outline)))]), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () { if (pin.text.length == 4) Navigator.pop(context, pin.text); }, style: FilledButton.styleFrom(backgroundColor: _green), child: const Text('Confirm'))])); }