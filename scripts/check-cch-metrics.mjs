import assert from 'node:assert/strict';

import { summarizeCchProviders } from '../src/lib/cch-metrics.ts';

const summary = summarizeCchProviders(
  [
    { id: 1, isEnabled: true, statistics: { todayCalls: 10, todayCost: '1.20', todayUpstreamCost: '0.80', coveredRequestCount: 8, uncoveredRequestCount: 2, effectiveRateMultiplier: '2', totalTokens: 1000, inputTokens: 500, outputTokens: 200, cacheCreationTokens: 200, cacheReadTokens: 100 } },
    { id: 2, isEnabled: false, statistics: { todayCalls: 5, todayCost: 0.4, todayUpstreamCost: 0.4, coveredRequestCount: 5, uncoveredRequestCount: 0, effectiveRateMultiplier: 1, totalTokens: 500, inputTokens: 300, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 100 } },
  ],
  {
    1: { circuitState: 'open' },
    2: { circuitState: 'closed' },
  },
  [
    { providerId: 1, usedSlots: 2, totalSlots: 4 },
    { providerId: 2, usedSlots: 1, totalSlots: 0 },
  ]
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
  slotUsed: 3,
  slotCapacity: 4,
  activeSlotProviders: 2,
});

console.log('CCH provider metrics self-check passed.');
