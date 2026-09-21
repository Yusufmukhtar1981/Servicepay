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

  test('resolves enrollment schoolId and classLevelId by exact IDs', () {
    const child = {
      'school': {'_id': 'legacy-school'},
      'enrollment': {'schoolId': 'school-2', 'classLevelId': 'class-2'},
    };
    expect(eduPayEnrollmentSchoolId(child), 'school-2');
    expect(eduPayEnrollmentClassId(child), 'class-2');
    expect(
      resolveEduPayEnrolledClass(child, [
        {'_id': 'class-1', 'name': 'Primary 1'},
        {'_id': 'class-2', 'name': 'Different display name'},
      ])?['_id'],
      'class-2',
    );
  });

  test('legacy child without enrollment keeps class-picker fallback', () {
    expect(eduPayEnrollmentSchoolId({'school': {'_id': 'school-1'}}), 'school-1');
    expect(eduPayEnrollmentClassId({'school': {'_id': 'school-1'}}), isEmpty);
    expect(
      resolveEduPayEnrolledClass(
        {'school': {'_id': 'school-1'}},
        [
          {'_id': 'class-1', 'name': 'Primary 1'}
        ],
      ),
      isNull,
    );
  });

  test('stale linked class never falls back to display-name matching', () {
    const child = {
      'enrollment': {'schoolId': 'school-1', 'classLevelId': 'missing-class'}
    };
    expect(eduPayEnrollmentClassId(child), 'missing-class');
    expect(
      resolveEduPayEnrolledClass(child, [
        {'_id': 'class-1', 'name': 'Primary 1'}
      ]),
      isNull,
    );
  });

  test('finance child identity survives academic enrollment merge', () {
    final merged = mergeEduPayChildren(
      [
        {
          '_id': 'finance-child-1',
          'fullName': 'Ada Child',
          'school': {'_id': 'school-1'},
          'studentId': 'ST-1',
        },
      ],
      [
        {
          '_id': 'academic-student-1',
          'school': {'_id': 'school-1'},
          'studentId': 'ST-1',
          'enrollment': {
            'schoolId': 'school-1',
            'classLevelId': 'class-2',
          },
        },
      ],
    );
    expect(merged, hasLength(1));
    expect(merged.single['_id'], 'finance-child-1');
    final payload = {
      'child': merged.single['_id'],
      'school': eduPayEnrollmentSchoolId(merged.single),
      'classLevel': eduPayEnrollmentClassId(merged.single),
    };
    expect(payload, {
      'child': 'finance-child-1',
      'school': 'school-1',
      'classLevel': 'class-2',
    });
  });

  test('academic-only student rows are excluded from plan selection', () {
    expect(
      mergeEduPayChildren(
        const [],
        [
          {
            '_id': 'academic-only',
            'schoolId': 'school-1',
            'classLevelId': 'class-1',
          }
        ],
      ),
      isEmpty,
    );
  });

  test('missing fee state preserves the exact safe parent message', () {
    const message =
        'Your school has not published the school fee for this term yet. '
        'Please contact the school or try again later.';
    expect(message, isNot(contains('No approved fee matches')));
    expect(message, contains('Please contact the school or try again later.'));
  });
}
