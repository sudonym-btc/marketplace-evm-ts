# Type Alias: EvmBoltzConfig

> **EvmBoltzConfig** = `object`

## Properties

### apiUrl

> **apiUrl**: `string`

***

### nativeCurrencyByChainId?

> `optional` **nativeCurrencyByChainId?**: `Record`\<`number`, `string`\>

***

### trustByChainId?

> `optional` **trustByChainId?**: `Record`\<`number`, [`EvmBoltzChainTrust`](EvmBoltzChainTrust.md)\>

Trust roots required before executing provider-generated calls or swaps.

***

### wsUrl?

> `optional` **wsUrl?**: `string`
