package com.jeezpay.app

import android.app.Application
import android.content.Intent
import java.io.PrintWriter
import java.io.StringWriter

object CrashHandler {
    fun install(app: Application) {
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))

                val intent = Intent(app, CrashReportActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                    putExtra("crash", sw.toString())
                }

                app.startActivity(intent)
                android.os.Process.killProcess(android.os.Process.myPid())
                kotlin.system.exitProcess(10)
            } catch (_: Exception) {
                defaultHandler?.uncaughtException(thread, throwable)
            }
        }
    }
}