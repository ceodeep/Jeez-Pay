package com.jeezpay.app.ui.send

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jeezpay.app.repository.WalletRepository
import com.jeezpay.app.network.dto.TransferResponse
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
