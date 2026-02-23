package com.jeezpay.app.ui.send

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jeezpay.app.network.dto.TransferResponse
import com.jeezpay.app.repository.WalletRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

sealed class SendMoneyUiState {
    object Idle : SendMoneyUiState()
    object Loading : SendMoneyUiState()
    data class Success(val res: TransferResponse) : SendMoneyUiState()
    data class Error(val message: String) : SendMoneyUiState()
}

class SendMoneyViewModel : ViewModel() {

    private val repo = WalletRepository()

    private val _state = MutableStateFlow<SendMoneyUiState>(SendMoneyUiState.Idle)
    val state: StateFlow<SendMoneyUiState> = _state

    // ✅ balances: currency -> balance
    private val _balances = MutableStateFlow<Map<String, Double>>(emptyMap())
    val balances: StateFlow<Map<String, Double>> = _balances

    fun loadBalances() {
        viewModelScope.launch {
            try {
                val res = repo.fetchBalances()
                val map = res.balances.associate { it.currency.uppercase() to (it.balance ?: 0.0) }
                _balances.value = map
            } catch (_: Exception) {
                // keep old balances (don’t break send screen if balance fails)
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
        description: String?
    ) {
        _state.value = SendMoneyUiState.Loading

        viewModelScope.launch {
            try {
                val res = repo.transfer(
                    toPhone = toPhone,
                    currency = currency,
                    amount = amount,
                    description = description
                )
                _state.value = SendMoneyUiState.Success(res)
            } catch (e: Exception) {
                _state.value = SendMoneyUiState.Error(e.message ?: "Transfer failed")
            }
        }
    }

    fun reset() {
        _state.value = SendMoneyUiState.Idle
    }
}