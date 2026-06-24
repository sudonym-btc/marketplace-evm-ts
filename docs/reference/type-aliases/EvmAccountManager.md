# Type Alias: EvmAccountManager

> **EvmAccountManager** = `object`

Defined in: [dependencies/marketplace-evm-ts/src/accounts.ts:17](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/accounts.ts#L17)

## Methods

### executorForTradeIndex()

> **executorForTradeIndex**(`tradeIndex`): [`EvmExecutor`](EvmExecutor.md)

Defined in: [dependencies/marketplace-evm-ts/src/accounts.ts:20](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/accounts.ts#L20)

#### Parameters

##### tradeIndex

`number`

#### Returns

[`EvmExecutor`](EvmExecutor.md)

***

### ownerAccount()

> **ownerAccount**(`tradeIndex`, `chainId?`): `object`

Defined in: [dependencies/marketplace-evm-ts/src/accounts.ts:18](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/accounts.ts#L18)

#### Parameters

##### tradeIndex

`number`

##### chainId?

`number`

#### Returns

`object`

##### address

> **address**: `Address`

##### nonceManager?

> `optional` **nonceManager?**: `NonceManager`

##### publicKey

> **publicKey**: `Hex`

##### sign?

> `optional` **sign?**: (`parameters`) => `Promise`\<`Hex`\>

###### Parameters

###### parameters

###### hash

`Hash`

###### Returns

`Promise`\<`Hex`\>

##### signAuthorization?

> `optional` **signAuthorization?**: (`parameters`) => `Promise`\<`SignAuthorizationReturnType`\>

###### Parameters

###### parameters

`AuthorizationRequest`

###### Returns

`Promise`\<`SignAuthorizationReturnType`\>

##### signMessage

> **signMessage**: (`{ message }`) => `Promise`\<`Hex`\>

###### Parameters

###### \{ message \}

###### message

`SignableMessage`

###### Returns

`Promise`\<`Hex`\>

##### signTransaction

> **signTransaction**: \<`serializer`, `transaction`\>(`transaction`, `options?`) => `Promise`\<`Hex`\>

###### Type Parameters

###### serializer

`serializer` *extends* `SerializeTransactionFn`\<`TransactionSerializable`\> = `SerializeTransactionFn`\<`TransactionSerializable`\>

###### transaction

`transaction` *extends* `Parameters`\<`serializer`\>\[`0`\] = `Parameters`\<`serializer`\>\[`0`\]

###### Parameters

###### transaction

`transaction`

###### options?

###### serializer?

`serializer`

###### Returns

`Promise`\<`Hex`\>

##### signTypedData

> **signTypedData**: \<`typedData`, `primaryType`\>(`parameters`) => `Promise`\<`Hex`\>

###### Type Parameters

###### typedData

`typedData` *extends* `TypedData` \| `Record`\<`string`, `unknown`\>

###### primaryType

`primaryType` *extends* keyof `typedData` \| `"EIP712Domain"` = keyof `typedData`

###### Parameters

###### parameters

`TypedDataDefinition`\<`typedData`, `primaryType`\>

###### Returns

`Promise`\<`Hex`\>

##### source

> **source**: `source`

##### type

> **type**: `"local"`

***

### smartAccountAddress()

> **smartAccountAddress**(`tradeIndex`, `chainId`): `Promise`\<`` `0x${string}` ``\>

Defined in: [dependencies/marketplace-evm-ts/src/accounts.ts:19](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/accounts.ts#L19)

#### Parameters

##### tradeIndex

`number`

##### chainId

`number`

#### Returns

`Promise`\<`` `0x${string}` ``\>
