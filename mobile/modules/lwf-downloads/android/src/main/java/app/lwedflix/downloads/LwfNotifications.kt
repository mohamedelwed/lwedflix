package app.lwedflix.downloads

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** The download notifications: one ongoing with progress and buttons, one per finished download. */
object LwfNotifications {
  const val CHANNEL_PROGRESS = "lwf-downloads"
  const val CHANNEL_DONE = "lwf-downloads-done"
  const val PROGRESS_ID = 4201

  data class Progress(
    val title: String,
    val text: String,
    val percent: Int,
    val indeterminate: Boolean,
    val paused: Boolean,
  )

  @Volatile var last: Progress? = null

  fun channels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_PROGRESS, "Downloads in progress", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Progress of downloads, with pause and cancel"
        setShowBadge(false)
      }
    )
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_DONE, "Finished downloads", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "When a download is ready to watch, or failed"
      }
    )
  }

  /** Opens the app at Downloads. */
  private fun openDownloads(context: Context): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!.apply {
      action = Intent.ACTION_VIEW
      data = Uri.parse("lwedflix://downloads")
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    return PendingIntent.getActivity(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun action(context: Context, name: String, code: Int): PendingIntent {
    val intent = Intent(context, LwfDownloadService::class.java).setAction(name)
    return PendingIntent.getService(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun progress(context: Context, p: Progress) =
    NotificationCompat.Builder(context, CHANNEL_PROGRESS)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(p.title)
      .setContentText(p.text)
      .setColor(0xFFFF9900.toInt())
      .setOngoing(!p.paused)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setProgress(100, p.percent, p.indeterminate)
      .setContentIntent(openDownloads(context))
      .addAction(0, if (p.paused) "Resume" else "Pause", action(context, if (p.paused) LwfDownloadService.ACTION_RESUME else LwfDownloadService.ACTION_PAUSE, 2))
      .addAction(0, "Cancel all", action(context, LwfDownloadService.ACTION_CANCEL, 3))
      .build()

  fun update(context: Context, p: Progress) {
    last = p
    try {
      NotificationManagerCompat.from(context).notify(PROGRESS_ID, progress(context, p))
    } catch (e: SecurityException) {
      // Notifications not allowed: the download carries on regardless.
    }
  }

  fun finished(context: Context, key: String, title: String, text: String) {
    val n = NotificationCompat.Builder(context, CHANNEL_DONE)
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentTitle(title)
      .setContentText(text)
      .setColor(0xFFFF9900.toInt())
      .setAutoCancel(true)
      .setContentIntent(openDownloads(context))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(key.hashCode(), n)
    } catch (e: SecurityException) {
      // Not allowed: the Downloads screen shows it.
    }
  }
}
