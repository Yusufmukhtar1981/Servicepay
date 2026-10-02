import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/widgets/saved_beneficiaries.dart';

void main() {
  group('SavedBeneficiaries', () {
    late TextEditingController phoneController;
    late List<Map<String, dynamic>> saved;
    late int loadCount;
    late bool failLoad;
    late bool failSave;

    setUp(() {
      phoneController = TextEditingController(text: '0803 123 4567');
      saved = <Map<String, dynamic>>[];
      loadCount = 0;
      failLoad = false;
      failSave = false;
    });

    tearDown(() => phoneController.dispose());

    Future<void> pumpWidgetUnderTest(
      WidgetTester tester, {
      BeneficiaryLoader? loader,
      BeneficiarySaver? saver,
      BeneficiaryUpdater? updater,
      BeneficiaryDeleter? deleter,
    }) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: SavedBeneficiaries(
                phoneController: phoneController,
                network: 'MTN',
                serviceType: 'AIRTIME',
                loadBeneficiaries: loader ??
                    () async {
                      loadCount++;
                      if (failLoad)
                        throw Exception('Could not load saved numbers');
                      return saved
                          .map((item) => Map<String, dynamic>.from(item))
                          .toList();
                    },
                saveBeneficiary: saver ??
                    ({
                      required String phone,
                      required String name,
                      required String network,
                      required String serviceType,
                    }) async {
                      if (failSave) throw Exception('Number already saved');
                      saved.add({
                        '_id': 'saved-${saved.length + 1}',
                        'phone': phone,
                        'name': name,
                      });
                      return {'success': true};
                    },
                updateBeneficiary: updater ??
                    ({
                      required String id,
                      required String name,
                    }) async {
                      final item =
                          saved.firstWhere((entry) => entry['_id'] == id);
                      item['name'] = name;
                      return {'success': true};
                    },
                deleteBeneficiary: deleter ??
                    (String id) async {
                      saved.removeWhere((entry) => entry['_id'] == id);
                      return {'success': true};
                    },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets(
        'always shows saved numbers, handles empty and loading error retry',
        (tester) async {
      failLoad = true;
      await pumpWidgetUnderTest(tester);
      expect(find.text('Saved Numbers'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.text('Save Number'), findsOneWidget);
      await tester.tap(find.text('Saved Numbers'));
      await tester.pumpAndSettle();
      expect(
          find.text(
              "Saved numbers couldn't load. You can still enter a number manually."),
          findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);

      failLoad = false;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(find.text('No saved numbers yet.'),
          findsOneWidget);
      expect(find.text('Search saved numbers'), findsOneWidget);
    });

    testWidgets('saves independently with optional nickname and reloads',
        (tester) async {
      await pumpWidgetUnderTest(tester);
      await tester.tap(find.text('Save Number'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, 'Phone Number'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'Nickname (optional)'), '');
      await tester.tap(find.text('Save').last);
      await tester.pumpAndSettle();

      expect(saved, hasLength(1));
      expect(saved.single['name'], '');
      expect(saved.single['phone'], '0803 123 4567');
      expect(find.byType(Dialog), findsNothing);
      await tester.tap(find.text('Saved Numbers'));
      await tester.pumpAndSettle();
      expect(find.text('0803 123 4567'), findsOneWidget);
      expect(loadCount, greaterThanOrEqualTo(2));
    });

    testWidgets('searches locally, selects phone, renames, deletes and reloads',
        (tester) async {
      saved.addAll([
        {'_id': '1', 'phone': '0803 111 2222', 'name': 'Mum'},
        {'_id': '2', 'phone': '0805 333 4444', 'name': ''},
      ]);
      await pumpWidgetUnderTest(tester);
      await tester.tap(find.text('Saved Numbers'));
      await tester.pumpAndSettle();
      final initialLoads = loadCount;

      await tester.enterText(find.byType(TextField).first, 'office');
      await tester.pumpAndSettle();
      expect(find.text('No saved numbers match “office”.'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(loadCount, initialLoads);

      await tester.enterText(find.byType(TextField).first, '0805');
      await tester.pumpAndSettle();
      expect(find.text('0805 333 4444'), findsOneWidget);
      await tester.tap(find.text('0805 333 4444'));
      await tester.pumpAndSettle();
      expect(phoneController.text, '0805 333 4444');
      expect(find.byType(TextField), findsNothing);
      await tester.tap(find.text('Saved Numbers'));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Rename 0805 333 4444'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, 'Office');
      await tester.tap(find.text('Save').last);
      await tester.pumpAndSettle();
      expect(saved.last['name'], 'Office');

      await tester.tap(find.byTooltip('Delete 0805 333 4444'));
      await tester.pumpAndSettle();
      expect(find.text('Delete saved number?'), findsOneWidget);
      await tester.tap(find.text('Delete').last);
      await tester.pumpAndSettle();
      expect(saved, hasLength(1));
      await tester.enterText(find.byType(TextField).first, '');
      await tester.pumpAndSettle();
      expect(find.text('Mum'), findsOneWidget);
      expect(loadCount, greaterThan(initialLoads));
    });

    testWidgets('shows mutation errors and keeps duplicate errors visible',
        (tester) async {
      failSave = true;
      await pumpWidgetUnderTest(tester);
      await tester.tap(find.text('Save Number'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save').last);
      await tester.pumpAndSettle();
      expect(find.text('Number already saved'), findsOneWidget);
      expect(find.text('Saved Numbers'), findsOneWidget);
    });

    testWidgets('rename and delete failures are shown without losing entries',
        (tester) async {
      saved.add({'_id': '9', 'phone': '0802 555 2222', 'name': 'Aunty'});
      await pumpWidgetUnderTest(
        tester,
        updater: ({required String id, required String name}) async {
          throw Exception('Rename failed');
        },
        deleter: (String id) async {
          throw Exception('Delete failed');
        },
      );
      await tester.tap(find.text('Saved Numbers'));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Rename 0802 555 2222'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, 'Aunty B');
      await tester.tap(find.text('Save').last);
      await tester.pumpAndSettle();
      expect(find.text('Rename failed'), findsOneWidget);
      expect(find.text('Aunty'), findsOneWidget);

      await tester.tap(find.byTooltip('Delete 0802 555 2222'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete').last);
      await tester.pumpAndSettle();
      expect(find.text('Delete failed'), findsOneWidget);
      expect(saved, hasLength(1));
    });

    testWidgets('external save notification reloads mounted widgets',
        (tester) async {
      await pumpWidgetUnderTest(tester);
      final before = loadCount;
      saved.add({'_id': '3', 'phone': '0809 222 3333', 'name': 'Dad'});
      SavedBeneficiaries.notifySaved();
      await tester.pumpAndSettle();
      expect(loadCount, greaterThan(before));
      await tester.tap(find.text('Saved Numbers'));
      await tester.pumpAndSettle();
      expect(find.text('Dad'), findsOneWidget);
    });
    testWidgets('mobile actions stay compact without fetching on rebuild or open', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await pumpWidgetUnderTest(tester);
      expect(tester.getSize(find.byType(SavedBeneficiaries)).height, lessThan(100));
      expect(find.text('No saved numbers yet.'),findsNothing);
      final before = loadCount;
      await tester.pump();
      await tester.tap(find.text('Saved Numbers'));
      await tester.pumpAndSettle();
      expect(loadCount,before);
      await tester.enterText(find.byType(TextField).first,'somebody');
      await tester.pumpAndSettle();
      expect(loadCount,before);
    });
    testWidgets('Save Number has editable phone, blocks repeated submits and closes on success', (tester) async {
      final pending=Completer<Map<String,dynamic>>();
      var writes=0;
      String? submittedPhone;
      await pumpWidgetUnderTest(tester,saver:({required String phone,required String name,required String network,required String serviceType}){
        writes++;submittedPhone=phone;return pending.future;
      });
      await tester.tap(find.text('Save Number'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField,'Phone Number'),'08012345678');
      final save=find.text('Save').last;
      await tester.tap(save);await tester.pump();
      await tester.tap(find.text('Saving…'),warnIfMissed:false);await tester.pump();
      expect(writes,1);expect(submittedPhone,'08012345678');
      pending.complete({'success':true});
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField,'Phone Number'),findsNothing);
    });
    testWidgets('pending selector can be dismissed without leaving a loading overlay', (tester) async {
      final pending=Completer<List<Map<String,dynamic>>>();
      await tester.pumpWidget(MaterialApp(home:Scaffold(body:SavedBeneficiaries(
        phoneController:phoneController,network:'MTN',serviceType:'DATA',
        loadBeneficiaries:()=>pending.future))));
      await tester.pump();
      await tester.tap(find.text('Saved Numbers'));
      await tester.pump(const Duration(milliseconds:400));
      Navigator.of(tester.element(find.byType(TextField).first)).pop();
      await tester.pump(const Duration(milliseconds:400));
      pending.complete([]);await tester.pumpAndSettle();
      expect(find.byType(CircularProgressIndicator),findsNothing);
      expect(find.byType(TextField),findsNothing);
    });
  });
}
