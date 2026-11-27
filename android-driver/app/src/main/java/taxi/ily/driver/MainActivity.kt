package taxi.ily.driver

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.provider.Settings
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * IL-Y driver app (2026-11-28): our driver web screens inside a WebView, plus what a web app cannot do:
 *  - the small round IL-Y icon over other apps while this app is in the background (BubbleService);
 *  - Waze / Google Maps links open the real navigator apps;
 *  - the screen stays on while the app is open.
 * The login, the language and everything else are the web app's own.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var geoPending: Pair<String, GeolocationPermissions.Callback>? = null

    private val ownHosts = listOf("il-y.taxi", "ackedberryes.store")

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        setContentView(web)

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = false // the offer chime plays without a tap
            setSupportMultipleWindows(true) // target=_blank links (navigators) come to onCreateWindow
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "$userAgentString ILYDriverApp/${BuildConfig.VERSION_NAME}"
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                openOutside(request.url)
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (hasLocation()) callback.invoke(origin, true, true)
                else {
                    geoPending = origin to callback
                    ActivityCompat.requestPermissions(this@MainActivity, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_LOCATION)
                }
            }

            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try {
                    startActivityForResult(params.createIntent(), REQ_FILE); true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null; false
                }
            }

            // A target=_blank link (Waze / Google Maps): catch its address and hand it to the navigator app.
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val catcher = WebView(this@MainActivity)
                catcher.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                        if (!openOutside(r.url)) web.loadUrl(r.url.toString())
                        v.destroy()
                        return true
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = catcher
                resultMsg.sendToTarget()
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else moveTaskToBack(true) // keep running, like a taxi app
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(BuildConfig.START_URL)
        askPermissionsOnce()
    }

    /** true = handled outside the WebView (another app). Our own pages stay inside. */
    private fun openOutside(uri: Uri): Boolean {
        val scheme = uri.scheme ?: return false
        val host = uri.host ?: ""
        if ((scheme == "https" || scheme == "http") && ownHosts.any { host == it || host.endsWith(".$it") }) return false
        return try {
            val intent = if (scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) else Intent(Intent.ACTION_VIEW, uri)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent); true
        } catch (e: Exception) {
            if (scheme == "https" || scheme == "http") false else true
        }
    }

    private fun hasLocation() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** First start: location (for the web GPS), notifications (the bubble's service note), then «Поверх других приложений». */
    private fun askPermissionsOnce() {
        val want = mutableListOf<String>()
        if (!hasLocation()) { want += Manifest.permission.ACCESS_FINE_LOCATION; want += Manifest.permission.ACCESS_COARSE_LOCATION }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) want += Manifest.permission.POST_NOTIFICATIONS
        if (want.isNotEmpty()) ActivityCompat.requestPermissions(this, want.toTypedArray(), REQ_START)
        else askOverlay()
    }

    private fun askOverlay() {
        if (Settings.canDrawOverlays(this)) return
        val prefs = getSharedPreferences("ily", MODE_PRIVATE)
        if (prefs.getBoolean("overlayAsked", false)) return
        prefs.edit().putBoolean("overlayAsked", true).apply()
        AlertDialog.Builder(this)
            .setTitle(R.string.overlay_title)
            .setMessage(R.string.overlay_text)
            .setPositiveButton(R.string.overlay_allow) { _, _ ->
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }
            .setNegativeButton(R.string.overlay_later, null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            REQ_LOCATION -> geoPending?.let { (origin, cb) -> cb.invoke(origin, hasLocation(), true); geoPending = null }
            REQ_START -> askOverlay()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
    }

    // The bubble: the service starts while the app is in front (allowed), hidden; it shows when we leave.
    override fun onResume() {
        super.onResume()
        web.onResume()
        if (Settings.canDrawOverlays(this)) BubbleService.send(this, BubbleService.HIDE)
    }

    override fun onStop() {
        super.onStop()
        if (Settings.canDrawOverlays(this) && !isFinishing) BubbleService.send(this, BubbleService.SHOW)
    }

    override fun onDestroy() {
        if (isFinishing) BubbleService.send(this, BubbleService.STOP)
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    companion object {
        private const val REQ_LOCATION = 1
        private const val REQ_START = 2
        private const val REQ_FILE = 3
    }
}
