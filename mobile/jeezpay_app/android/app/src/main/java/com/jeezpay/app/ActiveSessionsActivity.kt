package com.jeezpay.app

import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.dto.UserSessionDto
import com.jeezpay.app.repository.AuthRepository
import kotlinx.coroutines.launch

class ActiveSessionsActivity : AppCompatActivity() {

    private val repo = AuthRepository()

    private lateinit var btnBack: View
    private lateinit var btnLogoutOthers: TextView
    private lateinit var sessionsContainer: LinearLayout
    private lateinit var progressBar: View
    private lateinit var tvEmpty: TextView

    private var sessions: List<UserSessionDto> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_active_sessions)

        btnBack = findViewById(R.id.btnBack)
        btnLogoutOthers = findViewById(R.id.btnLogoutOthers)
        sessionsContainer = findViewById(R.id.sessionsContainer)
        progressBar = findViewById(R.id.progressBar)
        tvEmpty = findViewById(R.id.tvEmpty)

        btnBack.setOnClickListener {
            finish()
        }

        btnLogoutOthers.setOnClickListener {
            confirmLogoutOthers()
        }

        loadSessions()
    }

    override fun onResume() {
        super.onResume()
        loadSessions()
    }

    private fun loadSessions() {
        setLoading(true)

        lifecycleScope.launch {
            when (val result = repo.activeSessionsSafe()) {
                is ApiResult.Success -> {
                    sessions = result.data.sessions
                    setLoading(false)
                    renderSessions(sessions)
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    renderSessions(emptyList())
                    toast(errorMessage(result.error))
                }
            }
        }
    }

    private fun renderSessions(items: List<UserSessionDto>) {
        sessionsContainer.removeAllViews()

        tvEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        sessionsContainer.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE

        items.forEach { session ->
            val row = layoutInflater.inflate(
                R.layout.item_active_session,
                sessionsContainer,
                false
            )

            val tvDeviceName = row.findViewById<TextView>(R.id.tvDeviceName)
            val tvSessionMeta = row.findViewById<TextView>(R.id.tvSessionMeta)
            val tvSessionLastSeen = row.findViewById<TextView>(R.id.tvSessionLastSeen)
            val tvCurrentBadge = row.findViewById<TextView>(R.id.tvCurrentBadge)
            val btnRevoke = row.findViewById<TextView>(R.id.btnRevoke)

            tvDeviceName.text = session.deviceName?.ifBlank { null } ?: "Unknown device"

            val platform = session.appPlatform?.ifBlank { "android" } ?: "android"
            val type = session.deviceType?.ifBlank { "mobile" } ?: "mobile"
            val ip = session.ipAddress?.takeIf { it.isNotBlank() }

            tvSessionMeta.text = if (ip != null) {
                "${platform.uppercase()} • $type • $ip"
            } else {
                "${platform.uppercase()} • $type"
            }

            tvSessionLastSeen.text = "Last active: ${formatDate(session.lastSeenAt)}"

            tvCurrentBadge.visibility = if (session.isCurrent) View.VISIBLE else View.GONE

            if (session.isCurrent) {
                btnRevoke.visibility = View.GONE
            } else {
                btnRevoke.visibility = View.VISIBLE
                btnRevoke.setOnClickListener {
                    confirmRevokeSession(session)
                }
            }

            sessionsContainer.addView(row)
        }
    }

    private fun confirmRevokeSession(session: UserSessionDto) {
        AlertDialog.Builder(this)
            .setTitle("Remove session?")
            .setMessage("This will log out ${session.deviceName ?: "this device"} from JeezPay.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Remove") { _, _ ->
                revokeSession(session.id)
            }
            .show()
    }

    private fun revokeSession(sessionId: String) {
        setLoading(true)

        lifecycleScope.launch {
            when (val result = repo.revokeSessionSafe(sessionId)) {
                is ApiResult.Success -> {
                    toast(result.data.message.ifBlank { "Session removed" })
                    loadSessions()
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    toast(errorMessage(result.error))
                }
            }
        }
    }

    private fun confirmLogoutOthers() {
        val otherCount = sessions.count { !it.isCurrent }

        if (otherCount == 0) {
            toast("No other active sessions")
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Logout other devices?")
            .setMessage("This will log out $otherCount other device(s) from your JeezPay account.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Logout") { _, _ ->
                logoutOtherSessions()
            }
            .show()
    }

    private fun logoutOtherSessions() {
        setLoading(true)

        lifecycleScope.launch {
            when (val result = repo.logoutOtherSessionsSafe()) {
                is ApiResult.Success -> {
                    toast(result.data.message.ifBlank { "Other sessions logged out" })
                    loadSessions()
                }

                is ApiResult.Error -> {
                    setLoading(false)
                    toast(errorMessage(result.error))
                }
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        btnLogoutOthers.isEnabled = !loading
        btnLogoutOthers.alpha = if (loading) 0.65f else 1f
    }

    private fun formatDate(value: String?): String {
        if (value.isNullOrBlank()) return "Recently"

        return value
            .replace("T", " ")
            .replace("Z", "")
            .substringBefore(".")
    }

    private fun errorMessage(error: AppError): String {
        return when (error) {
            is AppError.NoInternet -> "No internet connection"
            is AppError.Server -> error.message
            is AppError.Unauthorized -> error.message
            is AppError.Validation -> error.message
            is AppError.Unknown -> error.message
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}