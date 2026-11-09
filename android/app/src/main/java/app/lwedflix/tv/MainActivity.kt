package app.lwedflix.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream

/**
 * Lwedflix for Google TV and Android TV: the hosted web app in a full-screen
 * WebView, with the desktop shell's player bridge and ad blocking (see
 * PlayerRelay, AdBlock and assets/shim.js). The web app does the rest,
 * including remote-control navigation (src/components/tv/TvNavigation.tsx).
 */
class MainActivity : Activity() {

    private val appUrl = BuildConfig.APP_URL
    private val appOrigin: Uri = Uri.parse(appUrl)

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var relay: PlayerRelay
    private lateinit var adBlock: AdBlock
    private var errorView: View? = null
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }
        setContentView(root)

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        ) {
            root.addView(message(getString(R.string.webview_too_old), null))
            return
        }

        adBlock = AdBlock(this)
        relay = PlayerRelay(
            appOrigin,
            onPlayingChange = { playing ->
                if (playing) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            },
            onKeyboardRequest = {
                val view = fullscreenView ?: webView
                view.requestFocus()
                getSystemService(InputMethodManager::class.java)?.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
            },
        )
        webView = createWebView()
        root.addView(webView, FrameLayout.LayoutParams(MATCH, MATCH))
        webView.requestFocus()

        val path = savedInstanceState?.getString(STATE_URL)?.takeIf { isAppUrl(it) }
        webView.loadUrl(path ?: (appUrl + (deepLinkPath(intent) ?: "/")))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val view = WebView(this)
        view.setBackgroundColor(BACKGROUND)
        view.isFocusable = true
        view.isFocusableInTouchMode = true

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // Popups are refused in onCreateWindow; without this, window.open
            // would replace the app page instead.
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            // Honour the viewport the bridge sets (1280 CSS px, scaled to fit).
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            // Players reached through the app shouldn't see a WebView user
            // agent; some refuse to play for one. The app's token lets the
            // server tell TV visits apart.
            userAgentString = userAgentString.replace("; wv", "") + " LwedflixTV/" + BuildConfig.VERSION_NAME
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, true)
        }

        val shim = assets.open("shim.js").bufferedReader().use { it.readText() }
            .replace("/*__PLAYER_PROTOCOL__*/", asset("playerProtocol.js"))
            .replace("/*__PRELOAD__*/", asset("preload.js"))
            .replace("__SHELL_VERSION__", BuildConfig.VERSION_NAME)
        WebViewCompat.addWebMessageListener(view, "lwedflixNative", setOf("*"), relay)
        WebViewCompat.addDocumentStartJavaScript(view, shim, setOf("*"))

        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                // The players' ads and trackers. Never the app page itself.
                if (!request.isForMainFrame && adBlock.isBlockedHost(request.url.host)) {
                    return WebResourceResponse("text/plain", "utf-8", 204, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                return null
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val url = request.url
                if (url.scheme == SCHEME) {
                    pathFromDeepLink(url)?.let { view.loadUrl(appUrl + it) }
                    return true
                }
                // The players' ads love top-frame redirects; the app never
                // leaves its own origin.
                return !PlayerRelay.sameOrigin(url, appOrigin)
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                relay.onAppNavigated()
                hideError()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError()
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame && errorResponse.statusCode >= 500) showError()
            }
        }

        view.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?): Boolean = false

            override fun onPermissionRequest(request: PermissionRequest) = request.deny()

            // The player's fullscreen button (the app fullscreens its own
            // player box, not the server's).
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                fullscreenView = view
                fullscreenCallback = callback
                root.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
                webView.visibility = View.INVISIBLE
                view.isFocusable = true
                view.requestFocus()
            }

            override fun onHideCustomView() {
                val view = fullscreenView ?: return
                root.removeView(view)
                fullscreenView = null
                fullscreenCallback = null
                webView.visibility = View.VISIBLE
                webView.requestFocus()
            }

            // No grey play icon over videos before they start.
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        }

        // The app never downloads anything here; any download is an ad's.
        view.setDownloadListener { _, _, _, _, _ -> }
        return view
    }

    private fun asset(name: String) = assets.open(name).bufferedReader().use { it.readText() }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!::webView.isInitialized) return
        deepLinkPath(intent)?.let { webView.loadUrl(appUrl + it) }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!::webView.isInitialized) return super.dispatchKeyEvent(event)
        when (event.keyCode) {
            KeyEvent.KEYCODE_BACK -> {
                if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) goBack()
                return true
            }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> return media(event, "toggle")
            KeyEvent.KEYCODE_MEDIA_PLAY -> return media(event, "play")
            KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_STOP -> return media(event, "pause")
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> return media(event, "seekBy", 10)
            KeyEvent.KEYCODE_MEDIA_REWIND -> return media(event, "seekBy", -10)
        }
        return super.dispatchKeyEvent(event)
    }

    /** Media keys on the remote go straight to the stream, wherever focus is. */
    private fun media(event: KeyEvent, action: String, delta: Int = 0): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return true
        val command = JSONObject().put("action", action)
        if (action == "seekBy") command.put("delta", delta)
        relay.command(command)
        return true
    }

    /**
     * Back closes what's open in the app first (a menu, the keyboard,
     * fullscreen — TvNavigation decides), then goes back a page, then leaves.
     */
    private fun goBack() {
        webView.evaluateJavascript("(() => { try { return Boolean(window.__lwedflixTvBack && window.__lwedflixTvBack()); } catch (e) { return false; } })()") { handled ->
            if (handled == "true") return@evaluateJavascript
            when {
                fullscreenView != null -> fullscreenCallback?.onCustomViewHidden()
                errorView != null -> finish()
                webView.canGoBack() -> webView.goBack()
                else -> finish()
            }
        }
    }

    private fun showError() {
        if (errorView != null) return
        val view = message(getString(R.string.offline_title) + "\n\n" + getString(R.string.offline_body), getString(R.string.retry))
        errorView = view
        root.addView(view)
        view.findViewWithTag<View>(RETRY_TAG)?.requestFocus()
    }

    private fun hideError() {
        errorView?.let { root.removeView(it) }
        errorView = null
    }

    private fun message(text: String, button: String?): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(BACKGROUND)
            layoutParams = FrameLayout.LayoutParams(MATCH, MATCH)
            isClickable = true
        }
        box.addView(TextView(this).apply {
            this.text = text
            setTextColor(Color.WHITE)
            textSize = 22f
            gravity = Gravity.CENTER
            setPadding(96, 0, 96, 48)
        }, LinearLayout.LayoutParams(WRAP, WRAP))
        if (button != null) {
            box.addView(Button(this).apply {
                this.text = button
                tag = RETRY_TAG
                textSize = 18f
                setOnClickListener {
                    hideError()
                    webView.reload()
                }
            }, LinearLayout.LayoutParams(WRAP, WRAP))
        }
        return box
    }

    private fun isAppUrl(url: String) = PlayerRelay.sameOrigin(Uri.parse(url), appOrigin)

    private fun deepLinkPath(intent: Intent?): String? =
        intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data?.let { pathFromDeepLink(it) }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::webView.isInitialized) webView.url?.let { outState.putString(STATE_URL, it) }
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onPause() {
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
        private const val STATE_URL = "url"
        private const val RETRY_TAG = "retry"
        private val BACKGROUND = Color.rgb(10, 10, 10)

        // lwedflix://<page> opens that page, e.g. lwedflix://watch/K7M2QX.
        // The same allowlist as electron/main.js and src/lib/shareLink.ts;
        // keep the three in step.
        const val SCHEME = "lwedflix"
        private val DEEP_LINK_PATH = Regex("""^/(?:(?:movie|tv|person)/\d{1,10}|(?:watch|invite|p|u|c)/[\w.-]{1,64})$""")
        private val DEEP_LINK_QUERY = Regex("""^(\?[\w=&-]{0,100})?$""")

        /** lwedflix://movie/550 → /movie/550; null for anything off the allowlist. */
        fun pathFromDeepLink(uri: Uri): String? {
            if (uri.scheme != SCHEME) return null
            // lwedflix://movie/550 parses with "movie" as the host.
            val path = "/${uri.host.orEmpty()}${uri.encodedPath.orEmpty()}".trimEnd('/')
            val query = uri.encodedQuery?.let { "?$it" }.orEmpty()
            return if (DEEP_LINK_PATH.matches(path) && DEEP_LINK_QUERY.matches(query)) path + query else null
        }
    }
}
