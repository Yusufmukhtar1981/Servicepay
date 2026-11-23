import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'referral_attribution_service.dart';
import 'security_utils.dart';
import 'servicepay_theme.dart';
import 'login_screen.dart';
import 'widgets/registration_details_fields.dart';

export 'widgets/registration_details_fields.dart'
    show normalizeNigerianPhone, isValidRegistrationEmail;

/// Identity document used for KYC at registration.
enum RegistrationIdentityType { nin, bvn }

extension RegistrationIdentityTypeLabel on RegistrationIdentityType {
  String get code => this == RegistrationIdentityType.bvn ? 'BVN' : 'NIN';
}

Map<String, dynamic> buildRegistrationPayload({
  required String fullName,
  required String phone,
  required String email,
  required String password,
  required String transactionPin,
  required String confirmTransactionPin,
  required String dateOfBirth,
  required String gender,
  required String residentialAddress,
  required String state,
  required String lga,
  required String nin,
  String? referralCode,
  RegistrationIdentityType identityType = RegistrationIdentityType.nin,
}) =>
    <String, dynamic>{
      'fullName': fullName,
      'phone': phone,
      'email': email,
      'password': password,
      'transactionPin': transactionPin,
      'confirmTransactionPin': confirmTransactionPin,
      'dateOfBirth': dateOfBirth,
      'gender': gender,
      'residentialAddress': residentialAddress,
      'state': state,
      'lga': lga,
      // `nin` carries the identity number; BVN registrations send `bvn`
      // instead so the backend never treats a BVN as a NIN.
      if (identityType == RegistrationIdentityType.bvn)
        'bvn': nin
      else
        'nin': nin,
      'identityType': identityType.code,
      'kycConsent': true,
      'acceptTerms': true,
      if (referralCode != null && referralCode.isNotEmpty)
        'referralCode': referralCode,
    };

class SecureRegistrationScreen extends StatefulWidget {
  const SecureRegistrationScreen({
    super.key,
    this.client,
    this.initialReferralCode,
    this.referralService,
  });

  final http.Client? client;
  final String? initialReferralCode;
  final ReferralAttributionService? referralService;

  @override
  State<SecureRegistrationScreen> createState() =>
      _SecureRegistrationScreenState();
}

class _SecureRegistrationScreenState extends State<SecureRegistrationScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final _formKey = GlobalKey<FormState>();

  final fullNameController = TextEditingController();
  final phoneController = TextEditingController();
  final emailController = TextEditingController();
  final dobController = TextEditingController();
  final addressController = TextEditingController();
  final stateController = TextEditingController();
  final lgaController = TextEditingController();

  final passwordController = TextEditingController();
  final confirmPasswordController = TextEditingController();
  final pinController = TextEditingController();
  final confirmPinController = TextEditingController();

  final ninController = TextEditingController();
  final referralController = TextEditingController();

  bool loading = false;
  RegistrationIdentityType identityType = RegistrationIdentityType.nin;
  late final http.Client _client;
  late final bool _ownsClient;
  late final ReferralAttributionService _referralService;
  late final Future<void> _referralInitialization;

  bool acceptTerms = false;
  bool kycConsent = false;
  ReferralAttribution? _appliedAttribution;

  String gender = '';

  static const Map<String, List<String>> nigeriaStateLgas = {
    'Abia': [
      'Aba North',
      'Aba South',
      'Arochukwu',
      'Bende',
      'Ikwuano',
      'Isiala Ngwa North',
      'Isiala Ngwa South',
      'Isuikwuato',
      'Obi Ngwa',
      'Ohafia',
      'Osisioma',
      'Ugwunagbo',
      'Ukwa East',
      'Ukwa West',
      'Umuahia North',
      'Umuahia South',
      'Umu Nneochi'
    ],
    'Adamawa': [
      'Demsa',
      'Fufore',
      'Ganye',
      'Gayuk',
      'Gombi',
      'Grie',
      'Hong',
      'Jada',
      'Lamurde',
      'Madagali',
      'Maiha',
      'Mayo Belwa',
      'Michika',
      'Mubi North',
      'Mubi South',
      'Numan',
      'Shelleng',
      'Song',
      'Toungo',
      'Yola North',
      'Yola South'
    ],
    'Akwa Ibom': [
      'Abak',
      'Eastern Obolo',
      'Eket',
      'Esit Eket',
      'Essien Udim',
      'Etim Ekpo',
      'Etinan',
      'Ibeno',
      'Ibesikpo Asutan',
      'Ibiono-Ibom',
      'Ika',
      'Ikono',
      'Ikot Abasi',
      'Ikot Ekpene',
      'Ini',
      'Itu',
      'Mbo',
      'Mkpat-Enin',
      'Nsit-Atai',
      'Nsit-Ibom',
      'Nsit-Ubium',
      'Obot Akara',
      'Okobo',
      'Onna',
      'Oron',
      'Oruk Anam',
      'Udung-Uko',
      'Ukanafun',
      'Uruan',
      'Urue-Offong/Oruko',
      'Uyo'
    ],
    'Anambra': [
      'Aguata',
      'Anambra East',
      'Anambra West',
      'Anaocha',
      'Awka North',
      'Awka South',
      'Ayamelum',
      'Dunukofia',
      'Ekwusigo',
      'Idemili North',
      'Idemili South',
      'Ihiala',
      'Njikoka',
      'Nnewi North',
      'Nnewi South',
      'Ogbaru',
      'Onitsha North',
      'Onitsha South',
      'Orumba North',
      'Orumba South',
      'Oyi'
    ],
    'Bauchi': [
      'Alkaleri',
      'Bauchi',
      'Bogoro',
      'Damban',
      'Darazo',
      'Dass',
      'Gamawa',
      'Ganjuwa',
      'Giade',
      'Itas/Gadau',
      'Jamaare',
      'Katagum',
      'Kirfi',
      'Misau',
      'Ningi',
      'Shira',
      'Tafawa Balewa',
      'Toro',
      'Warji',
      'Zaki'
    ],
    'Bayelsa': [
      'Brass',
      'Ekeremor',
      'Kolokuma/Opokuma',
      'Nembe',
      'Ogbia',
      'Sagbama',
      'Southern Ijaw',
      'Yenagoa'
    ],
    'Benue': [
      'Ado',
      'Agatu',
      'Apa',
      'Buruku',
      'Gboko',
      'Guma',
      'Gwer East',
      'Gwer West',
      'Katsina-Ala',
      'Konshisha',
      'Kwande',
      'Logo',
      'Makurdi',
      'Obi',
      'Ogbadibo',
      'Ohimini',
      'Oju',
      'Okpokwu',
      'Otukpo',
      'Tarka',
      'Ukum',
      'Ushongo',
      'Vandeikya'
    ],
    'Borno': [
      'Abadam',
      'Askira/Uba',
      'Bama',
      'Bayo',
      'Biu',
      'Chibok',
      'Damboa',
      'Dikwa',
      'Gubio',
      'Guzamala',
      'Gwoza',
      'Hawul',
      'Jere',
      'Kaga',
      'Kala/Balge',
      'Konduga',
      'Kukawa',
      'Kwaya Kusar',
      'Mafa',
      'Magumeri',
      'Maiduguri',
      'Marte',
      'Mobbar',
      'Monguno',
      'Ngala',
      'Nganzai',
      'Shani'
    ],
    'Cross River': [
      'Abi',
      'Akamkpa',
      'Akpabuyo',
      'Bakassi',
      'Bekwarra',
      'Biase',
      'Boki',
      'Calabar Municipal',
      'Calabar South',
      'Etung',
      'Ikom',
      'Obanliku',
      'Obubra',
      'Obudu',
      'Odukpani',
      'Ogoja',
      'Yakurr',
      'Yala'
    ],
    'Delta': [
      'Aniocha North',
      'Aniocha South',
      'Bomadi',
      'Burutu',
      'Ethiope East',
      'Ethiope West',
      'Ika North East',
      'Ika South',
      'Isoko North',
      'Isoko South',
      'Ndokwa East',
      'Ndokwa West',
      'Okpe',
      'Oshimili North',
      'Oshimili South',
      'Patani',
      'Sapele',
      'Udu',
      'Ughelli North',
      'Ughelli South',
      'Ukwuani',
      'Uvwie',
      'Warri North',
      'Warri South',
      'Warri South West'
    ],
    'Ebonyi': [
      'Abakaliki',
      'Afikpo North',
      'Afikpo South',
      'Ebonyi',
      'Ezza North',
      'Ezza South',
      'Ikwo',
      'Ishielu',
      'Ivo',
      'Izzi',
      'Ohaozara',
      'Ohaukwu',
      'Onicha'
    ],
    'Edo': [
      'Akoko-Edo',
      'Egor',
      'Esan Central',
      'Esan North-East',
      'Esan South-East',
      'Esan West',
      'Etsako Central',
      'Etsako East',
      'Etsako West',
      'Igueben',
      'Ikpoba Okha',
      'Orhionmwon',
      'Oredo',
      'Ovia North-East',
      'Ovia South-West',
      'Owan East',
      'Owan West',
      'Uhunmwonde'
    ],
    'Ekiti': [
      'Ado Ekiti',
      'Efon',
      'Ekiti East',
      'Ekiti South-West',
      'Ekiti West',
      'Emure',
      'Gbonyin',
      'Ido Osi',
      'Ijero',
      'Ikere',
      'Ikole',
      'Ilejemeje',
      'Irepodun/Ifelodun',
      'Ise/Orun',
      'Moba',
      'Oye'
    ],
    'Enugu': [
      'Aninri',
      'Awgu',
      'Enugu East',
      'Enugu North',
      'Enugu South',
      'Ezeagu',
      'Igbo Etiti',
      'Igbo Eze North',
      'Igbo Eze South',
      'Isi Uzo',
      'Nkanu East',
      'Nkanu West',
      'Nsukka',
      'Oji River',
      'Udenu',
      'Udi',
      'Uzo-Uwani'
    ],
    'FCT': [
      'Abaji',
      'Abuja Municipal Area Council',
      'Bwari',
      'Gwagwalada',
      'Kuje',
      'Kwali'
    ],
    'Gombe': [
      'Akko',
      'Balanga',
      'Billiri',
      'Dukku',
      'Funakaye',
      'Gombe',
      'Kaltungo',
      'Kwami',
      'Nafada',
      'Shongom',
      'Yamaltu/Deba'
    ],
    'Imo': [
      'Aboh Mbaise',
      'Ahiazu Mbaise',
      'Ehime Mbano',
      'Ezinihitte',
      'Ideato North',
      'Ideato South',
      'Ihitte/Uboma',
      'Ikeduru',
      'Isiala Mbano',
      'Isu',
      'Mbaitoli',
      'Ngor Okpala',
      'Njaba',
      'Nkwerre',
      'Nwangele',
      'Obowo',
      'Oguta',
      'Ohaji/Egbema',
      'Okigwe',
      'Orlu',
      'Orsu',
      'Oru East',
      'Oru West',
      'Owerri Municipal',
      'Owerri North',
      'Owerri West',
      'Unuimo'
    ],
    'Jigawa': [
      'Auyo',
      'Babura',
      'Biriniwa',
      'Birnin Kudu',
      'Buji',
      'Dutse',
      'Gagarawa',
      'Garki',
      'Gumel',
      'Guri',
      'Gwaram',
      'Gwiwa',
      'Hadejia',
      'Jahun',
      'Kafin Hausa',
      'Kaugama',
      'Kazaure',
      'Kiri Kasama',
      'Kiyawa',
      'Maigatari',
      'Malam Madori',
      'Miga',
      'Ringim',
      'Roni',
      'Sule Tankarkar',
      'Taura',
      'Yankwashi'
    ],
    'Kaduna': [
      'Birnin Gwari',
      'Chikun',
      'Giwa',
      'Igabi',
      'Ikara',
      'Jaba',
      'Jema’a',
      'Kachia',
      'Kaduna North',
      'Kaduna South',
      'Kagarko',
      'Kajuru',
      'Kaura',
      'Kauru',
      'Kubau',
      'Kudan',
      'Lere',
      'Makarfi',
      'Sabon Gari',
      'Sanga',
      'Soba',
      'Zangon Kataf',
      'Zaria'
    ],
    'Kano': [
      'Ajingi',
      'Albasu',
      'Bagwai',
      'Bebeji',
      'Bichi',
      'Bunkure',
      'Dala',
      'Dambatta',
      'Dawakin Kudu',
      'Dawakin Tofa',
      'Doguwa',
      'Fagge',
      'Gabasawa',
      'Garko',
      'Garun Mallam',
      'Gaya',
      'Gezawa',
      'Gwale',
      'Gwarzo',
      'Kabo',
      'Kano Municipal',
      'Karaye',
      'Kibiya',
      'Kiru',
      'Kumbotso',
      'Kunchi',
      'Kura',
      'Madobi',
      'Makoda',
      'Minjibir',
      'Nasarawa',
      'Rano',
      'Rimin Gado',
      'Rogo',
      'Shanono',
      'Sumaila',
      'Takai',
      'Tarauni',
      'Tofa',
      'Tsanyawa',
      'Tudun Wada',
      'Ungogo',
      'Warawa',
      'Wudil'
    ],
    'Katsina': [
      'Bakori',
      'Batagarawa',
      'Batsari',
      'Baure',
      'Bindawa',
      'Charanchi',
      'Dandume',
      'Danja',
      'Dan Musa',
      'Daura',
      'Dutsi',
      'Dutsin-Ma',
      'Faskari',
      'Funtua',
      'Ingawa',
      'Jibia',
      'Kafur',
      'Kaita',
      'Kankara',
      'Kankia',
      'Katsina',
      'Kurfi',
      'Kusada',
      'MaiAdua',
      'Malumfashi',
      'Mani',
      'Mashi',
      'Matazu',
      'Musawa',
      'Rimi',
      'Sabuwa',
      'Safana',
      'Sandamu',
      'Zango'
    ],
    'Kebbi': [
      'Aleiro',
      'Arewa Dandi',
      'Argungu',
      'Augie',
      'Bagudo',
      'Birnin Kebbi',
      'Bunza',
      'Dandi',
      'Fakai',
      'Gwandu',
      'Jega',
      'Kalgo',
      'Koko/Besse',
      'Maiyama',
      'Ngaski',
      'Sakaba',
      'Shanga',
      'Suru',
      'Wasagu/Danko',
      'Yauri',
      'Zuru'
    ],
    'Kogi': [
      'Adavi',
      'Ajaokuta',
      'Ankpa',
      'Bassa',
      'Dekina',
      'Ibaji',
      'Idah',
      'Igalamela Odolu',
      'Ijumu',
      'Kabba/Bunu',
      'Kogi',
      'Lokoja',
      'Mopa Muro',
      'Ofu',
      'Ogori/Magongo',
      'Okehi',
      'Okene',
      'Olamaboro',
      'Omala',
      'Yagba East',
      'Yagba West'
    ],
    'Kwara': [
      'Asa',
      'Baruten',
      'Edu',
      'Ekiti',
      'Ifelodun',
      'Ilorin East',
      'Ilorin South',
      'Ilorin West',
      'Irepodun',
      'Isin',
      'Kaiama',
      'Moro',
      'Offa',
      'Oke Ero',
      'Oyun',
      'Pategi'
    ],
    'Lagos': [
      'Agege',
      'Ajeromi-Ifelodun',
      'Alimosho',
      'Amuwo-Odofin',
      'Apapa',
      'Badagry',
      'Epe',
      'Eti-Osa',
      'Ibeju-Lekki',
      'Ifako-Ijaiye',
      'Ikeja',
      'Ikorodu',
      'Kosofe',
      'Lagos Island',
      'Lagos Mainland',
      'Mushin',
      'Ojo',
      'Oshodi-Isolo',
      'Shomolu',
      'Surulere'
    ],
    'Nasarawa': [
      'Akwanga',
      'Awe',
      'Doma',
      'Karu',
      'Keana',
      'Keffi',
      'Kokona',
      'Lafia',
      'Nasarawa',
      'Nasarawa Egon',
      'Obi',
      'Toto',
      'Wamba'
    ],
    'Niger': [
      'Agaie',
      'Agwara',
      'Bida',
      'Borgu',
      'Bosso',
      'Chanchaga',
      'Edati',
      'Gbako',
      'Gurara',
      'Katcha',
      'Kontagora',
      'Lapai',
      'Lavun',
      'Magama',
      'Mariga',
      'Mashegu',
      'Mokwa',
      'Moya',
      'Paikoro',
      'Rafi',
      'Rijau',
      'Shiroro',
      'Suleja',
      'Tafa',
      'Wushishi'
    ],
    'Ogun': [
      'Abeokuta North',
      'Abeokuta South',
      'Ado-Odo/Ota',
      'Ewekoro',
      'Ifo',
      'Ijebu East',
      'Ijebu North',
      'Ijebu North East',
      'Ijebu Ode',
      'Ikenne',
      'Imeko Afon',
      'Ipokia',
      'Obafemi Owode',
      'Odeda',
      'Odogbolu',
      'Ogun Waterside',
      'Remo North',
      'Sagamu',
      'Yewa North',
      'Yewa South'
    ],
    'Ondo': [
      'Akoko North-East',
      'Akoko North-West',
      'Akoko South-East',
      'Akoko South-West',
      'Akure North',
      'Akure South',
      'Ese Odo',
      'Idanre',
      'Ifedore',
      'Ilaje',
      'Ile Oluji/Okeigbo',
      'Irele',
      'Odigbo',
      'Okitipupa',
      'Ondo East',
      'Ondo West',
      'Ose',
      'Owo'
    ],
    'Osun': [
      'Atakunmosa East',
      'Atakunmosa West',
      'Aiyedaade',
      'Aiyedire',
      'Boluwaduro',
      'Boripe',
      'Ede North',
      'Ede South',
      'Egbedore',
      'Ejigbo',
      'Ife Central',
      'Ife East',
      'Ife North',
      'Ife South',
      'Ifedayo',
      'Ifelodun',
      'Ila',
      'Ilesa East',
      'Ilesa West',
      'Irepodun',
      'Irewole',
      'Isokan',
      'Iwo',
      'Obokun',
      'Odo Otin',
      'Ola Oluwa',
      'Olorunda',
      'Oriade',
      'Orolu',
      'Osogbo'
    ],
    'Oyo': [
      'Afijio',
      'Akinyele',
      'Atiba',
      'Atisbo',
      'Egbeda',
      'Ibadan North',
      'Ibadan North-East',
      'Ibadan North-West',
      'Ibadan South-East',
      'Ibadan South-West',
      'Ibarapa Central',
      'Ibarapa East',
      'Ibarapa North',
      'Ido',
      'Irepo',
      'Iseyin',
      'Itesiwaju',
      'Iwajowa',
      'Kajola',
      'Lagelu',
      'Ogbomosho North',
      'Ogbomosho South',
      'Ogo Oluwa',
      'Olorunsogo',
      'Oluyole',
      'Ona Ara',
      'Orelope',
      'Ori Ire',
      'Oyo East',
      'Oyo West',
      'Saki East',
      'Saki West',
      'Surulere'
    ],
    'Plateau': [
      'Barkin Ladi',
      'Bassa',
      'Bokkos',
      'Jos East',
      'Jos North',
      'Jos South',
      'Kanam',
      'Kanke',
      'Langtang North',
      'Langtang South',
      'Mangu',
      'Mikang',
      'Pankshin',
      'Qua’an Pan',
      'Riyom',
      'Shendam',
      'Wase'
    ],
    'Rivers': [
      'Abua/Odual',
      'Ahoada East',
      'Ahoada West',
      'Akuku-Toru',
      'Andoni',
      'Asari-Toru',
      'Bonny',
      'Degema',
      'Eleme',
      'Emohua',
      'Etche',
      'Gokana',
      'Ikwerre',
      'Khana',
      'Obio/Akpor',
      'Ogba/Egbema/Ndoni',
      'Ogu/Bolo',
      'Okrika',
      'Omuma',
      'Opobo/Nkoro',
      'Oyigbo',
      'Port Harcourt',
      'Tai'
    ],
    'Sokoto': [
      'Binji',
      'Bodinga',
      'Dange Shuni',
      'Gada',
      'Goronyo',
      'Gudu',
      'Gwadabawa',
      'Illela',
      'Isa',
      'Kebbe',
      'Kware',
      'Rabah',
      'Sabon Birni',
      'Shagari',
      'Silame',
      'Sokoto North',
      'Sokoto South',
      'Tambuwal',
      'Tangaza',
      'Tureta',
      'Wamako',
      'Wurno',
      'Yabo'
    ],
    'Taraba': [
      'Ardo Kola',
      'Bali',
      'Donga',
      'Gashaka',
      'Gassol',
      'Ibi',
      'Jalingo',
      'Karim Lamido',
      'Kumi',
      'Lau',
      'Sardauna',
      'Takum',
      'Ussa',
      'Wukari',
      'Yorro',
      'Zing'
    ],
    'Yobe': [
      'Bade',
      'Bursari',
      'Damaturu',
      'Fika',
      'Fune',
      'Geidam',
      'Gujba',
      'Gulani',
      'Jakusko',
      'Karasuwa',
      'Machina',
      'Nangere',
      'Nguru',
      'Potiskum',
      'Tarmuwa',
      'Yunusari',
      'Yusufari'
    ],
    'Zamfara': [
      'Anka',
      'Bakura',
      'Birnin Magaji/Kiyaw',
      'Bukkuyum',
      'Bungudu',
      'Gummi',
      'Gusau',
      'Kaura Namoda',
      'Maradun',
      'Maru',
      'Shinkafi',
      'Talata Mafara',
      'Chafe',
      'Zurmi'
    ],
  };

  final Color servicePayGreen = ServicePayColors.brand;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
    _referralService = widget.referralService ??
        ReferralAttributionService(
          client: _client,
        );
    _referralInitialization = _initializeReferralAttribution();
  }

  Future<void> _initializeReferralAttribution() async {
    final rawCode = widget.initialReferralCode;
    ReferralAttribution? attribution;

    if (rawCode != null && rawCode.trim().isNotEmpty) {
      // A link code takes precedence for this registration visit. Invalid
      // links deliberately do not restore an unrelated pending attribution.
      attribution = await _referralService.captureAndPersist(rawCode);
    } else {
      attribution = await _referralService.restore();
    }

    if (!mounted || attribution == null) return;
    setState(() {
      _appliedAttribution = attribution;
      referralController.clear();
    });
  }

  @override
  void dispose() {
    for (final c in [
      fullNameController,
      phoneController,
      emailController,
      dobController,
      addressController,
      stateController,
      lgaController,
      passwordController,
      confirmPasswordController,
      pinController,
      confirmPinController,
      ninController,
      referralController,
    ]) {
      c.dispose();
    }
    if (widget.referralService == null) _referralService.dispose();
    if (_ownsClient) _client.close();

    super.dispose();
  }

  void showMessage(String message, {bool error = true}) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  // ---- Field validators (inline, shown under each field) ----

  String? _validateState(String? v) =>
      (v ?? '').isEmpty ? 'Select your state.' : null;

  String? _validateLga(String? v) =>
      (v ?? '').isEmpty ? 'Select your LGA.' : null;

  String? _validatePin(String? v) => transactionPinError((v ?? '').trim());

  late final FormFieldValidator<String> _validateConfirmPin =
      RegistrationValidators.matches(
          pinController, 'Transaction PINs do not match.');

  String? _validateIdentity(String? v) => RegExp(r'^\d{11}$').hasMatch(v ?? '')
      ? null
      : 'Enter a valid 11-digit ${identityType.code}.';

  String? _validateDob(String? v) =>
      (v ?? '').trim().isEmpty ? 'Date of birth is required.' : null;

  String? _validateAddress(String? v) =>
      (v ?? '').trim().length < 5 ? 'Enter your residential address.' : null;

  bool _validateAll() {
    final fieldsValid = _formKey.currentState?.validate() ?? false;
    if (!fieldsValid) {
      showMessage('Please correct the highlighted fields.');
      return false;
    }
    if (gender.isEmpty) {
      showMessage('Please select your gender.');
      return false;
    }
    if (!acceptTerms) {
      showMessage('Please accept the Terms and Privacy Policy.');
      return false;
    }
    if (!kycConsent) {
      showMessage('KYC verification consent is required.');
      return false;
    }
    return true;
  }

  Future<void> register() async {
    if (loading) return;
    FocusScope.of(context).unfocus();
    if (!_validateAll()) return;

    setState(() => loading = true);

    try {
      await _referralInitialization;
      String? referralCode = _appliedAttribution?.code;
      if (referralCode == null || referralCode.isEmpty) {
        final manualCode =
            ReferralCodeNormalizer.normalize(referralController.text);
        if (manualCode != null) {
          final result = await _referralService.validate(manualCode);
          if (result.isValid) referralCode = result.code;
        }
      }

      final payload = buildRegistrationPayload(
        fullName: fullNameController.text.trim(),
        phone: normalizeNigerianPhone(phoneController.text)!,
        email: emailController.text.trim().toLowerCase(),
        password: passwordController.text,
        transactionPin: pinController.text.trim(),
        confirmTransactionPin: confirmPinController.text.trim(),
        dateOfBirth: dobController.text.trim(),
        gender: gender,
        residentialAddress: addressController.text.trim(),
        state: stateController.text.trim(),
        lga: lgaController.text.trim(),
        nin: ninController.text.trim(),
        identityType: identityType,
        referralCode: referralCode,
      );

      final response = await _client.post(
        Uri.parse('$baseUrl/auth/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );

      dynamic data;

      try {
        data = jsonDecode(response.body);
      } catch (_) {
        data = null;
      }

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data is Map &&
          data['success'] == true) {
        for (final controller in [
          passwordController,
          confirmPasswordController,
          pinController,
          confirmPinController,
          ninController,
        ]) {
          controller.clear();
        }
        await _referralService.clearPending();
        if (!mounted) return;

        await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Account Created'),
            content: const Text(
              'Your ServicePay account has been created successfully. '
              'Your identity/KYC information will be processed according '
              'to your account verification level.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Continue'),
              ),
            ],
          ),
        );

        if (!mounted) return;
        if (Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        } else {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
          );
        }
        return;
      }

      showMessage(
        data is Map && data['message'] != null
            ? data['message'].toString()
            : 'Unable to create account. Please try again.',
      );
    } catch (_) {
      showMessage(
        'Unable to connect to ServicePay. Please check your connection.',
      );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Widget sectionLabel(String text) => Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 12),
        child: Text(
          text.toUpperCase(),
          style: const TextStyle(
            color: ServicePayColors.accent,
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.1,
          ),
        ),
      );

  Widget field({
    required String keyName,
    required TextEditingController controller,
    required String label,
    String? Function(String?)? validator,
    int maxLength = 80,
  }) =>
      RegistrationTextField(
        key: Key('reg-$keyName'),
        controller: controller,
        label: label,
        validator: validator,
        maxLength: maxLength,
      );

  Widget identityTypeSelector() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SegmentedButton<RegistrationIdentityType>(
        key: const Key('reg-identityType'),
        showSelectedIcon: false,
        segments: const [
          ButtonSegment(
            value: RegistrationIdentityType.nin,
            label: Text('NIN'),
          ),
          ButtonSegment(
            value: RegistrationIdentityType.bvn,
            label: Text('BVN'),
          ),
        ],
        selected: {identityType},
        onSelectionChanged: loading
            ? null
            : (s) => setState(() {
                  identityType = s.first;
                  ninController.clear();
                }),
      ),
    );
  }

  Widget referralSection() {
    if (_appliedAttribution != null) {
      return Container(
        padding: const EdgeInsets.all(14),
        margin: const EdgeInsets.only(bottom: 14),
        decoration: BoxDecoration(
          color: servicePayGreen.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: servicePayGreen.withValues(alpha: 0.25)),
        ),
        child: Row(
          children: [
            Icon(Icons.verified_rounded, color: servicePayGreen),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _appliedAttribution!.firstName == null
                    ? 'Referred by Servicepay customer\n'
                        '${_appliedAttribution!.code} Applied'
                    : 'Referred by ${_appliedAttribution!.firstName}\n'
                        '${_appliedAttribution!.code} Applied',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ),
      );
    }
    return field(
      keyName: 'referral',
      controller: referralController,
      label: 'Referral code (optional)',
    );
  }

  Future<void> _pickDob() async {
    FocusScope.of(context).unfocus();
    final DateTime now = DateTime.now();
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: DateTime(now.year - 18, now.month, now.day),
      firstDate: DateTime(1900, 1, 1),
      lastDate: now,
    );
    if (picked != null) {
      final String yyyy = picked.year.toString().padLeft(4, '0');
      final String mm = picked.month.toString().padLeft(2, '0');
      final String dd = picked.day.toString().padLeft(2, '0');
      setState(() => dobController.text = '$yyyy-$mm-$dd');
    }
  }

  Widget registrationForm() {
    final selectedState = stateController.text.trim();
    final lgas = nigeriaStateLgas[selectedState] ?? const <String>[];
    final digits = [FilteringTextInputFormatter.digitsOnly];

    return SingleChildScrollView(
      key: const Key('registration-scroll'),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      // Keep all FormFields registered while scrolling. A lazy list can
      // dispose off-screen validators before Create Account is pressed.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
        const Text(
          'Create your account',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(
          'Everything on one page. Your secrets never leave this form '
          'except over a secure connection to ServicePay.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 20),
        // 1-3. Shared Full Name, Phone Number, Email
        FullNameField(
            key: const Key('reg-fullName'), controller: fullNameController),
        NigerianPhoneField(
            key: const Key('reg-phone'), controller: phoneController),
        EmailField(key: const Key('reg-email'), controller: emailController),
        // 4. State
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: DropdownButtonFormField<String>(
            key: const Key('reg-state'),
            value: nigeriaStateLgas.containsKey(selectedState)
                ? selectedState
                : null,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'State'),
            hint: const Text('Select State'),
            validator: _validateState,
            items: nigeriaStateLgas.keys
                .map((s) => DropdownMenuItem<String>(value: s, child: Text(s)))
                .toList(),
            onChanged: loading
                ? null
                : (value) => setState(() {
                      stateController.text = value ?? '';
                      lgaController.clear();
                    }),
          ),
        ),
        // 5. LGA (keyed by state so it fully resets when state changes)
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: DropdownButtonFormField<String>(
            key: ValueKey('reg-lga-$selectedState'),
            value: lgas.contains(lgaController.text.trim())
                ? lgaController.text.trim()
                : null,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'LGA'),
            hint: Text(selectedState.isEmpty
                ? 'Select State first'
                : 'Select Local Government'),
            validator: _validateLga,
            items: lgas
                .map((l) => DropdownMenuItem<String>(value: l, child: Text(l)))
                .toList(),
            onChanged: selectedState.isEmpty || loading
                ? null
                : (value) => setState(() => lgaController.text = value ?? ''),
          ),
        ),
        // 6-7. Shared Password and Confirm Password
        PasswordField(
            key: const Key('reg-password'), controller: passwordController),
        ConfirmPasswordField(
          key: const Key('reg-confirmPassword'),
          controller: confirmPasswordController,
          passwordController: passwordController,
        ),
        // 8. PIN
        SecretTextField(
          key: const Key('reg-pin'),
          controller: pinController,
          label: 'PIN (4 digits)',
          secretName: 'PIN',
          toggleKeyName: 'pin',
          keyboardType: TextInputType.number,
          maxLength: 4,
          inputFormatters: digits,
          validator: _validatePin,
        ),
        // 9. Confirm PIN
        SecretTextField(
          key: const Key('reg-confirmPin'),
          controller: confirmPinController,
          label: 'Confirm PIN',
          secretName: 'PIN confirmation',
          toggleKeyName: 'confirmPin',
          keyboardType: TextInputType.number,
          maxLength: 4,
          inputFormatters: digits,
          validator: _validateConfirmPin,
        ),
        // 10. BVN or NIN
        identityTypeSelector(),
        SecretTextField(
          key: const Key('reg-identity'),
          controller: ninController,
          label: 'BVN or NIN (11-digit ${identityType.code})',
          secretName: identityType.code,
          toggleKeyName: 'identity',
          keyboardType: TextInputType.number,
          maxLength: 11,
          inputFormatters: digits,
          validator: _validateIdentity,
        ),
        const SizedBox(height: 8),
        sectionLabel('Additional details'),
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: InkWell(
            onTap: loading ? null : _pickDob,
            child: AbsorbPointer(
              child: TextFormField(
                key: const Key('reg-dob'),
                controller: dobController,
                readOnly: true,
                validator: _validateDob,
                decoration: const InputDecoration(
                  labelText: 'Date of birth',
                  hintText: 'Select date of birth',
                  suffixIcon: Icon(Icons.calendar_month_outlined),
                ),
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: DropdownButtonFormField<String>(
            key: const Key('reg-gender'),
            value: gender.isEmpty ? null : gender,
            decoration: const InputDecoration(labelText: 'Gender'),
            items: const [
              DropdownMenuItem(value: 'MALE', child: Text('Male')),
              DropdownMenuItem(value: 'FEMALE', child: Text('Female')),
              DropdownMenuItem(value: 'OTHER', child: Text('Other')),
            ],
            onChanged: loading
                ? null
                : (value) => setState(() => gender = value ?? ''),
          ),
        ),
        field(
          keyName: 'address',
          controller: addressController,
          label: 'Residential address',
          maxLength: 160,
          validator: _validateAddress,
        ),
        referralSection(),
        Container(
          padding: const EdgeInsets.all(14),
          margin: const EdgeInsets.only(bottom: 8),
          decoration: BoxDecoration(
            color: ServicePayColors.surface,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Text(
            'ServicePay requires basic identity verification to help '
            'protect your account and support regulatory compliance. '
            'Higher account tiers may require additional documents.',
          ),
        ),
        CheckboxListTile(
          key: const Key('reg-terms'),
          contentPadding: EdgeInsets.zero,
          value: acceptTerms,
          onChanged: (value) => setState(() => acceptTerms = value ?? false),
          title: const Text(
            'I accept the ServicePay Terms & Conditions '
            'and Privacy Policy.',
          ),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        CheckboxListTile(
          key: const Key('reg-kyc'),
          contentPadding: EdgeInsets.zero,
          value: kycConsent,
          onChanged: (value) => setState(() => kycConsent = value ?? false),
          title: const Text(
            'I consent to ServicePay using the information provided '
            'for identity and KYC verification.',
          ),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          height: 52,
          child: FilledButton(
            key: const Key('reg-submit'),
            style: FilledButton.styleFrom(
              backgroundColor: ServicePayColors.accent,
              foregroundColor: ServicePayColors.onAccent,
            ),
            onPressed: loading ? null : register,
            child: loading
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: ServicePayColors.onAccent,
                    ),
                  )
                : const Text('Create Account'),
          ),
        ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: loading ? null : () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back),
        ),
        title: const Text('Create ServicePay Account'),
      ),
      body: SafeArea(
        child: AutofillGroup(
          child: Form(
            key: _formKey,
            child: registrationForm(),
          ),
        ),
      ),
    );
  }
}
