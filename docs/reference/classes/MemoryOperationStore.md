# Class: MemoryOperationStore

## Implements

- [`EvmOperationStore`](../type-aliases/EvmOperationStore.md)

## Constructors

### Constructor

> **new MemoryOperationStore**(): `MemoryOperationStore`

#### Returns

`MemoryOperationStore`

## Methods

### delete()

> **delete**(`id`): `Promise`\<`void`\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`EvmOperationStore.delete`

***

### get()

> **get**(`id`): `Promise`\<[`EvmOperationRecord`](../type-aliases/EvmOperationRecord.md) \| `null`\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`EvmOperationRecord`](../type-aliases/EvmOperationRecord.md) \| `null`\>

#### Implementation of

`EvmOperationStore.get`

***

### list()

> **list**(`query?`): `Promise`\<[`EvmOperationRecord`](../type-aliases/EvmOperationRecord.md)[]\>

#### Parameters

##### query?

[`EvmOperationQuery`](../type-aliases/EvmOperationQuery.md) = `{}`

#### Returns

`Promise`\<[`EvmOperationRecord`](../type-aliases/EvmOperationRecord.md)[]\>

#### Implementation of

`EvmOperationStore.list`

***

### put()

> **put**(`record`): `Promise`\<`void`\>

#### Parameters

##### record

[`EvmOperationRecord`](../type-aliases/EvmOperationRecord.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

`EvmOperationStore.put`

***

### putIfAbsent()

> **putIfAbsent**(`record`): `Promise`\<`boolean`\>

Atomically insert a record when it does not already exist. Order
settlement requires this primitive and fails closed when it is absent.

#### Parameters

##### record

[`EvmOperationRecord`](../type-aliases/EvmOperationRecord.md)

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

`EvmOperationStore.putIfAbsent`
