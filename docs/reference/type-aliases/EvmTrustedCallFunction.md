# Type Alias: EvmTrustedCallFunction

> **EvmTrustedCallFunction** = `object`

## Properties

### decoder

> **decoder**: [`EvmTrustedCallDecoder`](EvmTrustedCallDecoder.md)

Built-in semantic decoder; unknown call shapes are never accepted.

***

### selector

> **selector**: [`EvmHex`](EvmHex.md)

Exact 4-byte function selector for the pinned ABI.
