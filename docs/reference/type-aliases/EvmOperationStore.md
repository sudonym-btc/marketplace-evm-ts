# Type Alias: EvmOperationStore

> **EvmOperationStore** = `object`

Defined in: [dependencies/marketplace-evm-ts/src/types.ts:132](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/types.ts#L132)

## Methods

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [dependencies/marketplace-evm-ts/src/types.ts:136](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/types.ts#L136)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`id`): `Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md) \| `null`\>

Defined in: [dependencies/marketplace-evm-ts/src/types.ts:133](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/types.ts#L133)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md) \| `null`\>

***

### list()

> **list**(`query?`): `Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md)[]\>

Defined in: [dependencies/marketplace-evm-ts/src/types.ts:135](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/types.ts#L135)

#### Parameters

##### query?

[`EvmOperationQuery`](EvmOperationQuery.md)

#### Returns

`Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md)[]\>

***

### put()

> **put**(`record`): `Promise`\<`void`\>

Defined in: [dependencies/marketplace-evm-ts/src/types.ts:134](https://github.com/sudonym-btc/marketplace-evm-ts/blob/9753d1381d82ef5e3e048bb2ccde93101c2613ce/src/types.ts#L134)

#### Parameters

##### record

[`EvmOperationRecord`](EvmOperationRecord.md)

#### Returns

`Promise`\<`void`\>
