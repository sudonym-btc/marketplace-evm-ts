# Type Alias: EvmAccountManager

> **EvmAccountManager** = `object`

## Methods

### executorForTradeIndex()

> **executorForTradeIndex**(`tradeIndex`): [`EvmExecutor`](EvmExecutor.md)

#### Parameters

##### tradeIndex

`number`

#### Returns

[`EvmExecutor`](EvmExecutor.md)

***

### ownerAccount()

> **ownerAccount**(`tradeIndex`, `chainId?`): `object`

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

#### Parameters

##### tradeIndex

`number`

##### chainId

`number`

#### Returns

`Promise`\<`` `0x${string}` ``\>
