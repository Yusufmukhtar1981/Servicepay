import 'package:http/http.dart' as http;

import 'school_portal_handoff_client_stub.dart'
    if (dart.library.html) 'school_portal_handoff_client_web.dart';

http.Client createSchoolPortalHandoffClient() =>
    createPlatformSchoolPortalHandoffClient();