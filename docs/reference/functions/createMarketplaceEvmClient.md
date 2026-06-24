# Function: createMarketplaceEvmClient()

> **createMarketplaceEvmClient**(`options`): `object`

Defined in: [dependencies/marketplace-evm-ts/src/client.ts:15](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/client.ts#L15)

## Parameters

### options

[`MarketplaceEvmClientOptions`](../type-aliases/MarketplaceEvmClientOptions.md)

## Returns

`object`

### accounts?

> `optional` **accounts?**: [`EvmAccountManager`](../type-aliases/EvmAccountManager.md)

### auction

> **auction**: `object`

#### auction.validate

> **validate**: (`request`) => `Promise`\<[`EvmAuctionPaymentValidationResult`](../type-aliases/EvmAuctionPaymentValidationResult.md)\> = `auctionValidator.validate`

##### Parameters

###### request

[`EvmAuctionBidValidationRequest`](../type-aliases/EvmAuctionBidValidationRequest.md)

##### Returns

`Promise`\<[`EvmAuctionPaymentValidationResult`](../type-aliases/EvmAuctionPaymentValidationResult.md)\>

#### auction.placeBid()

> **placeBid**(`params`): [`NamedEvmCall`](../type-aliases/NamedEvmCall.md)[]

##### Parameters

###### params

[`EvmPlaceBidParams`](../type-aliases/EvmPlaceBidParams.md)

##### Returns

[`NamedEvmCall`](../type-aliases/NamedEvmCall.md)[]

### chains

> **chains**: [`ResolvedEvmChainConfig`](../type-aliases/ResolvedEvmChainConfig.md)[]

### discoverHighWatermark?

> `optional` **discoverHighWatermark?**: (`options?`) => `Promise`\<[`EvmHighWatermarkDiscovery`](../type-aliases/EvmHighWatermarkDiscovery.md)\> = `discovery.discoverHighWatermark`

#### Parameters

##### options?

[`EvmDiscoverHighWatermarkOptions`](../type-aliases/EvmDiscoverHighWatermarkOptions.md)

#### Returns

`Promise`\<[`EvmHighWatermarkDiscovery`](../type-aliases/EvmHighWatermarkDiscovery.md)\>

### escrow

> **escrow**: `object`

#### escrow.validate

> **validate**: (`request`) => `Promise`\<[`EvmEscrowPaymentValidationResult`](../type-aliases/EvmEscrowPaymentValidationResult.md)\> = `escrowValidator.validate`

##### Parameters

###### request

[`EvmEscrowPaymentValidationRequest`](../type-aliases/EvmEscrowPaymentValidationRequest.md)

##### Returns

`Promise`\<[`EvmEscrowPaymentValidationResult`](../type-aliases/EvmEscrowPaymentValidationResult.md)\>

#### escrow.arbitrate()

> **arbitrate**(`params`): [`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

##### Parameters

###### params

[`EvmArbitrateParams`](../type-aliases/EvmArbitrateParams.md)

##### Returns

[`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

#### escrow.claim()

> **claim**(`params`): [`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

##### Parameters

###### params

[`EvmSignedEscrowAction`](../type-aliases/EvmSignedEscrowAction.md)

##### Returns

[`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

#### escrow.createTrade()

> **createTrade**(`params`): [`NamedEvmCall`](../type-aliases/NamedEvmCall.md)[]

##### Parameters

###### params

[`EvmCreateTradeParams`](../type-aliases/EvmCreateTradeParams.md)

##### Returns

[`NamedEvmCall`](../type-aliases/NamedEvmCall.md)[]

#### escrow.recycle()

> **recycle**(`params`): [`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

##### Parameters

###### params

`EvmRecycleParams`

##### Returns

[`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

#### escrow.release()

> **release**(`params`): [`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

##### Parameters

###### params

[`EvmReleaseParams`](../type-aliases/EvmReleaseParams.md)

##### Returns

[`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

#### escrow.withdraw()

> **withdraw**(`params`): [`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

##### Parameters

###### params

[`EvmWithdrawParams`](../type-aliases/EvmWithdrawParams.md)

##### Returns

[`NamedEvmCall`](../type-aliases/NamedEvmCall.md)

### executor?

> `optional` **executor?**: [`EvmExecutor`](../type-aliases/EvmExecutor.md)

### operationStore

> **operationStore**: [`EvmOperationStore`](../type-aliases/EvmOperationStore.md) = `options.operationStore`

### swaps?

> `optional` **swaps?**: [`EvmSwapService`](../type-aliases/EvmSwapService.md)
