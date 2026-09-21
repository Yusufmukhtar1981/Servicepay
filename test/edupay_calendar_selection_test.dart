import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/edupay/edupay_screen.dart';

void main() {
  test('exposes all three published terms for the selected session', () {
    final terms = [
      {
        'id': 'term-1',
        'name': 'First Term',
        'session': 'session-current',
        'status': 'ACTIVE'
      },
      {
        'id': 'term-2',
        'name': 'Second Term',
        'session': 'session-current',
        'status': 'UPCOMING'
      },
      {
        'id': 'term-3',
        'name': 'Third Term',
        'session': 'session-current',
        'status': 'UPCOMING'
      },
      {
        'id': 'other-term',
        'name': 'First Term',
        'session': 'session-other',
        'status': 'ACTIVE'
      },
      {
        'id': 'closed-term',
        'name': 'Closed Term',
        'session': 'session-current',
        'status': 'CLOSED'
      },
    ];

    final result = eligibleEduPayTerms(terms, 'session-current');

    expect(result.map((term) => term['id']), ['term-1', 'term-2', 'term-3']);
  });

  test('allows active and upcoming sessions but excludes closed sessions', () {
    final result = eligibleEduPaySessions([
      {'id': 'closed', 'name': '2024/2025', 'status': 'CLOSED'},
      {'id': 'upcoming', 'name': '2027/2028', 'status': 'UPCOMING'},
      {
        'id': 'current',
        'name': '2026/2027',
        'status': 'ACTIVE',
        'isCurrent': true
      },
    ]);

    expect(result.map((session) => session['id']), ['current', 'upcoming']);
    expect(unambiguousCurrentEduPayOption(result)?['id'], 'current');
  });

  test('supports an upcoming session with a future term for advance savings',
      () {
    final sessions = eligibleEduPaySessions([
      {
        'id': 'current',
        'name': '2026/2027',
        'status': 'ACTIVE',
        'isCurrent': true
      },
      {'id': 'next', 'name': '2027/2028', 'status': 'UPCOMING'},
    ]);
    final terms = eligibleEduPayTerms([
      {
        'id': 'next-first',
        'name': 'First Term',
        'session': 'next',
        'status': 'UPCOMING'
      },
    ], 'next');

    expect(sessions.map((session) => session['id']), ['current', 'next']);
    expect(terms.single['id'], 'next-first');
  });

  test('returns no term when a school has not published another term', () {
    final result = eligibleEduPayTerms([
      {
        'id': 'only',
        'name': 'First Term',
        'session': 'session-1',
        'status': 'ACTIVE'
      },
    ], 'session-2');

    expect(result, isEmpty);
  });

  test('keeps children in different schools isolated by each school catalogue',
      () {
    final schoolOne = eligibleEduPayTerms([
      {'id': 'one-term', 'session': 'one', 'status': 'ACTIVE'},
      {'id': 'two-term', 'session': 'two', 'status': 'ACTIVE'},
    ], 'one');
    final schoolTwo = eligibleEduPayTerms([
      {'id': 'other-term', 'session': 'other', 'status': 'ACTIVE'},
    ], 'other');

    expect(schoolOne.single['id'], 'one-term');
    expect(schoolTwo.single['id'], 'other-term');
  });
}
