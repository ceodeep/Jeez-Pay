package com.jeezpay.app

import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton

class ChangePinActivity : AppCompatActivity() {

    private lateinit var etCurrentPin: EditText
    private lateinit var etNewPin: EditText
    private lateinit var etConfirmPin: EditText
    private lateinit var btnSavePin: MaterialButton

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

        // Backend connection comes next.
        toast("Change PIN backend endpoint needed")
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}