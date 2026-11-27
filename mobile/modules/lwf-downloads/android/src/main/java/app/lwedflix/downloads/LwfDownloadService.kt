package app.lwedflix.downloads

import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Keeps downloads going while Lwedflix is in the background: a foreground
 * service (the notification with progress) that runs the JS task
 * "LwfDownloads" (index.js). While a headless task runs, React Native keeps
 * its timers going and the phone stays awake enough to download.
 */
class LwfDownloadService : HeadlessJsTaskService() {
  companion object {
    const val ACTION_PAUSE = "app.lwedflix.downloads.PAUSE"
    const val ACTION_RESUME = "app.lwedflix.downloads.RESUME"
    const val ACTION_CANCEL = "app.lwedflix.downloads.CANCEL"
    @Volatile var running = false
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PAUSE -> return emit("pause")
      ACTION_RESUME -> return emit("resume")
      ACTION_CANCEL -> return emit("cancel")
    }
    LwfNotifications.channels(this)
    val p = LwfNotifications.last ?: LwfNotifications.Progress("Downloading", "Starting…", 0, true, false)
    ServiceCompat.startForeground(
      this,
      LwfNotifications.PROGRESS_ID,
      LwfNotifications.progress(this, p),
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
    )
    running = true
    return super.onStartCommand(intent, flags, startId)
  }

  private fun emit(action: String): Int {
    LwfDownloadsModule.emit(action)
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? =
    // No timeout: the task ends itself when nothing is left to download.
    HeadlessJsTaskConfig("LwfDownloads", Arguments.createMap(), 0, true)

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }
}
