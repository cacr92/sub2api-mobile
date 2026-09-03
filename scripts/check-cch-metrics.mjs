import assert from 'node:assert/strict';

import { summarizeCchProviders } from '../src/lib/cch-metrics.ts';

const summary = summarizeCchProviders(
  [
    { id: 1, isEnabled: true, statistics: { todayCalls: 10, todayCost: '1.20' } },
    { id: 2, isEnabled: false, statistics: { todayCalls: 5, todayCost: 0.4 } },
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
  slotUsed: 3,
  slotCapacity: 4,
  activeSlotProviders: 2,
});

console.log('CCH provider metrics self-check passed.');
