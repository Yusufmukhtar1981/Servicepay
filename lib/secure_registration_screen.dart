import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class SecureRegistrationScreen extends StatefulWidget {
  const SecureRegistrationScreen({super.key});

  @override
  State<SecureRegistrationScreen> createState() =>
      _SecureRegistrationScreenState();
}

class _SecureRegistrationScreenState extends State<SecureRegistrationScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final PageController _pageController = PageController();

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

  int currentStep = 0;
  bool loading = false;
  bool hidePassword = true;
  bool hideConfirmPassword = true;
  bool hidePin = true;

  bool acceptTerms = false;
  bool kycConsent = false;

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

  final Color servicePayGreen = const Color(0xFF08783E);

  @override
  void dispose() {
    _pageController.dispose();

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

    super.dispose();
  }

  void showMessage(String message, {bool error = true}) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  bool validateStepOne() {
    if (fullNameController.text.trim().split(' ').length < 2) {
      showMessage('Please enter your complete name.');
      return false;
    }

    final phone = phoneController.text.replaceAll(RegExp(r'\D'), '');

    if (phone.length < 10) {
      showMessage('Please enter a valid phone number.');
      return false;
    }

    final email = emailController.text.trim();

    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      showMessage('Please enter a valid email address.');
      return false;
    }

    if (dobController.text.trim().isEmpty) {
      showMessage('Date of birth is required.');
      return false;
    }

    if (gender.isEmpty) {
      showMessage('Please select your gender.');
      return false;
    }

    if (stateController.text.trim().isEmpty ||
        lgaController.text.trim().isEmpty ||
        addressController.text.trim().length < 5) {
      showMessage('Please complete your residential information.');
      return false;
    }

    return true;
  }

  bool validateStepTwo() {
    final password = passwordController.text;

    if (password.length < 8 ||
        !RegExp(r'[A-Z]').hasMatch(password) ||
        !RegExp(r'[a-z]').hasMatch(password) ||
        !RegExp(r'[0-9]').hasMatch(password) ||
        !RegExp(r'[^A-Za-z0-9]').hasMatch(password)) {
      showMessage(
        'Password must be 8+ characters and include uppercase, '
        'lowercase, number and special character.',
      );
      return false;
    }

    if (password != confirmPasswordController.text) {
      showMessage('Passwords do not match.');
      return false;
    }

    final pin = pinController.text.trim();

    if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
      showMessage('Transaction PIN must contain exactly 4 digits.');
      return false;
    }

    if (pin != confirmPinController.text.trim()) {
      showMessage('Transaction PINs do not match.');
      return false;
    }

    const weakPins = {
      '0000',
      '1111',
      '1234',
      '4321',
      '0123',
      '9876',
    };

    if (weakPins.contains(pin)) {
      showMessage('Please choose a less predictable transaction PIN.');
      return false;
    }

    if (!acceptTerms) {
      showMessage('Please accept the Terms and Privacy Policy.');
      return false;
    }

    return true;
  }

  bool validateStepThree() {
    final nin = ninController.text.replaceAll(RegExp(r'\D'), '');

    if (nin.length != 11) {
      showMessage('Please enter a valid 11-digit NIN.');
      return false;
    }

    if (!kycConsent) {
      showMessage('KYC verification consent is required.');
      return false;
    }

    return true;
  }

  void nextStep() {
    bool valid = false;

    if (currentStep == 0) valid = validateStepOne();
    if (currentStep == 1) valid = validateStepTwo();

    if (!valid) return;

    setState(() => currentStep++);

    _pageController.animateToPage(
      currentStep,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeInOut,
    );
  }

  void previousStep() {
    if (currentStep == 0) {
      Navigator.pop(context);
      return;
    }

    setState(() => currentStep--);

    _pageController.animateToPage(
      currentStep,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeInOut,
    );
  }

  Future<void> register() async {
    if (!validateStepThree()) return;

    setState(() => loading = true);

    try {
      final payload = {
        'fullName': fullNameController.text.trim(),
        'phone': phoneController.text.trim(),
        'email': emailController.text.trim().toLowerCase(),
        'password': passwordController.text,
        'transactionPin': pinController.text.trim(),
        'dateOfBirth': dobController.text.trim(),
        'gender': gender,
        'residentialAddress': addressController.text.trim(),
        'state': stateController.text.trim(),
        'lga': lgaController.text.trim(),
        'nin': ninController.text.trim(),
        'kycConsent': true,
        'acceptTerms': true,
        if (referralController.text.trim().isNotEmpty)
          'referralCode': referralController.text.trim(),
      };

      final response = await http.post(
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

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (_) => AlertDialog(
            title: const Text('Account Created'),
            content: const Text(
              'Your ServicePay account has been created successfully. '
              'Your identity/KYC information will be processed according '
              'to your account verification level.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Continue'),
              ),
            ],
          ),
        );

        if (!mounted) return;
        Navigator.pop(context);
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

  Widget stepHeader() {
    final titles = [
      'Personal Details',
      'Account Security',
      'Identity Verification',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Step ${currentStep + 1} of 3',
          style: TextStyle(
            color: servicePayGreen,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          titles[currentStep],
          style: const TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: List.generate(
            3,
            (index) => Expanded(
              child: Container(
                height: 5,
                margin: EdgeInsets.only(right: index == 2 ? 0 : 6),
                decoration: BoxDecoration(
                  color: index <= currentStep
                      ? servicePayGreen
                      : Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget field({
    required TextEditingController controller,
    required String label,
    TextInputType? keyboard,
    bool obscure = false,
    Widget? suffixIcon,
    int maxLength = 80,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        obscureText: obscure,
        maxLength: maxLength,
        decoration: InputDecoration(
          labelText: label,
          counterText: '',
          suffixIcon: suffixIcon,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }

  Widget personalStep() {
    return ListView(
      children: [
        stepHeader(),
        const SizedBox(height: 24),
        field(
          controller: fullNameController,
          label: 'Full legal name',
        ),
        field(
          controller: phoneController,
          label: 'Phone number',
          keyboard: TextInputType.phone,
        ),
        field(
          controller: emailController,
          label: 'Email address',
          keyboard: TextInputType.emailAddress,
        ),
        InkWell(
          onTap: () async {
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

              setState(() {
                dobController.text = '$yyyy-$mm-$dd';
              });
            }
          },
          child: AbsorbPointer(
            child: TextFormField(
              controller: dobController,
              readOnly: true,
              decoration: InputDecoration(
                labelText: 'Date of birth',
                hintText: 'Select date of birth',
                suffixIcon: const Icon(Icons.calendar_month_outlined),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
        ),
        DropdownButtonFormField<String>(
          value: gender.isEmpty ? null : gender,
          decoration: InputDecoration(
            labelText: 'Gender',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          items: const [
            DropdownMenuItem(value: 'MALE', child: Text('Male')),
            DropdownMenuItem(value: 'FEMALE', child: Text('Female')),
            DropdownMenuItem(value: 'OTHER', child: Text('Other')),
          ],
          onChanged: (value) => setState(() => gender = value ?? ''),
        ),
        const SizedBox(height: 14),
        DropdownButtonFormField<String>(
          value: nigeriaStateLgas.containsKey(stateController.text.trim())
              ? stateController.text.trim()
              : null,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: 'State of residence',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          hint: const Text('Select State'),
          items: nigeriaStateLgas.keys
              .map(
                (state) => DropdownMenuItem<String>(
                  value: state,
                  child: Text(state),
                ),
              )
              .toList(),
          onChanged: (value) {
            setState(() {
              stateController.text = value ?? '';
              lgaController.clear();
            });
          },
        ),
        const SizedBox(height: 14),
        DropdownButtonFormField<String>(
          value: (stateController.text.trim().isNotEmpty &&
                  (nigeriaStateLgas[stateController.text.trim()] ??
                          const <String>[])
                      .contains(lgaController.text.trim()))
              ? lgaController.text.trim()
              : null,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: 'Local Government Area',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          hint: Text(
            stateController.text.trim().isEmpty
                ? 'Select State first'
                : 'Select Local Government',
          ),
          items: stateController.text.trim().isEmpty
              ? const <DropdownMenuItem<String>>[]
              : (nigeriaStateLgas[stateController.text.trim()] ??
                      const <String>[])
                  .map(
                    (lga) => DropdownMenuItem<String>(
                      value: lga,
                      child: Text(lga),
                    ),
                  )
                  .toList(),
          onChanged: stateController.text.trim().isEmpty
              ? null
              : (value) {
                  setState(() {
                    lgaController.text = value ?? '';
                  });
                },
        ),
        field(
          controller: addressController,
          label: 'Residential address',
          maxLength: 160,
        ),
        field(
          controller: referralController,
          label: 'Referral code (optional)',
        ),
      ],
    );
  }

  Widget securityStep() {
    return ListView(
      children: [
        stepHeader(),
        const SizedBox(height: 24),
        field(
          controller: passwordController,
          label: 'Create strong password',
          obscure: hidePassword,
          suffixIcon: IconButton(
            onPressed: () => setState(() => hidePassword = !hidePassword),
            icon: Icon(
              hidePassword ? Icons.visibility_off : Icons.visibility,
            ),
          ),
        ),
        field(
          controller: confirmPasswordController,
          label: 'Confirm password',
          obscure: hideConfirmPassword,
          suffixIcon: IconButton(
            onPressed: () => setState(
              () => hideConfirmPassword = !hideConfirmPassword,
            ),
            icon: Icon(
              hideConfirmPassword ? Icons.visibility_off : Icons.visibility,
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.all(14),
          margin: const EdgeInsets.only(bottom: 16),
          decoration: BoxDecoration(
            color: Colors.grey.shade100,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Text(
            'Password must contain at least 8 characters, uppercase, '
            'lowercase, number and special character.',
          ),
        ),
        field(
          controller: pinController,
          label: 'Create 4-digit transaction PIN',
          keyboard: TextInputType.number,
          obscure: hidePin,
          maxLength: 4,
        ),
        field(
          controller: confirmPinController,
          label: 'Confirm transaction PIN',
          keyboard: TextInputType.number,
          obscure: hidePin,
          maxLength: 4,
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: acceptTerms,
          onChanged: (value) => setState(() => acceptTerms = value ?? false),
          title: const Text(
            'I accept the ServicePay Terms & Conditions '
            'and Privacy Policy.',
          ),
          controlAffinity: ListTileControlAffinity.leading,
        ),
      ],
    );
  }

  Widget kycStep() {
    return ListView(
      children: [
        stepHeader(),
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(16),
          margin: const EdgeInsets.only(bottom: 18),
          decoration: BoxDecoration(
            color: servicePayGreen.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Text(
            'ServicePay requires basic identity verification to help '
            'protect your account and support regulatory compliance. '
            'Higher account tiers may require additional documents.',
          ),
        ),
        field(
          controller: ninController,
          label: '11-digit NIN',
          keyboard: TextInputType.number,
          maxLength: 11,
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: kycConsent,
          onChanged: (value) => setState(() => kycConsent = value ?? false),
          title: const Text(
            'I consent to ServicePay using the information provided '
            'for identity and KYC verification.',
          ),
          controlAffinity: ListTileControlAffinity.leading,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: loading ? null : previousStep,
          icon: const Icon(Icons.arrow_back),
        ),
        title: const Text('Create ServicePay Account'),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
          child: Column(
            children: [
              Expanded(
                child: PageView(
                  controller: _pageController,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    personalStep(),
                    securityStep(),
                    kycStep(),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: servicePayGreen,
                  ),
                  onPressed: loading
                      ? null
                      : currentStep < 2
                          ? nextStep
                          : register,
                  child: loading
                      ? const SizedBox(
                          height: 22,
                          width: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          currentStep < 2 ? 'Continue' : 'Create Account',
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
