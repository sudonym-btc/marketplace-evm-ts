# Type Alias: EvmEscrowPolicy

> **EvmEscrowPolicy** = `MarketplaceDriverOrderPolicy`\<[`GenericPolicyPaymentState`](GenericPolicyPaymentState.md), [`EvmEscrowPaymentPolicy`](EvmEscrowPaymentPolicy.md), [`EvmPaymentAsset`](EvmPaymentAsset.md), [`GenericPaymentIntent`](GenericPaymentIntent.md), [`GenericPaymentValidationRequest`](GenericPaymentValidationRequest.md), [`GenericPaymentValidationResult`](GenericPaymentValidationResult.md), [`GenericPaymentSweepInput`](GenericPaymentSweepInput.md), [`GenericPaymentSweepState`](GenericPaymentSweepState.md), `GenericPaymentSettlementIntent`, `GenericPaymentSettlementState`, [`GenericSwapResumeContext`](GenericSwapResumeContext.md), [`GenericSwapResumeState`](GenericSwapResumeState.md)\> & `object`

Defined in: [dependencies/marketplace-evm-ts/src/marketplace/types.ts:120](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/marketplace/types.ts#L120)

## Type Declaration

### id

> **id**: `"evm:multi-escrow"`

### method

> **method**: `"evm"`

### assets()

> **assets**(): [`EvmPaymentAsset`](EvmPaymentAsset.md)[]

#### Returns

[`EvmPaymentAsset`](EvmPaymentAsset.md)[]

### client()

> **client**(`seed`, `tradeIndex?`): `object`

#### Parameters

##### seed

`string`

##### tradeIndex?

`number`

#### Returns

`object`

##### accounts?

> `optional` **accounts?**: [`EvmAccountManager`](EvmAccountManager.md)

##### auction

> **auction**: `object`

###### auction.validate

> **validate**: (`request`) => `Promise`\<[`EvmAuctionPaymentValidationResult`](EvmAuctionPaymentValidationResult.md)\> = `auctionValidator.validate`

###### Parameters

###### request

[`EvmAuctionBidValidationRequest`](EvmAuctionBidValidationRequest.md)

###### Returns

`Promise`\<[`EvmAuctionPaymentValidationResult`](EvmAuctionPaymentValidationResult.md)\>

###### auction.placeBid()

> **placeBid**(`params`): [`NamedEvmCall`](NamedEvmCall.md)[]

###### Parameters

###### params

[`EvmPlaceBidParams`](EvmPlaceBidParams.md)

###### Returns

[`NamedEvmCall`](NamedEvmCall.md)[]

##### chains

> **chains**: [`ResolvedEvmChainConfig`](ResolvedEvmChainConfig.md)[]

##### discoverHighWatermark?

> `optional` **discoverHighWatermark?**: (`options?`) => `Promise`\<[`EvmHighWatermarkDiscovery`](EvmHighWatermarkDiscovery.md)\> = `discovery.discoverHighWatermark`

###### Parameters

###### options?

[`EvmDiscoverHighWatermarkOptions`](EvmDiscoverHighWatermarkOptions.md)

###### Returns

`Promise`\<[`EvmHighWatermarkDiscovery`](EvmHighWatermarkDiscovery.md)\>

##### escrow

> **escrow**: `object`

###### escrow.validate

> **validate**: (`request`) => `Promise`\<[`EvmEscrowPaymentValidationResult`](EvmEscrowPaymentValidationResult.md)\> = `escrowValidator.validate`

###### Parameters

###### request

[`EvmEscrowPaymentValidationRequest`](EvmEscrowPaymentValidationRequest.md)

###### Returns

`Promise`\<[`EvmEscrowPaymentValidationResult`](EvmEscrowPaymentValidationResult.md)\>

###### escrow.arbitrate()

> **arbitrate**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

###### Parameters

###### params

[`EvmArbitrateParams`](EvmArbitrateParams.md)

###### Returns

[`NamedEvmCall`](NamedEvmCall.md)

###### escrow.claim()

> **claim**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

###### Parameters

###### params

[`EvmSignedEscrowAction`](EvmSignedEscrowAction.md)

###### Returns

[`NamedEvmCall`](NamedEvmCall.md)

###### escrow.createTrade()

> **createTrade**(`params`): [`NamedEvmCall`](NamedEvmCall.md)[]

###### Parameters

###### params

[`EvmCreateTradeParams`](EvmCreateTradeParams.md)

###### Returns

[`NamedEvmCall`](NamedEvmCall.md)[]

###### escrow.recycle()

> **recycle**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

###### Parameters

###### params

`EvmRecycleParams`

###### Returns

[`NamedEvmCall`](NamedEvmCall.md)

###### escrow.release()

> **release**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

###### Parameters

###### params

[`EvmReleaseParams`](EvmReleaseParams.md)

###### Returns

[`NamedEvmCall`](NamedEvmCall.md)

###### escrow.withdraw()

> **withdraw**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

###### Parameters

###### params

[`EvmWithdrawParams`](EvmWithdrawParams.md)

###### Returns

[`NamedEvmCall`](NamedEvmCall.md)

##### executor?

> `optional` **executor?**: [`EvmExecutor`](EvmExecutor.md)

##### operationStore

> **operationStore**: [`EvmOperationStore`](EvmOperationStore.md) = `options.operationStore`

##### swaps?

> `optional` **swaps?**: [`EvmSwapService`](EvmSwapService.md)

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

> **policies**(): [`EvmEscrowPaymentPolicy`](EvmEscrowPaymentPolicy.md)[]

#### Returns

[`EvmEscrowPaymentPolicy`](EvmEscrowPaymentPolicy.md)[]

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
