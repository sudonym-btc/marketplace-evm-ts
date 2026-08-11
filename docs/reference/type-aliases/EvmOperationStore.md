# Type Alias: EvmOperationStore

> **EvmOperationStore** = `object`

## Methods

### delete()

> **delete**(`id`): `Promise`\<`void`\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`id`): `Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md) \| `null`\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md) \| `null`\>

***

### list()

> **list**(`query?`): `Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md)[]\>

#### Parameters

##### query?

[`EvmOperationQuery`](EvmOperationQuery.md)

#### Returns

`Promise`\<[`EvmOperationRecord`](EvmOperationRecord.md)[]\>

***

### put()

> **put**(`record`): `Promise`\<`void`\>

#### Parameters

##### record

[`EvmOperationRecord`](EvmOperationRecord.md)

#### Returns

`Promise`\<`void`\>

***

### putIfAbsent()?

> `optional` **putIfAbsent**(`record`): `Promise`\<`boolean`\>

Atomically insert a record when it does not already exist.

#### Parameters

##### record

[`EvmOperationRecord`](EvmOperationRecord.md)

#### Returns

`Promise`\<`boolean`\>
