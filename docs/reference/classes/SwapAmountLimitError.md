# Class: SwapAmountLimitError

## Extends

- `Error`

## Constructors

### Constructor

> **new SwapAmountLimitError**(`reason`, `limits`): `SwapAmountLimitError`

#### Parameters

##### reason

`LimitReason`

##### limits

[`SwapAmountLimits`](../type-aliases/SwapAmountLimits.md)

#### Returns

`SwapAmountLimitError`

#### Overrides

`Error.constructor`

## Properties

### cause?

> `optional` **cause?**: `unknown`

#### Inherited from

`Error.cause`

***

### code

> `readonly` **code**: `"PAYMENT_AMOUNT_LIMIT"` = `'PAYMENT_AMOUNT_LIMIT'`

***

### limits

> `readonly` **limits**: [`SwapAmountLimits`](../type-aliases/SwapAmountLimits.md)

***

### message

> **message**: `string`

#### Inherited from

`Error.message`

***

### name

> `readonly` **name**: `"SwapAmountLimitError"` = `'SwapAmountLimitError'`

#### Overrides

`Error.name`

***

### reason

> `readonly` **reason**: `LimitReason`

***

### stack?

> `optional` **stack?**: `string`

#### Inherited from

`Error.stack`
