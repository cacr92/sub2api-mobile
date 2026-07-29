import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RefreshCw, Search, ShieldCheck, ShieldOff } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { useDebouncedValue } from '@/src/hooks/use-debounced-value';
import { formatTokenValue } from '@/src/lib/formatters';
import {
  getAccountUpstreamBillingCosts24h,
  getAccountTodayStatsBatch,
  listAccounts,
  listAllGroups,
  probeUpstreamBillingBatch,
  setAccountSchedulable,
  testAccount,
} from '@/src/services/admin';
import type { AdminAccount, UpstreamBillingCostEstimate, UpstreamBillingProbeResult } from '@/src/types/admin';

type AccountStatusFilter = 'all' | 'active' | 'paused' | 'error';
type AccountVisualStatus = {
  filterKey: AccountStatusFilter;
  label: '正常' | '暂停' | '异常';
  badgeTone: 'success' | 'muted' | 'danger';
};

type AccountTodaySummary = {
  requests: number;
  tokens: number;
  cost: number;
};

type AccountTestFeedback = {
  message: string;
  tone: 'success' | 'danger';
};

type AccountGroupFilterOption = {
  id: number;
  name: string;
};

type UpstreamBillingRateDisplay = {
  value: string;
  detail?: string;
  detailTone?: 'muted' | 'warning';
};

type UpstreamBillingCostDisplay = {
  value: string;
  detail?: string;
  detailTone?: 'muted' | 'warning';
};

const UPSTREAM_BILLING_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const UPSTREAM_BILLING_PROBE_BATCH_SIZE = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getFiniteNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function getFiniteNonNegativeInteger(value: unknown) {
  const numberValue = getFiniteNonNegativeNumber(value);
  return numberValue !== null && Number.isInteger(numberValue) ? numberValue : null;
}

function parseTimestamp(value: unknown) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function getAccountLastUsedTimestamp(account: AdminAccount) {
  return parseTimestamp(account.last_used_at);
}

function isUpstreamBillingProbeEligible(account: AdminAccount) {
  const platform = account.platform.toLowerCase();
  return (platform === 'anthropic' || platform === 'openai' || platform === 'grok') && account.type.toLowerCase() === 'apikey';
}

function compareAccountsByLastUsedAt(left: AdminAccount, right: AdminAccount) {
  const leftLastUsed = getAccountLastUsedTimestamp(left);
  const rightLastUsed = getAccountLastUsedTimestamp(right);

  if (leftLastUsed === null && rightLastUsed === null) return left.id - right.id;
  if (leftLastUsed === null) return 1;
  if (rightLastUsed === null) return -1;
  if (leftLastUsed !== rightLastUsed) return rightLastUsed - leftLastUsed;

  return left.id - right.id;
}

function getFreshUntil(snapshot: Record<string, unknown>, receivedAt: number) {
  if (typeof snapshot.fresh_until === 'string') return parseTimestamp(snapshot.fresh_until);
  if (snapshot.status !== 'ok') return null;

  const nextProbeAt = parseTimestamp(snapshot.next_probe_at);
  return nextProbeAt !== null && nextProbeAt > receivedAt ? receivedAt + 2 * (nextProbeAt - receivedAt) : null;
}

function parseClockMinute(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function getMinuteInTimeZone(timestamp: number, timeZone: unknown) {
  if (typeof timeZone !== 'string' || !timeZone) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

function getFreshUpstreamBillingData(account: AdminAccount, now: number): Record<string, unknown> | null {
  if (!isUpstreamBillingProbeEligible(account)) return null;

  const snapshot = account.extra?.upstream_billing_probe;
  if (!isRecord(snapshot) || (snapshot.status !== 'ok' && snapshot.status !== 'failed')) return null;

  const billing = snapshot.data;
  if (!isRecord(billing) || billing.billing_scope !== 'token') return null;

  const receivedAt = parseTimestamp(snapshot.received_at);
  const freshUntil = receivedAt === null ? null : getFreshUntil(snapshot, receivedAt);
  if (
    receivedAt === null ||
    freshUntil === null ||
    receivedAt > now + UPSTREAM_BILLING_CLOCK_SKEW_TOLERANCE_MS ||
    freshUntil <= receivedAt ||
    now > freshUntil
  ) {
    return null;
  }

  return billing;
}

function getUpstreamBillingRate(account: AdminAccount, now: number) {
  const billing = getFreshUpstreamBillingData(account, now);
  if (!billing) return '--';

  const base = getFiniteNonNegativeNumber(billing.resolved_rate_multiplier);
  if (base === null || typeof billing.peak_rate_enabled !== 'boolean') return '--';

  let rate = base;
  if (billing.peak_rate_enabled) {
    const start = parseClockMinute(billing.peak_start);
    const end = parseClockMinute(billing.peak_end);
    const minute = getMinuteInTimeZone(now, billing.timezone);
    const peak = getFiniteNonNegativeNumber(billing.peak_rate_multiplier);
    if (start === null || end === null || minute === null || start >= end || peak === null) return '--';
    if (minute >= start && minute < end) rate *= peak;
  }

  return Number.isFinite(rate) ? `${Number(rate.toPrecision(12))}x` : '--';
}

function getUpstreamBillingRateDisplay(account: AdminAccount, now: number): UpstreamBillingRateDisplay {
  const rate = getUpstreamBillingRate(account, now);
  const snapshot = account.extra?.upstream_billing_probe;

  if (rate !== '--') {
    const receivedAt = isRecord(snapshot) ? snapshot.received_at : undefined;
    const isCachedAfterFailure = isRecord(snapshot) && snapshot.status === 'failed';
    return {
      value: rate,
      detail: isCachedAfterFailure ? '最近探测失败，当前仍使用有效缓存倍率' : `倍率快照 ${formatTime(typeof receivedAt === 'string' ? receivedAt : undefined)}`,
      detailTone: isCachedAfterFailure ? 'warning' : 'muted',
    };
  }

  if (!isRecord(snapshot)) {
    return account.extra?.upstream_billing_probe_enabled === true
      ? { value: '待探测', detail: '尚未获取上游倍率', detailTone: 'muted' }
      : { value: '未启用', detail: '未启用上游倍率探测', detailTone: 'warning' };
  }

  if (snapshot.status === 'unsupported') {
    return { value: '不支持', detail: '上游不支持倍率查询', detailTone: 'warning' };
  }
  if (snapshot.status === 'failed') {
    return { value: '探测失败', detail: '最近一次上游倍率探测失败', detailTone: 'warning' };
  }

  return { value: '已过期', detail: '上游倍率快照已过期或格式无效', detailTone: 'warning' };
}

function formatCurrency(value: number) {
  const normalizedValue = Object.is(value, -0) ? 0 : value;
  const digits = Math.abs(normalizedValue) > 0 && Math.abs(normalizedValue) < 0.01 ? 4 : 2;

  return `$${normalizedValue.toFixed(digits)}`;
}

function getUpstreamBillingCostDisplay(estimate?: UpstreamBillingCostEstimate, error?: unknown): UpstreamBillingCostDisplay {
  const amount = getFiniteNonNegativeNumber(estimate?.estimated_upstream_cost);
  const standardCost = getFiniteNonNegativeNumber(estimate?.standard_cost);
  const tokenRequestCount = getFiniteNonNegativeInteger(estimate?.token_request_count);
  const coveredTokenRequestCount = getFiniteNonNegativeInteger(estimate?.covered_token_request_count);
  const uncoveredTokenRequestCount = getFiniteNonNegativeInteger(estimate?.uncovered_token_request_count);
  const coveredStandardCost = getFiniteNonNegativeNumber(estimate?.covered_standard_cost);
  const uncoveredStandardCost = getFiniteNonNegativeNumber(estimate?.uncovered_standard_cost);
  const effectiveRateMultiplier = getFiniteNonNegativeNumber(estimate?.effective_rate_multiplier);
  const cachedRateRequestCount = getFiniteNonNegativeInteger(estimate?.cached_rate_request_count);
  const nonTokenRequestCount = getFiniteNonNegativeInteger(estimate?.non_token_request_count);
  const unknownBillingModeRequestCount = getFiniteNonNegativeInteger(estimate?.unknown_billing_mode_request_count);

  if (amount !== null) {
    if (tokenRequestCount === null || coveredTokenRequestCount === null) {
      return {
        value: formatCurrency(amount),
        detail: '服务器仍在返回旧口径，使用当前倍率回推，可能包含历史误差。',
        detailTone: 'warning',
      };
    }

    const details = [
      standardCost === null ? '' : `模型 Token 标准费用 ${formatCurrency(standardCost)}`,
      effectiveRateMultiplier === null ? '' : `请求时费用加权倍率 ${effectiveRateMultiplier.toFixed(4)}x`,
      coveredStandardCost === null ? `请求时倍率覆盖 ${coveredTokenRequestCount}/${tokenRequestCount} 条 Token 请求` : `请求时倍率覆盖 ${coveredTokenRequestCount}/${tokenRequestCount} 条 Token 请求（${formatCurrency(coveredStandardCost)}）`,
      cachedRateRequestCount && cachedRateRequestCount > 0 ? `${cachedRateRequestCount} 条使用有效缓存倍率` : '',
      nonTokenRequestCount && nonTokenRequestCount > 0 ? `排除 ${nonTokenRequestCount} 条非 Token 请求` : '',
      unknownBillingModeRequestCount && unknownBillingModeRequestCount > 0 ? `${unknownBillingModeRequestCount} 条历史记录未标记计费模式` : '',
    ].filter(Boolean);

    if (estimate?.status === 'partial' || (uncoveredTokenRequestCount ?? 0) > 0) {
      details.push(
        uncoveredStandardCost === null
          ? `另有 ${uncoveredTokenRequestCount ?? 0} 条 Token 请求未覆盖，未用当前倍率回推`
          : `另有 ${uncoveredTokenRequestCount ?? 0} 条 Token 请求（${formatCurrency(uncoveredStandardCost)}）未覆盖，未用当前倍率回推`
      );
      return {
        value: formatCurrency(amount),
        detail: details.join('；'),
        detailTone: 'warning',
      };
    }

    return {
      value: formatCurrency(amount),
      detail: details.join('；') || '按请求时倍率估算',
      detailTone: 'muted',
    };
  }

  switch (estimate?.reason) {
    case 'no_token_usage':
      return { value: '无请求', detail: '北京时间今日 00:00 以来没有 Token 计费请求。', detailTone: 'muted' };
    case 'missing_request_rate_snapshot':
      return { value: '待快照', detail: '历史 Token 记录没有请求时倍率；为避免误算，未使用当前倍率回推。', detailTone: 'warning' };
    case 'account_not_eligible':
      return { value: '不适用', detail: '该账号类型不支持倍率估算', detailTone: 'muted' };
    case 'missing_snapshot':
      return { value: '待快照', detail: '等待上游倍率快照', detailTone: 'muted' };
    case 'upstream_unsupported':
      return { value: '不支持', detail: '上游不支持倍率查询', detailTone: 'warning' };
    case 'probe_failed':
      return { value: '探测失败', detail: '倍率快照刷新失败', detailTone: 'warning' };
    case 'stale_snapshot':
      return { value: '已过期', detail: '倍率快照已过期', detailTone: 'warning' };
    case 'invalid_usage_stats':
    case 'invalid_estimate':
      return { value: '数据异常', detail: '费用统计数据异常，未显示估算金额。', detailTone: 'warning' };
    default:
      if (error instanceof Error && (error.message === 'HTTP_404' || error.message === 'INVALID_SERVER_RESPONSE')) {
        return { value: '未部署', detail: '当前服务器尚未部署今日费用估算', detailTone: 'warning' };
      }
      return { value: '暂无数据', detail: '暂无可用的请求时上游倍率', detailTone: 'muted' };
  }
}

function getUpstreamBillingRefreshErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : 'REQUEST_FAILED';

  switch (message) {
    case 'UPSTREAM_BILLING_PROBE_UNAVAILABLE':
    case 'HTTP_404':
      return '当前服务器未部署上游倍率探测。';
    case 'BASE_URL_REQUIRED':
      return '请先到服务器页填写服务地址。';
    case 'ADMIN_API_KEY_REQUIRED':
      return '请先到服务器页填写 Admin Token。';
    default:
      return `上游账单刷新失败：${message}`;
  }
}

function formatTime(value?: string | null) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getAccountError(account: AdminAccount) {
  return Boolean(account.status === 'error' || account.error_message);
}

function getAccountTestErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : '测试失败';

  switch (message) {
    case 'BASE_URL_REQUIRED':
      return '请先到服务器页填写服务地址。';
    case 'ADMIN_API_KEY_REQUIRED':
      return '请先到服务器页填写 Admin Token。';
    case 'TEST_STREAM_INVALID':
      return '服务器未返回可识别的测试结果。';
    case 'TEST_STREAM_INCOMPLETE':
      return '测试流在返回最终结果前结束。';
    default:
      return message;
  }
}

function getAccountVisualStatus(account: AdminAccount): AccountVisualStatus {
  const normalizedStatus = `${account.status ?? ''}`.toLowerCase();
  const isPausedStatus = ['inactive', 'disabled', 'paused', 'stop', 'stopped'].includes(normalizedStatus);

  if (getAccountError(account)) {
    return { filterKey: 'error', label: '异常', badgeTone: 'danger' };
  }
  if (isPausedStatus || account.schedulable === false) {
    return { filterKey: 'paused', label: '暂停', badgeTone: 'muted' };
  }
  return { filterKey: 'active', label: '正常', badgeTone: 'success' };
}

function accountBelongsToGroup(account: AdminAccount, groupID: number) {
  return account.group_ids?.includes(groupID) || account.groups?.some((group) => group.id === groupID) || false;
}

function formatAccountConcurrency(account: AdminAccount) {
  const limit = typeof account.concurrency === 'number' && Number.isFinite(account.concurrency) && account.concurrency >= 0
    ? Math.trunc(account.concurrency)
    : null;
  if (limit === null) return '--';

  const current = typeof account.current_concurrency === 'number' && Number.isFinite(account.current_concurrency) && account.current_concurrency >= 0
    ? Math.trunc(account.current_concurrency)
    : 0;
  return `${current}/${limit}`;
}

type AccountsListScreenProps = {
  safeAreaEdges?: Edge[];
};

export function AccountsListScreen({ safeAreaEdges }: AccountsListScreenProps) {
  const [searchText, setSearchText] = useState('');
  const [filter, setFilter] = useState<AccountStatusFilter>('all');
  const [groupFilterID, setGroupFilterID] = useState<number | null>(null);
  const [testingAccountId, setTestingAccountId] = useState<number | null>(null);
  const [testFeedbackByAccountId, setTestFeedbackByAccountId] = useState<Record<number, AccountTestFeedback>>({});
  const [togglingAccountId, setTogglingAccountId] = useState<number | null>(null);
  const [upstreamBillingNow, setUpstreamBillingNow] = useState(() => Date.now());
  const [upstreamBillingRefreshFeedback, setUpstreamBillingRefreshFeedback] = useState<string | null>(null);
  const [isRefreshingUpstreamBilling, setIsRefreshingUpstreamBilling] = useState(false);
  const keyword = useDebouncedValue(searchText.trim(), 300);
  const queryClient = useQueryClient();

  useEffect(() => {
    const intervalId = setInterval(() => setUpstreamBillingNow(Date.now()), 60_000);

    return () => clearInterval(intervalId);
  }, []);

  const accountsQuery = useQuery({
    queryKey: ['accounts', keyword],
    queryFn: () => listAccounts(keyword),
  });
  const groupsQuery = useQuery({
    queryKey: ['groups', 'all'],
    queryFn: listAllGroups,
    staleTime: 60_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ accountId, schedulable }: { accountId: number; schedulable: boolean }) =>
      setAccountSchedulable(accountId, schedulable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const testMutation = useMutation({
    mutationFn: (accountId: number) => testAccount(accountId),
  });

  const items = accountsQuery.data?.items ?? [];
  const accountIds = useMemo(() => items.map((account) => account.id), [items]);
  const todayStatsQuery = useQuery({
    queryKey: ['account-today-stats', accountIds],
    queryFn: () => getAccountTodayStatsBatch(accountIds),
    enabled: accountIds.length > 0,
    staleTime: 60_000,
  });
  const upstreamBillingCosts24hQuery = useQuery({
    queryKey: ['account-upstream-billing-costs-24h', accountIds],
    queryFn: () => getAccountUpstreamBillingCosts24h(accountIds),
    enabled: accountIds.length > 0,
    staleTime: 60_000,
  });

  const todayByAccountId = useMemo(() => {
    const next = new Map<number, AccountTodaySummary>();
    items.forEach((account) => {
      const result = todayStatsQuery.data?.stats[`${account.id}`];
      const fromStatsCost = typeof result?.cost === 'number' && Number.isFinite(result.cost) ? result.cost : undefined;
      const fromExtra = typeof account.extra?.today_cost === 'number' ? account.extra.today_cost : undefined;
      const cost = fromStatsCost ?? fromExtra ?? 0;
      const requests = typeof result?.requests === 'number' && Number.isFinite(result.requests) ? result.requests : 0;
      const tokens = typeof result?.tokens === 'number' && Number.isFinite(result.tokens) ? result.tokens : 0;
      next.set(account.id, { requests, tokens, cost });
    });
    return next;
  }, [items, todayStatsQuery.data]);

  const groupFilterOptions = useMemo(() => {
    const groups = new Map<number, AccountGroupFilterOption>();

    groupsQuery.data?.items.forEach((group) => {
      groups.set(group.id, { id: group.id, name: group.name });
    });

    items.forEach((account) => {
      const groupsByID = new Map(account.groups?.map((group) => [group.id, group]));
      const groupIDs = new Set([...(account.group_ids ?? []), ...(account.groups?.map((group) => group.id) ?? [])]);

      groupIDs.forEach((groupID) => {
        if (!groups.has(groupID)) {
          const group = groupsByID.get(groupID);
          groups.set(groupID, {
            id: groupID,
            name: group?.name || `分组 #${groupID}`,
          });
        }
      });
    });

    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.id - right.id);
  }, [groupsQuery.data?.items, items]);

  useEffect(() => {
    if (groupsQuery.isSuccess && groupFilterID !== null && !groupFilterOptions.some((group) => group.id === groupFilterID)) {
      setGroupFilterID(null);
    }
  }, [groupFilterID, groupFilterOptions, groupsQuery.isSuccess]);

  const filteredItems = useMemo(() => {
    const statusMatched = items.filter((account) => {
      const visualStatus = getAccountVisualStatus(account);
      if (filter === 'all') return true;
      if (filter === 'active') return visualStatus.filterKey === 'active';
      if (filter === 'paused') return visualStatus.filterKey === 'paused';
      if (filter === 'error') return visualStatus.filterKey === 'error';
      return true;
    });

    const groupMatched = groupFilterID === null
      ? statusMatched
      : statusMatched.filter((account) => accountBelongsToGroup(account, groupFilterID));

    return [...groupMatched].sort(compareAccountsByLastUsedAt);
  }, [filter, groupFilterID, items]);
  const eligibleUpstreamBillingAccounts = useMemo(
    () => filteredItems.filter(isUpstreamBillingProbeEligible),
    [filteredItems]
  );
  const refreshUpstreamBilling = useCallback(async () => {
    if (eligibleUpstreamBillingAccounts.length === 0) return;

    setIsRefreshingUpstreamBilling(true);
    setUpstreamBillingRefreshFeedback(null);

    try {
      const results: UpstreamBillingProbeResult[] = [];

      for (let start = 0; start < eligibleUpstreamBillingAccounts.length; start += UPSTREAM_BILLING_PROBE_BATCH_SIZE) {
        const accounts = eligibleUpstreamBillingAccounts.slice(start, start + UPSTREAM_BILLING_PROBE_BATCH_SIZE);
        results.push(...await probeUpstreamBillingBatch(accounts.map((account) => account.id)));
      }

      if (results.length === 0) {
        throw new Error('UPSTREAM_BILLING_PROBE_UNAVAILABLE');
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['account-upstream-billing-costs-24h'] }),
      ]);
      setUpstreamBillingNow(Date.now());

      const unsupported = results.filter((result) => result.snapshot?.status === 'unsupported').length;
      const failed = results.filter((result) => result.snapshot?.status === 'failed' || Boolean(result.error)).length;
      const suffix = [
        unsupported > 0 ? `${unsupported} 个上游不支持` : '',
        failed > 0 ? `${failed} 个探测失败` : '',
      ].filter(Boolean).join('，');

      setUpstreamBillingRefreshFeedback(`已刷新 ${results.length} 个上游倍率快照${suffix ? `；${suffix}` : ''}。`);
    } catch (error) {
      setUpstreamBillingRefreshFeedback(getUpstreamBillingRefreshErrorMessage(error));
    } finally {
      setIsRefreshingUpstreamBilling(false);
    }
  }, [eligibleUpstreamBillingAccounts, queryClient]);
  const errorMessage = accountsQuery.error instanceof Error ? accountsQuery.error.message : '';

  const summary = useMemo(() => {
    const total = items.length;
    const errors = items.filter((item) => getAccountVisualStatus(item).filterKey === 'error').length;
    const paused = items.filter((item) => getAccountVisualStatus(item).filterKey === 'paused').length;
    const active = items.filter((item) => getAccountVisualStatus(item).filterKey === 'active').length;
    return { total, active, paused, errors };
  }, [items]);

  const listHeader = useMemo(
    () => (
      <View className="pb-2">
        <View className="rounded-[24px] bg-[#fbf8f2] p-2.5">
          <View className="flex-row items-center rounded-[18px] bg-[#f1ece2] px-4 py-3">
            <Search color="#7d7468" size={18} />
            <TextInput
              defaultValue=""
              onChangeText={setSearchText}
              placeholder="搜索账号名称 / 平台"
              placeholderTextColor="#9b9081"
              className="ml-3 flex-1 text-base text-[#16181a]"
            />
          </View>

          <View className="mt-3 flex-row gap-2">
            {([
              ['all', `全部 ${summary.total}`],
              ['active', `正常 ${summary.active}`],
              ['paused', `暂停 ${summary.paused}`],
              ['error', `异常 ${summary.errors}`],
            ] as const).map(([key, label]) => {
              const active = filter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setFilter(key)}
                  className={active ? 'rounded-full bg-[#1d5f55] px-3 py-2' : 'rounded-full bg-[#e7dfcf] px-3 py-2'}
                >
                  <Text className={active ? 'text-xs font-semibold text-white' : 'text-xs font-semibold text-[#4e463e]'}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {groupFilterOptions.length > 0 ? (
            <View className="mt-3">
              <Text className="text-xs font-semibold text-[#7d7468]">按分组筛选</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2">
                <View className="flex-row gap-2 pr-3">
                  <Pressable
                    accessibilityLabel="显示全部分组账号"
                    accessibilityRole="button"
                    accessibilityState={{ selected: groupFilterID === null }}
                    onPress={() => setGroupFilterID(null)}
                    className={groupFilterID === null ? 'rounded-full bg-[#4e463e] px-3 py-2' : 'rounded-full bg-[#e7dfcf] px-3 py-2'}
                  >
                    <Text className={groupFilterID === null ? 'text-xs font-semibold text-white' : 'text-xs font-semibold text-[#4e463e]'}>全部分组</Text>
                  </Pressable>
                  {groupFilterOptions.map((group) => {
                    const selected = groupFilterID === group.id;
                    return (
                      <Pressable
                        key={group.id}
                        accessibilityLabel={`筛选分组 ${group.name}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setGroupFilterID(group.id)}
                        className={selected ? 'rounded-full bg-[#4e463e] px-3 py-2' : 'rounded-full bg-[#e7dfcf] px-3 py-2'}
                      >
                        <Text numberOfLines={1} style={{ maxWidth: 160 }} className={selected ? 'text-xs font-semibold text-white' : 'text-xs font-semibold text-[#4e463e]'}>
                          {group.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          ) : null}

          {eligibleUpstreamBillingAccounts.length > 0 ? (
            <View className="mt-3 gap-2">
              <Pressable
                accessibilityLabel="刷新当前筛选账号的上游倍率"
                accessibilityRole="button"
                disabled={isRefreshingUpstreamBilling}
                onPress={() => void refreshUpstreamBilling()}
                className="self-start flex-row items-center gap-2 rounded-full bg-[#1d5f55] px-3 py-2"
              >
                <RefreshCw color="#ffffff" size={14} />
                <Text className="text-xs font-semibold text-white">{isRefreshingUpstreamBilling ? '正在刷新上游倍率...' : '刷新上游倍率'}</Text>
              </Pressable>
              {upstreamBillingRefreshFeedback ? <Text className="text-xs text-[#7d7468]">{upstreamBillingRefreshFeedback}</Text> : null}
              <Text className="text-xs text-[#7d7468]">北京时间今日 00:00 至当前：按最终上游模型的输入、输出、缓存写入和缓存读取 Token 标准单价分项计算，再乘每次请求保存的上游有效倍率；未覆盖记录不会用当前倍率回推。</Text>
            </View>
          ) : null}

          <Text className="mt-3 text-xs text-[#7d7468]">排序：最近调用优先，未调用账号置底。</Text>
        </View>
      </View>
    ),
    [
      eligibleUpstreamBillingAccounts.length,
      filter,
      groupFilterID,
      groupFilterOptions,
      isRefreshingUpstreamBilling,
      refreshUpstreamBilling,
      summary.active,
      summary.errors,
      summary.paused,
      summary.total,
      upstreamBillingRefreshFeedback,
    ]
  );

  const renderItem = useCallback(
    ({ item: account }: { item: (typeof filteredItems)[number] }) => {
      const isError = getAccountError(account);
      const visualStatus = getAccountVisualStatus(account);
      const statusText = visualStatus.label;
      const groupNames = account.groups?.map((group) => group.name).filter(Boolean).slice(0, 3) ?? [];
      const groupsText = groupNames.length > 0 ? groupNames.join(' · ') : account.group_ids?.slice(0, 3).map((groupID) => `#${groupID}`).join(' · ');
      const todayStats = todayByAccountId.get(account.id) ?? { requests: 0, tokens: 0, cost: 0 };
      const nextSchedulable = visualStatus.filterKey === 'paused';
      const toggleLabel = nextSchedulable ? '恢复' : '暂停';
      const testFeedback = testFeedbackByAccountId[account.id];
      const isTogglingCurrent = togglingAccountId === account.id && toggleMutation.isPending;
      const isTestingCurrent = testingAccountId === account.id && testMutation.isPending;
      const supportsUpstreamBilling = isUpstreamBillingProbeEligible(account);
      const upstreamBillingRate = getUpstreamBillingRateDisplay(account, upstreamBillingNow);
      const upstreamBillingCost = upstreamBillingCosts24hQuery.data?.costs[`${account.id}`];
      const upstreamBillingCostDisplay = getUpstreamBillingCostDisplay(upstreamBillingCost, upstreamBillingCosts24hQuery.error);
      const concurrencyText = formatAccountConcurrency(account);

      return (
        <View>
          <ListCard
            title={account.name}
            meta={`${account.platform} · ${account.type}`}
            badge={statusText}
            badgeTone={visualStatus.badgeTone}
            icon={KeyRound}
          >
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  {account.schedulable && !isError ? <ShieldCheck color="#7d7468" size={14} /> : <ShieldOff color="#7d7468" size={14} />}
                  <Text className="text-sm text-[#7d7468]">状态：{statusText}</Text>
                </View>
                <Text className="text-xs text-[#7d7468]">最近调用 {formatTime(account.last_used_at)}</Text>
              </View>

              <View className="flex-row border-y border-[#e7dfcf] py-3">
                <View className="flex-1 pr-2">
                  <Text className="text-[11px] text-[#7d7468]">本日请求</Text>
                  <Text className="mt-1 text-sm font-bold text-[#16181a]">{todayStats.requests}</Text>
                </View>
                <View className="flex-1 border-l border-[#e7dfcf] px-2">
                  <Text className="text-[11px] text-[#7d7468]">本日账号费用</Text>
                  <Text className="mt-1 text-sm font-bold text-[#16181a]">{formatCurrency(todayStats.cost)}</Text>
                </View>
                <View className="flex-1 border-l border-[#e7dfcf] pl-2">
                  <Text className="text-[11px] text-[#7d7468]">本日 Token</Text>
                  <Text className="mt-1 text-sm font-bold text-[#16181a]">{formatTokenValue(todayStats.tokens)}</Text>
                </View>
              </View>

              <Text className="text-xs text-[#7d7468]">
                优先级 {account.priority ?? 0} · 调度并发 {concurrencyText} · 渠道倍率 {(account.rate_multiplier ?? 1).toFixed(2)}x
              </Text>
              {supportsUpstreamBilling ? (
                <View className="border-l-2 border-[#1d5f55] pl-3">
                  <Text className="text-[11px] font-semibold text-[#1d5f55]">上游监控</Text>
                  <View className="mt-2 flex-row overflow-hidden rounded-lg border border-[#d8e5e1] bg-[#f3f8f6]">
                    <View className="flex-1 px-3 py-2.5">
                      <Text numberOfLines={1} className="text-[11px] text-[#55756e]">当前上游倍率</Text>
                      <Text numberOfLines={1} className={upstreamBillingRate.detailTone === 'warning' ? 'mt-1 text-base font-bold text-[#a4512b]' : 'mt-1 text-base font-bold text-[#1d5f55]'}>
                        {upstreamBillingRate.value}
                      </Text>
                    </View>
                    <View className="flex-1 border-l border-[#d8e5e1] px-3 py-2.5">
                      <Text numberOfLines={1} className="text-[11px] text-[#55756e]">今日上游费用估算</Text>
                      <Text numberOfLines={1} className={upstreamBillingCostDisplay.detailTone === 'warning' ? 'mt-1 text-base font-bold text-[#a4512b]' : 'mt-1 text-base font-bold text-[#16181a]'}>
                        {upstreamBillingCostDisplay.value}
                      </Text>
                    </View>
                  </View>
                  {upstreamBillingRate.detail ? (
                    <Text className={upstreamBillingRate.detailTone === 'warning' ? 'mt-2 text-xs text-[#a4512b]' : 'mt-2 text-xs text-[#7d7468]'}>
                      {upstreamBillingRate.detail}
                    </Text>
                  ) : null}
                  {upstreamBillingCostDisplay.detail ? (
                    <Text className={upstreamBillingCostDisplay.detailTone === 'warning' ? 'mt-1 text-xs text-[#a4512b]' : 'mt-1 text-xs text-[#7d7468]'}>
                      {upstreamBillingCostDisplay.detail}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {groupsText ? <Text className="text-xs text-[#7d7468]">分组 {groupsText}</Text> : null}
              {account.error_message ? <Text className="text-xs text-[#a4512b]">异常信息：{account.error_message}</Text> : null}

              <View className="flex-row gap-2">
                <Pressable
                  className="rounded-full bg-[#1b1d1f] px-4 py-2"
                  disabled={isTestingCurrent}
                  onPress={(event) => {
                    event.stopPropagation();
                    setTestingAccountId(account.id);
                    testMutation.mutate(account.id, {
                      onSuccess: (result) => {
                        setTestFeedbackByAccountId((current) => ({
                          ...current,
                          [account.id]: { message: result.message, tone: 'success' },
                        }));
                      },
                      onError: (error) => {
                        setTestFeedbackByAccountId((current) => ({
                          ...current,
                          [account.id]: { message: getAccountTestErrorMessage(error), tone: 'danger' },
                        }));
                      },
                      onSettled: () => {
                        setTestingAccountId((current) => (current === account.id ? null : current));
                      },
                    });
                  }}
                >
                  <Text className="text-xs font-semibold text-[#f6f1e8]">{isTestingCurrent ? '测试中...' : '测试'}</Text>
                </Pressable>
                <Pressable
                  className="rounded-full bg-[#e7dfcf] px-4 py-2"
                  disabled={isTogglingCurrent}
                  onPress={(event) => {
                    event.stopPropagation();
                    setTogglingAccountId(account.id);
                    toggleMutation.mutate({
                      accountId: account.id,
                      schedulable: nextSchedulable,
                    }, {
                      onSettled: () => {
                        setTogglingAccountId((current) => (current === account.id ? null : current));
                      },
                    });
                  }}
                >
                  <Text className="text-xs font-semibold text-[#4e463e]">{isTogglingCurrent ? '处理中...' : toggleLabel}</Text>
                </Pressable>
              </View>

              {testFeedback ? (
                <Text className={testFeedback.tone === 'success' ? 'text-xs text-[#1d5f55]' : 'text-xs text-[#a4512b]'}>
                  测试结果：{testFeedback.message}
                </Text>
              ) : null}
            </View>
          </ListCard>
        </View>
      );
    },
    [testFeedbackByAccountId, testMutation, testingAccountId, todayByAccountId, toggleMutation, togglingAccountId, upstreamBillingCosts24hQuery.data, upstreamBillingNow]
  );

  const emptyState = useMemo(
    () => <ListCard title="暂无账号" meta={errorMessage || '连上后这里会展示账号列表。'} icon={KeyRound} />,
    [errorMessage]
  );

  return (
    <ScreenShell
      title="账号清单"
      subtitle="查看账号状态、本日用量、调度信息与上游账单估算；账号固定按最近调用时间排列。"
      titleAside={(
        <Text className="text-[11px] text-[#7d7468]">更接近网页后台的账号视图。</Text>
      )}
      variant="minimal"
      scroll={false}
      safeAreaEdges={safeAreaEdges}
      bottomInsetClassName="pb-6"
      contentGapClassName="mt-2 gap-2"
    >
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 12, flexGrow: 1 }}
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => `${item.id}`}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={accountsQuery.isRefetching || groupsQuery.isRefetching || todayStatsQuery.isRefetching || upstreamBillingCosts24hQuery.isRefetching}
            onRefresh={() => {
              void accountsQuery.refetch();
              void groupsQuery.refetch();
              void todayStatsQuery.refetch();
              void upstreamBillingCosts24hQuery.refetch();
            }}
            tintColor="#1d5f55"
          />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyState}
        ItemSeparatorComponent={() => <View className="h-4" />}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
      />
    </ScreenShell>
  );
}
