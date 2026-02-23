package com.jeezpay.app.ui.receipt

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.jeezpay.app.R
import java.io.IOException
import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Locale

class ReceiptActivity : AppCompatActivity() {

    private val df = DecimalFormat("#,##0.00")

    private fun formatTime(raw: String): String {
        return try {
            val input = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
            val date = input.parse(raw) ?: return raw

            val output = SimpleDateFormat("dd MMM yyyy • h:mm a", Locale.getDefault())
            output.format(date)
        } catch (e: Exception) {
            raw
        }
    }

    // Android 9 and below permission request
    private val requestWritePermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                saveFullReceiptPageToGallery()
            } else {
                Toast.makeText(this, "Storage permission denied", Toast.LENGTH_SHORT).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_receipt)

        val tvFrom = findViewById<TextView>(R.id.tvFrom)
        val fromPhone = intent.getStringExtra("fromPhone") ?: "-"
        tvFrom.text = fromPhone

        val btnDownload = findViewById<MaterialButton>(R.id.btnDownload)
        btnDownload.setOnClickListener {
            // Android 10+ (Q+) does not need storage permission to save via MediaStore
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveFullReceiptPageToGallery()
            } else {
                // Android 9- needs WRITE permission
                val granted = ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE
                ) == PackageManager.PERMISSION_GRANTED

                if (granted) {
                    saveFullReceiptPageToGallery()
                } else {
                    requestWritePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                }
            }
        }

        val tvTo = findViewById<TextView>(R.id.tvTo)
        val tvAmount = findViewById<TextView>(R.id.tvAmount)
        val tvCurrency = findViewById<TextView>(R.id.tvCurrency)
        val tvDesc = findViewById<TextView>(R.id.tvDesc)
        val tvTime = findViewById<TextView>(R.id.tvTime)

        val createdAtRaw = intent.getStringExtra("createdAt") ?: "-"
        val formattedTime = formatTime(createdAtRaw)
        tvTime.text = formattedTime

        val btnDone = findViewById<MaterialButton>(R.id.btnDone)
        btnDone.setOnClickListener { finish() }

        val toPhone = intent.getStringExtra("toPhone") ?: "-"
        val currency = intent.getStringExtra("currency") ?: "-"
        val amount = intent.getDoubleExtra("amount", 0.0)
        val description = intent.getStringExtra("description") ?: "-"

        val tvReference = findViewById<TextView>(R.id.tvReference)
        val reference = intent.getStringExtra("reference") ?: "-"
        tvReference.text = reference

        tvTo.text = toPhone
        tvAmount.text = df.format(amount)
        tvCurrency.text = currency
        tvDesc.text = if (description.isBlank()) "-" else description
    }

    private fun saveFullReceiptPageToGallery() {
        val root = findViewById<View>(android.R.id.content)

        // Ensure view has been laid out
        if (root.width == 0 || root.height == 0) {
            root.post { saveFullReceiptPageToGallery() }
            return
        }

        val bitmap = captureViewToBitmap(root)
        val filename = "JeezPay_Receipt_${System.currentTimeMillis()}.png"
        val uri = saveBitmapToMediaStore(bitmap, filename)

        if (uri != null) {
            Toast.makeText(this, "Receipt saved ✅", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Failed to save receipt", Toast.LENGTH_SHORT).show()
        }
    }

    private fun captureViewToBitmap(view: View): Bitmap {
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        view.draw(canvas)
        return bitmap
    }

    private fun saveBitmapToMediaStore(bitmap: Bitmap, filename: String): Uri? {
        return try {
            val resolver = contentResolver
            val values = ContentValues().apply {
                put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, filename)
                put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "image/png")

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(
                        android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/JeezPay"
                    )
                    put(android.provider.MediaStore.Images.Media.IS_PENDING, 1)
                }
            }

            val uri = resolver.insert(
                android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                values
            ) ?: return null

            resolver.openOutputStream(uri).use { out ->
                if (out == null) return null
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) return null
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }

            uri
        } catch (e: IOException) {
            null
        } catch (e: SecurityException) {
            null
        }
    }
}