import { z } from 'zod';

import { cchFetch } from '@/src/lib/cch-fetch';
import type {
  CchHealth,
  CchModelPricePage,
  CchOverview,
  CchProviderHealth,
  CchProviderList,
  CchProviderSlots,
  CchProxyStatus,
  CchRealtime,
  CchServerIdentity,
  CchSystemSettings,
  CchUpstreamBillingProbeBatchResult,
  CchUsersPage,
} from '@/src/types/cch';

const nonNegativeNumber = z.number().finite().min(0);
const nonNegativeNumeric = z.union([z.string(), nonNegativeNumber]);
const upstreamCostStatusSchema = z.enum(['estimated', 'partial', 'unavailable']);
const cchUpstreamBillingProbeSchema = z.object({
  status: z.enum(['ok', 'unsupported', 'failed']),
  effectiveRateMultiplier: nonNegativeNumber.optional(),
  lastAttemptAt: z.string(),
  nextProbeAt: z.string(),
  receivedAt: z.string().optional(),
  freshUntil: z.string().optional(),
  failureCount: z.number().int().min(0).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  lastError: z.string().max(256).optional(),
}).passthrough();

const cchHealthComponentSchema = z.object({
  status: z.string().min(1),
  latencyMs: nonNegativeNumber.optional(),
}).passthrough();

const cchHealthSchema = z.object({
  status: z.string().min(1),
  timestamp: z.string().optional(),
  version: z.string().optional(),
  uptime: nonNegativeNumber.optional(),
  components: z.object({
    database: cchHealthComponentSchema.optional(),
    redis: cchHealthComponentSchema.optional(),
    proxy: cchHealthComponentSchema.optional(),
  }).passthrough().optional(),
}).passthrough();

const cchOverviewSchema = z.object({
  concurrentSessions: z.number().int().min(0),
  todayRequests: z.number().int().min(0),
  todayCost: nonNegativeNumber,
  avgResponseTime: nonNegativeNumber,
  todayErrorRate: nonNegativeNumber,
  yesterdaySamePeriodRequests: z.number().int().min(0),
  yesterdaySamePeriodCost: nonNegativeNumber,
  yesterdaySamePeriodAvgResponseTime: nonNegativeNumber,
  recentMinuteRequests: z.number().int().min(0),
}).passthrough();

const cchProviderSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  isEnabled: z.boolean(),
  providerType: z.string().optional(),
  costMultiplier: nonNegativeNumber.optional(),
  upstreamBillingProbeEnabled: z.boolean().optional(),
  upstreamBillingProbe: cchUpstreamBillingProbeSchema.nullable().optional(),
  upstreamBillingProbeNextAt: z.string().nullable().optional(),
  limit5hUsd: nonNegativeNumber.nullable().optional(),
  limitDailyUsd: nonNegativeNumber.nullable().optional(),
  limitWeeklyUsd: nonNegativeNumber.nullable().optional(),
  limitMonthlyUsd: nonNegativeNumber.nullable().optional(),
  limitTotalUsd: nonNegativeNumber.nullable().optional(),
  limitConcurrentSessions: z.number().int().min(0).optional(),
  statistics: z.object({
    todayCost: nonNegativeNumeric,
    todayCalls: z.number().int().min(0),
    todayUpstreamCost: nonNegativeNumeric.optional(),
    upstreamCostStatus: upstreamCostStatusSchema.optional(),
    coveredRequestCount: z.number().int().min(0).optional(),
    uncoveredRequestCount: z.number().int().min(0).optional(),
    effectiveRateMultiplier: z.union([z.string(), nonNegativeNumber]).nullable().optional(),
    totalTokens: nonNegativeNumber.optional(),
    inputTokens: nonNegativeNumber.optional(),
    outputTokens: nonNegativeNumber.optional(),
    cacheCreationTokens: nonNegativeNumber.optional(),
    cacheReadTokens: nonNegativeNumber.optional(),
    cacheHitRate: z.number().finite().min(0).max(1).optional(),
    avgTtftMs: nonNegativeNumber.optional(),
    successRate: z.number().finite().min(0).max(1).nullable().optional(),
    models: z.array(z.object({
      model: z.string(),
      todayCalls: z.number().int().min(0),
      totalTokens: nonNegativeNumber,
      todayUpstreamCost: nonNegativeNumeric,
      upstreamCostStatus: upstreamCostStatusSchema,
      coveredRequestCount: z.number().int().min(0),
      uncoveredRequestCount: z.number().int().min(0),
    }).passthrough()).optional(),
    lastCallTime: z.string().nullable().optional(),
    lastCallModel: z.string().nullable().optional(),
  }).passthrough().optional(),
}).passthrough();

const cchProviderHealthSchema = z.record(z.string(), z.object({
  circuitState: z.enum(['closed', 'open', 'half-open']),
  failureCount: z.number().int().min(0),
  lastFailureTime: z.number().nullable(),
  circuitOpenUntil: z.number().nullable(),
  recoveryMinutes: z.number().nullable(),
}).passthrough());

const cchProviderSlotsSchema = z.object({
  items: z.array(z.object({
    providerId: z.number().int().positive(),
    name: z.string(),
    usedSlots: z.number().int().min(0),
    totalSlots: z.number().int().min(0),
    totalVolume: nonNegativeNumber.optional(),
  }).passthrough()),
}).passthrough();

const cchSystemSettingsSchema = z.object({
  autoSortProviderPriorityEnabled: z.boolean().optional().default(false),
}).passthrough();

const cchUpstreamBillingProbeBatchResultSchema = z.object({
  total: z.number().int().min(0),
  ok: z.number().int().min(0),
  failed: z.number().int().min(0),
  unsupported: z.number().int().min(0),
  items: z.array(z.object({
    providerId: z.number().int().positive(),
    status: z.enum(['ok', 'unsupported', 'failed']),
    effectiveRateMultiplier: nonNegativeNumber.optional(),
    lastError: z.string().max(256).optional(),
  }).passthrough()),
}).passthrough();

const cchUsersSchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string(),
    isEnabled: z.boolean().optional(),
    keys: z.array(z.object({
      id: z.number().int().positive().optional(),
      isEnabled: z.boolean().optional(),
    }).passthrough()).optional(),
  }).passthrough()),
  pageInfo: z.object({
    nextCursor: z.string().nullable().optional(),
    hasMore: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
  }).passthrough(),
}).passthrough();

const cchModelPriceSchema = z.object({
  id: z.number().int().positive(),
  modelName: z.string(),
  priceData: z.record(z.string(), z.unknown()),
  source: z.enum(['cloud', 'litellm', 'manual']),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

const cchModelPricesSchema = z.object({
  items: z.array(cchModelPriceSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
}).passthrough();

const cchProxyStatusSchema = z.object({
  users: z.array(z.object({
    userId: z.number().int().positive(),
    userName: z.string(),
    activeCount: z.number().int().min(0),
  }).passthrough()),
}).passthrough();

const cchRealtimeSchema = z.object({
  metrics: cchOverviewSchema.optional(),
  activityStream: z.array(z.object({
    id: z.string().optional(),
    user: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    latency: nonNegativeNumber.optional(),
    status: z.number().int().optional(),
    cost: nonNegativeNumber.optional(),
    startTime: nonNegativeNumber.optional(),
  }).passthrough()).optional(),
}).passthrough();

function parseCchResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('CCH_INVALID_SERVER_RESPONSE');
  return parsed.data;
}

export async function getCchHealth(): Promise<CchServerIdentity> {
  const startedAt = Date.now();
  const health = parseCchResponse<CchHealth>(
    cchHealthSchema,
    await cchFetch<unknown>('/api/health', {}, { requiresApiKey: false })
  );

  return {
    ...health,
    latencyMs: Math.max(0, Date.now() - startedAt),
    checkedAt: new Date().toISOString(),
  };
}

export function getCchOverview() {
  return cchFetch<unknown>('/api/v1/dashboard/overview').then((body) => parseCchResponse<CchOverview>(cchOverviewSchema, body));
}

export function getCchConcurrentSessions() {
  return cchFetch<unknown>('/api/v1/dashboard/concurrent-sessions').then((body) => {
    const parsed = parseCchResponse(z.object({ count: z.number().int().min(0) }).passthrough(), body);
    return parsed.count;
  });
}

export function getCchRealtime() {
  return cchFetch<unknown>('/api/v1/dashboard/realtime').then((body) => parseCchResponse<CchRealtime>(cchRealtimeSchema, body));
}

export function listCchProviders() {
  return cchFetch<unknown>('/api/v1/providers?include=statistics').then((body) => parseCchResponse<CchProviderList>(
    z.object({ items: z.array(cchProviderSchema) }).passthrough(),
    body
  ));
}

export function getCchProviderHealth() {
  return cchFetch<unknown>('/api/v1/providers/health').then((body) => parseCchResponse<CchProviderHealth>(cchProviderHealthSchema, body));
}

export function getCchProviderSlots() {
  return cchFetch<unknown>('/api/v1/dashboard/provider-slots').then((body) => parseCchResponse<CchProviderSlots>(cchProviderSlotsSchema, body));
}

export function getCchSystemSettings() {
  return cchFetch<unknown>('/api/v1/system/settings').then((body) =>
    parseCchResponse<CchSystemSettings>(cchSystemSettingsSchema, body)
  );
}

export function updateCchAutoSortProviderPriority(enabled: boolean) {
  return cchFetch<unknown>('/api/v1/system/settings', {
    method: 'PUT',
    body: JSON.stringify({ autoSortProviderPriorityEnabled: enabled }),
  }).then((body) => parseCchResponse<CchSystemSettings>(cchSystemSettingsSchema, body));
}

export function probeCchProvidersUpstreamBilling() {
  return cchFetch<unknown>('/api/v1/providers:upstream-billing:probe', {
    method: 'POST',
  }).then((body) => parseCchResponse<CchUpstreamBillingProbeBatchResult>(cchUpstreamBillingProbeBatchResultSchema, body));
}

export function resetCchProviderCircuit(providerId: number) {
  return cchFetch<unknown>(`/api/v1/providers/${providerId}/circuit:reset`, {
    method: 'POST',
  }).then((body) => parseCchResponse(z.object({ ok: z.literal(true) }).passthrough(), body));
}

export function getCchUsers(query?: string) {
  const search = query?.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
  return cchFetch<unknown>(`/api/v1/users?limit=100${search}`).then((body) => parseCchResponse<CchUsersPage>(cchUsersSchema, body));
}

export function getCchModelPrices(search?: string) {
  const query = search?.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
  return cchFetch<unknown>(`/api/v1/model-prices?page=1&pageSize=100${query}`).then((body) => parseCchResponse<CchModelPricePage>(cchModelPricesSchema, body));
}

export function getCchProxyStatus() {
  return cchFetch<unknown>('/api/v1/dashboard/proxy-status').then((body) => parseCchResponse<CchProxyStatus>(cchProxyStatusSchema, body));
}
