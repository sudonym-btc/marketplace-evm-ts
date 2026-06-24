# Type Alias: SwapInResult

> **SwapInResult** = \{ `amount?`: [`EvmAmount`](EvmAmount.md); `claimAssetAddress?`: [`EvmAddress`](EvmAddress.md); `invoice`: `string`; `limits?`: [`SwapAmountLimits`](SwapAmountLimits.md); `lockupAddress?`: [`EvmAddress`](EvmAddress.md); `onchainAmount?`: `number`; `operation`: [`EvmOperationRecord`](EvmOperationRecord.md); `postClaimCalls?`: [`NamedEvmCall`](NamedEvmCall.md)[]; `preimage?`: [`EvmHex`](EvmHex.md); `preimageHash`: [`EvmHex`](EvmHex.md); `refundAddress?`: [`EvmAddress`](EvmAddress.md); `swapId`: `string`; `timeoutBlockHeight`: `number`; `type`: `"external_payment_required"`; \} \| \{ `operation`: [`EvmOperationRecord`](EvmOperationRecord.md); `txHash`: `string`; `type`: `"completed"`; \}

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:53](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L53)
