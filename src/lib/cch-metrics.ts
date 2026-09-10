export type CchProviderMetricInput = {
  id: number;
  priority?: number;
  priorityLocked?: boolean;
  isEnabled: boolean;
  upstreamBillingProbeEnabled?: boolean;
  upstreamBillingProbe?: {
    status: 'ok' | 'unsupported' | 'failed';
    effectiveRateMultiplier?: number;
  } | null;
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

export type CchProviderMultiplierSource = 'probe' | 'historical-probe' | 'manual' | 'unavailable';

export type CchProviderMultiplier = {
  value: number | null;
  source: CchProviderMultiplierSource;
};

export function resolveCchProviderGroups(groupTag?: string | null): string[] {
  const groups = typeof groupTag === 'string'
    ? groupTag
      .split(/[,，\n\r]+/)
      .map((group) => group.trim())
      .filter(Boolean)
    : [];
  return groups.length > 0 ? [...new Set(groups)] : ['default'];
}

export type CchProxyStatusMetricInput = {
  activeCount: number;
  activeRequests?: Array<{ providerId: number }>;
};

export function summarizeCchProxyStatus(users: CchProxyStatusMetricInput[]) {
  const activeRequestsByProviderId = new Map<number, number>();
  let totalActiveRequests = 0;
  let detailedActiveRequestCount = 0;
  let hasProviderDetails = true;

  for (const user of users) {
    totalActiveRequests += toNonNegativeNumber(user.activeCount);
    if (!Array.isArray(user.activeRequests)) {
      hasProviderDetails = false;
      continue;
    }
    detailedActiveRequestCount += user.activeRequests.length;
    for (const request of user.activeRequests) {
      if (!Number.isInteger(request.providerId) || request.providerId <= 0) {
        hasProviderDetails = false;
        continue;
      }
      activeRequestsByProviderId.set(
        request.providerId,
        (activeRequestsByProviderId.get(request.providerId) ?? 0) + 1
      );
    }
  }

  return {
    activeRequestsByProviderId,
    hasProviderDetails: hasProviderDetails && detailedActiveRequestCount === totalActiveRequests,
    totalActiveRequests,
  };
}

function isValidMultiplier(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function resolveCchProviderMultiplier(provider: {
  costMultiplier?: number;
  upstreamBillingProbe?: {
    status: 'ok' | 'unsupported' | 'failed';
    effectiveRateMultiplier?: number;
  } | null;
}): CchProviderMultiplier {
  const probeMultiplier = provider.upstreamBillingProbe?.effectiveRateMultiplier;
  if (provider.upstreamBillingProbe?.status === 'ok' && isValidMultiplier(probeMultiplier)) {
    return { value: probeMultiplier, source: 'probe' };
  }
  // CCH keeps the last successful multiplier on both failed and unsupported snapshots.
  if (provider.upstreamBillingProbe && isValidMultiplier(probeMultiplier)) {
    return { value: probeMultiplier, source: 'historical-probe' };
  }
  if (isValidMultiplier(provider.costMultiplier)) {
    return { value: provider.costMultiplier, source: 'manual' };
  }
  return { value: null, source: 'unavailable' };
}

export type CchProviderHealthMetricInput = {
  circuitState: 'closed' | 'open' | 'half-open';
};

export type CchProviderSlotMetricInput = {
  providerId: number;
  usedSlots: number;
  totalSlots: number;
};

export type CchProviderSlotSnapshot = {
  usedSlots: number;
  totalSlots: number;
  isActive: boolean;
  utilization: number;
};

function toNonNegativeNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

export function getCchProviderSlotSnapshot(slot?: CchProviderSlotMetricInput): CchProviderSlotSnapshot {
  const usedSlots = toNonNegativeNumber(slot?.usedSlots);
  const totalSlots = toNonNegativeNumber(slot?.totalSlots);
  const isActive = usedSlots > 0;

  return {
    usedSlots,
    totalSlots,
    isActive,
    utilization: totalSlots > 0 ? Math.min(1, usedSlots / totalSlots) : 0,
  };
}

export function compareCchProvidersByLiveActivity(
  left: CchProviderMetricInput,
  right: CchProviderMetricInput,
  slotsByProviderId: ReadonlyMap<number, CchProviderSlotMetricInput>
) {
  if (left.priorityLocked !== right.priorityLocked) {
    return Number(right.priorityLocked) - Number(left.priorityLocked);
  }
  if (left.priorityLocked && right.priorityLocked && left.priority !== right.priority) {
    return (left.priority ?? 0) - (right.priority ?? 0);
  }

  const leftSlot = getCchProviderSlotSnapshot(slotsByProviderId.get(left.id));
  const rightSlot = getCchProviderSlotSnapshot(slotsByProviderId.get(right.id));

  if (leftSlot.isActive !== rightSlot.isActive) return Number(rightSlot.isActive) - Number(leftSlot.isActive);
  if (leftSlot.usedSlots !== rightSlot.usedSlots) return rightSlot.usedSlots - leftSlot.usedSlots;
  if (leftSlot.utilization !== rightSlot.utilization) return rightSlot.utilization - leftSlot.utilization;

  const callDifference = toNonNegativeNumber(right.statistics?.todayCalls) - toNonNegativeNumber(left.statistics?.todayCalls);
  if (callDifference !== 0) return callDifference;

  return left.id - right.id;
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
    hasCacheStatistics: false,
    slotUsed: 0,
    slotCapacity: 0,
    activeSlotProviders: 0,
    probeEnabled: 0,
    probeDisabled: 0,
    probePending: 0,
    probeOk: 0,
    probeUnsupported: 0,
    probeFailed: 0,
    probeEffectiveMultiplier: 0,
    probeFailedUsingHistoricalMultiplier: 0,
  };
  let effectiveRateUpstreamCost = 0;
  let effectiveRateBaseCost = 0;

  for (const provider of providers) {
    if (provider.isEnabled) summary.enabled += 1;
    else summary.disabled += 1;

    if (provider.upstreamBillingProbeEnabled === true) summary.probeEnabled += 1;
    if (provider.upstreamBillingProbeEnabled === false) summary.probeDisabled += 1;
    const probe = provider.upstreamBillingProbe;
    if (provider.upstreamBillingProbeEnabled !== false) {
      if (!probe) summary.probePending += 1;
      else if (probe.status === 'ok') summary.probeOk += 1;
      else if (probe.status === 'unsupported') summary.probeUnsupported += 1;
      else summary.probeFailed += 1;
    }
    const hasProbeMultiplier = typeof probe?.effectiveRateMultiplier === 'number'
      && Number.isFinite(probe.effectiveRateMultiplier)
      && probe.effectiveRateMultiplier >= 0;
    if (hasProbeMultiplier) summary.probeEffectiveMultiplier += 1;
    if (probe?.status === 'failed' && hasProbeMultiplier) {
      summary.probeFailedUsingHistoricalMultiplier += 1;
    }

    const circuitState = healthByProviderId[`${provider.id}`]?.circuitState;
    if (circuitState === 'open') summary.circuitOpen += 1;
    if (circuitState === 'half-open') summary.circuitHalfOpen += 1;

    const statistics = provider.statistics;
    summary.todayCalls += toNonNegativeNumber(statistics?.todayCalls);
    summary.todayCost += toNonNegativeNumber(statistics?.todayCost);

    if (!statistics) continue;

    if (statistics.todayUpstreamCost !== undefined) {
      summary.hasEnhancedStatistics = true;
      const upstreamCost = toNonNegativeNumber(statistics.todayUpstreamCost);
      const effectiveRate = toNonNegativeNumber(statistics.effectiveRateMultiplier);
      summary.todayUpstreamCost += upstreamCost;
      summary.coveredRequestCount += toNonNegativeNumber(statistics.coveredRequestCount);
      summary.uncoveredRequestCount += toNonNegativeNumber(statistics.uncoveredRequestCount);
      if (upstreamCost > 0 && effectiveRate > 0) {
        effectiveRateUpstreamCost += upstreamCost;
        effectiveRateBaseCost += upstreamCost / effectiveRate;
      }
    }

    const hasCacheStatistics = statistics.inputTokens !== undefined
      || statistics.cacheCreationTokens !== undefined
      || statistics.cacheReadTokens !== undefined;
    if (hasCacheStatistics) summary.hasCacheStatistics = true;

    summary.totalTokens += toNonNegativeNumber(statistics.totalTokens);
    summary.inputTokens += toNonNegativeNumber(statistics.inputTokens);
    summary.outputTokens += toNonNegativeNumber(statistics.outputTokens);
    summary.cacheCreationTokens += toNonNegativeNumber(statistics.cacheCreationTokens);
    summary.cacheReadTokens += toNonNegativeNumber(statistics.cacheReadTokens);
  }

  summary.effectiveRateMultiplier = effectiveRateBaseCost > 0
    ? Number((effectiveRateUpstreamCost / effectiveRateBaseCost).toFixed(4))
    : null;
  const cacheInputTokens = summary.inputTokens + summary.cacheCreationTokens + summary.cacheReadTokens;
  summary.cacheHitRate = summary.hasCacheStatistics && cacheInputTokens > 0
    ? summary.cacheReadTokens / cacheInputTokens
    : 0;

  for (const slot of slots) {
    const usedSlots = toNonNegativeNumber(slot.usedSlots);
    summary.slotUsed += usedSlots;
    summary.slotCapacity += toNonNegativeNumber(slot.totalSlots);
    if (usedSlots > 0) summary.activeSlotProviders += 1;
  }

  return summary;
}
