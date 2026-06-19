package com.jeezpay.app.base

import android.content.Intent
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.jeezpay.app.AuthActivity
import com.jeezpay.app.R
import com.jeezpay.app.network.AppError
import com.jeezpay.app.storage.SessionManager
import com.jeezpay.app.common.LoaderOverlayController

abstract class BaseFintechActivity : AppCompatActivity() {

    private var loaderOverlay: LoaderOverlayController? = null

    protected fun initBlockingLoader() {
        loaderOverlay = LoaderOverlayController(findViewById(android.R.id.content))
    }

    protected fun showBlockingLoader() {
        loaderOverlay?.setVisible(true)
    }

    protected fun hideBlockingLoader() {
        loaderOverlay?.setVisible(false)
    }

    protected fun showNoInternetDialog(onRetry: () -> Unit = {}) {
        showCustomConfirmDialog(
            message = "No internet connection. Please check your network and try again.",
            confirmText = "Retry",
            cancelText = "Close",
            onConfirm = onRetry
        )
    }

    protected fun showServerFailureDialog(
        title: String = "Error occured",
        message: String = "We couldn't complete your request right now.",
        retryText: String = "Try again",
        closeText: String = "Close",
        onRetry: () -> Unit = {}
    ) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_error_retry, null)

        val tvTitle = dialogView.findViewById<TextView>(R.id.tvErrorTitle)
        val tvMessage = dialogView.findViewById<TextView>(R.id.tvErrorMessage)
        val btnClose = dialogView.findViewById<TextView>(R.id.btnErrorClose)
        val btnRetry = dialogView.findViewById<TextView>(R.id.btnErrorRetry)

        tvTitle.text = title
        tvMessage.text = message
        btnClose.text = closeText
        btnRetry.text = retryText

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .setCancelable(false)
            .create()

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnClose.setOnClickListener {
            dialog.dismiss()
        }

        btnRetry.setOnClickListener {
            dialog.dismiss()
            onRetry()
        }

        dialog.show()
    }

    protected fun showCustomConfirmDialog(
        message: String,
        confirmText: String = "Confirm",
        cancelText: String = "Cancel",
        onConfirm: () -> Unit = {}
    ) {
        val view = layoutInflater.inflate(R.layout.dialog_action_confirm, null)

        val tvMessage = view.findViewById<TextView>(R.id.tvDialogMessage)
        val btnCancel = view.findViewById<TextView>(R.id.btnCancelDialog)
        val btnConfirm = view.findViewById<TextView>(R.id.btnConfirmDialog)

        tvMessage.text = message
        btnCancel.text = cancelText
        btnConfirm.text = confirmText

        val dialog = AlertDialog.Builder(this)
            .setView(view)
            .setCancelable(false)
            .create()

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }

        btnConfirm.setOnClickListener {
            dialog.dismiss()
            onConfirm()
        }

        dialog.show()
    }

    protected fun handleCommonError(
        error: AppError,
        retryAction: () -> Unit = {},
        onValidation: ((String) -> Unit)? = null,
        onUnauthorized: (() -> Unit)? = null
    ) {
        when (error) {
            is AppError.NoInternet -> {
                hideBlockingLoader()
                showNoInternetDialog(onRetry = retryAction)
            }

            is AppError.Server -> {
                hideBlockingLoader()
                showServerFailureDialog(
                    message = error.message,
                    onRetry = retryAction
                )
            }

            is AppError.Validation -> {
                hideBlockingLoader()
                onValidation?.invoke(error.message)
                    ?: Toast.makeText(this, error.message, Toast.LENGTH_LONG).show()
            }

            is AppError.Unauthorized -> {
                hideBlockingLoader()

                Toast.makeText(
                    this,
                    error.message.ifBlank { "Invalid credentials" },
                    Toast.LENGTH_LONG
                ).show()

                if (onUnauthorized != null) {
                    onUnauthorized()
                } else {
                    SessionManager(this).clearAll()

                    val i = Intent(this, AuthActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                        putExtra(AuthActivity.EXTRA_FORCE_LOGIN, true)
                    }
                    startActivity(i)
                    finish()
                }
            }

            is AppError.Unknown -> {
                hideBlockingLoader()
                showServerFailureDialog(
                    message = error.message,
                    onRetry = retryAction
                )
            }
        }
    }
}