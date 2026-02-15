package com.jeezpay.app.network

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

object SignedUploader {

    private val client = OkHttpClient()

    @Throws(IOException::class)
    fun putBytes(signedUrl: String, bytes: ByteArray, contentType: String) {
        val body = bytes.toRequestBody(contentType.toMediaTypeOrNull())
        val req = Request.Builder()
            .url(signedUrl)
            .put(body)
            .header("Content-Type", contentType)
            .build()

        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw IOException("Upload failed: HTTP ${resp.code} ${resp.message}")
            }
        }
    }
}
