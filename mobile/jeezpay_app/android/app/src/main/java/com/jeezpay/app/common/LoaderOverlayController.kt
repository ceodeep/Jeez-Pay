package com.jeezpay.app.common

import android.view.View
import com.airbnb.lottie.LottieAnimationView
import com.airbnb.lottie.LottieDrawable
import com.jeezpay.app.R

class LoaderOverlayController(
    root: View
) {
    private val dim: View = root.findViewById(R.id.sendLoadingDim)
    private val lottie: LottieAnimationView = root.findViewById(R.id.loadingLottie)

    init {
        lottie.repeatCount = LottieDrawable.INFINITE
        lottie.speed = 1.0f

        dim.elevation = 20f
        lottie.elevation = 21f
    }

    fun show() {
        dim.visibility = View.VISIBLE
        lottie.visibility = View.VISIBLE

        if (!lottie.isAnimating) {
            lottie.playAnimation()
        }
    }

    fun hide() {
        lottie.cancelAnimation()
        lottie.visibility = View.GONE
        dim.visibility = View.GONE
    }

    fun setVisible(visible: Boolean) {
        if (visible) show() else hide()
    }
}