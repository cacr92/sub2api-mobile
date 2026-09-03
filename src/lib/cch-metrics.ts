export type CchProviderMetricInput = {
  id: number;
  isEnabled: boolean;
  statistics?: {
    todayCalls: number;
    todayCost: string | number;
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
    slotUsed: 0,
    slotCapacity: 0,
    activeSlotProviders: 0,
  };

  for (const provider of providers) {
    if (provider.isEnabled) summary.enabled += 1;
    else summary.disabled += 1;

    const circuitState = healthByProviderId[`${provider.id}`]?.circuitState;
    if (circuitState === 'open') summary.circuitOpen += 1;
    if (circuitState === 'half-open') summary.circuitHalfOpen += 1;

    summary.todayCalls += toNonNegativeNumber(provider.statistics?.todayCalls);
    summary.todayCost += toNonNegativeNumber(provider.statistics?.todayCost);
  }

  for (const slot of slots) {
    const usedSlots = toNonNegativeNumber(slot.usedSlots);
    summary.slotUsed += usedSlots;
    summary.slotCapacity += toNonNegativeNumber(slot.totalSlots);
    if (usedSlots > 0) summary.activeSlotProviders += 1;
  }

  return summary;
}
