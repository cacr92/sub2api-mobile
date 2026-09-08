export type CchProviderMetricInput = {
  id: number;
  isEnabled: boolean;
  statistics?: {
    todayCalls: number;
    todayCost: string | number;
    todayUpstreamCost?: string | number;
    coveredRequestCount?: number;
    uncoveredRequestCount?: number;
    effectiveRateMultiplier?: string | number | null;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
};

export type CchProviderHealthMetricInput = {
  circuitState: 'closed' | 'open' | 'half-open';
};

export type CchProviderSlotMetricInput = {
  providerId: number;
  usedSlots: number;
  totalSlots: number;
};

function toNonNegativeNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

export function summarizeCchProviders(
  providers: CchProviderMetricInput[],
  healthByProviderId: Record<string, CchProviderHealthMetricInput | undefined>,
  slots: CchProviderSlotMetricInput[]
) {
  const summary = {
    total: providers.length,
    enabled: 0,
    disabled: 0,
    circuitOpen: 0,
    circuitHalfOpen: 0,
    todayCalls: 0,
    todayCost: 0,
    todayUpstreamCost: 0,
    coveredRequestCount: 0,
    uncoveredRequestCount: 0,
    effectiveRateMultiplier: null as number | null,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cacheHitRate: 0,
    hasEnhancedStatistics: false,
    slotUsed: 0,
    slotCapacity: 0,
    activeSlotProviders: 0,
  };
  let effectiveRateUpstreamCost = 0;
  let effectiveRateBaseCost = 0;

  for (const provider of providers) {
    if (provider.isEnabled) summary.enabled += 1;
    else summary.disabled += 1;

    const circuitState = healthByProviderId[`${provider.id}`]?.circuitState;
    if (circuitState === 'open') summary.circuitOpen += 1;
    if (circuitState === 'half-open') summary.circuitHalfOpen += 1;

    summary.todayCalls += toNonNegativeNumber(provider.statistics?.todayCalls);
    summary.todayCost += toNonNegativeNumber(provider.statistics?.todayCost);
    if (provider.statistics?.todayUpstreamCost !== undefined) {
      summary.hasEnhancedStatistics = true;
      const upstreamCost = toNonNegativeNumber(provider.statistics.todayUpstreamCost);
      const effectiveRate = toNonNegativeNumber(provider.statistics.effectiveRateMultiplier);
      summary.todayUpstreamCost += upstreamCost;
      summary.coveredRequestCount += toNonNegativeNumber(provider.statistics.coveredRequestCount);
      summary.uncoveredRequestCount += toNonNegativeNumber(provider.statistics.uncoveredRequestCount);
      summary.totalTokens += toNonNegativeNumber(provider.statistics.totalTokens);
      summary.inputTokens += toNonNegativeNumber(provider.statistics.inputTokens);
      summary.outputTokens += toNonNegativeNumber(provider.statistics.outputTokens);
      summary.cacheCreationTokens += toNonNegativeNumber(provider.statistics.cacheCreationTokens);
      summary.cacheReadTokens += toNonNegativeNumber(provider.statistics.cacheReadTokens);
      if (upstreamCost > 0 && effectiveRate > 0) {
        effectiveRateUpstreamCost += upstreamCost;
        effectiveRateBaseCost += upstreamCost / effectiveRate;
      }
    }
  }

  summary.effectiveRateMultiplier = effectiveRateBaseCost > 0
    ? Number((effectiveRateUpstreamCost / effectiveRateBaseCost).toFixed(4))
    : null;
  const cacheInputTokens = summary.inputTokens + summary.cacheCreationTokens + summary.cacheReadTokens;
  summary.cacheHitRate = cacheInputTokens > 0 ? summary.cacheReadTokens / cacheInputTokens : 0;

  for (const slot of slots) {
    const usedSlots = toNonNegativeNumber(slot.usedSlots);
    summary.slotUsed += usedSlots;
    summary.slotCapacity += toNonNegativeNumber(slot.totalSlots);
    if (usedSlots > 0) summary.activeSlotProviders += 1;
  }

  return summary;
}
