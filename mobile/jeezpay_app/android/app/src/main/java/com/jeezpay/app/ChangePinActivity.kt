package com.jeezpay.app

import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.repository.AuthRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ChangePinActivity : AppCompatActivity() {

    private lateinit var etCurrentPin: EditText
    private lateinit var etNewPin: EditText
    private lateinit var etConfirmPin: EditText
    private lateinit var btnSavePin: MaterialButton

    private val repo = AuthRepository()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_change_pin)

        findViewById<android.view.View>(R.id.btnBack).setOnClickListener {
            finish()
        }

        etCurrentPin = findViewById(R.id.etCurrentPin)
        etNewPin = findViewById(R.id.etNewPin)
        etConfirmPin = findViewById(R.id.etConfirmPin)
        btnSavePin = findViewById(R.id.btnSavePin)

        setupPinInput(etCurrentPin)
        setupPinInput(etNewPin)
        setupPinInput(etConfirmPin)

        btnSavePin.setOnClickListener {
            validateAndSubmit()
        }
    }

    private fun setupPinInput(input: EditText) {
        input.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        input.filters = arrayOf(InputFilter.LengthFilter(4))
    }

    private fun validateAndSubmit() {
        val currentPin = etCurrentPin.text.toString().trim()
        val newPin = etNewPin.text.toString().trim()
        val confirmPin = etConfirmPin.text.toString().trim()

        if (currentPin.length != 4) {
            toast("Enter your current 4-digit PIN")
            return
        }

        if (newPin.length != 4) {
            toast("Enter a new 4-digit PIN")
            return
        }

        if (newPin != confirmPin) {
            toast("New PINs do not match")
            return
        }

        if (currentPin == newPin) {
            toast("New PIN must be different")
            return
        }

        changePinOnBackend(currentPin, newPin)
    }

    private fun changePinOnBackend(currentPin: String, newPin: String) {
        setLoading(true)

        lifecycleScope.launch(Dispatchers.IO) {
            val result = repo.changePinSafe(
                currentPin = currentPin,
                newPin = newPin
            )

            withContext(Dispatchers.Main) {
                setLoading(false)

                when (result) {
                    is ApiResult.Success -> {
                        toast(result.data.message.ifBlank { "PIN changed successfully" })
                        finish()
                    }

                    is ApiResult.Error -> {
                        toast("Failed to change PIN")
                    }
                }
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        btnSavePin.isEnabled = !loading
        btnSavePin.alpha = if (loading) 0.7f else 1f
        btnSavePin.text = if (loading) "Saving..." else "Save New PIN"
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}