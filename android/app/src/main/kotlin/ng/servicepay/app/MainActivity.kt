package ng.servicepay.app

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.EventChannel

class MainActivity : FlutterFragmentActivity() {
    private val settingsChannel = "ng.servicepay.app/settings"
    private val versionChannel = "ng.servicepay.app/version"
    private val deepLinkChannel = "ng.servicepay.app/deep_links"
    private val deepLinkEvents = "ng.servicepay.app/deep_links/events"
    private var deepLinkSink: EventChannel.EventSink? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            versionChannel
        ).setMethodCallHandler { call, result ->
            if (call.method != "getVersion") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            try {
                val packageInfo = if (android.os.Build.VERSION.SDK_INT >= 33) {
                    packageManager.getPackageInfo(
                        packageName,
                        android.content.pm.PackageManager.PackageInfoFlags.of(0)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(packageName, 0)
                }
                @Suppress("DEPRECATION")
                val versionCode = if (android.os.Build.VERSION.SDK_INT >= 28) {
                    packageInfo.longVersionCode.toInt()
                } else {
                    packageInfo.versionCode
                }
                result.success(
                    mapOf(
                        "versionName" to (packageInfo.versionName ?: ""),
                        "versionCode" to versionCode
                    )
                )
            } catch (error: Exception) {
                result.error("VERSION_UNAVAILABLE", error.message, null)
            }
        }
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            settingsChannel
        ).setMethodCallHandler { call, result ->
            if (call.method != "openAppSettings") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            result.success(null)
        }
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            deepLinkChannel
        ).setMethodCallHandler { call, result ->
            if (call.method == "initialUri") {
                result.success(intent?.data?.toString())
            } else {
                result.notImplemented()
            }
        }
        EventChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            deepLinkEvents
        ).setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                deepLinkSink = events
            }

            override fun onCancel(arguments: Any?) {
                deepLinkSink = null
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deepLinkSink?.success(intent.data?.toString())
    }

}
