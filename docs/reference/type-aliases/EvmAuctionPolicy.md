# Type Alias: EvmAuctionPolicy

> **EvmAuctionPolicy** = `MarketplaceDriverAuctionPolicy`\<[`GenericPolicyPaymentState`](GenericPolicyPaymentState.md), [`EvmAuctionPaymentPolicy`](EvmAuctionPaymentPolicy.md), [`EvmPaymentAsset`](EvmPaymentAsset.md), [`GenericPaymentIntent`](GenericPaymentIntent.md), [`GenericPaymentValidationRequest`](GenericPaymentValidationRequest.md), [`GenericPaymentValidationResult`](GenericPaymentValidationResult.md), [`GenericPaymentSweepInput`](GenericPaymentSweepInput.md), [`GenericPaymentSweepState`](GenericPaymentSweepState.md), `GenericPaymentSettlementIntent`, `GenericPaymentSettlementState`, [`GenericSwapResumeContext`](GenericSwapResumeContext.md), [`GenericSwapResumeState`](GenericSwapResumeState.md), [`GenericAuctionSettlementIntent`](GenericAuctionSettlementIntent.md), [`GenericAuctionSettlementResult`](GenericAuctionSettlementResult.md)\> & `object`

Defined in: [dependencies/marketplace-evm-ts/src/marketplace/types.ts:162](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/marketplace/types.ts#L162)

## Type Declaration

### id

> **id**: `"evm:multi-escrow-auction-v1"`

### method

> **method**: `"evm"`

### assets()

> **assets**(): [`EvmPaymentAsset`](EvmPaymentAsset.md)[]

#### Returns

[`EvmPaymentAsset`](EvmPaymentAsset.md)[]

### discoverHighWatermark()

> **discoverHighWatermark**(`context`): `Promise`\<`MarketplaceDriverWatermarkDiscovery` & `object`\>

#### Parameters

##### context

`MarketplaceDriverWatermarkContext`

#### Returns

`Promise`\<`MarketplaceDriverWatermarkDiscovery` & `object`\>

### pay()

> **pay**(`intent`): `AsyncIterable`\<[`GenericPolicyPaymentState`](GenericPolicyPaymentState.md)\>

#### Parameters

##### intent

`MarketplaceDriverPaymentIntent`

#### Returns

`AsyncIterable`\<[`GenericPolicyPaymentState`](GenericPolicyPaymentState.md)\>

### policies()

> **policies**(): [`EvmAuctionPaymentPolicy`](EvmAuctionPaymentPolicy.md)[]

#### Returns

[`EvmAuctionPaymentPolicy`](EvmAuctionPaymentPolicy.md)[]

### recyclePayment()

> **recyclePayment**(`intent`): `Promise`\<[`GenericAuctionSettlementResult`](GenericAuctionSettlementResult.md)\>

#### Parameters

##### intent

[`GenericAuctionSettlementIntent`](GenericAuctionSettlementIntent.md) & `object`

#### Returns

`Promise`\<[`GenericAuctionSettlementResult`](GenericAuctionSettlementResult.md)\>

### refundPayment()

> **refundPayment**(`intent`): `Promise`\<[`GenericAuctionSettlementResult`](GenericAuctionSettlementResult.md)\>

#### Parameters

##### intent

[`GenericAuctionSettlementIntent`](GenericAuctionSettlementIntent.md) & `object`

#### Returns

`Promise`\<[`GenericAuctionSettlementResult`](GenericAuctionSettlementResult.md)\>

### resumeSwapOperations()

> **resumeSwapOperations**(`context`): `AsyncIterable`\<`MarketplaceDriverSwapResumeState`\>

#### Parameters

##### context

[`GenericSwapResumeContext`](GenericSwapResumeContext.md)

#### Returns

`AsyncIterable`\<`MarketplaceDriverSwapResumeState`\>

### startup()

> **startup**(`context`): `Promise`\<`MarketplaceDriverStartResult` & `object`\>

#### Parameters

##### context

`MarketplaceDriverStartContext`

#### Returns

`Promise`\<`MarketplaceDriverStartResult` & `object`\>

### state()

> **state**(): [`EvmMarketplacePolicyState`](EvmMarketplacePolicyState.md)

#### Returns

[`EvmMarketplacePolicyState`](EvmMarketplacePolicyState.md)

### sweepPayment()

> **sweepPayment**(`payment`): `AsyncIterable`\<[`GenericPaymentSweepState`](GenericPaymentSweepState.md)\>

#### Parameters

##### payment

[`GenericPaymentSweepInput`](GenericPaymentSweepInput.md)

#### Returns

`AsyncIterable`\<[`GenericPaymentSweepState`](GenericPaymentSweepState.md)\>

### validatePayment()

> **validatePayment**(`request`): `Promise`\<[`GenericPaymentValidationResult`](GenericPaymentValidationResult.md)\>

#### Parameters

##### request

`MarketplaceDriverValidationRequest`

#### Returns

`Promise`\<[`GenericPaymentValidationResult`](GenericPaymentValidationResult.md)\>
