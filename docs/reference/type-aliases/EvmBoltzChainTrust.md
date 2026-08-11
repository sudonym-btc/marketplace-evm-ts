# Type Alias: EvmBoltzChainTrust

> **EvmBoltzChainTrust** = `object`

## Properties

### dexCallTargets?

> `optional` **dexCallTargets?**: [`EvmTrustedCallTarget`](EvmTrustedCallTarget.md)[]

Explicit trust roots for provider-produced DEX/router calls.

***

### erc20Swap

> **erc20Swap**: [`EvmTrustedContract`](EvmTrustedContract.md)

The only ERC20Swap deployment that may custody swap funds.
