# Type Alias: SwapOutResult

> **SwapOutResult** = \{ `amount?`: [`EvmAmount`](EvmAmount.md); `description?`: `string`; `operation`: [`EvmOperationRecord`](EvmOperationRecord.md); `type`: `"external_invoice_required"`; \} \| \{ `claimAddress?`: [`EvmAddress`](EvmAddress.md); `expectedAmount?`: `number`; `limits?`: [`SwapAmountLimits`](SwapAmountLimits.md); `lockupAddress?`: [`EvmAddress`](EvmAddress.md); `operation`: [`EvmOperationRecord`](EvmOperationRecord.md); `swapId`: `string`; `timeoutBlockHeight`: `number`; `type`: `"awaiting_resolution"`; \} \| \{ `operation`: [`EvmOperationRecord`](EvmOperationRecord.md); `preimage?`: `string`; `type`: `"completed"`; \}

Defined in: [dependencies/marketplace-evm-ts/src/swaps/types.ts:76](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/swaps/types.ts#L76)
