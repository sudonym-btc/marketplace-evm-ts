import { MarketplacePolicyBase } from '@sudonym-btc/marketplace-driver-interface'

import { resolveEvmChainConfigs } from '../chains.js'
import { createMarketplaceEvmClient } from '../client.js'
import { evmPaymentAssets } from './assets.js'
import { recoverActiveEvmSwapOperations } from './operationRecovery.js'
import { payEvmIntent } from './pay.js'
import { validateEvmMarketplacePayment } from './validate.js'
import type {
  EvmMarketplacePolicyOptions,
  EvmMarketplacePolicyState,
  EvmPaymentAsset,
  EvmPaymentPolicy,
  GenericPaymentIntent,
  GenericPaymentRecoveryItem,
  GenericPaymentRecoveryState,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  GenericPolicyPaymentState,
  ResolvedEvmMarketplaceChainConfig,
} from './types.js'

type EvmPolicyBasePurpose = 'order' | 'bid'
type EvmPolicyBaseFamily = 'escrow' | 'auction'

type EvmPolicyBaseConfig<Id extends string, Purpose extends EvmPolicyBasePurpose, Family extends EvmPolicyBaseFamily> = {
  id: Id
  purpose: Purpose
  family: Family
  enabled: boolean
  recoveryNoun: string
  recoveryReason: string
  expectedProofPolicyType?: string
}

export abstract class EvmMarketplacePolicyBase<
  Policy extends EvmPaymentPolicy,
  Id extends string,
  Purpose extends EvmPolicyBasePurpose,
  Family extends EvmPolicyBaseFamily,
> extends MarketplacePolicyBase<
  EvmMarketplacePolicyState,
  GenericPolicyPaymentState,
  Policy,
  EvmPaymentAsset,
  GenericPaymentIntent,
  GenericPaymentValidationRequest,
  GenericPaymentValidationResult,
  GenericPaymentRecoveryItem,
  GenericPaymentRecoveryState,
  Purpose,
  Family
> {
  protected readonly chains: ResolvedEvmMarketplaceChainConfig[]
  private readonly operationStore: EvmMarketplacePolicyOptions['operationStore']
  private readonly appId: string | undefined
  private readonly typedPolicyId: Id
  private readonly recoveryNoun: string
  private readonly recoveryReason: string
  private readonly expectedProofPolicyType: string | undefined

  protected constructor(options: EvmMarketplacePolicyOptions, config: EvmPolicyBaseConfig<Id, Purpose, Family>) {
    const chains = resolveEvmChainConfigs(options.chains) as ResolvedEvmMarketplaceChainConfig[]
    super({
      method: 'evm',
      id: config.id,
      purpose: config.purpose,
      family: config.family,
      initialState: {
        enabled: config.enabled,
        started: false,
        maxUsedIndex: -1,
        nextTradeIndex: 0,
        startSummary: 'Not started',
      },
      ...(options.logger ? { logger: options.logger } : {}),
    })
    this.chains = chains
    this.operationStore = options.operationStore
    this.appId = options.appId
    this.typedPolicyId = config.id
    this.recoveryNoun = config.recoveryNoun
    this.recoveryReason = config.recoveryReason
    this.expectedProofPolicyType = config.expectedProofPolicyType
  }

  assets(): EvmPaymentAsset[] {
    return evmPaymentAssets(this.chains, this.appId)
  }

  client(seed: string, tradeIndex?: number) {
    const [primaryChain] = this.chains
    return createMarketplaceEvmClient({
      chains: this.chains,
      operationStore: this.operationStore,
      seed,
      ...(tradeIndex !== undefined ? { tradeIndex } : {}),
      ...(primaryChain?.boltz ? { boltz: primaryChain.boltz } : {}),
      ...(this.logger ? { logger: this.logger } : {}),
    })
  }

  async discoverHighWatermark(context: Parameters<MarketplacePolicyBase<EvmMarketplacePolicyState>['discoverHighWatermark']>[0]) {
    const evm = this.client(context.seed)
    this.log('debug', 'Discovering EVM high watermark', {
      highWaterMark: context.highWaterMark,
      unusedWindow: context.unusedWindow,
    })
    if (!evm.discoverHighWatermark) throw new Error('EVM high watermark discovery is unavailable')
    const discovery = await evm.discoverHighWatermark({
      highWaterMark: context.highWaterMark,
      unusedWindow: context.unusedWindow,
    })
    this.patchState({
      maxUsedIndex: discovery.maxUsedIndex,
      nextTradeIndex: discovery.nextUnusedIndex,
    })
    return {
      policy: this.typedPolicyId,
      maxUsedIndex: discovery.maxUsedIndex,
      nextUnusedIndex: discovery.nextUnusedIndex,
      scannedFrom: discovery.scannedFrom,
      scannedThrough: discovery.scannedThrough,
      unusedWindow: discovery.unusedWindow,
      usedIndexes: discovery.usedTradeIndexes,
      recoveryActions: discovery.recoveryActions,
    }
  }

  async startup(context: Parameters<MarketplacePolicyBase<EvmMarketplacePolicyState>['startup']>[0]) {
    const recovery = await recoverActiveEvmSwapOperations({
      chains: this.chains,
      operationStore: this.operationStore,
      seed: context.seed,
      client: (seed, tradeIndex) => this.client(seed, tradeIndex),
    })
    this.patchState({
      started: true,
      maxUsedIndex: context.highWaterMark,
      nextTradeIndex: context.nextUnusedIndex,
      startSummary: `${recovery.resumed} active EVM ${this.recoveryNoun} operation(s) resumed; ${recovery.settled.length} settled; ${recovery.failed.length} failed`,
    })
    this.log('info', 'EVM policy startup complete', {
      activeOperations: recovery.activeOperations,
      resumed: recovery.resumed,
      settled: recovery.settled.length,
      failed: recovery.failed.length,
    })
    return {
      policy: this.typedPolicyId,
      data: {
        ...this.startupData(),
        activeOperations: recovery.activeOperations,
        resumed: recovery.resumed,
        settled: recovery.settled.length,
        failed: recovery.failed,
      },
    }
  }

  protected startupData(): Record<string, unknown> {
    return {}
  }

  async *recover(payment: GenericPaymentRecoveryItem): AsyncIterable<GenericPaymentRecoveryState> {
    yield this.noOpRecoveryState({
      reason: this.recoveryReason,
      purpose: payment.purpose,
      driver: payment.proof.driver,
    })
  }

  pay(intent: GenericPaymentIntent): AsyncIterable<GenericPolicyPaymentState> {
    const logger = intent.logger ?? this.logger
    return payEvmIntent({
      chains: this.chains,
      operationStore: this.operationStore,
      intent,
      state: this.state(),
      setState: nextState => {
        this.setState(nextState)
      },
      ...(logger ? { logger } : {}),
    })
  }

  validatePayment(request: GenericPaymentValidationRequest): Promise<GenericPaymentValidationResult> {
    if (this.expectedProofPolicyType) {
      const policyTypeResult = this.validateProofPolicyType(request, this.expectedProofPolicyType, this.family)
      if (policyTypeResult) return Promise.resolve(policyTypeResult)
    }
    return validateEvmMarketplacePayment(this.chains, request)
  }
}
