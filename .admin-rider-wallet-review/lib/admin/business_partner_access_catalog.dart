const List<String> businessPartnerViewPermissions = <String>[
  'DASHBOARD',
  'OFFICERS',
  'CUSTOMERS',
  'APPLICATIONS',
  'REPAYMENTS',
  'REPORTS',
];

const Map<String, String> businessPartnerServicePermissions = <String, String>{
  'SOLAR': 'SOLAR_ASSIGNMENT',
  'PHONE': 'PHONE_ASSIGNMENT',
};

const Set<String> businessPartnerPermissionCatalog = <String>{
  ...businessPartnerViewPermissions,
  'OFFICER_MANAGEMENT',
  'SOLAR_ASSIGNMENT',
  'PHONE_ASSIGNMENT',
  'VERIFICATION_REVIEW',
};

String normalizeBusinessPartnerService(String value) {
  final normalized = value.trim().toUpperCase().replaceAll(' ', '_');
  if (normalized == 'PHONE_FINANCING') {
    return 'PHONE';
  }
  return normalized;
}

Map<String, List<String>> businessPartnerAccessForServices(
  Iterable<String> selectedServices,
) {
  final services = selectedServices
      .map(normalizeBusinessPartnerService)
      .where(businessPartnerServicePermissions.containsKey)
      .toSet()
      .toList()
    ..sort();
  final permissions = <String>{
    ...businessPartnerViewPermissions,
    if (services.isNotEmpty) 'OFFICER_MANAGEMENT',
    for (final service in services)
      if (businessPartnerServicePermissions[service] case final permission?)
        permission,
  }.where(businessPartnerPermissionCatalog.contains).toList();

  return <String, List<String>>{
    'services': services,
    'permissions': permissions,
  };
}
