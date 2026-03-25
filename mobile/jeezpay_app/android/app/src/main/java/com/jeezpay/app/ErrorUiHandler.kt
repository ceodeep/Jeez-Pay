package com.jeezpay.app

import android.app.Activity
import android.content.Intent
import androidx.appcompat.app.AlertDialog
import com.jeezpay.app.AuthActivity
import com.jeezpay.app.R
import com.jeezpay.app.network.AppError
import com.jeezpay.app.storage.SessionManager

object ErrorUiHandler {

    fun handle(
        activity: Activity,
        error: AppError,
        showNoInternetDialog: (() -> Unit)? = null,
        showServerRetryDialog: ((String) -> Unit)? = null,
        showMessage: ((String) -> Unit)? = null,
        onRetryableAction: (() -> Unit)? = null
    ) {
        when (error) {
            is AppError.NoInternet -> {
                showNoInternetDialog?.invoke()
                    ?: showBasicDialog(activity, "No internet connection. Please check your network and try again.")
            }

            is AppError.Server -> {
                if (showServerRetryDialog != null) {
                    showServerRetryDialog.invoke(error.message)
                } else {
                    showBasicDialog(activity, error.message)
                }
            }

            is AppError.Unauthorized -> {
                showMessage?.invoke(error.message)
                SessionManager(activity).clearAll()
                val i = Intent(activity, AuthActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    putExtra(AuthActivity.EXTRA_FORCE_LOGIN, true)
                }
                activity.startActivity(i)
                activity.finish()
            }

            is AppError.Validation -> {
                showMessage?.invoke(error.message)
            }

            is AppError.Unknown -> {
                if (showServerRetryDialog != null) {
                    showServerRetryDialog.invoke(error.message)
                } else {
                    showMessage?.invoke(error.message)
                }
            }
        }
    }

    private fun showBasicDialog(activity: Activity, message: String) {
        AlertDialog.Builder(activity)
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }
}