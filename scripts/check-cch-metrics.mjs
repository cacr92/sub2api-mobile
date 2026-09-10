import assert from 'node:assert/strict';

import { compareCchProvidersByLiveActivity, resolveCchProviderGroups, resolveCchProviderMultiplier, summarizeCchProviders, summarizeCchProxyStatus } from '../src/lib/cch-metrics.ts';

const providers = [
  { id: 1, isEnabled: true, upstreamBillingProbeEnabled: true, upstreamBillingProbe: { status: 'ok', effectiveRateMultiplier: 2 }, statistics: { todayCalls: 10, todayCost: '1.20', todayUpstreamCost: '0.80', coveredRequestCount: 8, uncoveredRequestCount: 2, effectiveRateMultiplier: '2', totalTokens: 1000, inputTokens: 500, outputTokens: 200, cacheCreationTokens: 200, cacheReadTokens: 100 } },
  { id: 2, isEnabled: false, upstreamBillingProbeEnabled: true, upstreamBillingProbe: { status: 'failed', effectiveRateMultiplier: 1 }, statistics: { todayCalls: 5, todayCost: 0.4, todayUpstreamCost: 0.4, coveredRequestCount: 5, uncoveredRequestCount: 0, effectiveRateMultiplier: 1, totalTokens: 500, inputTokens: 300, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 100 } },
];
const slots = [
  { providerId: 1, usedSlots: 2, totalSlots: 4 },
  { providerId: 2, usedSlots: 1, totalSlots: 0 },
];

const summary = summarizeCchProviders(
  providers,
  {
    1: { circuitState: 'open' },
    2: { circuitState: 'closed' },
  },
  slots
);

assert.deepEqual(summary, {
  total: 2,
  enabled: 1,
  disabled: 1,
  circuitOpen: 1,
  circuitHalfOpen: 0,
  todayCalls: 15,
  todayCost: 1.6,
  todayUpstreamCost: 1.2000000000000002,
  coveredRequestCount: 13,
  uncoveredRequestCount: 2,
  effectiveRateMultiplier: 1.5,
  totalTokens: 1500,
  inputTokens: 800,
  outputTokens: 300,
  cacheCreationTokens: 200,
  cacheReadTokens: 200,
  cacheHitRate: 1 / 6,
  hasEnhancedStatistics: true,
  hasCacheStatistics: true,
  slotUsed: 3,
  slotCapacity: 4,
  activeSlotProviders: 2,
  probeEnabled: 2,
  probeDisabled: 0,
  probePending: 0,
  probeOk: 1,
  probeUnsupported: 0,
  probeFailed: 1,
  probeEffectiveMultiplier: 2,
  probeFailedUsingHistoricalMultiplier: 1,
});

const liveSlots = new Map([
  [1, { providerId: 1, usedSlots: 0, totalSlots: 4 }],
  [2, { providerId: 2, usedSlots: 1, totalSlots: 0 }],
]);
assert.deepEqual(
  [...providers].sort((left, right) => compareCchProvidersByLiveActivity(left, right, liveSlots)).map((provider) => provider.id),
  [2, 1],
);
assert.deepEqual(
  [...providers]
    .map((provider) => ({ ...provider, priority: provider.id === 1 ? 9 : 1, priorityLocked: provider.id === 1 }))
    .sort((left, right) => compareCchProvidersByLiveActivity(left, right, liveSlots))
    .map((provider) => provider.id),
  [1, 2],
);

const cacheOnlySummary = summarizeCchProviders(
  [{ id: 3, isEnabled: true, statistics: { todayCalls: 1, todayCost: 0, inputTokens: 80, cacheCreationTokens: 10, cacheReadTokens: 10 } }],
  {},
  []
);
assert.equal(cacheOnlySummary.hasEnhancedStatistics, false);
assert.equal(cacheOnlySummary.hasCacheStatistics, true);
assert.equal(cacheOnlySummary.cacheHitRate, 0.1);

assert.deepEqual(
  resolveCchProviderMultiplier({
    costMultiplier: 0.5,
    upstreamBillingProbe: { status: 'ok', effectiveRateMultiplier: 0.09 },
  }),
  { value: 0.09, source: 'probe' },
);
assert.deepEqual(
  resolveCchProviderMultiplier({
    costMultiplier: 0.5,
    upstreamBillingProbe: { status: 'failed', effectiveRateMultiplier: 0.09 },
  }),
  { value: 0.09, source: 'historical-probe' },
);
assert.deepEqual(
  resolveCchProviderMultiplier({
    costMultiplier: 0.5,
    upstreamBillingProbe: { status: 'unsupported', effectiveRateMultiplier: 0.09 },
  }),
  { value: 0.09, source: 'historical-probe' },
);
assert.deepEqual(
  resolveCchProviderMultiplier({
    costMultiplier: 0.5,
    upstreamBillingProbe: { status: 'unsupported' },
  }),
  { value: 0.5, source: 'manual' },
);
assert.deepEqual(
  resolveCchProviderMultiplier({ upstreamBillingProbe: null }),
  { value: null, source: 'unavailable' },
);

assert.deepEqual(resolveCchProviderGroups(null), ['default']);
assert.deepEqual(resolveCchProviderGroups('cli，chat\ncli'), ['cli', 'chat']);

const liveStatus = summarizeCchProxyStatus([
  { activeCount: 2, activeRequests: [{ providerId: 1 }, { providerId: 1 }] },
  { activeCount: 1, activeRequests: [{ providerId: 2 }] },
]);
assert.equal(liveStatus.totalActiveRequests, 3);
assert.equal(liveStatus.hasProviderDetails, true);
assert.deepEqual([...liveStatus.activeRequestsByProviderId], [[1, 2], [2, 1]]);
assert.equal(summarizeCchProxyStatus([{ activeCount: 1 }]).hasProviderDetails, false);
assert.equal(summarizeCchProxyStatus([{ activeCount: 1, activeRequests: [] }]).hasProviderDetails, false);

console.log('CCH provider metrics self-check passed.');
