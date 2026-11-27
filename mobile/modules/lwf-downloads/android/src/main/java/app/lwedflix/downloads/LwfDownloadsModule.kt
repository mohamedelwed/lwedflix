package app.lwedflix.downloads

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** downloads/background.ts's way to the notification and the background service. */
private const val WindowBrightnessOverrideNone = -1f

class LwfDownloadsModule : Module() {
  companion object {
    @Volatile private var instance: LwfDownloadsModule? = null
    fun emit(action: String) {
      instance?.sendEvent("onAction", mapOf("action" to action))
    }
  }

  private val context get() = appContext.reactContext!!.applicationContext

  override fun definition() = ModuleDefinition {
    Name("LwfDownloads")
    Events("onAction")
    OnCreate { instance = this@LwfDownloadsModule }
    OnDestroy { if (instance === this@LwfDownloadsModule) instance = null }

    /** Shows or updates the progress notification; starts the background service the first time. */
    Function("show") { title: String, text: String, percent: Int, indeterminate: Boolean, paused: Boolean ->
      val p = LwfNotifications.Progress(title, text, percent, indeterminate, paused)
      LwfNotifications.channels(context)
      LwfNotifications.last = p
      if (!LwfDownloadService.running) {
        try {
          ContextCompat.startForegroundService(context, Intent(context, LwfDownloadService::class.java))
        } catch (e: Exception) {
          // Not allowed right now (the app is in the background): the notification still shows.
          LwfNotifications.update(context, p)
        }
      } else {
        LwfNotifications.update(context, p)
      }
    }

    /** Nothing left to download: the service and its notification go. */
    Function("hide") {
      context.stopService(Intent(context, LwfDownloadService::class.java))
      NotificationManagerCompat.from(context).cancel(LwfNotifications.PROGRESS_ID)
      LwfNotifications.last = null
    }

    // ---- The player: screen brightness and media volume ----

    /** This screen's brightness, 0–1: the player's own if set, otherwise the phone's. */
    Function("getBrightness") {
      val own = appContext.currentActivity?.window?.attributes?.screenBrightness ?: -1f
      if (own >= 0f) own.toDouble()
      else try {
        // The phone's setting runs to the device's own maximum (255 on most, 1023 or more on some).
        val res = android.content.res.Resources.getSystem()
        val id = res.getIdentifier("config_screenBrightnessSettingMaximum", "integer", "android")
        val max = (if (id != 0) res.getInteger(id) else 255).coerceAtLeast(1)
        (Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS).toDouble() / max).coerceIn(0.0, 1.0)
      } catch (e: Exception) {
        0.5
      }
    }

    /** Sets this screen's brightness only (the phone's setting is untouched). */
    Function("setBrightness") { value: Double ->
      val activity = appContext.currentActivity ?: return@Function null
      activity.runOnUiThread {
        val attrs = activity.window.attributes
        attrs.screenBrightness = value.toFloat().coerceIn(0.01f, 1f)
        activity.window.attributes = attrs
      }
    }

    /** Back to the phone's own brightness. */
    Function("resetBrightness") {
      val activity = appContext.currentActivity ?: return@Function null
      activity.runOnUiThread {
        val attrs = activity.window.attributes
        attrs.screenBrightness = WindowBrightnessOverrideNone
        activity.window.attributes = attrs
      }
    }

    /** The phone's media volume, 0–1 (what the volume buttons change). */
    Function("getVolume") {
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
      audio.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max
    }

    /** Sets the media volume; returns the level the phone actually took (it may refuse, e.g. Do Not Disturb). */
    Function("setVolume") { value: Double ->
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
      try {
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(value.coerceIn(0.0, 1.0) * max).toInt(), 0)
      } catch (e: SecurityException) {
        // Not allowed right now: report what it is.
      }
      audio.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max
    }

    /** A download finished or failed. */
    Function("notify") { key: String, title: String, text: String ->
      LwfNotifications.channels(context)
      LwfNotifications.finished(context, key, title, text)
    }
  }
}
