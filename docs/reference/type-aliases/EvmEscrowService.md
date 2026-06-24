# Type Alias: EvmEscrowService

> **EvmEscrowService** = [`EvmEscrowClient`](EvmEscrowClient.md) & `object`

Defined in: [dependencies/marketplace-evm-ts/src/escrow/types.ts:96](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/escrow/types.ts#L96)

## Type Declaration

### execute()

> **execute**(`calls`, `chainId`, `operationId?`): `Promise`\<\{ `txHash`: `string`; \}\>

#### Parameters

##### calls

[`NamedEvmCall`](NamedEvmCall.md)[]

##### chainId

`number`

##### operationId?

`string`

#### Returns

`Promise`\<\{ `txHash`: `string`; \}\>
