# Type Alias: EvmEscrowCallBuilder

> **EvmEscrowCallBuilder** = `object`

Defined in: [dependencies/marketplace-evm-ts/src/escrow/types.ts:81](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/escrow/types.ts#L81)

## Methods

### arbitrate()

> **arbitrate**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

Defined in: [dependencies/marketplace-evm-ts/src/escrow/types.ts:86](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/escrow/types.ts#L86)

#### Parameters

##### params

[`EvmArbitrateParams`](EvmArbitrateParams.md)

#### Returns

[`NamedEvmCall`](NamedEvmCall.md)

***

### claim()

> **claim**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

Defined in: [dependencies/marketplace-evm-ts/src/escrow/types.ts:84](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/escrow/types.ts#L84)

#### Parameters

##### params

[`EvmSignedEscrowAction`](EvmSignedEscrowAction.md)

#### Returns

[`NamedEvmCall`](NamedEvmCall.md)

***

### createTrade()

> **createTrade**(`params`): [`NamedEvmCall`](NamedEvmCall.md)[]

Defined in: [dependencies/marketplace-evm-ts/src/escrow/types.ts:82](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/escrow/types.ts#L82)

#### Parameters

##### params

[`EvmCreateTradeParams`](EvmCreateTradeParams.md)

#### Returns

[`NamedEvmCall`](NamedEvmCall.md)[]

***

### recycle()

> **recycle**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

Defined in: [dependencies/marketplace-evm-ts/src/escrow/types.ts:83](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/escrow/types.ts#L83)

#### Parameters

##### params

`EvmRecycleParams`

#### Returns

[`NamedEvmCall`](NamedEvmCall.md)

***

### release()

> **release**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

Defined in: [dependencies/marketplace-evm-ts/src/escrow/types.ts:85](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/escrow/types.ts#L85)

#### Parameters

##### params

[`EvmReleaseParams`](EvmReleaseParams.md)

#### Returns

[`NamedEvmCall`](NamedEvmCall.md)

***

### withdraw()

> **withdraw**(`params`): [`NamedEvmCall`](NamedEvmCall.md)

Defined in: [dependencies/marketplace-evm-ts/src/escrow/types.ts:87](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/escrow/types.ts#L87)

#### Parameters

##### params

[`EvmWithdrawParams`](EvmWithdrawParams.md)

#### Returns

[`NamedEvmCall`](NamedEvmCall.md)
