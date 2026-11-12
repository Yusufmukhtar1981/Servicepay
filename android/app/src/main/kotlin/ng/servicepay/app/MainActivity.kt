package ng.servicepay.app

import android.content.Intent
import android.net.Uri
import android.app.Activity
import android.content.ActivityNotFoundException
import android.provider.ContactsContract
import android.provider.Settings
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.EventChannel

class MainActivity : FlutterFragmentActivity() {
    private val settingsChannel = "ng.servicepay.app/settings"
    private val deepLinkChannel = "ng.servicepay.app/deep_links"
    private val deepLinkEvents = "ng.servicepay.app/deep_links/events"
    private var deepLinkSink: EventChannel.EventSink? = null
    private var contactResult: MethodChannel.Result? = null
    private val contactRequestCode = 6041

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // ACTION_PICK grants access only to the selected phone-number row.
        // Never request READ_CONTACTS or enumerate the customer's address book.
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "ng.servicepay.app/contacts"
        ).setMethodCallHandler { call, result ->
            if (call.method != "pickPhoneNumber") {
                result.notImplemented()
            } else if (contactResult != null) {
                result.error("busy", "A contact picker is already open.", null)
            } else {
                contactResult = result
                try {
                    startActivityForResult(
                        Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI),
                        contactRequestCode
                    )
                } catch (_: ActivityNotFoundException) {
                    contactResult = null
                    result.error("unavailable", "Contact selection is unavailable. Enter the number manually.", null)
                } catch (_: SecurityException) {
                    contactResult = null
                    result.error("permission_denied", "Contact access was denied. Enter the number manually.", null)
                }
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

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != contactRequestCode) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val result = contactResult ?: return
        contactResult = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            result.success(null)
            return
        }
        if (uri.scheme != "content") {
            result.error("unavailable", "No usable phone number was selected.", null)
            return
        }
        try {
            contentResolver.query(
                uri,
                arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
                null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val column = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                    if (column >= 0) {
                        result.success(cursor.getString(column))
                        return
                    }
                }
            }
            result.error("unavailable", "No usable phone number was selected.", null)
        } catch (_: SecurityException) {
            result.error("permission_denied", "Contact access was denied. Enter the number manually.", null)
        } catch (_: Exception) {
            result.error("unavailable", "Contact selection could not be completed. Enter the number manually.", null)
        }
    }

    override fun onDestroy() {
        contactResult?.error("cancelled", "Contact selection was interrupted.", null)
        contactResult = null
        super.onDestroy()
    }
}
