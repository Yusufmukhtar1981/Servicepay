class AdminBuildInfo {
  const AdminBuildInfo._();

  static const String version = String.fromEnvironment(
    'SERVICEPAY_BUILD_VERSION',
    defaultValue: 'development',
  );

  static const String commit = String.fromEnvironment(
    'SERVICEPAY_BUILD_COMMIT',
    defaultValue: 'unknown',
  );

  static String get label => 'Build: $version · Commit: $commit';
}
