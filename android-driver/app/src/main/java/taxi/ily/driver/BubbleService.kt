package taxi.ily.driver

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import kotlin.math.abs

/**
 * The small round IL-Y icon over other apps (operator 2026-11-28, like Bolt / Uber for drivers).
 * Runs as a foreground service so Android keeps the app alive while the driver is in Waze / Google Maps.
 * Started (hidden) while the app is in front; MainActivity shows it when the app goes to the background
 * and hides it when the driver comes back. Drag it anywhere; a tap opens IL-Y.
 */
class BubbleService : Service() {

    private var wm: WindowManager? = null
    private var bubble: View? = null
    private var params: WindowManager.LayoutParams? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        startAsForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            SHOW -> show()
            HIDE -> hide()
            STOP -> { hide(); stopSelf() }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        hide()
        instance = null
        super.onDestroy()
    }

    private fun startAsForeground() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.bubble_channel), NotificationManager.IMPORTANCE_MIN))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.bubble_note))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(NOTE_ID, n)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun show() {
        if (bubble != null || !Settings.canDrawOverlays(this)) return
        val d = resources.displayMetrics.density
        val size = (58 * d).toInt()
        val ring = FrameLayout(this).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFF10191C.toInt()); setStroke((2.5f * d).toInt(), 0xFFC8FF46.toInt()) }
            elevation = 8 * d
            val img = ImageView(context).apply { setImageResource(R.drawable.bubble_logo); scaleType = ImageView.ScaleType.FIT_CENTER }
            val pad = (9 * d).toInt()
            addView(img, FrameLayout.LayoutParams(size - 2 * pad, size - 2 * pad, Gravity.CENTER))
            contentDescription = getString(R.string.bubble_open)
        }
        val prefs = getSharedPreferences("ily", MODE_PRIVATE)
        val lp = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = prefs.getInt("bx", (resources.displayMetrics.widthPixels - size - 8 * d).toInt())
            y = prefs.getInt("by", (resources.displayMetrics.heightPixels * 0.35f).toInt())
        }
        // Drag to move; a short tap (hardly moved) opens the app. The spot is remembered.
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0
        ring.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; true }
                MotionEvent.ACTION_MOVE -> {
                    lp.x = startX + (e.rawX - downX).toInt(); lp.y = startY + (e.rawY - downY).toInt()
                    wm?.updateViewLayout(v, lp); true
                }
                MotionEvent.ACTION_UP -> {
                    if (abs(e.rawX - downX) < 12 * d && abs(e.rawY - downY) < 12 * d) openApp()
                    else prefs.edit().putInt("bx", lp.x).putInt("by", lp.y).apply()
                    true
                }
                else -> false
            }
        }
        try {
            wm?.addView(ring, lp)
            bubble = ring; params = lp
        } catch (e: Exception) { /* no permission any more */ }
    }

    private fun hide() {
        bubble?.let { try { wm?.removeView(it) } catch (e: Exception) { } }
        bubble = null
    }

    private fun openApp() {
        hide()
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }

    companion object {
        const val SHOW = "show"
        const val HIDE = "hide"
        const val STOP = "stop"
        private const val CHANNEL = "bubble"
        private const val NOTE_ID = 7
        @Volatile private var instance: BubbleService? = null

        /** Same process: talk to the running service directly (no background-start limits);
         *  otherwise start it — only from the foreground (MainActivity.onResume). */
        fun send(ctx: Context, action: String) {
            val s = instance
            if (s != null) {
                when (action) { SHOW -> s.show(); HIDE -> s.hide(); STOP -> { s.hide(); s.stopSelf() } }
                return
            }
            if (action == STOP) return
            val i = Intent(ctx, BubbleService::class.java).setAction(action)
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) { /* not allowed from the background: it starts next time the app is opened */ }
        }
    }
}
