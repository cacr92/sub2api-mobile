import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CalendarClock, Clock3, KeyRound, Layers3, Pause, Play, RefreshCw, RotateCcw, Search, StickyNote, TriangleAlert, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { useDebouncedValue } from '@/src/hooks/use-debounced-value';
import { getAccountRecoverySummary } from '@/src/lib/account-recovery';
import { formatCacheHitRate, formatTokenValue } from '@/src/lib/formatters';
import { getUpstreamBillingCostDisplay, getUpstreamBillingRateDisplay, isUpstreamBillingProbeEligible, type UpstreamBillingRateDisplay } from '@/src/lib/upstream-billing';
import {
  getAccount,
  getAccountTodayCacheHitRateBatch,
  getAccountUpstreamBillingCosts24h,
  getAccountTodayStatsBatchWithUsageFallback,
  getOpsConcurrencyStats,
  listAccounts,
  listAllGroups,
  probeUpstreamBillingBatch,
  recoverAccountState,
  setAccountSchedulable,
  testAccount,
} from '@/src/services/admin';
import type { AccountTodayStats, AdminAccount, OpsAccountConcurrencyInfo, OpsGroupConcurrencyInfo, PaginatedData, UpstreamBillingCostEstimate, UpstreamBillingProbeResult } from '@/src/types/admin';

type AccountStatusFilter = 'all' | 'active' | 'paused' | 'error';
type AccountVisualStatus = {
  filterKey: AccountStatusFilter;
  label: string;
  badgeTone: 'success' | 'muted' | 'warning' | 'danger';
};

type AccountRuntimeDisplay = {
  current: number;
  limit: number | null;
  utilizationPercent: number | null;
  waiting: number;
  label: '正在调用' | '并发满载' | '请求排队';
  tone: 'active' | 'full';
  activeModels: Array<{ model: string; current: number }>;
  unattributedInUse: number;
};

type AccountOperationalMetric = {
  label: string;
  value: string;
  tone: 'normal' | 'warning' | 'danger';
};

type AccountTestFeedback = {
  message: string;
  tone: 'success' | 'warning' | 'danger';
};

type AccountGroupFilterOption = {
  id: number;
  name: string;
  accountCount: number;
};

type RecoverableAccountGroupOption = AccountGroupFilterOption & {
  accountIds: number[];
};

type BatchRecoveryResult = {
  recoveredAccounts: AdminAccount[];
  failedAccountIds: number[];
};

const UPSTREAM_BILLING_PROBE_BATCH_SIZE = 20;
const ACCOUNT_RECOVERY_BATCH_SIZE = 4;

function StatusFilterSegment({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`筛选${label}账号`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={selected
        ? 'min-h-10 flex-1 items-center justify-center rounded-[8px] bg-[#1f6759] px-1.5'
        : 'min-h-10 flex-1 items-center justify-center rounded-[8px] px-1.5'}
      style={({ pressed }) => ({ minWidth: 0, opacity: pressed ? 0.76 : 1 })}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        className={selected ? 'text-center text-xs font-semibold text-white' : 'text-center text-xs font-semibold text-[#5d564d]'}
      >
        {label} {count}
      </Text>
    </Pressable>
  );
}

function GroupFilterChip({
  label,
  count,
  activityLabel,
  selected,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  count: number;
  activityLabel?: string;
  selected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={selected
        ? 'max-w-full flex-row items-center gap-1.5 rounded-[8px] border border-[#1f6759] bg-[#1f6759] px-3 py-2'
        : 'max-w-full flex-row items-center gap-1.5 rounded-[8px] border border-[#dfe5e1] bg-[#f7f9f8] px-3 py-2'}
      style={({ pressed }) => ({ opacity: pressed ? 0.76 : 1 })}
    >
      <View style={{ flexShrink: 1 }}>
        <Text className={selected ? 'text-xs font-semibold leading-4 text-white' : 'text-xs font-semibold leading-4 text-[#4e463e]'}>
          {label}
        </Text>
        {activityLabel ? (
          <Text className={selected ? 'mt-0.5 text-[10px] font-medium leading-3 text-[#d9f0e9]' : 'mt-0.5 text-[10px] font-semibold leading-3 text-[#a4512b]'}>
            {activityLabel}
          </Text>
        ) : null}
      </View>
      <View className={selected ? 'shrink-0 rounded-md bg-[#ffffff26] px-1.5 py-0.5' : 'shrink-0 rounded-md bg-[#e7dfcf] px-1.5 py-0.5'}>
        <Text className={selected ? 'text-[10px] font-semibold text-white' : 'text-[10px] font-semibold text-[#6f665c]'}>{count}</Text>
      </View>
    </Pressable>
  );
}

function getGroupActivityLabel(runtime?: OpsGroupConcurrencyInfo) {
  const current = Math.trunc(getFiniteNonNegativeNumber(runtime?.current_in_use) ?? 0);
  const waiting = Math.trunc(getFiniteNonNegativeNumber(runtime?.waiting_in_queue) ?? 0);
  if (current <= 0 && waiting <= 0) return undefined;

  return waiting > 0 ? `并发 ${current} · 排队 ${waiting}` : `并发 ${current}`;
}

function AccountRuntimeSummary({
  runtime,
  priority,
}: {
  runtime: AccountRuntimeDisplay;
  priority: number | null;
}) {
  const limitText = runtime.limit === null ? '--' : `${runtime.limit}`;
  const utilizationText = runtime.utilizationPercent === null ? '--' : `${runtime.utilizationPercent}%`;
  const toneClassName = runtime.tone === 'full'
    ? 'border-[#efc9bd] bg-[#fff7f3]'
    : 'border-[#ead8aa] bg-[#fffaf0]';
  const iconClassName = runtime.tone === 'full'
    ? 'bg-[#f4d0c5]'
    : 'bg-[#f7df9e]';
  const accentColor = runtime.tone === 'full' ? '#a4512b' : '#8a5a12';
  const progressColor = runtime.tone === 'full' ? '#b6472e' : '#c38a24';
  const progressWidth = `${Math.min(runtime.utilizationPercent ?? 0, 100)}%` as `${number}%`;
  const activeModelText = runtime.activeModels.map((model) => `${model.model} ×${model.current}`).join(' · ');
  const modelLabel = activeModelText
    ? `${activeModelText}${runtime.unattributedInUse > 0 ? ` · 另 ${runtime.unattributedInUse} 个未标识` : ''}`
    : runtime.current > 0
      ? '当前请求的模型暂未标识'
      : '请求正在排队，尚未占用模型槽位';

  return (
    <View
      accessible
      accessibilityLabel={`${runtime.label}，当前并发 ${runtime.current}，并发上限 ${limitText}，占用率 ${utilizationText}，排队 ${runtime.waiting}，当前模型 ${modelLabel}，调度优先级 ${priority ?? '--'}`}
      className={`border-l-2 px-3 py-2.5 ${toneClassName}`}
    >
      <View className="flex-row items-center gap-2.5">
        <View className={`h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${iconClassName}`}>
          <Activity color={accentColor} size={15} />
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text numberOfLines={1} className="min-w-0 flex-1 text-xs font-bold" style={{ color: accentColor }}>
              {runtime.label}
            </Text>
            {runtime.waiting > 0 ? (
              <Text numberOfLines={1} className="shrink-0 text-[10px] font-bold text-[#a4512b]">排队 {runtime.waiting}</Text>
            ) : null}
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} className="mt-0.5 text-[10px] leading-4 text-[#7d7468]">
            {runtime.waiting > 0 ? '正在等待可用并发槽位' : '上游账号正在承载请求'}
          </Text>
        </View>
        <View className="w-[76px] shrink-0 items-end">
          <Text className="text-[9px] font-semibold text-[#7d7468]">当前并发</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} className="mt-0.5 text-[17px] font-bold leading-5 text-[#16181a]">
            {runtime.current}<Text className="text-[10px] font-semibold text-[#8a8072]"> / {limitText}</Text>
          </Text>
        </View>
      </View>

      <Text numberOfLines={3} className={runtime.activeModels.length > 0 ? 'mt-2 text-[11px] leading-4 text-[#4e463e]' : 'mt-2 text-[11px] leading-4 text-[#7d7468]'}>
        <Text className="font-bold text-[#1d5f55]">当前模型 </Text>{modelLabel}
      </Text>

      <View className="mt-2 flex-row items-center gap-2">
        <View className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e3ddd2]">
          <View className="h-full rounded-full" style={{ width: progressWidth, backgroundColor: progressColor }} />
        </View>
        <Text numberOfLines={1} className="shrink-0 text-[10px] font-semibold text-[#6f665c]">占用 {utilizationText}</Text>
        <Text numberOfLines={1} className="shrink-0 text-[10px] font-semibold text-[#6f665c]">优先级 {priority ?? '--'}</Text>
      </View>
    </View>
  );
}

function AccountModelUsageSummary({
  estimate,
  loading,
  error,
}: {
  estimate?: UpstreamBillingCostEstimate;
  loading: boolean;
  error?: unknown;
}) {
  const models = estimate?.models;

  let content: React.ReactNode;
  if (loading) {
    content = (
      <View className="flex-row items-center gap-2 py-1">
        <ActivityIndicator color="#1d5f55" size="small" />
        <Text className="text-[11px] text-[#7d7468]">正在加载模型用量</Text>
      </View>
    );
  } else if (error) {
    content = <Text className="text-[11px] leading-4 text-[#a4512b]">模型级费用暂不可用，请下拉重试。</Text>;
  } else if (!models) {
    content = estimate?.reason === 'account_not_eligible'
      ? <Text className="text-[11px] leading-4 text-[#7d7468]">此账号暂不支持模型级上游费用统计。</Text>
      : <Text className="text-[11px] leading-4 text-[#7d7468]">服务器尚未返回模型级调用明细。</Text>;
  } else if (models.length === 0) {
    content = <Text className="text-[11px] leading-4 text-[#7d7468]">今天暂无模型调用记录。</Text>;
  } else {
    content = models.map((model, index) => {
      const modelName = model.model.trim() || '未标识模型';
      const requests = getFiniteNonNegativeInteger(model.requests) ?? 0;
      const inputTokens = getFiniteNonNegativeInteger(model.input_tokens) ?? 0;
      const outputTokens = getFiniteNonNegativeInteger(model.output_tokens) ?? 0;
      const cacheCreationTokens = getFiniteNonNegativeInteger(model.cache_creation_tokens) ?? 0;
      const cacheReadTokens = getFiniteNonNegativeInteger(model.cache_read_tokens) ?? 0;
      const totalTokens = getFiniteNonNegativeInteger(model.total_tokens)
        ?? inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
      const costDisplay = getUpstreamBillingCostDisplay(model);
      const usageBreakdown = [
        `输入 ${formatTokenValue(inputTokens)}`,
        `输出 ${formatTokenValue(outputTokens)}`,
        cacheCreationTokens > 0 ? `写缓存 ${formatTokenValue(cacheCreationTokens)}` : null,
        cacheReadTokens > 0 ? `读缓存 ${formatTokenValue(cacheReadTokens)}` : null,
      ].filter(Boolean).join(' · ');

      return (
        <View key={`${modelName}-${index}`} className={index === 0 ? 'py-2.5' : 'border-t border-[#dfe5e1] py-2.5'}>
          <View className="flex-row items-start gap-3">
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-xs font-bold leading-4 text-[#4e463e]">{modelName}</Text>
              <Text numberOfLines={1} className="mt-1 text-[10px] leading-4 text-[#7d7468]">调用 {requests.toLocaleString('en-US')} 次 · {formatTokenValue(totalTokens)} Token</Text>
              <Text numberOfLines={2} className="mt-0.5 text-[10px] leading-4 text-[#8a8072]">{usageBreakdown}</Text>
              {costDisplay.detail ? (
                <Text numberOfLines={2} className={costDisplay.detailTone === 'warning' ? 'mt-1 text-[10px] leading-4 text-[#a4512b]' : 'mt-1 text-[10px] leading-4 text-[#7d7468]'}>{costDisplay.detail}</Text>
              ) : null}
            </View>
            <View className="w-[78px] shrink-0 items-end">
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} className={costDisplay.detailTone === 'warning' ? 'w-full text-right text-sm font-bold text-[#a4512b]' : 'w-full text-right text-sm font-bold text-[#1d5f55]'}>{costDisplay.value}</Text>
              <Text className="mt-0.5 text-[10px] text-[#8a8072]">上游费用</Text>
            </View>
          </View>
        </View>
      );
    });
  }

  return (
    <View className="overflow-hidden rounded-[8px] border border-[#d8e5e1] bg-[#f7fbf9]">
      <View className="border-b border-[#d8e5e1] bg-[#eef7f3] px-3 py-2">
        <Text className="text-[11px] font-bold text-[#1d5f55]">今日模型调用与上游费用</Text>
      </View>
      <View className="px-3">{content}</View>
    </View>
  );
}

function AccountOperationalSummary({ metrics }: { metrics: AccountOperationalMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <View className="border-y border-[#dfe5e1] bg-[#f7f9f8] px-3 py-2.5">
      <Text className="text-[11px] font-semibold text-[#65706c]">运行限额</Text>
      <View className="mt-2 flex-row flex-wrap gap-y-2">
        {metrics.map((metric) => (
          <View key={metric.label} className="min-w-0 px-1" style={{ width: '50%' }}>
            <Text numberOfLines={1} className="text-[10px] text-[#7d7468]">{metric.label}</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              className={metric.tone === 'danger'
                ? 'mt-0.5 text-xs font-bold text-[#a4512b]'
                : metric.tone === 'warning'
                  ? 'mt-0.5 text-xs font-bold text-[#8a5a12]'
                  : 'mt-0.5 text-xs font-bold text-[#1d5f55]'}
            >
              {metric.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

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

function compareAccountsByLastUsedAt(left: AdminAccount, right: AdminAccount) {
  const leftLastUsed = getAccountLastUsedTimestamp(left);
  const rightLastUsed = getAccountLastUsedTimestamp(right);

  if (leftLastUsed === null && rightLastUsed === null) return left.id - right.id;
  if (leftLastUsed === null) return 1;
  if (rightLastUsed === null) return -1;
  if (leftLastUsed !== rightLastUsed) return rightLastUsed - leftLastUsed;

  return left.id - right.id;
}

function formatCurrency(value: number) {
  const normalizedValue = Object.is(value, -0) ? 0 : value;
  const digits = Math.abs(normalizedValue) > 0 && Math.abs(normalizedValue) < 0.01 ? 4 : 2;

  return `$${normalizedValue.toFixed(digits)}`;
}

function formatFirstTokenSeconds(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${(value / 1000).toFixed(2)}s` : '--';
}

type FirstTokenStatsState = 'loading' | 'error' | 'no_samples' | 'ready';

function getFirstTokenStatsState(
  stats: AccountTodayStats | undefined,
  isLoading: boolean,
  hasError: boolean
): FirstTokenStatsState {
  if (isLoading && !stats) return 'loading';
  if (hasError) return 'error';

  const recentFirstTokenMs = stats?.recent_first_token_ms;
  if (!Array.isArray(recentFirstTokenMs) || recentFirstTokenMs.every((value) => value === null)) return 'no_samples';
  return 'ready';
}

function formatFirstTokenMetric(value: number | null | undefined, state: FirstTokenStatsState) {
  switch (state) {
    case 'loading':
      return '读取中';
    case 'error':
      return '读取失败';
    case 'no_samples':
      return '暂无';
    default:
      return formatFirstTokenSeconds(value);
  }
}

function getUpstreamBillingRefreshErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : 'REQUEST_FAILED';

  switch (message) {
    case 'UPSTREAM_BILLING_PROBE_UNAVAILABLE':
    case 'HTTP_404':
      return '当前服务器未部署上游倍率探测。';
    case 'BASE_URL_REQUIRED':
      return '请先到设置页填写服务地址。';
    case 'ADMIN_API_KEY_REQUIRED':
      return '请先到设置页填写 Admin Token。';
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

function getAccountExpiryTimestamp(value: AdminAccount['expires_at']) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1_000;
  }
  if (typeof value !== 'string' || !value.trim()) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1_000;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getMetricTone(used: number, limit: number): AccountOperationalMetric['tone'] {
  if (limit <= 0) return 'normal';
  if (used >= limit) return 'danger';
  if (used >= limit * 0.8) return 'warning';
  return 'normal';
}

function getAccountOperationalMetrics(account: AdminAccount): AccountOperationalMetric[] {
  const metrics: AccountOperationalMetric[] = [];
  const platform = account.platform.toLowerCase();
  const type = account.type.toLowerCase();
  const isAnthropicSessionAccount = platform === 'anthropic' && (type === 'oauth' || type === 'setup-token');

  const windowCostLimit = getFiniteNonNegativeNumber(account.window_cost_limit);
  if (isAnthropicSessionAccount && windowCostLimit !== null && windowCostLimit > 0) {
    const current = getFiniteNonNegativeNumber(account.current_window_cost) ?? 0;
    const reserve = getFiniteNonNegativeNumber(account.window_cost_sticky_reserve) ?? 10;
    metrics.push({
      label: '5h 窗口费用',
      value: `${formatCurrency(current)} / ${formatCurrency(windowCostLimit)}`,
      tone: current >= windowCostLimit + reserve ? 'danger' : current >= windowCostLimit * 0.8 ? 'warning' : 'normal',
    });
  }

  const maxSessions = getFiniteNonNegativeInteger(account.max_sessions);
  if (isAnthropicSessionAccount && maxSessions !== null && maxSessions > 0) {
    const current = getFiniteNonNegativeInteger(account.active_sessions) ?? 0;
    metrics.push({ label: '活跃会话', value: `${current} / ${maxSessions}`, tone: getMetricTone(current, maxSessions) });
  }

  const baseRPM = getFiniteNonNegativeInteger(account.base_rpm);
  if (isAnthropicSessionAccount && baseRPM !== null && baseRPM > 0) {
    const current = getFiniteNonNegativeInteger(account.current_rpm) ?? 0;
    metrics.push({ label: '当前 RPM', value: `${current} / ${baseRPM}`, tone: getMetricTone(current, baseRPM) });
  }

  if (type === 'apikey' || type === 'bedrock') {
    const quotaFields: Array<{ label: string; used: unknown; limit: unknown }> = [
      { label: '今日配额', used: account.quota_daily_used, limit: account.quota_daily_limit },
      { label: '本周配额', used: account.quota_weekly_used, limit: account.quota_weekly_limit },
      { label: '累计配额', used: account.quota_used, limit: account.quota_limit },
    ];

    quotaFields.forEach((quota) => {
      const limit = getFiniteNonNegativeNumber(quota.limit);
      if (limit === null || limit <= 0) return;
      const used = getFiniteNonNegativeNumber(quota.used) ?? 0;
      metrics.push({
        label: quota.label,
        value: `${formatCurrency(used)} / ${formatCurrency(limit)}`,
        tone: getMetricTone(used, limit),
      });
    });
  }

  return metrics;
}

function getAccountError(account: AdminAccount) {
  return Boolean(account.status === 'error' || account.error_message);
}

function replaceAccountInPage(
  page: PaginatedData<AdminAccount> | undefined,
  refreshedAccount: AdminAccount
) {
  if (!page?.items.some((account) => account.id === refreshedAccount.id)) {
    return page;
  }

  return {
    ...page,
    items: page.items.map((account) =>
      account.id === refreshedAccount.id ? { ...account, ...refreshedAccount } : account
    ),
  };
}

function getAccountTestErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : '测试失败';

  switch (message) {
    case 'BASE_URL_REQUIRED':
      return '请先到设置页填写服务地址。';
    case 'ADMIN_API_KEY_REQUIRED':
      return '请先到设置页填写 Admin Token。';
    case 'TEST_STREAM_INVALID':
      return '服务器未返回可识别的测试结果。';
    case 'TEST_STREAM_INCOMPLETE':
      return '测试流在返回最终结果前结束。';
    default:
      return message;
  }
}

function getAccountRecoveryErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : '恢复失败';

  switch (message) {
    case 'BASE_URL_REQUIRED':
      return '请先到设置页填写服务地址。';
    case 'ADMIN_API_KEY_REQUIRED':
      return '请先到设置页填写 Admin Token。';
    case 'HTTP_404':
      return '当前服务器版本尚不支持统一恢复，请先升级服务端。';
    default:
      return message;
  }
}

function getAccountSchedulingErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : '调度状态更新失败';

  switch (message) {
    case 'BASE_URL_REQUIRED':
      return '请先到设置页填写服务地址。';
    case 'ADMIN_API_KEY_REQUIRED':
      return '请先到设置页填写 Admin Token。';
    default:
      return message;
  }
}

function getAccountSchedulingFeedback(account: AdminAccount, requestedSchedulable: boolean): AccountTestFeedback {
  if (typeof account.schedulable === 'boolean' && account.schedulable !== requestedSchedulable) {
    return {
      message: '服务器返回的调度状态与请求不一致，请刷新后重试。',
      tone: 'danger',
    };
  }

  if (!requestedSchedulable) {
    return { message: '服务器已确认暂停调度。', tone: 'success' };
  }

  const normalizedStatus = `${account.status ?? ''}`.toLowerCase();
  if (normalizedStatus && normalizedStatus !== 'active') {
    return {
      message: `服务器已保存开始调度开关，但账号仍处于“${account.status}”状态，请先处理账号状态。`,
      tone: 'warning',
    };
  }

  const recovery = getAccountRecoverySummary(account);
  if (recovery.recoverable) {
    return {
      message: `服务器已保存开始调度开关，但账号仍不可调度：${recovery.detail}。请先点击“恢复状态”。`,
      tone: 'warning',
    };
  }

  return { message: '服务器已确认开始调度。', tone: 'success' };
}

function getAccountVisualStatus(account: AdminAccount): AccountVisualStatus {
  const normalizedStatus = `${account.status ?? ''}`.toLowerCase();
  const isPausedStatus = ['inactive', 'disabled', 'paused', 'stop', 'stopped'].includes(normalizedStatus);
  const recovery = getAccountRecoverySummary(account);

  if (recovery.recoverable) {
    return {
      filterKey: 'error',
      label: recovery.label,
      badgeTone: recovery.severity === 'danger' ? 'danger' : 'warning',
    };
  }
  if (isPausedStatus || account.schedulable === false) {
    return { filterKey: 'paused', label: '暂停', badgeTone: 'muted' };
  }
  return { filterKey: 'active', label: '正常', badgeTone: 'success' };
}

function getAccountRuntimeDisplay(
  account: AdminAccount,
  realtime: OpsAccountConcurrencyInfo | undefined,
  useRealtime: boolean
): AccountRuntimeDisplay | null {
  const current = Math.trunc(getFiniteNonNegativeNumber(
    useRealtime ? realtime?.current_in_use : account.current_concurrency
  ) ?? 0);
  const waiting = Math.trunc(getFiniteNonNegativeNumber(useRealtime ? realtime?.waiting_in_queue : 0) ?? 0);
  if (current <= 0 && waiting <= 0) return null;

  const activeModels = useRealtime
    ? (realtime?.active_models ?? [])
      .map((model) => ({
        model: model.model.trim(),
        current: getFiniteNonNegativeInteger(model.current_in_use) ?? 0,
      }))
      .filter((model) => model.model && model.current > 0)
    : [];
  const identifiedInUse = activeModels.reduce((total, model) => total + model.current, 0);
  const reportedUnattributedInUse = useRealtime
    ? getFiniteNonNegativeInteger(realtime?.unattributed_in_use) ?? 0
    : 0;
  const unattributedInUse = Math.max(reportedUnattributedInUse, current - identifiedInUse, 0);
  const concurrencyLimit = getFiniteNonNegativeNumber(useRealtime ? realtime?.max_capacity : account.concurrency);
  const limit = concurrencyLimit === null ? null : Math.trunc(concurrencyLimit);
  const serverUtilization = getFiniteNonNegativeNumber(realtime?.load_percentage);
  const utilizationPercent = useRealtime && serverUtilization !== null
    ? Math.round(serverUtilization)
    : limit !== null && limit > 0
      ? Math.round((current / limit) * 100)
      : null;

  if (waiting > 0) {
    return { current, limit, utilizationPercent, waiting, label: '请求排队', tone: 'full', activeModels, unattributedInUse };
  }
  if (limit !== null && limit > 0 && current >= limit) {
    return { current, limit, utilizationPercent, waiting, label: '并发满载', tone: 'full', activeModels, unattributedInUse };
  }
  return { current, limit, utilizationPercent, waiting, label: '正在调用', tone: 'active', activeModels, unattributedInUse };
}

function getAccountGroupIDs(account: AdminAccount) {
  return [...new Set([...(account.group_ids ?? []), ...(account.groups?.map((group) => group.id) ?? [])])];
}

function accountBelongsToGroup(account: AdminAccount, groupId: number) {
  return getAccountGroupIDs(account).includes(groupId);
}

async function recoverAccountsInBatches(accountIds: number[]): Promise<BatchRecoveryResult> {
  const normalizedAccountIds = [...new Set(accountIds.filter((accountId) => Number.isSafeInteger(accountId) && accountId > 0))];
  const recoveredAccounts: AdminAccount[] = [];
  const failedAccountIds: number[] = [];

  for (let start = 0; start < normalizedAccountIds.length; start += ACCOUNT_RECOVERY_BATCH_SIZE) {
    const batchAccountIds = normalizedAccountIds.slice(start, start + ACCOUNT_RECOVERY_BATCH_SIZE);
    const results = await Promise.allSettled(batchAccountIds.map((accountId) => recoverAccountState(accountId)));

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        recoveredAccounts.push(result.value);
      } else {
        failedAccountIds.push(batchAccountIds[index]);
      }
    });
  }

  return { recoveredAccounts, failedAccountIds };
}

type AccountsListScreenProps = {
  safeAreaEdges?: Edge[];
  showHeader?: boolean;
};

export function AccountsListScreen({ safeAreaEdges, showHeader = true }: AccountsListScreenProps) {
  const [searchText, setSearchText] = useState('');
  const [filter, setFilter] = useState<AccountStatusFilter>('all');
  const [groupFilterId, setGroupFilterId] = useState<number | null>(null);
  const [testingAccountId, setTestingAccountId] = useState<number | null>(null);
  const [testFeedbackByAccountId, setTestFeedbackByAccountId] = useState<Record<number, AccountTestFeedback>>({});
  const [togglingAccountId, setTogglingAccountId] = useState<number | null>(null);
  const [toggleFeedbackByAccountId, setToggleFeedbackByAccountId] = useState<Record<number, AccountTestFeedback>>({});
  const [recoveringAccountId, setRecoveringAccountId] = useState<number | null>(null);
  const [recoveryFeedbackByAccountId, setRecoveryFeedbackByAccountId] = useState<Record<number, AccountTestFeedback>>({});
  const [recoveringGroupId, setRecoveringGroupId] = useState<number | null>(null);
  const [groupRecoveryNotice, setGroupRecoveryNotice] = useState<AccountTestFeedback | null>(null);
  const [upstreamBillingNow, setUpstreamBillingNow] = useState(() => Date.now());
  const [upstreamBillingRefreshFeedback, setUpstreamBillingRefreshFeedback] = useState<string | null>(null);
  const [isRefreshingUpstreamBilling, setIsRefreshingUpstreamBilling] = useState(false);
  const keyword = useDebouncedValue(searchText.trim(), 300);
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: ['accounts', keyword],
    queryFn: () => listAccounts(keyword),
  });

  const groupsQuery = useQuery({
    queryKey: ['groups', 'all'],
    queryFn: listAllGroups,
    staleTime: 60_000,
  });
  const opsConcurrencyQuery = useQuery({
    queryKey: ['ops-concurrency'],
    queryFn: getOpsConcurrencyStats,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  });
  const toggleMutation = useMutation({
    mutationFn: ({ accountId, schedulable }: { accountId: number; schedulable: boolean }) =>
      setAccountSchedulable(accountId, schedulable),
    onSuccess: async (updatedAccount, variables) => {
      queryClient.setQueriesData<PaginatedData<AdminAccount>>(
        { queryKey: ['accounts'] },
        (current) => replaceAccountInPage(current, updatedAccount)
      );
      queryClient.setQueriesData<PaginatedData<AdminAccount>>(
        { queryKey: ['monitor-accounts'] },
        (current) => replaceAccountInPage(current, updatedAccount)
      );
      setToggleFeedbackByAccountId((current) => ({
        ...current,
        [variables.accountId]: getAccountSchedulingFeedback(updatedAccount, variables.schedulable),
      }));

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['monitor-accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['monitor-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-concurrency'] }),
      ]);
    },
    onError: (error, variables) => {
      setToggleFeedbackByAccountId((current) => ({
        ...current,
        [variables.accountId]: { message: getAccountSchedulingErrorMessage(error), tone: 'danger' },
      }));
    },
  });

  const testMutation = useMutation({
    mutationFn: (accountId: number) => testAccount(accountId),
  });
  const recoveryMutation = useMutation({
    mutationFn: (accountId: number) => recoverAccountState(accountId),
  });
  const groupRecoveryMutation = useMutation({
    mutationFn: (accountIds: number[]) => recoverAccountsInBatches(accountIds),
  });

  const items = accountsQuery.data?.items ?? [];
  const accountIds = useMemo(() => items.map((account) => account.id).sort((left, right) => left - right), [items]);
  const todayStatsQuery = useQuery({
    queryKey: ['account-today-stats', accountIds],
    queryFn: () => getAccountTodayStatsBatchWithUsageFallback(accountIds),
    enabled: accountIds.length > 0,
    staleTime: 60_000,
  });
  const cacheHitRateQuery = useQuery({
    queryKey: ['account-today-cache-hit-rates', accountIds],
    queryFn: () => getAccountTodayCacheHitRateBatch(accountIds),
    enabled: accountIds.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  const upstreamBillingCosts24hQuery = useQuery({
    queryKey: ['account-upstream-billing-costs-24h', accountIds],
    queryFn: () => getAccountUpstreamBillingCosts24h(accountIds),
    enabled: accountIds.length > 0,
    staleTime: 60_000,
  });

  const todayByAccountId = useMemo(() => {
    const next = new Map<number, number>();
    items.forEach((account) => {
      const result = todayStatsQuery.data?.stats[`${account.id}`];
      if (typeof result?.tokens === 'number' && Number.isFinite(result.tokens) && result.tokens >= 0) {
        next.set(account.id, result.tokens);
      }
    });
    return next;
  }, [items, todayStatsQuery.data]);

  const groupFilterOptions = useMemo(() => {
    const groups = new Map<number, AccountGroupFilterOption>();

    groupsQuery.data?.items.forEach((group) => {
      groups.set(group.id, { id: group.id, name: group.name, accountCount: 0 });
    });

    items.forEach((account) => {
      const accountGroupsById = new Map(account.groups?.map((group) => [group.id, group]));

      getAccountGroupIDs(account).forEach((groupId) => {
        const current = groups.get(groupId);
        groups.set(groupId, {
          id: groupId,
          name: current?.name || accountGroupsById.get(groupId)?.name || `分组 #${groupId}`,
          accountCount: (current?.accountCount ?? 0) + 1,
        });
      });
    });

    return [...groups.values()].sort((left, right) => {
      const leftActive = getGroupActivityLabel(opsConcurrencyQuery.data?.group?.[`${left.id}`]) ? 1 : 0;
      const rightActive = getGroupActivityLabel(opsConcurrencyQuery.data?.group?.[`${right.id}`]) ? 1 : 0;
      return rightActive - leftActive || left.name.localeCompare(right.name, 'zh-CN') || left.id - right.id;
    });
  }, [groupsQuery.data?.items, items, opsConcurrencyQuery.data?.group]);
  const groupNameById = useMemo(
    () => new Map(groupFilterOptions.map((group) => [group.id, group.name])),
    [groupFilterOptions]
  );
  const recoverableGroupOptions = useMemo(() => {
    const groups = new Map<number, RecoverableAccountGroupOption>();

    items.forEach((account) => {
      if (!getAccountRecoverySummary(account).recoverable) return;

      getAccountGroupIDs(account).forEach((groupId) => {
        const current = groups.get(groupId);
        groups.set(groupId, {
          id: groupId,
          name: current?.name || groupNameById.get(groupId) || account.groups?.find((group) => group.id === groupId)?.name || `分组 #${groupId}`,
          accountCount: (current?.accountCount ?? 0) + 1,
          accountIds: [...(current?.accountIds ?? []), account.id],
        });
      });
    });

    return [...groups.values()].sort((left, right) => (
      right.accountCount - left.accountCount || left.name.localeCompare(right.name, 'zh-CN') || left.id - right.id
    ));
  }, [groupNameById, items]);

  useEffect(() => {
    if (groupsQuery.isSuccess && groupFilterId !== null && !groupFilterOptions.some((group) => group.id === groupFilterId)) {
      setGroupFilterId(null);
    }
  }, [groupFilterId, groupFilterOptions, groupsQuery.isSuccess]);

  const filteredItems = useMemo(() => {
    const statusMatched = items.filter((account) => {
      const visualStatus = getAccountVisualStatus(account);
      if (filter === 'all') return true;
      if (filter === 'active') return visualStatus.filterKey === 'active';
      if (filter === 'paused') return visualStatus.filterKey === 'paused';
      if (filter === 'error') return visualStatus.filterKey === 'error';
      return true;
    });

    const groupMatched = groupFilterId === null
      ? statusMatched
      : statusMatched.filter((account) => accountBelongsToGroup(account, groupFilterId));

    return [...groupMatched].sort(compareAccountsByLastUsedAt);
  }, [filter, groupFilterId, items]);
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
  const handleRecoverGroup = useCallback((group: RecoverableAccountGroupOption) => {
    if (groupRecoveryMutation.isPending) return;

    setRecoveringGroupId(group.id);
    setGroupRecoveryNotice(null);
    groupRecoveryMutation.mutate(group.accountIds, {
      onSuccess: async ({ recoveredAccounts, failedAccountIds }) => {
        recoveredAccounts.forEach((refreshedAccount) => {
          queryClient.setQueriesData<PaginatedData<AdminAccount>>(
            { queryKey: ['accounts'] },
            (current) => replaceAccountInPage(current, refreshedAccount)
          );
          queryClient.setQueriesData<PaginatedData<AdminAccount>>(
            { queryKey: ['monitor-accounts'] },
            (current) => replaceAccountInPage(current, refreshedAccount)
          );
        });

        const recoveredCount = recoveredAccounts.length;
        const failedCount = failedAccountIds.length;
        setGroupRecoveryNotice({
          message: failedCount === 0
            ? `${group.name} 已恢复 ${recoveredCount} 个异常账号。`
            : recoveredCount > 0
              ? `${group.name} 已恢复 ${recoveredCount} 个，${failedCount} 个恢复失败，请检查仍显示的异常账号。`
              : `${group.name} 的 ${failedCount} 个异常账号均未恢复，请检查服务端返回的错误。`,
          tone: failedCount === 0 ? 'success' : recoveredCount > 0 ? 'warning' : 'danger',
        });

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['accounts'] }),
          queryClient.invalidateQueries({ queryKey: ['monitor-accounts'] }),
          queryClient.invalidateQueries({ queryKey: ['monitor-stats'] }),
          queryClient.invalidateQueries({ queryKey: ['ops-concurrency'] }),
          queryClient.invalidateQueries({ queryKey: ['account-today-stats'] }),
          queryClient.invalidateQueries({ queryKey: ['account-today-cache-hit-rates'] }),
          queryClient.invalidateQueries({ queryKey: ['account-upstream-billing-costs-24h'] }),
        ]);
      },
      onError: (error) => {
        setGroupRecoveryNotice({ message: `${group.name}：${getAccountRecoveryErrorMessage(error)}`, tone: 'danger' });
      },
      onSettled: () => {
        setRecoveringGroupId((current) => current === group.id ? null : current);
      },
    });
  }, [groupRecoveryMutation, queryClient]);

  const listHeader = useMemo(
    () => (
      <View className="pb-3">
        <View className="rounded-[8px] border border-[#dfe5e1] bg-white p-3">
          <View className="h-12 flex-row items-center rounded-[8px] bg-[#eef1ef] px-3.5">
            <Search color="#7d7468" size={18} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="搜索账号名称 / 平台"
              placeholderTextColor="#9b9081"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              className="ml-2.5 flex-1 py-0 text-[15px] text-[#16181a]"
            />
            {searchText ? (
              <Pressable
                accessibilityLabel="清空账号搜索"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setSearchText('')}
                className="ml-2 h-8 w-8 items-center justify-center rounded-full"
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
              >
                <X color="#7d7468" size={17} />
              </Pressable>
            ) : null}
          </View>

          <View className="mt-3 flex-row gap-1 rounded-[8px] bg-[#eef1ef] p-1">
            {([
              ['all', '全部', summary.total],
              ['active', '正常', summary.active],
              ['paused', '暂停', summary.paused],
              ['error', '待处理', summary.errors],
            ] as const).map(([key, label, count]) => (
              <StatusFilterSegment
                key={key}
                label={label}
                count={count}
                selected={filter === key}
                onPress={() => setFilter(key)}
              />
            ))}
          </View>

          {groupFilterOptions.length > 0 ? (
            <View className="mt-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-1.5">
                  <Layers3 color="#7d7468" size={14} />
                  <Text className="text-xs font-semibold text-[#5d564d]">账号分组</Text>
                </View>
                <Text className="text-[11px] text-[#8a8072]">显示 {filteredItems.length} 个</Text>
              </View>
              <View className="mt-2 flex-row flex-wrap gap-2">
                <GroupFilterChip
                  label="全部分组"
                  count={summary.total}
                  selected={groupFilterId === null}
                  accessibilityLabel="显示全部分组账号"
                  onPress={() => setGroupFilterId(null)}
                />
                {groupFilterOptions.map((group) => (
                  <GroupFilterChip
                    key={group.id}
                    label={group.name}
                    count={group.accountCount}
                    activityLabel={opsConcurrencyQuery.data?.enabled === true
                      ? getGroupActivityLabel(opsConcurrencyQuery.data.group?.[`${group.id}`])
                      : undefined}
                    selected={groupFilterId === group.id}
                    accessibilityLabel={`筛选分组 ${group.name}`}
                    onPress={() => setGroupFilterId(group.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {recoverableGroupOptions.length > 0 || groupRecoveryNotice ? (
            <View className="mt-4 border-t border-[#eee6d7] pt-3">
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-row min-w-0 flex-1 items-center gap-1.5">
                  <TriangleAlert color="#a4512b" size={15} />
                  <Text className="text-xs font-semibold text-[#5d564d]">异常分组</Text>
                </View>
                {recoverableGroupOptions.length > 0 ? (
                  <Text className="text-[11px] text-[#8a8072]">{recoverableGroupOptions.length} 个分组</Text>
                ) : null}
              </View>

              {recoverableGroupOptions.map((group, index) => {
                const isRecoveringGroup = recoveringGroupId === group.id && groupRecoveryMutation.isPending;

                return (
                  <View
                    key={group.id}
                    className={index === 0 ? 'mt-2 flex-row items-center gap-3 py-2.5' : 'flex-row items-center gap-3 border-t border-[#eee6d7] py-2.5'}
                  >
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-xs font-semibold text-[#4e463e]">{group.name}</Text>
                      <Text className="mt-0.5 text-[11px] text-[#8a8072]">{group.accountCount} 个账号需要恢复</Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`一键恢复分组 ${group.name} 的 ${group.accountCount} 个异常账号`}
                      accessibilityRole="button"
                      disabled={groupRecoveryMutation.isPending}
                      onPress={() => handleRecoverGroup(group)}
                      className="min-h-9 flex-row items-center justify-center gap-1.5 rounded-[8px] bg-[#1d5f55] px-3"
                      style={({ pressed }) => ({ opacity: groupRecoveryMutation.isPending ? 0.58 : pressed ? 0.78 : 1 })}
                    >
                      {isRecoveringGroup ? <ActivityIndicator color="#ffffff" size="small" /> : <RotateCcw color="#ffffff" size={14} />}
                      <Text className="text-xs font-semibold text-white">{isRecoveringGroup ? '正在恢复' : '一键恢复'}</Text>
                    </Pressable>
                  </View>
                );
              })}

              {groupRecoveryNotice ? (
                <Text className={groupRecoveryNotice.tone === 'success'
                  ? 'mt-2 text-xs leading-5 text-[#1d5f55]'
                  : groupRecoveryNotice.tone === 'warning'
                    ? 'mt-2 text-xs leading-5 text-[#8a5a12]'
                    : 'mt-2 text-xs leading-5 text-[#a4512b]'}
                >
                  恢复结果：{groupRecoveryNotice.message}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View className="mt-4 border-t border-[#eee6d7] pt-3">
            <View className="flex-row items-center gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-[11px] font-medium text-[#6f665c]">北京时间今日 00:00 起</Text>
                <Text className="mt-0.5 text-[11px] text-[#9a9082]">最近调用优先，未调用账号置底</Text>
              </View>
              {eligibleUpstreamBillingAccounts.length > 0 ? (
                <Pressable
                  accessibilityLabel="刷新当前筛选账号的上游倍率"
                  accessibilityRole="button"
                  disabled={isRefreshingUpstreamBilling}
                  onPress={() => void refreshUpstreamBilling()}
                  className="min-h-10 flex-row items-center justify-center gap-1.5 rounded-[8px] bg-[#1f6759] px-3"
                  style={({ pressed }) => ({ opacity: isRefreshingUpstreamBilling ? 0.6 : pressed ? 0.78 : 1 })}
                >
                  {isRefreshingUpstreamBilling ? <ActivityIndicator color="#ffffff" size="small" /> : <RefreshCw color="#ffffff" size={14} />}
                  <Text className="text-xs font-semibold text-white">{isRefreshingUpstreamBilling ? '刷新中' : '刷新倍率'}</Text>
                </Pressable>
              ) : null}
            </View>
            {upstreamBillingRefreshFeedback ? <Text className="mt-2 text-xs leading-5 text-[#7d7468]">{upstreamBillingRefreshFeedback}</Text> : null}
          </View>
        </View>
      </View>
    ),
    [
      eligibleUpstreamBillingAccounts.length,
      filter,
      filteredItems.length,
      groupFilterId,
      groupFilterOptions,
      groupRecoveryMutation.isPending,
      groupRecoveryNotice,
      handleRecoverGroup,
      isRefreshingUpstreamBilling,
      opsConcurrencyQuery.data,
      recoverableGroupOptions,
      recoveringGroupId,
      refreshUpstreamBilling,
      searchText,
      summary.active,
      summary.errors,
      summary.paused,
      summary.total,
      upstreamBillingRefreshFeedback,
    ]
  );

  const renderItem = useCallback(
    ({ item: account }: { item: (typeof filteredItems)[number] }) => {
      const visualStatus = getAccountVisualStatus(account);
      const statusText = visualStatus.label;
      const recovery = getAccountRecoverySummary(account, upstreamBillingNow);
      const todayTokens = todayByAccountId.get(account.id);
      const todayStats = todayStatsQuery.data?.stats[`${account.id}`];
      const firstTokenStatsState = getFirstTokenStatsState(
        todayStats,
        todayStatsQuery.isLoading,
        Boolean(todayStatsQuery.error || todayStatsQuery.data?.first_token_stats_error)
      );
      const isSchedulable = account.schedulable !== false;
      const nextSchedulable = !isSchedulable;
      const toggleLabel = isSchedulable ? '暂停' : '开始';
      const testFeedback = testFeedbackByAccountId[account.id];
      const toggleFeedback = toggleFeedbackByAccountId[account.id];
      const recoveryFeedback = recoveryFeedbackByAccountId[account.id];
      const isTogglingCurrent = togglingAccountId === account.id && toggleMutation.isPending;
      const isTestingCurrent = testingAccountId === account.id && testMutation.isPending;
      const isRecoveringCurrent = (recoveringAccountId === account.id && recoveryMutation.isPending) || groupRecoveryMutation.isPending;
      const upstreamBillingRate = getUpstreamBillingRateDisplay(account, upstreamBillingNow);
      const upstreamBillingCost = upstreamBillingCosts24hQuery.data?.costs[`${account.id}`];
      const upstreamBillingCostDisplay = getUpstreamBillingCostDisplay(upstreamBillingCost, upstreamBillingCosts24hQuery.error);
      const cacheHitRate = cacheHitRateQuery.data?.[`${account.id}`];
      const runtime = getAccountRuntimeDisplay(
        account,
        opsConcurrencyQuery.data?.account?.[`${account.id}`],
        opsConcurrencyQuery.data?.enabled === true
      );
      const operationalMetrics = getAccountOperationalMetrics(account);
      const priority = getFiniteNonNegativeInteger(account.priority);
      const expiryTimestamp = getAccountExpiryTimestamp(account.expires_at);
      const expiryText = expiryTimestamp === null ? null : formatTime(new Date(expiryTimestamp).toISOString());
      const isExpired = expiryTimestamp !== null && expiryTimestamp <= Date.now();
      const notes = account.notes?.trim();
      const groupNames = getAccountGroupIDs(account).map(
        (groupId) => account.groups?.find((group) => group.id === groupId)?.name || groupNameById.get(groupId) || `#${groupId}`
      );
      const groupsText = groupNames.length > 0 ? groupNames.join(' · ') : null;
      const upstreamNotices = [upstreamBillingRate.detail, upstreamBillingCostDisplay.detail].filter(
        (notice, index, notices): notice is string => Boolean(notice) && notices.indexOf(notice) === index
      );

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
              <View className="gap-2">
                <View className="flex-row items-start gap-2">
                  <Clock3 color="#8a8072" size={14} />
                  <Text className="min-w-0 flex-1 text-xs leading-4 text-[#7d7468]">
                    <Text className="font-semibold text-[#5d564d]">最近调用</Text> {formatTime(account.last_used_at)}
                  </Text>
                </View>
                {groupsText ? (
                  <View className="flex-row items-start gap-2">
                    <Layers3 color="#8a8072" size={14} />
                    <Text className="min-w-0 flex-1 text-xs leading-4 text-[#7d7468]">
                      <Text className="font-semibold text-[#5d564d]">所属分组</Text> {groupsText}
                    </Text>
                  </View>
                ) : null}
                {expiryText ? (
                  <View className="flex-row items-start gap-2">
                    <CalendarClock color={isExpired ? '#b6472e' : '#8a8072'} size={14} />
                    <Text className={isExpired ? 'min-w-0 flex-1 text-xs leading-4 text-[#a4512b]' : 'min-w-0 flex-1 text-xs leading-4 text-[#7d7468]'}>
                      <Text className={isExpired ? 'font-semibold text-[#a4512b]' : 'font-semibold text-[#5d564d]'}>
                        {isExpired ? '已到期' : '账号到期'}
                      </Text>{' '}{expiryText} · {account.auto_pause_on_expired === false ? '到期后不自动暂停' : '到期自动暂停'}
                    </Text>
                  </View>
                ) : null}
                {notes ? (
                  <View className="flex-row items-start gap-2">
                    <StickyNote color="#8a8072" size={14} />
                    <Text numberOfLines={2} className="min-w-0 flex-1 text-xs leading-4 text-[#7d7468]">
                      <Text className="font-semibold text-[#5d564d]">备注</Text> {notes}
                    </Text>
                  </View>
                ) : null}
              </View>

              {runtime ? <AccountRuntimeSummary runtime={runtime} priority={priority} /> : null}

              <View className="flex-row overflow-hidden rounded-[8px] border border-[#d8e5e1] bg-[#f3f8f6]">
                <View className="min-h-[64px] flex-1 justify-center px-2.5 py-2.5">
                  <Text numberOfLines={1} className="text-[11px] text-[#55756e]">上游倍率</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} className={upstreamBillingRate.detailTone === 'warning' ? 'mt-1 text-base font-bold text-[#a4512b]' : 'mt-1 text-base font-bold text-[#1d5f55]'}>
                    {upstreamBillingRate.value}
                  </Text>
                </View>
                <View className="min-h-[64px] flex-1 justify-center border-l border-[#d8e5e1] px-2.5 py-2.5">
                  <Text numberOfLines={1} className="text-[11px] text-[#55756e]">今日费用</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} className={upstreamBillingCostDisplay.detailTone === 'warning' ? 'mt-1 text-base font-bold text-[#a4512b]' : 'mt-1 text-base font-bold text-[#16181a]'}>
                    {upstreamBillingCostDisplay.value}
                  </Text>
                </View>
                <View className="min-h-[64px] flex-1 justify-center border-l border-[#d8e5e1] px-2.5 py-2.5">
                  <Text numberOfLines={1} className="text-[11px] text-[#55756e]">今日 Token</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} className="mt-1 text-base font-bold text-[#16181a]">
                    {todayTokens === undefined ? '--' : formatTokenValue(todayTokens)}
                  </Text>
                </View>
                <View className="min-h-[64px] flex-1 justify-center border-l border-[#d8e5e1] px-2.5 py-2.5">
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} className="text-[11px] text-[#55756e]">今日缓存命中率</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} className={cacheHitRateQuery.error ? 'mt-1 text-base font-bold text-[#a4512b]' : 'mt-1 text-base font-bold text-[#1d5f55]'}>
                    {formatCacheHitRate(cacheHitRate, cacheHitRateQuery.isLoading, Boolean(cacheHitRateQuery.error))}
                  </Text>
                </View>
              </View>

              <View className="gap-1.5">
                <Text className="text-[11px] font-semibold text-[#55756e]">首字延迟 · 最近 3 次</Text>
                <View className="flex-row overflow-hidden rounded-[8px] border border-[#d8e5e1] bg-[#f7f9f8]">
                  <View className="min-h-[56px] flex-1 justify-center px-2.5 py-2">
                    <Text numberOfLines={1} className="text-[10px] text-[#55756e]">最近</Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} className="mt-1 text-sm font-bold text-[#1d5f55]">
                      {formatFirstTokenMetric(todayStats?.recent_first_token_ms?.[0], firstTokenStatsState)}
                    </Text>
                  </View>
                  <View className="min-h-[56px] flex-1 justify-center border-l border-[#d8e5e1] px-2.5 py-2">
                    <Text numberOfLines={1} className="text-[10px] text-[#55756e]">上次</Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} className="mt-1 text-sm font-bold text-[#16181a]">
                      {formatFirstTokenMetric(todayStats?.recent_first_token_ms?.[1], firstTokenStatsState)}
                    </Text>
                  </View>
                  <View className="min-h-[56px] flex-1 justify-center border-l border-[#d8e5e1] px-2.5 py-2">
                    <Text numberOfLines={1} className="text-[10px] text-[#55756e]">再上次</Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} className="mt-1 text-sm font-bold text-[#16181a]">
                      {formatFirstTokenMetric(todayStats?.recent_first_token_ms?.[2], firstTokenStatsState)}
                    </Text>
                  </View>
                </View>
              </View>
              {firstTokenStatsState === 'no_samples' ? (
                <Text className="text-[10px] leading-4 text-[#7d7468]">今日暂无可识别的首字延迟。</Text>
              ) : firstTokenStatsState === 'error' ? (
                <Text className="text-[10px] leading-4 text-[#a4512b]">首字延迟读取失败，请检查服务器连接。</Text>
              ) : null}

              <AccountModelUsageSummary
                estimate={upstreamBillingCost}
                loading={upstreamBillingCosts24hQuery.isLoading}
                error={upstreamBillingCosts24hQuery.error}
              />

              <AccountOperationalSummary metrics={operationalMetrics} />

              {upstreamNotices.length > 0 ? (
                <Text className="text-xs text-[#a4512b]">{upstreamNotices.join('；')}</Text>
              ) : null}
              {account.error_message ? <Text className="text-xs text-[#a4512b]">异常信息：{account.error_message}</Text> : null}

              {recovery.recoverable ? (
                <View className={recovery.severity === 'danger'
                  ? 'border-l-2 border-[#b6472e] bg-[#fff4f0] px-3 py-3'
                  : 'border-l-2 border-[#c38a24] bg-[#fff9e8] px-3 py-3'}
                >
                  <View className="flex-row items-start gap-2.5">
                    <TriangleAlert color={recovery.severity === 'danger' ? '#b6472e' : '#9b6b16'} size={17} />
                    <View className="min-w-0 flex-1">
                      <Text className={recovery.severity === 'danger'
                        ? 'text-xs font-bold text-[#9f3f29]'
                        : 'text-xs font-bold text-[#7b5515]'}
                      >
                        {recovery.reasons.length > 1 ? `${recovery.reasons.length} 项状态需要处理` : recovery.label}
                      </Text>
                      <Text className="mt-1 text-xs leading-5 text-[#6f665c]">{recovery.detail}</Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityLabel={`恢复账号 ${account.name} 的运行状态`}
                    accessibilityRole="button"
                    disabled={isRecoveringCurrent}
                    onPress={(event) => {
                      event.stopPropagation();
                      setRecoveringAccountId(account.id);
                      setRecoveryFeedbackByAccountId((current) => {
                        if (!current[account.id]) return current;
                        const next = { ...current };
                        delete next[account.id];
                        return next;
                      });
                      recoveryMutation.mutate(account.id, {
                        onSuccess: async (refreshedAccount) => {
                          queryClient.setQueriesData<PaginatedData<AdminAccount>>(
                            { queryKey: ['accounts'] },
                            (current) => replaceAccountInPage(current, refreshedAccount)
                          );
                          queryClient.setQueriesData<PaginatedData<AdminAccount>>(
                            { queryKey: ['monitor-accounts'] },
                            (current) => replaceAccountInPage(current, refreshedAccount)
                          );
                          setRecoveryFeedbackByAccountId((current) => ({
                            ...current,
                            [account.id]: { message: '可恢复状态已清理，账号状态已从服务器同步。', tone: 'success' },
                          }));
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ['accounts'] }),
                            queryClient.invalidateQueries({ queryKey: ['monitor-accounts'] }),
                            queryClient.invalidateQueries({ queryKey: ['monitor-stats'] }),
                          ]);
                        },
                        onError: (error) => {
                          setRecoveryFeedbackByAccountId((current) => ({
                            ...current,
                            [account.id]: { message: getAccountRecoveryErrorMessage(error), tone: 'danger' },
                          }));
                        },
                        onSettled: () => {
                          setRecoveringAccountId((current) => (current === account.id ? null : current));
                        },
                      });
                    }}
                    className="mt-3 min-h-10 flex-row items-center justify-center gap-2 rounded-[8px] bg-[#1d5f55] px-3"
                    style={({ pressed }) => ({ opacity: isRecoveringCurrent ? 0.58 : pressed ? 0.78 : 1 })}
                  >
                    {isRecoveringCurrent
                      ? <ActivityIndicator color="#ffffff" size="small" />
                      : <RotateCcw color="#ffffff" size={15} />}
                    <Text className="text-xs font-semibold text-white">{isRecoveringCurrent ? '正在恢复' : '恢复状态'}</Text>
                  </Pressable>
                </View>
              ) : null}

              <View className="flex-row gap-2">
                <Pressable
                  accessibilityLabel={`测试账号 ${account.name}`}
                  accessibilityRole="button"
                  className="min-h-10 flex-1 flex-row items-center justify-center gap-2 rounded-[8px] bg-[#1b1d1f] px-3"
                  disabled={isTestingCurrent}
                  style={({ pressed }) => ({ opacity: isTestingCurrent ? 0.58 : pressed ? 0.78 : 1 })}
                  onPress={(event) => {
                    event.stopPropagation();
                    setTestingAccountId(account.id);
                    setTestFeedbackByAccountId((current) => {
                      if (!current[account.id]) return current;
                      const next = { ...current };
                      delete next[account.id];
                      return next;
                    });
                    testMutation.mutate(account.id, {
                      onSuccess: async (result) => {
                        try {
                          const refreshedAccount = await getAccount(account.id);
                          queryClient.setQueriesData<PaginatedData<AdminAccount>>(
                            { queryKey: ['accounts'] },
                            (current) => replaceAccountInPage(current, refreshedAccount)
                          );

                          const stillErrored = getAccountError(refreshedAccount);
                          setTestFeedbackByAccountId((current) => ({
                            ...current,
                            [account.id]: {
                              message: stillErrored
                                ? `${result.message}；连接正常，但服务端仍标记异常，请查看上方最新异常信息`
                                : `${result.message}；账号状态已同步`,
                              tone: stillErrored ? 'warning' : 'success',
                            },
                          }));
                        } catch {
                          await queryClient.invalidateQueries({ queryKey: ['accounts'] });
                          setTestFeedbackByAccountId((current) => ({
                            ...current,
                            [account.id]: {
                              message: `${result.message}；账号状态同步结果暂未确认，请刷新列表后检查`,
                              tone: 'warning',
                            },
                          }));
                        }
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
                  {isTestingCurrent ? <ActivityIndicator color="#f6f1e8" size="small" /> : <Activity color="#f6f1e8" size={15} />}
                  <Text className="text-xs font-semibold text-[#f6f1e8]">{isTestingCurrent ? '测试中' : '测试连接'}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`${toggleLabel}调度账号 ${account.name}`}
                  accessibilityRole="button"
                  className="min-h-10 flex-1 flex-row items-center justify-center gap-2 rounded-[8px] bg-[#e9edeb] px-3"
                  disabled={isTogglingCurrent}
                  style={({ pressed }) => ({ opacity: isTogglingCurrent ? 0.58 : pressed ? 0.78 : 1 })}
                  onPress={(event) => {
                    event.stopPropagation();
                    setTogglingAccountId(account.id);
                    setToggleFeedbackByAccountId((current) => {
                      if (!current[account.id]) return current;
                      const next = { ...current };
                      delete next[account.id];
                      return next;
                    });
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
                  {isTogglingCurrent
                    ? <ActivityIndicator color="#4e463e" size="small" />
                    : nextSchedulable
                      ? <Play color="#4e463e" size={15} />
                      : <Pause color="#4e463e" size={15} />}
                  <Text className="text-xs font-semibold text-[#4e463e]">{isTogglingCurrent ? '处理中' : `${toggleLabel}调度`}</Text>
                </Pressable>
              </View>

              {testFeedback ? (
                <Text
                  className={testFeedback.tone === 'success'
                    ? 'text-xs text-[#1d5f55]'
                    : testFeedback.tone === 'warning'
                      ? 'text-xs text-[#8a5a12]'
                      : 'text-xs text-[#a4512b]'}
                >
                  测试结果：{testFeedback.message}
                </Text>
              ) : null}
              {recoveryFeedback ? (
                <Text className={recoveryFeedback.tone === 'success' ? 'text-xs text-[#1d5f55]' : 'text-xs text-[#a4512b]'}>
                  恢复结果：{recoveryFeedback.message}
                </Text>
              ) : null}
              {toggleFeedback ? (
                <Text className={toggleFeedback.tone === 'success' ? 'text-xs text-[#1d5f55]' : toggleFeedback.tone === 'warning' ? 'text-xs text-[#8a5a12]' : 'text-xs text-[#a4512b]'}>
                  调度结果：{toggleFeedback.message}
                </Text>
              ) : null}
            </View>
          </ListCard>
        </View>
      );
    },
    [cacheHitRateQuery.data, cacheHitRateQuery.error, cacheHitRateQuery.isLoading, groupNameById, groupRecoveryMutation.isPending, opsConcurrencyQuery.data, queryClient, recoveringAccountId, recoveryFeedbackByAccountId, recoveryMutation, testFeedbackByAccountId, testMutation, testingAccountId, todayByAccountId, todayStatsQuery.data, toggleFeedbackByAccountId, toggleMutation, togglingAccountId, upstreamBillingCosts24hQuery.data, upstreamBillingCosts24hQuery.error, upstreamBillingNow]
  );

  const emptyState = useMemo(
    () => (
      <ListCard
        title="暂无账号"
        meta={errorMessage || (filter !== 'all' || groupFilterId !== null ? '当前筛选条件下没有匹配账号。' : '连上后这里会展示账号列表。')}
        icon={KeyRound}
      />
    ),
    [errorMessage, filter, groupFilterId]
  );

  return (
    <ScreenShell
      title="账号清单"
      subtitle="账号状态、今日用量与上游倍率"
      variant="minimal"
      showHeader={showHeader}
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
            refreshing={accountsQuery.isRefetching || groupsQuery.isRefetching || opsConcurrencyQuery.isRefetching || todayStatsQuery.isRefetching || cacheHitRateQuery.isRefetching || upstreamBillingCosts24hQuery.isRefetching}
            onRefresh={() => {
              setUpstreamBillingNow(Date.now());
              void accountsQuery.refetch();
              void groupsQuery.refetch();
              void opsConcurrencyQuery.refetch();
              void todayStatsQuery.refetch();
              void cacheHitRateQuery.refetch();
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
