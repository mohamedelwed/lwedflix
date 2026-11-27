package app.lwedflix.downloads

import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** downloads/background.ts's way to the notification and the background service. */
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

    /** A download finished or failed. */
    Function("notify") { key: String, title: String, text: String ->
      LwfNotifications.channels(context)
      LwfNotifications.finished(context, key, title, text)
    }
  }
}
