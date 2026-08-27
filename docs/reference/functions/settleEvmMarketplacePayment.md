# Function: settleEvmMarketplacePayment()

> **settleEvmMarketplacePayment**(`options`): `AsyncIterable`\<[`GenericPaymentSettlementState`](../type-aliases/GenericPaymentSettlementState.md)\>

## Parameters

### options

#### chains

[`ResolvedEvmMarketplaceChainConfig`](../type-aliases/ResolvedEvmMarketplaceChainConfig.md)[]

#### intent

[`GenericPaymentSettlementIntent`](../type-aliases/GenericPaymentSettlementIntent.md)

#### operationStore

[`EvmOperationStore`](../type-aliases/EvmOperationStore.md)

#### settlementAccount?

\{ `address`: `` `0x${string}` ``; `nonceManager?`: `NonceManager`; `publicKey`: `` `0x${string}` ``; `sign?`: (`parameters`) => `Promise`\<`` `0x${string}` ``\>; `signAuthorization?`: (`parameters`) => `Promise`\<`SignAuthorizationReturnType`\>; `signMessage`: (`__namedParameters`) => `Promise`\<`` `0x${string}` ``\>; `signTransaction`: \<`serializer`, `transaction`\>(`transaction`, `options?`) => `Promise`\<`` `0x${string}` ``\>; `signTypedData`: \<`typedData`, `primaryType`\>(`parameters`) => `Promise`\<`` `0x${string}` ``\>; `source`: `string`; `type`: `"local"`; \}

#### settlementAccount.address

`` `0x${string}` ``

#### settlementAccount.nonceManager?

`NonceManager`

#### settlementAccount.publicKey

`` `0x${string}` ``

#### settlementAccount.sign?

(`parameters`) => `Promise`\<`` `0x${string}` ``\>

#### settlementAccount.signAuthorization?

(`parameters`) => `Promise`\<`SignAuthorizationReturnType`\>

#### settlementAccount.signMessage

(`__namedParameters`) => `Promise`\<`` `0x${string}` ``\>

#### settlementAccount.signTransaction

\<`serializer`, `transaction`\>(`transaction`, `options?`) => `Promise`\<`` `0x${string}` ``\>

#### settlementAccount.signTypedData

\<`typedData`, `primaryType`\>(`parameters`) => `Promise`\<`` `0x${string}` ``\>

#### settlementAccount.source

`string`

#### settlementAccount.type

`"local"`

#### settlementClient

## Returns

`AsyncIterable`\<[`GenericPaymentSettlementState`](../type-aliases/GenericPaymentSettlementState.md)\>
