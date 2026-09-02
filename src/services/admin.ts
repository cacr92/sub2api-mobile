import { z } from 'zod';

import { adminFetch, adminFetchSse } from '@/src/lib/admin-fetch';
import type {
  AdminUsageLog,
  AccountTodayStats,
  AccountTodayStatsBatchResponse,
  AdminAccount,
  AdminApiKey,
  AdminGroup,
  AdminSettings,
  AdminSettingsUpdate,
  AdminUser,
  BalanceOperation,
  DashboardModelStats,
  DashboardSnapshot,
  DashboardStats,
  DashboardTrend,
  CreateAccountRequest,
  CreateUserRequest,
  GroupCapacitySummary,
  ModelPlazaResponse,
  OpsConcurrencyStats,
  OpsDashboardOverview,
  OverloadCooldownSettings,
  PaginatedData,
  RateLimit429CooldownSettings,
  ServerIdentity,
  StreamTimeoutSettings,
  UsageStats,
  UserUsageSummary,
  UpstreamBillingCost24hResponse,
  UpstreamBillingProbeResult,
} from '@/src/types/admin';

const accountTestEventSchema = z.object({
  type: z.string().min(1),
  text: z.string().optional(),
  model: z.string().optional(),
  status: z.string().optional(),
  success: z.boolean().optional(),
  error: z.string().optional(),
});

type AccountTestEvent = z.infer<typeof accountTestEventSchema>;

export type AccountTestResult = {
  message: string;
};

type AccountTestState = {
  content: string;
  error?: string;
  hasEvent: boolean;
  model?: string;
  statusMessages: string[];
  succeeded: boolean;
};

function compactTestMessage(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();

  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function recordAccountTestEvent(event: AccountTestEvent, state: AccountTestState) {
  switch (event.type) {
    case 'test_start':
      state.hasEvent = true;
      state.model = event.model;
      break;
    case 'content':
      state.hasEvent = true;
      state.content += event.text ?? '';
      break;
    case 'status':
      state.hasEvent = true;
      if (event.text) {
        state.statusMessages.push(event.text);
      }
      if (event.status) {
        state.statusMessages.push(event.status);
      }
      break;
    case 'test_complete':
      state.hasEvent = true;
      if (event.success) {
        state.succeeded = true;
      } else {
        state.error = event.error || 'TEST_FAILED';
      }
      break;
    case 'error':
      state.hasEvent = true;
      state.error = event.error || 'TEST_FAILED';
      break;
  }
}

function consumeSseBuffer(
  buffer: string,
  isFinalChunk: boolean,
  onEvent: (event: AccountTestEvent) => void
) {
  const lines = buffer.split(/\r?\n/);
  const remaining = isFinalChunk ? '' : (lines.pop() ?? '');

  for (const line of lines) {
    if (!line.startsWith('data:')) {
      continue;
    }

    const rawEvent = line.slice('data:'.length).trim();

    if (!rawEvent || rawEvent === '[DONE]') {
      continue;
    }

    try {
      const parsed = accountTestEventSchema.safeParse(JSON.parse(rawEvent));
      if (parsed.success) {
        onEvent(parsed.data);
      }
    } catch {
      // A malformed progress event must not hide a later terminal result.
    }
  }

  return remaining;
}

async function readAccountTestEvents(response: Response, onEvent: (event: AccountTestEvent) => void) {
  const reader = response.body?.getReader();

  if (!reader) {
    consumeSseBuffer(await response.text(), true, onEvent);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      buffer += decoder.decode();
      consumeSseBuffer(buffer, true, onEvent);
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSseBuffer(buffer, false, onEvent);
  }
}

function buildQuery(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const value = query.toString();

  return value ? `?${value}` : '';
}

export function getDashboardStats() {
  return adminFetch<DashboardStats>('/api/v1/admin/dashboard/stats');
}

export async function getServerIdentity(): Promise<ServerIdentity> {
  const startedAt = Date.now();
  const result = await adminFetch<{ version: string }>('/api/v1/admin/system/version');

  return {
    version: result.version,
    latency_ms: Math.max(0, Date.now() - startedAt),
    checked_at: new Date().toISOString(),
  };
}

export function getOpsDashboardOverview(timeRange: '5m' | '30m' | '1h' | '6h' | '24h' = '1h') {
  return adminFetch<OpsDashboardOverview>(
    `/api/v1/admin/ops/dashboard/overview${buildQuery({ time_range: timeRange, mode: 'auto' })}`
  );
}

export function getOpsConcurrencyStats() {
  return adminFetch<OpsConcurrencyStats>('/api/v1/admin/ops/concurrency');
}

export function getAdminSettings() {
  return adminFetch<AdminSettings>('/api/v1/admin/settings');
}

/**
 * 读取服务端模型广场。该接口不是 admin 路由，但手机端使用已配置的
 * Admin Key 作为统一连接凭据；服务端仍会按模型广场开关和登录要求裁剪结果。
 */
export function getModelPlaza() {
  return adminFetch<ModelPlazaResponse>('/api/v1/model-plaza');
}

export function updateAdminSettings(settings: AdminSettingsUpdate) {
  return adminFetch<AdminSettings>('/api/v1/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function getOverloadCooldownSettings() {
  return adminFetch<OverloadCooldownSettings>('/api/v1/admin/settings/overload-cooldown');
}

export function updateOverloadCooldownSettings(settings: OverloadCooldownSettings) {
  return adminFetch<OverloadCooldownSettings>('/api/v1/admin/settings/overload-cooldown', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function getRateLimit429CooldownSettings() {
  return adminFetch<RateLimit429CooldownSettings>('/api/v1/admin/settings/rate-limit-429-cooldown');
}

export function updateRateLimit429CooldownSettings(settings: RateLimit429CooldownSettings) {
  return adminFetch<RateLimit429CooldownSettings>('/api/v1/admin/settings/rate-limit-429-cooldown', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function getStreamTimeoutSettings() {
  return adminFetch<StreamTimeoutSettings>('/api/v1/admin/settings/stream-timeout');
}

export function updateStreamTimeoutSettings(settings: StreamTimeoutSettings) {
  return adminFetch<StreamTimeoutSettings>('/api/v1/admin/settings/stream-timeout', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function getDashboardTrend(params: {
  start_date: string;
  end_date: string;
  granularity?: 'day' | 'hour';
  account_id?: number;
  group_id?: number;
  user_id?: number;
}) {
  return adminFetch<DashboardTrend>(`/api/v1/admin/dashboard/trend${buildQuery(params)}`);
}

export function getDashboardModels(params: { start_date: string; end_date: string }) {
  return adminFetch<DashboardModelStats>(`/api/v1/admin/dashboard/models${buildQuery(params)}`);
}

export function getDashboardSnapshot(params: {
  start_date: string;
  end_date: string;
  granularity?: 'day' | 'hour';
  account_id?: number;
  user_id?: number;
  group_id?: number;
  model?: string;
  request_type?: string;
  billing_type?: string | null;
  include_stats?: boolean;
  include_trend?: boolean;
  include_model_stats?: boolean;
  include_group_stats?: boolean;
  include_users_trend?: boolean;
}) {
  return adminFetch<DashboardSnapshot>(`/api/v1/admin/dashboard/snapshot-v2${buildQuery(params)}`);
}

export function getUsageStats(params: {
  start_date?: string;
  end_date?: string;
  period?: string;
  timezone?: string;
  user_id?: number;
  account_id?: number;
  group_id?: number;
  model?: string;
  request_type?: string;
  billing_type?: string | null;
}) {
  return adminFetch<UsageStats>(`/api/v1/admin/usage/stats${buildQuery(params)}`);
}

export function listUsers(search = '') {
  return adminFetch<PaginatedData<AdminUser>>(
    `/api/v1/admin/users${buildQuery({ page: 1, page_size: 20, search: search.trim() })}`
  );
}

export function getUser(userId: number) {
  return adminFetch<AdminUser>(`/api/v1/admin/users/${userId}`);
}

export function createUser(body: CreateUserRequest) {
  return adminFetch<AdminUser>('/api/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getUserUsage(userId: number, period: 'day' | 'week' | 'month' = 'month') {
  return adminFetch<UserUsageSummary>(`/api/v1/admin/users/${userId}/usage${buildQuery({ period })}`);
}

export function listUserApiKeys(userId: number) {
  return adminFetch<PaginatedData<AdminApiKey>>(`/api/v1/admin/users/${userId}/api-keys${buildQuery({ page: 1, page_size: 100 })}`);
}

export function updateUserBalance(
  userId: number,
  body: { balance: number; operation: BalanceOperation; notes?: string }
) {
  return adminFetch<AdminUser>(
    `/api/v1/admin/users/${userId}/balance`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    {
      idempotencyKey: `user-balance-${userId}-${Date.now()}`,
    }
  );
}

export function updateUserStatus(userId: number, status: 'active' | 'disabled') {
  return adminFetch<AdminUser>(`/api/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export function listGroups(search = '') {
  return adminFetch<PaginatedData<AdminGroup>>(
    `/api/v1/admin/groups${buildQuery({ page: 1, page_size: 20, search: search.trim() })}`
  );
}

const GROUPS_PAGE_SIZE = 20;
const GROUPS_PAGE_BATCH_SIZE = 4;

function listGroupsPage(page: number) {
  return adminFetch<PaginatedData<AdminGroup>>(
    `/api/v1/admin/groups${buildQuery({ page, page_size: GROUPS_PAGE_SIZE })}`
  );
}

export async function listAllGroups() {
  const firstPage = await listGroupsPage(1);
  const totalPages = Math.max(1, firstPage.pages);

  if (totalPages === 1) return firstPage;

  const items = [...firstPage.items];
  for (let page = 2; page <= totalPages; page += GROUPS_PAGE_BATCH_SIZE) {
    const pageCount = Math.min(GROUPS_PAGE_BATCH_SIZE, totalPages - page + 1);
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, offset) => listGroupsPage(page + offset))
    );
    items.push(...pages.flatMap((result) => result.items));
  }

  return { ...firstPage, items };
}

export function getGroup(groupId: number) {
  return adminFetch<AdminGroup>(`/api/v1/admin/groups/${groupId}`);
}

export function getGroupCapacitySummary() {
  return adminFetch<GroupCapacitySummary[]>('/api/v1/admin/groups/capacity-summary');
}

const ACCOUNTS_PAGE_SIZE = 1000;
const ACCOUNTS_PAGE_BATCH_SIZE = 4;

function listAccountsPage(search: string, page: number) {
  return adminFetch<PaginatedData<AdminAccount>>(
    `/api/v1/admin/accounts${buildQuery({
      page,
      page_size: ACCOUNTS_PAGE_SIZE,
      search,
      sort_by: 'last_used_at',
      sort_order: 'desc',
    })}`
  );
}

export async function listAccounts(search = '') {
  const normalizedSearch = search.trim();
  const firstPage = await listAccountsPage(normalizedSearch, 1);
  const totalPages = Math.max(1, firstPage.pages);

  if (totalPages === 1) return firstPage;

  const items = [...firstPage.items];
  for (let page = 2; page <= totalPages; page += ACCOUNTS_PAGE_BATCH_SIZE) {
    const pageCount = Math.min(ACCOUNTS_PAGE_BATCH_SIZE, totalPages - page + 1);
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, offset) => listAccountsPage(normalizedSearch, page + offset))
    );
    items.push(...pages.flatMap((result) => result.items));
  }

  return { ...firstPage, items };
}

export function getAccount(accountId: number) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}`);
}

export function recoverAccountState(accountId: number) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}/recover-state`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function createAccount(body: CreateAccountRequest) {
  return adminFetch<AdminAccount>('/api/v1/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function setAccountUpstreamBillingProbeEnabled(accountId: number, enabled: boolean) {
  return adminFetch<{ account_id: number; enabled: boolean }>(
    `/api/v1/admin/accounts/${accountId}/upstream-billing-probe`,
    {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }
  );
}

export function probeUpstreamBilling(accountId: number) {
  return adminFetch<UpstreamBillingProbeResult>(`/api/v1/admin/accounts/${accountId}/upstream-billing-probe`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function probeUpstreamBillingBatch(accountIds: number[]) {
  const result = await adminFetch<{ results: UpstreamBillingProbeResult[] }>(
    '/api/v1/admin/accounts/upstream-billing-probe/batch',
    {
      method: 'POST',
      body: JSON.stringify({ account_ids: accountIds }),
    }
  );

  return result.results;
}

export function getAccountTodayStats(accountId: number) {
  return adminFetch<AccountTodayStats>(`/api/v1/admin/accounts/${accountId}/today-stats`);
}

export function getAccountTodayStatsBatch(accountIds: number[]) {
  return adminFetch<AccountTodayStatsBatchResponse>('/api/v1/admin/accounts/today-stats/batch', {
    method: 'POST',
    body: JSON.stringify({ account_ids: accountIds }),
  });
}

const FIRST_TOKEN_USAGE_PAGE_SIZE = 3;
const FIRST_TOKEN_USAGE_ACCOUNT_BATCH_SIZE = 4;

function getShanghaiDate(offsetDays = 0) {
  const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  shanghaiNow.setUTCDate(shanghaiNow.getUTCDate() + offsetDays);
  return shanghaiNow.toISOString().slice(0, 10);
}

function hasFirstTokenStats(stats: AccountTodayStats | undefined) {
  return stats != null && Object.prototype.hasOwnProperty.call(stats, 'recent_first_token_ms');
}

function normalizeFirstTokenMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function getCacheHitRate(stats: UsageStats) {
  const inputTokens = normalizeFirstTokenMs(stats.total_input_tokens);
  const cacheReadTokens = normalizeFirstTokenMs(stats.total_cache_read_tokens);
  const cacheCreationTokens = normalizeFirstTokenMs(stats.total_cache_creation_tokens);

  if (inputTokens === null || cacheReadTokens === null || cacheCreationTokens === null) return null;

  const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
  return promptTokens > 0 ? Math.min(100, (cacheReadTokens / promptTokens) * 100) : null;
}

export async function getAccountTodayCacheHitRateBatch(accountIds: number[]) {
  const normalizedIds = normalizeAccountIds(accountIds);
  const result: Record<string, number | null> = {};

  for (let start = 0; start < normalizedIds.length; start += FIRST_TOKEN_USAGE_ACCOUNT_BATCH_SIZE) {
    const batch = normalizedIds.slice(start, start + FIRST_TOKEN_USAGE_ACCOUNT_BATCH_SIZE);
    const stats = await Promise.all(batch.map(async (accountId) => ({
      accountId,
      stats: await getUsageStats({ account_id: accountId, period: 'today', timezone: 'Asia/Shanghai' }),
    })));

    stats.forEach(({ accountId, stats: usageStats }) => {
      result[`${accountId}`] = getCacheHitRate(usageStats);
    });
  }

  return result;
}

function getTodayUsagePage(accountId: number) {
  return adminFetch<PaginatedData<AdminUsageLog>>(`/api/v1/admin/usage${buildQuery({
    page: 1,
    page_size: FIRST_TOKEN_USAGE_PAGE_SIZE,
    account_id: accountId,
    start_date: getShanghaiDate(),
    end_date: getShanghaiDate(1),
    sort_by: 'created_at',
    sort_order: 'desc',
    timezone: 'Asia/Shanghai',
  })}`);
}

async function getFirstTokenStatsFromUsage(accountIds: number[]) {
  const result: Record<string, Pick<AccountTodayStats, 'recent_first_token_ms'>> = {};

  for (let start = 0; start < accountIds.length; start += FIRST_TOKEN_USAGE_ACCOUNT_BATCH_SIZE) {
    const batch = accountIds.slice(start, start + FIRST_TOKEN_USAGE_ACCOUNT_BATCH_SIZE);
    const logs = await Promise.all(batch.map(async (accountId) => ({
      accountId,
      items: (await getTodayUsagePage(accountId)).items,
    })));

    logs.forEach(({ accountId, items }) => {
      result[`${accountId}`] = {
        recent_first_token_ms: items
          .filter((item) => item.account_id === accountId)
          .slice(0, FIRST_TOKEN_USAGE_PAGE_SIZE)
          .map((item) => normalizeFirstTokenMs(item.first_token_ms)),
      };
    });
  }

  return result;
}

export async function getAccountTodayStatsBatchWithUsageFallback(accountIds: number[]) {
  const normalizedIds = normalizeAccountIds(accountIds);
  const batch = await getAccountTodayStatsBatch(normalizedIds);
  const fallbackIds = normalizedIds.filter((accountId) => !hasFirstTokenStats(batch.stats[`${accountId}`]));

  if (fallbackIds.length === 0) return batch;

  try {
    const fallbackStats = await getFirstTokenStatsFromUsage(fallbackIds);
    const stats = { ...batch.stats };
    fallbackIds.forEach((accountId) => {
      const key = `${accountId}`;
      stats[key] = { ...(stats[key] ?? { requests: 0, tokens: 0, cost: 0 }), ...fallbackStats[key] };
    });
    return { ...batch, stats };
  } catch (error) {
    return {
      ...batch,
      first_token_stats_error: error instanceof Error ? error.message : 'REQUEST_FAILED',
    };
  }
}

const UPSTREAM_BILLING_COST_BATCH_SIZE = 1000;

function normalizeAccountIds(accountIds: number[]) {
  return [...new Set(accountIds.filter((accountId) => Number.isSafeInteger(accountId) && accountId > 0))].sort((left, right) => left - right);
}

function getAccountUpstreamBillingCosts24hBatch(accountIds: number[]) {
  return adminFetch<UpstreamBillingCost24hResponse>('/api/v1/admin/accounts/upstream-costs/today', {
    method: 'POST',
    body: JSON.stringify({ account_ids: accountIds }),
  });
}

export async function getAccountUpstreamBillingCosts24h(accountIds: number[]) {
  const normalizedIds = normalizeAccountIds(accountIds);
  if (normalizedIds.length === 0) {
    const now = new Date().toISOString();
    return { window_start: now, window_end: now, timezone: 'Asia/Shanghai', costs: {} };
  }

  const batches: UpstreamBillingCost24hResponse[] = [];
  for (let start = 0; start < normalizedIds.length; start += UPSTREAM_BILLING_COST_BATCH_SIZE) {
    batches.push(await getAccountUpstreamBillingCosts24hBatch(normalizedIds.slice(start, start + UPSTREAM_BILLING_COST_BATCH_SIZE)));
  }

  return {
    window_start: batches[0].window_start,
    window_end: batches[0].window_end,
    timezone: batches[0].timezone,
    costs: Object.assign({}, ...batches.map((batch) => batch.costs)),
  };
}

export async function testAccount(accountId: number): Promise<AccountTestResult> {
  const response = await adminFetchSse(`/api/v1/admin/accounts/${accountId}/test`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  const state: AccountTestState = {
    content: '',
    hasEvent: false,
    statusMessages: [],
    succeeded: false,
  };

  await readAccountTestEvents(response, (event) => recordAccountTestEvent(event, state));

  if (state.error) {
    throw new Error(state.error);
  }

  if (!state.hasEvent) {
    throw new Error('TEST_STREAM_INVALID');
  }

  if (!state.succeeded) {
    throw new Error('TEST_STREAM_INCOMPLETE');
  }

  const detail = compactTestMessage(state.statusMessages.at(-1) || state.content);
  const model = state.model ? `（${state.model}）` : '';

  return {
    message: detail ? `测试成功${model}：${detail}` : `测试成功${model}`,
  };
}

export function refreshAccount(accountId: number) {
  return adminFetch(`/api/v1/admin/accounts/${accountId}/refresh`, {
    method: 'POST',
  });
}

export function setAccountSchedulable(accountId: number, schedulable: boolean) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}/schedulable`, {
    method: 'POST',
    body: JSON.stringify({ schedulable }),
  });
}
