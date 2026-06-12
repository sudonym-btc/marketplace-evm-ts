import { evmEscrowPolicies } from './policies.js'
import { EvmMarketplacePolicyBase } from './policyBase.js'
import type {
  EvmEscrowPolicy,
  EvmMarketplacePolicyOptions,
  EvmEscrowPaymentPolicy,
} from './types.js'

class EvmEscrowPolicyImpl
  extends EvmMarketplacePolicyBase<EvmEscrowPaymentPolicy, 'evm:multi-escrow', 'order', 'escrow'>
  implements EvmEscrowPolicy {
  declare readonly method: 'evm'
  declare readonly id: 'evm:multi-escrow'
  declare readonly purpose: 'order'
  declare readonly family: 'escrow'

  constructor(options: EvmMarketplacePolicyOptions) {
    super(options, {
      id: 'evm:multi-escrow',
      purpose: 'order',
      family: 'escrow',
      enabled: true,
      recoveryNoun: 'operation',
      recoveryReason: 'EVM recovery is handled by startup using deterministic accounts and active swap operations',
    })
  }

  policies(): EvmEscrowPaymentPolicy[] {
    return evmEscrowPolicies(this.chains)
  }
}

export function createEvmEscrowPolicy(options: EvmMarketplacePolicyOptions): EvmEscrowPolicy {
  return new EvmEscrowPolicyImpl(options)
}
