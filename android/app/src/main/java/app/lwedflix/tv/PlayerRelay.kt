package app.lwedflix.tv

import android.net.Uri
import android.os.SystemClock
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONException
import org.json.JSONObject

/**
 * The player bridge's middle, as electron/main.js is on desktop. Every frame
 * gets `lwedflixNative` (assets/shim.js talks over it): embedded players
 * report their <video>, the app page sends commands, and this passes them
 * between the two. Only the frame that reported most recently is controlled.
 *
 * Messages are JSON: {t: 'send', c, p} and {t: 'invoke', id, c, a} from the
 * page, {t: 'event', c, p} and {t: 'reply', id, ok, v} back.
 */
class PlayerRelay(
    private val appOrigin: Uri,
    /** Whether the stream is playing, to keep the screen on while it is. */
    private val onPlayingChange: (Boolean) -> Unit,
    /** The app asked for the on-screen keyboard (a text field got OK). */
    private val onKeyboardRequest: () -> Unit,
) : WebViewCompat.WebMessageListener {

    private var appPage: JavaScriptReplyProxy? = null
    private var playerFrame: JavaScriptReplyProxy? = null
    /** Until when a newly loaded stream should start on its own (Up next). */
    private var autoplayUntil = 0L
    private var playing = false

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        val data = message.data ?: return
        val msg = try {
            JSONObject(data)
        } catch (e: JSONException) {
            return
        }
        if (isMainFrame) {
            // The main frame never leaves the app's origin (MainActivity
            // blocks that), but check anyway: commands only come from the app.
            if (sameOrigin(sourceOrigin, appOrigin)) fromAppPage(msg, replyProxy)
        } else {
            fromPlayerFrame(msg, replyProxy)
        }
    }

    private fun fromAppPage(msg: JSONObject, page: JavaScriptReplyProxy) {
        if (msg.optString("t") != "send") {
            if (msg.optString("t") == "invoke") reply(page, msg.optInt("id"), false, "not available on TV")
            return
        }
        appPage = page
        when (msg.optString("c")) {
            "app:hello" -> {
                playerFrame = null
                setPlaying(false)
            }
            "player:command" -> {
                val command = msg.optJSONObject("p") ?: return
                playerFrame?.let { send(it, "player:command", command) }
            }
            "player:autoplay" -> autoplayUntil = SystemClock.uptimeMillis() + 30_000
            "tv:keyboard" -> onKeyboardRequest()
        }
    }

    private fun fromPlayerFrame(msg: JSONObject, frame: JavaScriptReplyProxy) {
        val channel = msg.optString("c")
        if (msg.optString("t") == "invoke") {
            val id = msg.optInt("id")
            if (channel == "player:should-autoplay") reply(frame, id, true, SystemClock.uptimeMillis() < autoplayUntil)
            else reply(frame, id, false, "unknown")
            return
        }
        when (channel) {
            "player:state" -> {
                val state = msg.optJSONObject("p") ?: return
                if (state.optString("event") == "gone") {
                    if (frame != playerFrame) return
                    playerFrame = null
                    setPlaying(false)
                    toApp("player:state", JSONObject.NULL)
                    return
                }
                val nowPlaying = state.optBoolean("playing")
                if (nowPlaying) autoplayUntil = 0
                playerFrame = frame
                setPlaying(nowPlaying)
                // The app page checks it over (cleanState in shim.js).
                toApp("player:state", state)
            }
            "player:problem" -> toApp("player:problem", msg.optJSONObject("p") ?: JSONObject())
            "player:key" -> if (msg.optString("p") == "f") toApp("player:shortcut", JSONObject().put("key", "f"))
        }
    }

    /** A command from the remote (play/pause and seek keys), straight to the stream. */
    fun command(command: JSONObject): Boolean {
        val frame = playerFrame ?: return false
        send(frame, "player:command", command)
        return true
    }

    /** The main frame is loading a new page: its frames are gone. */
    fun onAppNavigated() {
        // appPage stays: the new page's hello can arrive before this does,
        // and replaces it anyway.
        playerFrame = null
        setPlaying(false)
    }

    private fun setPlaying(value: Boolean) {
        if (value == playing) return
        playing = value
        onPlayingChange(value)
    }

    private fun toApp(channel: String, payload: Any) {
        appPage?.let { send(it, channel, payload) }
    }

    private fun send(to: JavaScriptReplyProxy, channel: String, payload: Any) {
        post(to, JSONObject().put("t", "event").put("c", channel).put("p", payload))
    }

    private fun reply(to: JavaScriptReplyProxy, id: Int, ok: Boolean, value: Any) {
        post(to, JSONObject().put("t", "reply").put("id", id).put("ok", ok).put("v", value))
    }

    private fun post(to: JavaScriptReplyProxy, message: JSONObject) {
        try {
            to.postMessage(message.toString())
        } catch (e: IllegalStateException) {
            // That frame is gone.
        }
    }

    companion object {
        fun sameOrigin(a: Uri, b: Uri): Boolean =
            a.scheme.equals(b.scheme, ignoreCase = true) &&
                a.host.equals(b.host, ignoreCase = true) &&
                effectivePort(a) == effectivePort(b)

        private fun effectivePort(uri: Uri): Int = when {
            uri.port != -1 -> uri.port
            uri.scheme.equals("https", ignoreCase = true) -> 443
            uri.scheme.equals("http", ignoreCase = true) -> 80
            else -> -1
        }
    }
}
