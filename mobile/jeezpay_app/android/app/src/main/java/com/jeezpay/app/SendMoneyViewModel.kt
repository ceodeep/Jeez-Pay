package com.jeezpay.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jeezpay.app.network.ApiResult
import com.jeezpay.app.network.AppError
import com.jeezpay.app.network.dto.TransferResponse
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

sealed class SendMoneyUiState {
    object Idle : SendMoneyUiState()
    object Loading : SendMoneyUiState()
    data class Success(val res: TransferResponse) : SendMoneyUiState()
    data class Error(val error: AppError) : SendMoneyUiState()
}

class SendMoneyViewModel : ViewModel() {

    private val repo = WalletRepository()

    private val _state = MutableStateFlow<SendMoneyUiState>(SendMoneyUiState.Idle)
    val state: StateFlow<SendMoneyUiState> = _state

    private val _balances = MutableStateFlow<Map<String, Double>>(emptyMap())
    val balances: StateFlow<Map<String, Double>> = _balances

    private var isSending = false

    fun loadBalances() {
        viewModelScope.launch {
            when (val result = repo.fetchBalancesSafe()) {
                is ApiResult.Success -> {
                    val map = result.data.balances.associate {
                        it.currency.uppercase() to it.balance
                    }
                    _balances.value = map
                }

                is ApiResult.Error -> {
                    when (result.error) {
                        is AppError.Unauthorized -> {
                            _state.value = SendMoneyUiState.Error(result.error)
                        }
                        else -> {
                            // keep old balances silently for now
                        }
                    }
                }
            }
        }
    }

    fun availableFor(currency: String): Double {
        return _balances.value[currency.uppercase()] ?: 0.0
    }

    fun sendMoney(
        toPhone: String,
        currency: String,
        amount: Double,
        description: String?,
        pin: String
    ) {
        if (isSending) return

        isSending = true
        _state.value = SendMoneyUiState.Loading

        viewModelScope.launch {
            try {
                when (
                    val result = repo.transferSafe(
                        toPhone = toPhone,
                        currency = currency,
                        amount = amount,
                        description = description,
                        pin = pin
                    )
                ) {
                    is ApiResult.Success -> {
                        _state.value = SendMoneyUiState.Success(result.data)
                    }

                    is ApiResult.Error -> {
                        _state.value = SendMoneyUiState.Error(result.error)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                _state.value = SendMoneyUiState.Error(
                    AppError.Unknown("Something went wrong. Please try again.")
                )
            } finally {
                isSending = false
            }
        }
    }

    fun reset() {
        isSending = false
        _state.value = SendMoneyUiState.Idle
    }
}