import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  Activity,
  ChevronRight,
  Layers3,
  RefreshCw,
  RotateCcw,
  Server,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAccountRecoverySummary } from '@/src/lib/account-recovery';
import { formatCacheHitRate, formatTokenValue } from '@/src/lib/formatters';
import { getUpstreamBillingCostDisplay, getUpstreamBillingRateDisplay } from '@/src/lib/upstream-billing';
import {
  getAccountTodayCacheHitRateBatch,
  getAccountTodayStatsBatchWithUsageFallback,
  getAccountUpstreamBillingCosts24h,
  getAdminSettings,
  getDashboardStats,
  getOpsConcurrencyStats,
  getServerIdentity,
  listAccounts,
  listAllGroups,
  recoverAccountState,
} from '@/src/services/admin';
import { adminConfigState, hasAuthenticatedAdminSession, type AdminAccountProfile } from '@/src/store/admin-config';
import { radius, shadow } from '@/src/theme';
import type {
  AccountTodayStats,
  AdminAccount,
  AdminGroup,
  OpsAccountConcurrencyInfo,
  PaginatedData,
  ServerIdentity,
  UpstreamBillingCostEstimate,
  UpstreamBillingCostModelEstimate,
} from '@/src/types/admin';

const { useSnapshot } = require('valtio/react');

const colors = {
  page: '#ffffff',
  card: '#ffffff',
  mutedCard: '#f2f3f3',
  primary: '#111315',
  text: '#111315',
  subtext: '#5f6468',
  border: '#e8e9e9',
  warning: '#5f6468',
  dangerBg: '#fdecea',
  danger: '#d92d20',
};

type RecoveryNotice = {
  message: string;
  tone: 'success' | 'danger';
};

type UpstreamCostRankingItem = {
  account: AdminAccount;
  groupIds: number[];
  estimate?: UpstreamBillingCostEstimate;
  estimatedCost: number | null;
  todayRequestCount: number | null;
  tokenRequestCount: number | null;
  nonTokenRequestCount: number | null;
};

type UpstreamCostGroupFilterOption = {
  id: number;
  name: string;
  accountCount: number;
  estimatedCost: number;
};

type UpstreamCostRateSegment = {
  rateMultiplier: number;
  estimatedCost: number;
  tokenRequestCount: number | null;
};

type UpstreamModelUsageSummaryItem = {
  model: string;
  accountCount: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number | null;
  hasPartialCost: boolean;
};

function getFiniteNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isAccountPaused(account: AdminAccount) {
  const normalizedStatus = `${account.status ?? ''}`.toLowerCase();
  return account.schedulable === false || ['inactive', 'disabled', 'paused', 'stop', 'stopped'].includes(normalizedStatus);
}

function isExcludedFromUpstreamBilling(account: AdminAccount) {
  const accountIdentity = `${account.name} ${account.platform}`.toLowerCase().replace(/[\s_-]+/g, '');
  return accountIdentity.includes('shitrouter');
}

function formatNumber(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatMoney(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const normalizedValue = Object.is(value, -0) ? 0 : value;
  const digits = Math.abs(normalizedValue) > 0 && Math.abs(normalizedValue) < 0.01 ? 4 : 2;
  return `$${normalizedValue.toFixed(digits)}`;
}

function formatRate(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '--';
  return `${Number(value.toPrecision(6))}x`;
}

function formatFirstTokenMetric(value: number | null | undefined, isLoading: boolean, hasError: boolean, hasStats: boolean) {
  if (isLoading && !hasStats) return '读取中';
  if (hasError) return '读取失败';
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '暂无';
  return `${(value / 1_000).toFixed(2)}s`;
}

function RecentFirstTokenMetrics({
  stats,
  isLoading,
  hasError,
}: {
  stats?: AccountTodayStats;
  isLoading: boolean;
  hasError: boolean;
}) {
  return (
    <View style={{ marginTop: 5 }}>
      <Text style={{ fontSize: 10, fontWeight: '600', color: colors.subtext }}>首字延迟 · 最近 3 次</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={{ marginTop: 2, fontSize: 11, lineHeight: 16, color: hasError ? colors.warning : colors.subtext }}>
        最近 {formatFirstTokenMetric(stats?.recent_first_token_ms?.[0], isLoading, hasError, Boolean(stats))}
        {' · '}上次 {formatFirstTokenMetric(stats?.recent_first_token_ms?.[1], isLoading, hasError, Boolean(stats))}
        {' · '}再上次 {formatFirstTokenMetric(stats?.recent_first_token_ms?.[2], isLoading, hasError, Boolean(stats))}
      </Text>
    </View>
  );
}

function getAccountGroupIds(account: AdminAccount) {
  return [...new Set([...(account.group_ids ?? []), ...(account.groups?.map((group) => group.id) ?? [])])];
}

function getFiniteNonNegativeInteger(value: unknown) {
  const numberValue = getFiniteNonNegativeNumber(value);
  return numberValue !== null && Number.isInteger(numberValue) ? numberValue : null;
}

function getUpstreamCostRateSegments(estimate?: UpstreamBillingCostEstimate): UpstreamCostRateSegment[] {
  const segmentsByRate = new Map<number, UpstreamCostRateSegment>();

  estimate?.rate_segments?.forEach((segment) => {
    const rateMultiplier = getFiniteNonNegativeNumber(segment.rate_multiplier);
    const estimatedCost = getFiniteNonNegativeNumber(segment.estimated_upstream_cost);
    const tokenRequestCount = getFiniteNonNegativeInteger(segment.token_request_count);
    if (rateMultiplier === null || estimatedCost === null) return;

    const current = segmentsByRate.get(rateMultiplier);
    segmentsByRate.set(rateMultiplier, {
      rateMultiplier,
      estimatedCost: (current?.estimatedCost ?? 0) + estimatedCost,
      tokenRequestCount: current
        ? current.tokenRequestCount !== null && tokenRequestCount !== null
          ? current.tokenRequestCount + tokenRequestCount
          : null
        : tokenRequestCount,
    });
  });

  return [...segmentsByRate.values()].sort((left, right) => (
    right.estimatedCost - left.estimatedCost || left.rateMultiplier - right.rateMultiplier
  ));
}

function summarizeUpstreamModelUsage(costs?: Record<string, UpstreamBillingCostEstimate>): UpstreamModelUsageSummaryItem[] {
  type MutableModelUsageSummary = Omit<UpstreamModelUsageSummaryItem, 'accountCount' | 'estimatedCost'> & {
    accountIDs: Set<string>;
    estimatedCost: number;
    hasKnownCost: boolean;
  };

  const byModel = new Map<string, MutableModelUsageSummary>();
  Object.entries(costs ?? {}).forEach(([accountID, estimate]) => {
    estimate.models?.forEach((modelEstimate: UpstreamBillingCostModelEstimate) => {
      const model = modelEstimate.model.trim();
      if (!model) return;

      const current = byModel.get(model) ?? {
        model,
        accountIDs: new Set<string>(),
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        hasKnownCost: false,
        hasPartialCost: false,
      };
      const requests = getFiniteNonNegativeInteger(modelEstimate.requests) ?? 0;
      const inputTokens = getFiniteNonNegativeInteger(modelEstimate.input_tokens) ?? 0;
      const outputTokens = getFiniteNonNegativeInteger(modelEstimate.output_tokens) ?? 0;
      const cacheCreationTokens = getFiniteNonNegativeInteger(modelEstimate.cache_creation_tokens) ?? 0;
      const cacheReadTokens = getFiniteNonNegativeInteger(modelEstimate.cache_read_tokens) ?? 0;
      const totalTokens = getFiniteNonNegativeInteger(modelEstimate.total_tokens)
        ?? inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
      const estimatedCost = getFiniteNonNegativeNumber(modelEstimate.estimated_upstream_cost);
      const costKnown = estimatedCost !== null || modelEstimate.reason === 'no_token_usage';
      const uncoveredRequests = getFiniteNonNegativeInteger(modelEstimate.uncovered_token_request_count) ?? 0;

      current.accountIDs.add(accountID);
      current.requests += requests;
      current.inputTokens += inputTokens;
      current.outputTokens += outputTokens;
      current.cacheCreationTokens += cacheCreationTokens;
      current.cacheReadTokens += cacheReadTokens;
      current.totalTokens += totalTokens;
      if (costKnown) {
        current.hasKnownCost = true;
        current.estimatedCost += estimatedCost ?? 0;
      }
      current.hasPartialCost ||= modelEstimate.status === 'partial' || uncoveredRequests > 0 || (requests > 0 && !costKnown);
      byModel.set(model, current);
    });
  });

  return [...byModel.values()]
    .filter((item) => item.requests > 0 || item.totalTokens > 0 || item.hasKnownCost)
    .map(({ accountIDs, hasKnownCost, ...item }) => ({
      ...item,
      accountCount: accountIDs.size,
      estimatedCost: hasKnownCost ? item.estimatedCost : null,
    }))
    .sort((left, right) => {
      const leftHasCost = left.estimatedCost !== null;
      const rightHasCost = right.estimatedCost !== null;
      if (leftHasCost !== rightHasCost) return leftHasCost ? -1 : 1;
      if (left.estimatedCost !== null && right.estimatedCost !== null && left.estimatedCost !== right.estimatedCost) {
        return right.estimatedCost - left.estimatedCost;
      }
      return right.totalTokens - left.totalTokens || right.requests - left.requests || left.model.localeCompare(right.model, 'zh-CN');
    });
}

function formatLatency(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '--';
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function formatCheckedAt(value?: string) {
  if (!value) return '--';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '--';

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 10) return '刚刚';
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;

  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const platformLabels: Record<string, string> = {
  anthropic: 'Anthropic / Claude',
  claude: 'Anthropic / Claude',
  gemini: 'Google Gemini',
  google: 'Google Gemini',
  grok: 'xAI Grok',
  openai: 'OpenAI',
};

function formatPlatformName(value: string) {
  const normalized = value.trim().toLowerCase();
  return platformLabels[normalized] || value || '未知服务商';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    switch (error.message) {
      case 'BASE_URL_REQUIRED':
        return '请先去设置页填写服务地址。';
      case 'ADMIN_API_KEY_REQUIRED':
        return '请先去设置页填写 Admin Token。';
      case 'INVALID_SERVER_RESPONSE':
        return '当前服务返回的数据格式不正确，请确认它是可用的 Sub2API 管理接口。';
      default:
        return error.message;
    }
  }

  return '当前无法加载上游数据，请检查服务地址、Token 和网络。';
}

function getRecoveryErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : '恢复失败';

  return message === 'HTTP_404' ? '当前服务器版本尚不支持统一恢复。' : message;
}

function Section({ title, subtitle, children, right }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', paddingHorizontal: 16, paddingVertical: 16, ...shadow.card }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{title}</Text>
          {subtitle ? <Text style={{ marginTop: 5, fontSize: 12, lineHeight: 17, color: colors.subtext }}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <View style={{ marginTop: 14 }}>{children}</View>
    </View>
  );
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string; tone?: 'primary' | 'warning' | 'danger' }> }) {
  const compact = items.length > 3;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderColor: colors.border, borderTopWidth: 1, borderBottomWidth: 1 }}>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={{
            width: '33.333333%',
            minWidth: 0,
            minHeight: compact ? 68 : 78,
            justifyContent: 'center',
            paddingHorizontal: 10,
            paddingVertical: compact ? 10 : 12,
            borderLeftColor: colors.border,
            borderLeftWidth: index % 3 === 0 ? 0 : 1,
            borderTopColor: colors.border,
            borderTopWidth: index >= 3 ? 1 : 0,
          }}
        >
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.subtext }}>{item.label}</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            style={{
              marginTop: compact ? 5 : 7,
              fontSize: compact ? 19 : 22,
              fontWeight: '700',
              color: item.tone === 'danger'
                ? colors.danger
                : item.tone === 'warning'
                  ? colors.warning
                  : item.tone === 'primary'
                    ? colors.primary
                    : colors.text,
            }}
          >
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function UpstreamCostSummary({
  estimatedCost,
  effectiveRate,
  coveredTokenRequestCount,
  tokenRequestCount,
  todayRequests,
  todayTokens,
}: {
  estimatedCost?: number;
  effectiveRate?: number;
  coveredTokenRequestCount?: number;
  tokenRequestCount?: number;
  todayRequests?: number;
  todayTokens?: number;
}) {
  const secondaryMetrics = [
    { label: '倍率覆盖', value: formatCoverage(coveredTokenRequestCount, tokenRequestCount) },
    { label: '今日请求', value: formatNumber(todayRequests), tone: 'primary' as const },
    { label: '今日 Token', value: todayTokens === undefined ? '--' : formatTokenValue(todayTokens) },
  ];

  return (
    <View style={{ borderColor: colors.border, borderTopWidth: 1, borderBottomWidth: 1 }}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: '50%', minHeight: 94, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 13, backgroundColor: '#f6f7f7' }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: '#5f6468' }}>上游估算成本</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}
            style={{ marginTop: 6, fontSize: 25, fontWeight: '700', color: colors.primary }}
          >
            {formatMoney(estimatedCost)}
          </Text>
        </View>
        <View style={{ width: '50%', minHeight: 94, justifyContent: 'center', borderLeftColor: colors.border, borderLeftWidth: 1, paddingHorizontal: 13, paddingVertical: 13 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.subtext }}>加权上游倍率</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}
            style={{ marginTop: 6, fontSize: 25, fontWeight: '700', color: colors.text }}
          >
            {formatRate(effectiveRate)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', borderTopColor: colors.border, borderTopWidth: 1 }}>
        {secondaryMetrics.map((metric, index) => (
          <View
            key={metric.label}
            style={{
              width: '33.333333%',
              minWidth: 0,
              minHeight: 71,
              justifyContent: 'center',
              borderLeftColor: colors.border,
              borderLeftWidth: index === 0 ? 0 : 1,
              paddingHorizontal: 10,
              paddingVertical: 10,
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 10, color: colors.subtext }}>{metric.label}</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.62}
              style={{ marginTop: 5, fontSize: 17, fontWeight: '700', color: metric.tone === 'primary' ? colors.primary : colors.text }}
            >
              {metric.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function UpstreamModelUsageSummary({ items }: { items: UpstreamModelUsageSummaryItem[] }) {
  if (items.length === 0) {
    return <Text style={{ paddingVertical: 4, fontSize: 12, lineHeight: 18, color: colors.subtext }}>今天暂无模型级调用记录；旧版服务器不会返回此明细。</Text>;
  }

  return (
    <View style={{ borderTopColor: colors.border, borderTopWidth: 1 }}>
      {items.map((item) => {
        const costText = item.estimatedCost === null ? '--' : formatMoney(item.estimatedCost);
        const costColor = item.estimatedCost === null || item.hasPartialCost ? colors.warning : colors.primary;
        const tokenDetail = [
          `输入 ${formatTokenValue(item.inputTokens)}`,
          `输出 ${formatTokenValue(item.outputTokens)}`,
          item.cacheCreationTokens > 0 ? `写缓存 ${formatTokenValue(item.cacheCreationTokens)}` : null,
          item.cacheReadTokens > 0 ? `读缓存 ${formatTokenValue(item.cacheReadTokens)}` : null,
        ].filter(Boolean).join(' · ');

        return (
          <View key={item.model} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.text }}>{item.model}</Text>
              <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 11, lineHeight: 16, color: colors.subtext }}>
                {`调用 ${formatNumber(item.requests)} 次 · ${formatTokenValue(item.totalTokens)} Token · ${item.accountCount} 个账号`}
              </Text>
              <Text numberOfLines={2} style={{ marginTop: 3, fontSize: 10, lineHeight: 15, color: colors.subtext }}>{tokenDetail}</Text>
              {item.hasPartialCost ? (
                <Text style={{ marginTop: 4, fontSize: 10, lineHeight: 15, color: colors.warning }}>部分请求缺少请求时倍率，费用仅统计已覆盖部分</Text>
              ) : null}
            </View>
            <View style={{ width: 86, minWidth: 0, alignItems: 'flex-end', paddingTop: 1 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={{ width: '100%', textAlign: 'right', fontSize: 15, fontWeight: '700', color: costColor }}>
                {costText}
              </Text>
              <Text style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>上游费用</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function UpstreamCostGroupFilterChip({
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
      accessibilityLabel={`筛选今日上游费用分组 ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        maxWidth: '100%',
        minHeight: 36,
        borderColor: selected ? colors.primary : colors.border,
        borderWidth: 1,
        borderRadius: 8,
        backgroundColor: selected ? colors.primary : '#f6f7f7',
        paddingHorizontal: 10,
        paddingVertical: 7,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <Text numberOfLines={1} style={{ maxWidth: 160, fontSize: 12, fontWeight: '600', color: selected ? '#ffffff' : colors.text }}>{label}</Text>
      <View style={{ minWidth: 18, alignItems: 'center', borderRadius: 5, backgroundColor: selected ? '#ffffff' : '#e8e9e9', paddingHorizontal: 5, paddingVertical: 2 }}>
        <Text style={{ fontSize: 10, fontWeight: '700', color: selected ? '#ffffff' : colors.subtext }}>{count}</Text>
      </View>
    </Pressable>
  );
}

function UpstreamCostRankingList({
  items,
  groupNameById,
  error,
  todayStats,
  todayStatsLoading,
  todayStatsError,
  cacheHitRates,
  cacheHitRateLoading,
  cacheHitRateError,
}: {
  items: UpstreamCostRankingItem[];
  groupNameById: Map<number, string>;
  error?: unknown;
  todayStats?: Record<string, AccountTodayStats>;
  todayStatsLoading: boolean;
  todayStatsError?: unknown;
  cacheHitRates?: Record<string, number | null>;
  cacheHitRateLoading: boolean;
  cacheHitRateError?: unknown;
}) {
  if (items.length === 0) {
    return <Text style={{ paddingVertical: 4, fontSize: 12, lineHeight: 18, color: colors.subtext }}>所选分组今天暂无发生请求的上游账号。</Text>;
  }

  return (
    <View style={{ borderTopColor: colors.border, borderTopWidth: 1 }}>
      {items.map((item, index) => {
        const costDisplay = getUpstreamBillingCostDisplay(item.estimate, error);
        const groupNames = item.groupIds.map((groupId) => groupNameById.get(groupId) || `分组 #${groupId}`);
        const rateSegments = getUpstreamCostRateSegments(item.estimate);
        const weightedRate = getFiniteNonNegativeNumber(item.estimate?.effective_rate_multiplier);
        const cacheHitRate = cacheHitRates?.[`${item.account.id}`];
        const cacheHitRateText = formatCacheHitRate(cacheHitRate, cacheHitRateLoading, Boolean(cacheHitRateError));
        const accountStats = todayStats?.[`${item.account.id}`];
        const requestText = item.todayRequestCount !== null
          ? `今日 ${formatNumber(item.todayRequestCount)} 请求`
          : item.tokenRequestCount !== null
            ? `${formatNumber(item.tokenRequestCount)} 条 Token 请求`
            : item.nonTokenRequestCount !== null
              ? `${formatNumber(item.nonTokenRequestCount)} 条非 Token 请求`
              : '今日已使用';

        return (
          <View key={item.account.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 12 }}>
            <View style={{ width: 24, paddingTop: 2 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: index < 3 ? colors.primary : colors.subtext }}>{index + 1}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.text }}>{item.account.name}</Text>
              <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 11, lineHeight: 16, color: colors.subtext }}>
                {[formatPlatformName(item.account.platform), groupNames.join(' · ') || '未分组', requestText].filter(Boolean).join(' · ')}
              </Text>
              {rateSegments.length > 0 ? (
                <View style={{ marginTop: 7, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 7 }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: colors.subtext }}>请求时倍率</Text>
                  <View style={{ marginTop: 3, flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 3 }}>
                    {rateSegments.map((segment) => (
                      <Text key={`${item.account.id}-${segment.rateMultiplier}`} numberOfLines={1} style={{ fontSize: 11, lineHeight: 17, color: colors.subtext }}>
                        <Text style={{ fontWeight: '700', color: colors.primary }}>{formatRate(segment.rateMultiplier)}</Text>
                        <Text style={{ fontWeight: '700', color: colors.text }}> {formatMoney(segment.estimatedCost)}</Text>
                        <Text> · {segment.tokenRequestCount === null ? '已覆盖请求' : `${formatNumber(segment.tokenRequestCount)} 请求`}</Text>
                      </Text>
                    ))}
                  </View>
                </View>
              ) : weightedRate !== null ? (
                <Text style={{ marginTop: 6, fontSize: 11, lineHeight: 16, color: colors.subtext }}>
                  <Text style={{ fontWeight: '700', color: colors.primary }}>汇总倍率 {formatRate(weightedRate)}</Text>
                  <Text> · 由已覆盖请求加权</Text>
                </Text>
              ) : null}
              {costDisplay.detail ? (
                <Text numberOfLines={2} style={{ marginTop: 4, fontSize: 11, lineHeight: 16, color: costDisplay.detailTone === 'warning' ? colors.warning : colors.subtext }}>
                  {costDisplay.detail}
                </Text>
              ) : null}
              <Text numberOfLines={1} style={{ marginTop: 5, fontSize: 11, lineHeight: 16, color: cacheHitRateError ? colors.warning : colors.subtext }}>
                今日缓存命中率 {cacheHitRateText}
              </Text>
              <RecentFirstTokenMetrics
                stats={accountStats}
                isLoading={todayStatsLoading}
                hasError={Boolean(todayStatsError)}
              />
            </View>
            <View style={{ width: 82, minWidth: 0, alignItems: 'flex-end', paddingTop: 1 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={{ width: '100%', textAlign: 'right', fontSize: 15, fontWeight: '700', color: costDisplay.detailTone === 'warning' ? colors.warning : colors.text }}>
                {costDisplay.value}
              </Text>
              <Text style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>上游成本</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ServerIdentityBand({
  siteName,
  baseUrl,
  identity,
  isProbing,
}: {
  siteName: string;
  baseUrl: string;
  identity?: ServerIdentity;
  isProbing: boolean;
}) {
  return (
    <View style={{ marginHorizontal: -16, backgroundColor: '#111315', paddingHorizontal: 16, paddingVertical: 15 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6f7f7' }}>
          <Server color={colors.primary} size={18} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 5 }}>
            <Text style={{ flexShrink: 1, fontSize: 15, lineHeight: 20, fontWeight: '700', color: '#ffffff' }}>{siteName}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#111315' }} />
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#111315' }}>{isProbing ? '检测中' : '已连接'}</Text>
            </View>
          </View>
          <Text style={{ marginTop: 4, fontSize: 11, lineHeight: 16, color: '#e8e9e9' }}>{baseUrl}</Text>
        </View>
      </View>

      <View style={{ marginTop: 14, flexDirection: 'row', borderTopColor: '#111315', borderTopWidth: 1, paddingTop: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 10, color: '#5f6468' }}>服务端版本</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ marginTop: 4, fontSize: 13, fontWeight: '700', color: '#ffffff' }}>
            {identity?.version ? `v${identity.version.replace(/^v/i, '')}` : '--'}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, borderLeftColor: '#111315', borderLeftWidth: 1, paddingLeft: 12 }}>
          <Text style={{ fontSize: 10, color: '#5f6468' }}>连接耗时</Text>
          <Text style={{ marginTop: 4, fontSize: 13, fontWeight: '700', color: '#ffffff' }}>{formatLatency(identity?.latency_ms)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, borderLeftColor: '#111315', borderLeftWidth: 1, paddingLeft: 12 }}>
          <Text style={{ fontSize: 10, color: '#5f6468' }}>最近检测</Text>
          <Text style={{ marginTop: 4, fontSize: 13, fontWeight: '700', color: '#ffffff' }}>{formatCheckedAt(identity?.checked_at)}</Text>
        </View>
      </View>
    </View>
  );
}

function ActiveUpstreamAccountList({
  accounts,
  rateByAccountId,
  todayStats,
  todayStatsLoading,
  todayStatsError,
  cacheHitRates,
  cacheHitRateLoading,
  cacheHitRateError,
}: {
  accounts: OpsAccountConcurrencyInfo[];
  rateByAccountId: Map<number, string>;
  todayStats?: Record<string, AccountTodayStats>;
  todayStatsLoading: boolean;
  todayStatsError?: unknown;
  cacheHitRates?: Record<string, number | null>;
  cacheHitRateLoading: boolean;
  cacheHitRateError?: unknown;
}) {
  const visible = accounts.slice(0, 4);

  if (visible.length === 0) {
    return <Text style={{ marginTop: 12, fontSize: 11, lineHeight: 17, color: colors.subtext }}>当前没有具体上游账号正在占用并发。</Text>;
  }

  return (
    <View style={{ marginTop: 13, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 2 }}>
      {visible.map((account) => {
        const load = account.max_capacity > 0
          ? Math.max(0, Math.min(100, (account.current_in_use / account.max_capacity) * 100))
          : 0;
        const accountName = account.account_name?.trim() || `账号 #${account.account_id}`;
        const accountMeta = [formatPlatformName(account.platform), account.group_name?.trim()].filter(Boolean).join(' · ');
        const upstreamRate = rateByAccountId.get(account.account_id) ?? '未获取';
        const rateUsesWarningTone = ['不支持', '未启用', '探测失败', '已过期'].includes(upstreamRate);
        const cacheHitRate = cacheHitRates?.[`${account.account_id}`];
        const accountStats = todayStats?.[`${account.account_id}`];
        const activeModels = (account.active_models ?? [])
          .map((model) => ({ name: model.model.trim(), current: getFiniteNonNegativeInteger(model.current_in_use) ?? 0 }))
          .filter((model) => model.name && model.current > 0);
        const unattributedInUse = getFiniteNonNegativeInteger(account.unattributed_in_use) ?? 0;
        const activeModelText = activeModels.map((model) => `${model.name} ×${model.current}`).join(' · ');
        const modelLabel = activeModelText
          ? `${activeModelText}${unattributedInUse > 0 ? ` · 另 ${unattributedInUse} 个未标识` : ''}`
          : account.current_in_use > 0
            ? '当前请求的模型暂未标识'
            : '请求正在排队，尚未占用模型槽位';

        return (
          <View key={account.account_id} style={{ paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 17, fontWeight: '600', color: colors.text }}>{accountName}</Text>
                <View style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 16, color: colors.subtext }}>{accountMeta || '上游账号'}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ maxWidth: '58%', flexShrink: 1, fontSize: 11, lineHeight: 16, fontWeight: '600', color: rateUsesWarningTone ? colors.warning : colors.primary }}>上游倍率 {upstreamRate}</Text>
                </View>
              </View>
              <Text style={{ fontSize: 11, color: account.waiting_in_queue > 0 ? colors.warning : colors.subtext }}>
                {account.current_in_use} / {account.max_capacity}{account.waiting_in_queue > 0 ? ` · 排队 ${account.waiting_in_queue}` : ''}
              </Text>
            </View>
            <Text numberOfLines={2} style={{ marginTop: 5, fontSize: 11, lineHeight: 16, color: activeModels.length > 0 ? colors.text : colors.subtext }}>
              <Text style={{ fontWeight: '700', color: colors.primary }}>当前模型 </Text>{modelLabel}
            </Text>
            <Text numberOfLines={1} style={{ marginTop: 4, fontSize: 11, lineHeight: 16, color: cacheHitRateError ? colors.warning : colors.subtext }}>
              今日缓存命中率 {formatCacheHitRate(cacheHitRate, cacheHitRateLoading, Boolean(cacheHitRateError))}
            </Text>
            <RecentFirstTokenMetrics
              stats={accountStats}
              isLoading={todayStatsLoading}
              hasError={Boolean(todayStatsError)}
            />
            <View style={{ marginTop: 7, height: 4, overflow: 'hidden', backgroundColor: colors.mutedCard }}>
              <View style={{ width: `${load}%`, height: 4, backgroundColor: load >= 90 ? colors.danger : load >= 70 ? colors.warning : colors.primary }} />
            </View>
          </View>
        );
      })}
      {accounts.length > visible.length ? (
        <Text style={{ paddingTop: 8, fontSize: 11, color: colors.subtext }}>另有 {accounts.length - visible.length} 个上游账号正在承载或排队</Text>
      ) : null}
    </View>
  );
}

function summarizeUpstreamData(
  accounts: AdminAccount[],
  stats?: Record<string, AccountTodayStats>,
  costs?: Record<string, UpstreamBillingCostEstimate>
) {
  const billableAccounts = accounts.filter((account) => !isExcludedFromUpstreamBilling(account));
  let totalTokens = 0;
  let estimatedCost = 0;
  let coveredStandardCost = 0;
  let coveredUpstreamCost = 0;
  let hasTokenData = billableAccounts.length === 0 || stats !== undefined;
  let hasCostData = billableAccounts.length === 0;
  let hasCoverageData = billableAccounts.length === 0;
  let tokenRequestCount = 0;
  let coveredTokenRequestCount = 0;
  let hasIncompleteCoverage = false;

  billableAccounts.forEach((account) => {
    const tokenValue = getFiniteNonNegativeNumber(stats?.[`${account.id}`]?.tokens);
    const estimate = costs?.[`${account.id}`];
    const amount = getFiniteNonNegativeNumber(estimate?.estimated_upstream_cost);
    const coveredCost = getFiniteNonNegativeNumber(estimate?.covered_standard_cost);
    const accountTokenRequestCount = getFiniteNonNegativeNumber(estimate?.token_request_count);
    const accountCoveredTokenRequestCount = getFiniteNonNegativeNumber(estimate?.covered_token_request_count);
    const uncoveredRequests = getFiniteNonNegativeNumber(estimate?.uncovered_token_request_count) ?? 0;

    if (tokenValue !== null) {
      hasTokenData = true;
      totalTokens += tokenValue;
    }
    if (amount !== null) {
      hasCostData = true;
      estimatedCost += amount;
    } else if (estimate?.reason === 'no_token_usage') {
      hasCostData = true;
    }
    if (amount !== null && coveredCost !== null && coveredCost > 0) {
      coveredUpstreamCost += amount;
      coveredStandardCost += coveredCost;
    }
    if (accountTokenRequestCount !== null && accountCoveredTokenRequestCount !== null) {
      hasCoverageData = true;
      tokenRequestCount += accountTokenRequestCount;
      coveredTokenRequestCount += Math.min(accountCoveredTokenRequestCount, accountTokenRequestCount);
    }
    if (estimate?.status === 'partial' || uncoveredRequests > 0 || (tokenValue !== null && tokenValue > 0 && amount === null)) {
      hasIncompleteCoverage = true;
    }
  });

  if (hasTokenData && totalTokens === 0) hasCostData = true;

  return {
    totalTokens: hasTokenData ? totalTokens : undefined,
    estimatedCost: hasCostData ? estimatedCost : undefined,
    effectiveRate: coveredStandardCost > 0 ? coveredUpstreamCost / coveredStandardCost : undefined,
    tokenRequestCount: hasCoverageData ? tokenRequestCount : undefined,
    coveredTokenRequestCount: hasCoverageData ? coveredTokenRequestCount : undefined,
    hasIncompleteCoverage,
  };
}

function summarizeAccountActivity(accounts: AdminAccount[], stats?: Record<string, AccountTodayStats>) {
  let requests = 0;
  let tokens = 0;
  let currentConcurrency = 0;
  let concurrencyLimit = 0;
  let hasConcurrencyLimit = false;
  let schedulable = 0;

  accounts.forEach((account) => {
    const accountStats = stats?.[`${account.id}`];
    const accountRequests = getFiniteNonNegativeNumber(accountStats?.requests) ?? 0;
    const accountTokens = getFiniteNonNegativeNumber(accountStats?.tokens) ?? 0;
    const accountCurrentConcurrency = getFiniteNonNegativeNumber(account.current_concurrency) ?? 0;
    const accountConcurrencyLimit = getFiniteNonNegativeNumber(account.concurrency);

    requests += accountRequests;
    tokens += accountTokens;
    currentConcurrency += accountCurrentConcurrency;
    if (accountConcurrencyLimit !== null) {
      hasConcurrencyLimit = true;
      concurrencyLimit += accountConcurrencyLimit;
    }
    if (!getAccountRecoverySummary(account).recoverable && !isAccountPaused(account)) schedulable += 1;
  });

  return {
    requests: stats ? requests : undefined,
    tokens: stats ? tokens : undefined,
    currentConcurrency,
    concurrencyLimit: hasConcurrencyLimit ? concurrencyLimit : undefined,
    schedulable,
  };
}

function formatCoverage(covered?: number, total?: number) {
  if (covered === undefined || total === undefined) return '--';
  if (total === 0) return '无请求';
  return `${(Math.min(covered / total, 1) * 100).toFixed(1)}%`;
}

function formatConcurrency(current: number, limit?: number) {
  return limit === undefined ? `${formatNumber(current)} / --` : `${formatNumber(current)} / ${formatNumber(limit)}`;
}

function formatPercent(value: number, total: number) {
  if (total === 0) return '--';
  return `${Math.round((value / total) * 100)}%`;
}

function replaceAccountInPage(page: PaginatedData<AdminAccount> | undefined, refreshedAccount: AdminAccount) {
  if (!page?.items.some((account) => account.id === refreshedAccount.id)) return page;

  return {
    ...page,
    items: page.items.map((account) => account.id === refreshedAccount.id ? { ...account, ...refreshedAccount } : account),
  };
}

export function MonitorScreen() {
  const config = useSnapshot(adminConfigState);
  const hasAccount = hasAuthenticatedAdminSession(config);
  const queryClient = useQueryClient();
  const [recoveringAccountId, setRecoveringAccountId] = useState<number | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null);
  const [upstreamCostGroupFilterId, setUpstreamCostGroupFilterId] = useState<number | null>(null);

  const dashboardStatsQuery = useQuery({
    queryKey: ['monitor-stats'],
    queryFn: getDashboardStats,
    enabled: hasAccount,
    staleTime: 30_000,
  });
  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: getAdminSettings,
    enabled: hasAccount,
    staleTime: 5 * 60_000,
  });
  const serverIdentityQuery = useQuery({
    queryKey: ['server-identity'],
    queryFn: getServerIdentity,
    enabled: hasAccount,
    staleTime: 60_000,
    retry: false,
  });
  const opsConcurrencyQuery = useQuery({
    queryKey: ['ops-concurrency'],
    queryFn: getOpsConcurrencyStats,
    enabled: hasAccount,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  });
  const accountsQuery = useQuery({
    queryKey: ['monitor-accounts'],
    queryFn: () => listAccounts(''),
    enabled: hasAccount,
    staleTime: 60_000,
  });
  const groupsQuery = useQuery({
    queryKey: ['groups', 'all'],
    queryFn: listAllGroups,
    enabled: hasAccount,
    staleTime: 60_000,
  });
  const accounts = accountsQuery.data?.items ?? [];
  const accountIds = useMemo(
    () => accounts.map((account) => account.id).sort((left, right) => left - right),
    [accounts]
  );
  const upstreamBillingAccounts = useMemo(
    () => accounts.filter((account) => !isExcludedFromUpstreamBilling(account)),
    [accounts]
  );
  const upstreamBillingAccountIds = useMemo(
    () => upstreamBillingAccounts.map((account) => account.id).sort((left, right) => left - right),
    [upstreamBillingAccounts]
  );
  const todayStatsQuery = useQuery({
    queryKey: ['account-today-stats', accountIds],
    queryFn: () => getAccountTodayStatsBatchWithUsageFallback(accountIds),
    enabled: hasAccount && accountIds.length > 0,
    staleTime: 60_000,
  });
  const cacheHitRateQuery = useQuery({
    queryKey: ['account-today-cache-hit-rates', accountIds],
    queryFn: () => getAccountTodayCacheHitRateBatch(accountIds),
    enabled: hasAccount && accountIds.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  const upstreamCostsQuery = useQuery({
    queryKey: ['account-upstream-billing-costs-24h', upstreamBillingAccountIds],
    queryFn: () => getAccountUpstreamBillingCosts24h(upstreamBillingAccountIds),
    enabled: hasAccount && upstreamBillingAccountIds.length > 0,
    staleTime: 60_000,
  });
  const recoveryMutation = useMutation({ mutationFn: (accountId: number) => recoverAccountState(accountId) });

  const upstreamSummary = useMemo(
    () => summarizeUpstreamData(upstreamBillingAccounts, todayStatsQuery.data?.stats, upstreamCostsQuery.data?.costs),
    [upstreamBillingAccounts, todayStatsQuery.data?.stats, upstreamCostsQuery.data?.costs]
  );
  const upstreamModelUsage = useMemo(
    () => summarizeUpstreamModelUsage(upstreamCostsQuery.data?.costs),
    [upstreamCostsQuery.data?.costs]
  );
  const upstreamCostGroupNameById = useMemo(() => {
    const names = new Map<number, string>();

    groupsQuery.data?.items.forEach((group: AdminGroup) => {
      names.set(group.id, group.name);
    });
    accounts.forEach((account) => {
      account.groups?.forEach((group) => {
        if (!names.has(group.id)) names.set(group.id, group.name);
      });
    });

    return names;
  }, [accounts, groupsQuery.data?.items]);
  const upstreamCostRanking = useMemo(() => {
    const ranking = upstreamBillingAccounts.map((account): UpstreamCostRankingItem | null => {
      const estimate = upstreamCostsQuery.data?.costs[`${account.id}`];
      const todayRequestCount = getFiniteNonNegativeInteger(todayStatsQuery.data?.stats[`${account.id}`]?.requests);
      const tokenRequestCount = getFiniteNonNegativeInteger(estimate?.token_request_count);
      const nonTokenRequestCount = getFiniteNonNegativeInteger(estimate?.non_token_request_count);
      const estimatedCost = getFiniteNonNegativeNumber(estimate?.estimated_upstream_cost);
      const hasUsage = [todayRequestCount, tokenRequestCount, nonTokenRequestCount].some((value) => value !== null && value > 0)
        || (estimatedCost !== null && estimatedCost > 0);

      if (!hasUsage) return null;

      return {
        account,
        groupIds: getAccountGroupIds(account),
        estimate,
        estimatedCost,
        todayRequestCount,
        tokenRequestCount,
        nonTokenRequestCount,
      };
    }).filter((item): item is UpstreamCostRankingItem => item !== null);

    return ranking.sort((left, right) => {
      const leftHasEstimatedCost = left.estimatedCost !== null;
      const rightHasEstimatedCost = right.estimatedCost !== null;
      if (leftHasEstimatedCost !== rightHasEstimatedCost) return leftHasEstimatedCost ? -1 : 1;
      if (left.estimatedCost !== null && right.estimatedCost !== null && left.estimatedCost !== right.estimatedCost) {
        return right.estimatedCost - left.estimatedCost;
      }

      const leftUsageCount = Math.max(left.todayRequestCount ?? 0, left.tokenRequestCount ?? 0, left.nonTokenRequestCount ?? 0);
      const rightUsageCount = Math.max(right.todayRequestCount ?? 0, right.tokenRequestCount ?? 0, right.nonTokenRequestCount ?? 0);
      return rightUsageCount - leftUsageCount || left.account.name.localeCompare(right.account.name, 'zh-CN') || left.account.id - right.account.id;
    });
  }, [todayStatsQuery.data?.stats, upstreamBillingAccounts, upstreamCostsQuery.data?.costs]);
  const upstreamCostGroupFilterOptions = useMemo(() => {
    const groups = new Map<number, UpstreamCostGroupFilterOption>();

    upstreamCostRanking.forEach((item) => {
      item.groupIds.forEach((groupId) => {
        const current = groups.get(groupId);
        groups.set(groupId, {
          id: groupId,
          name: current?.name || upstreamCostGroupNameById.get(groupId) || `分组 #${groupId}`,
          accountCount: (current?.accountCount ?? 0) + 1,
          estimatedCost: (current?.estimatedCost ?? 0) + (item.estimatedCost ?? 0),
        });
      });
    });

    return [...groups.values()].sort((left, right) => (
      right.estimatedCost - left.estimatedCost || right.accountCount - left.accountCount || left.name.localeCompare(right.name, 'zh-CN') || left.id - right.id
    ));
  }, [upstreamCostGroupNameById, upstreamCostRanking]);
  const filteredUpstreamCostRanking = useMemo(
    () => upstreamCostGroupFilterId === null
      ? upstreamCostRanking
      : upstreamCostRanking.filter((item) => item.groupIds.includes(upstreamCostGroupFilterId)),
    [upstreamCostGroupFilterId, upstreamCostRanking]
  );

  useEffect(() => {
    if (
      upstreamCostGroupFilterId !== null
      && !upstreamCostGroupFilterOptions.some((group) => group.id === upstreamCostGroupFilterId)
    ) {
      setUpstreamCostGroupFilterId(null);
    }
  }, [upstreamCostGroupFilterId, upstreamCostGroupFilterOptions]);
  const activitySummary = useMemo(
    () => summarizeAccountActivity(accounts, todayStatsQuery.data?.stats),
    [accounts, todayStatsQuery.data?.stats]
  );
  const upstreamRateByAccountId = useMemo(
    () => new Map<number, string>(accounts.map((account) => [account.id, getUpstreamBillingRateDisplay(account).value])),
    [accounts]
  );
  const concurrencySummary = useMemo(() => {
    const realtime = opsConcurrencyQuery.data;
    if (realtime?.enabled) {
      const allPlatforms = Object.values(realtime.platform ?? {});
      const activeAccounts = Object.values(realtime.account ?? {})
        .filter((account) => account.current_in_use > 0 || account.waiting_in_queue > 0)
        .sort((left, right) => (
          right.current_in_use + right.waiting_in_queue - left.current_in_use - left.waiting_in_queue
          || left.account_id - right.account_id
        ));

      return {
        current: allPlatforms.reduce((total, platform) => total + platform.current_in_use, 0),
        capacity: allPlatforms.reduce((total, platform) => total + platform.max_capacity, 0),
        waiting: allPlatforms.reduce((total, platform) => total + platform.waiting_in_queue, 0),
        accounts: activeAccounts,
        servingAccountCount: activeAccounts.filter((account) => account.current_in_use > 0).length,
        realtime: true,
      };
    }

    const fallbackAccounts: OpsAccountConcurrencyInfo[] = [];
    accounts.forEach((account) => {
      const current = getFiniteNonNegativeNumber(account.current_concurrency) ?? 0;
      if (current <= 0) return;
      const capacity = getFiniteNonNegativeNumber(account.concurrency) ?? 0;
      const group = account.groups?.[0];
      fallbackAccounts.push({
        account_id: account.id,
        account_name: account.name,
        platform: account.platform || 'unknown',
        group_id: group?.id ?? account.group_ids?.[0] ?? 0,
        group_name: group?.name ?? '',
        current_in_use: current,
        max_capacity: capacity,
        waiting_in_queue: 0,
        load_percentage: capacity > 0 ? (current / capacity) * 100 : 0,
      });
    });
    fallbackAccounts.sort((left, right) => right.current_in_use - left.current_in_use || left.account_id - right.account_id);

    return {
      current: activitySummary.currentConcurrency,
      capacity: activitySummary.concurrencyLimit,
      waiting: undefined,
      accounts: fallbackAccounts,
      servingAccountCount: fallbackAccounts.length,
      realtime: false,
    };
  }, [accounts, activitySummary.concurrencyLimit, activitySummary.currentConcurrency, opsConcurrencyQuery.data]);
  const todaySummary = useMemo(() => ({
    requests: getFiniteNonNegativeNumber(dashboardStatsQuery.data?.today_requests) ?? activitySummary.requests,
    tokens: getFiniteNonNegativeNumber(dashboardStatsQuery.data?.today_tokens) ?? activitySummary.tokens,
  }), [activitySummary.requests, activitySummary.tokens, dashboardStatsQuery.data]);

  const accountStates = accounts.map((account) => ({ account, recovery: getAccountRecoverySummary(account) }));
  const actionableAccounts = accountStates.filter(({ recovery }) => recovery.recoverable);
  const accountSummary = {
    total: accounts.length,
    pending: actionableAccounts.length,
    paused: accountStates.filter(({ account, recovery }) => !recovery.recoverable && isAccountPaused(account)).length,
    healthy: accountStates.filter(({ account, recovery }) => !recovery.recoverable && !isAccountPaused(account)).length,
  };
  const hasDanger = actionableAccounts.some(({ recovery }) => recovery.severity === 'danger');
  const currentServer = config.accounts.find((account: AdminAccountProfile) => account.id === config.activeAccountId);
  const siteName = settingsQuery.data?.site_name || currentServer?.label || 'Sub2API';

  async function refetchAll() {
    const requests: Promise<unknown>[] = [
      dashboardStatsQuery.refetch(),
      settingsQuery.refetch(),
      serverIdentityQuery.refetch(),
      opsConcurrencyQuery.refetch(),
      accountsQuery.refetch(),
      groupsQuery.refetch(),
    ];
    if (accountIds.length > 0) {
      requests.push(todayStatsQuery.refetch());
      requests.push(cacheHitRateQuery.refetch());
    }
    if (upstreamBillingAccountIds.length > 0) requests.push(upstreamCostsQuery.refetch());
    await Promise.all(requests);
  }

  function handleRecover(account: AdminAccount) {
    setRecoveringAccountId(account.id);
    setRecoveryNotice(null);
    recoveryMutation.mutate(account.id, {
      onSuccess: async (refreshedAccount) => {
        queryClient.setQueryData<PaginatedData<AdminAccount>>(
          ['monitor-accounts'],
          (current) => replaceAccountInPage(current, refreshedAccount)
        );
        queryClient.setQueriesData<PaginatedData<AdminAccount>>(
          { queryKey: ['accounts'] },
          (current) => replaceAccountInPage(current, refreshedAccount)
        );
        setRecoveryNotice({ message: `${account.name} 的可恢复状态已清理。`, tone: 'success' });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['monitor-accounts'] }),
          queryClient.invalidateQueries({ queryKey: ['accounts'] }),
          queryClient.invalidateQueries({ queryKey: ['monitor-stats'] }),
        ]);
      },
      onError: (error) => {
        setRecoveryNotice({ message: `${account.name}：${getRecoveryErrorMessage(error)}`, tone: 'danger' });
      },
      onSettled: () => setRecoveringAccountId((current) => current === account.id ? null : current),
    });
  }

  const isLoading = dashboardStatsQuery.isLoading || accountsQuery.isLoading;
  const isRefreshing = dashboardStatsQuery.isRefetching
    || settingsQuery.isRefetching
    || serverIdentityQuery.isRefetching
    || opsConcurrencyQuery.isRefetching
    || accountsQuery.isRefetching
    || groupsQuery.isRefetching
    || todayStatsQuery.isRefetching
    || cacheHitRateQuery.isRefetching
    || upstreamCostsQuery.isRefetching;
  const upstreamDataError = todayStatsQuery.error ?? cacheHitRateQuery.error ?? upstreamCostsQuery.error;
  const upstreamNotice = upstreamDataError
    ? '部分上游数据加载失败，下拉可重试'
    : upstreamSummary.hasIncompleteCoverage
      ? '部分请求缺少倍率，上游估算成本仅统计已覆盖部分'
      : null;
  const dailyUsageNotice = dashboardStatsQuery.error && todayStatsQuery.error
    ? '今日统计暂时无法加载，下拉可重试'
    : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refetchAll()} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 26, fontWeight: '700', color: colors.text }}>概览</Text>
            <Text style={{ marginTop: 5, fontSize: 13, color: colors.subtext }}>流量、成本与上游运行状态</Text>
          </View>
          {hasAccount ? (
            <Pressable
              accessibilityLabel="刷新概览"
              accessibilityRole="button"
              disabled={isRefreshing}
              onPress={() => void refetchAll()}
              style={({ pressed }) => ({
                width: 42,
                height: 42,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                borderColor: 'rgba(255,255,255,0.6)',
                borderWidth: 1,
                backgroundColor: 'rgba(255,255,255,0.78)',
                opacity: isRefreshing ? 0.55 : pressed ? 0.75 : 1,
              })}
            >
              <RefreshCw color={colors.primary} size={18} />
            </Pressable>
          ) : null}
        </View>

        {hasAccount ? (
          <View style={{ marginBottom: 12 }}>
            <ServerIdentityBand
              siteName={siteName}
              baseUrl={config.baseUrl}
              identity={serverIdentityQuery.data}
              isProbing={serverIdentityQuery.isLoading || serverIdentityQuery.isRefetching}
            />
          </View>
        ) : null}

        {!hasAccount ? (
          <Section title="未连接服务器" subtitle="需要先配置连接">
            <Text style={{ fontSize: 14, lineHeight: 22, color: colors.subtext }}>请先前往“设置”页填写服务地址和 Admin Token。</Text>
            <Pressable
              style={({ pressed }) => ({ marginTop: 14, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.78 : 1 })}
              onPress={() => router.push('/settings')}
            >
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>打开设置</Text>
            </Pressable>
          </Section>
        ) : isLoading ? (
          <Section title="正在加载概览" subtitle="正在同步服务器数据">
            <View style={{ alignItems: 'center', paddingVertical: 14 }}><ActivityIndicator color={colors.primary} /></View>
          </Section>
        ) : accountsQuery.error ? (
          <Section title="加载失败" subtitle="请检查连接配置">
            <View style={{ backgroundColor: colors.dangerBg, paddingHorizontal: 14, paddingVertical: 12 }}>
              <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}>{getErrorMessage(accountsQuery.error)}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable style={({ pressed }) => ({ flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center', opacity: pressed ? 0.78 : 1 })} onPress={() => void refetchAll()}>
                <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>重试</Text>
              </Pressable>
              <Pressable style={({ pressed }) => ({ flex: 1, backgroundColor: '#f2f3f3', borderRadius: 8, paddingVertical: 12, alignItems: 'center', opacity: pressed ? 0.78 : 1 })} onPress={() => router.push('/settings')}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>检查设置</Text>
              </Pressable>
            </View>
          </Section>
        ) : (
          <View style={{ gap: 12 }}>
            <Section
              title="运行状态"
              subtitle={`${formatNumber(accountSummary.total)} 个上游账号 · ${concurrencySummary.realtime ? '实时并发' : '账号汇总'}`}
              right={(
                <Pressable
                  accessibilityLabel="打开账号清单"
                  accessibilityRole="button"
                  onPress={() => router.navigate('/(tabs)/accounts')}
                  style={({ pressed }) => ({ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#f2f3f3', opacity: pressed ? 0.72 : 1 })}
                >
                  <ChevronRight color={colors.text} size={18} />
                </Pressable>
              )}
            >
              <MetricGrid items={[
                { label: '正常', value: formatNumber(accountSummary.healthy), tone: 'primary' },
                { label: '暂停', value: formatNumber(accountSummary.paused) },
                { label: '待处理', value: formatNumber(accountSummary.pending), tone: accountSummary.pending > 0 ? (hasDanger ? 'danger' : 'warning') : undefined },
              ]} />
              <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 7 }}>
                <Text style={{ width: '50%', fontSize: 12, color: colors.subtext }}>当前并发 {formatConcurrency(concurrencySummary.current, concurrencySummary.capacity)}</Text>
                <Text style={{ width: '50%', fontSize: 12, textAlign: 'right', color: concurrencySummary.waiting && concurrencySummary.waiting > 0 ? colors.warning : colors.subtext }}>
                  排队 {concurrencySummary.waiting === undefined ? '--' : formatNumber(concurrencySummary.waiting)}
                </Text>
                <Text style={{ width: '50%', fontSize: 12, color: colors.subtext }}>正在承载 {concurrencySummary.servingAccountCount} 个账号</Text>
                <Text style={{ width: '50%', fontSize: 12, textAlign: 'right', color: colors.subtext }}>可调度率 {formatPercent(activitySummary.schedulable, accountSummary.total)}</Text>
              </View>
              <Text style={{ marginTop: 14, fontSize: 12, fontWeight: '700', color: colors.text }}>当前调用的上游供应商与模型</Text>
              <ActiveUpstreamAccountList
                accounts={concurrencySummary.accounts}
                rateByAccountId={upstreamRateByAccountId}
                todayStats={todayStatsQuery.data?.stats}
                todayStatsLoading={todayStatsQuery.isLoading}
                todayStatsError={todayStatsQuery.error || todayStatsQuery.data?.first_token_stats_error}
                cacheHitRates={cacheHitRateQuery.data}
                cacheHitRateLoading={cacheHitRateQuery.isLoading}
                cacheHitRateError={cacheHitRateQuery.error}
              />
              {recoveryNotice ? (
                <Text style={{ marginTop: 10, fontSize: 12, lineHeight: 18, color: recoveryNotice.tone === 'success' ? colors.primary : colors.danger }}>{recoveryNotice.message}</Text>
              ) : null}
            </Section>

            <Section title="今日上游成本" subtitle="按请求时保存的上游倍率推算 · 不含 ShitRouter">
              <UpstreamCostSummary
                estimatedCost={upstreamSummary.estimatedCost}
                effectiveRate={upstreamSummary.effectiveRate}
                coveredTokenRequestCount={upstreamSummary.coveredTokenRequestCount}
                tokenRequestCount={upstreamSummary.tokenRequestCount}
                todayRequests={todaySummary.requests}
                todayTokens={todaySummary.tokens}
              />
              <Text style={{ marginTop: 12, fontSize: 12, lineHeight: 18, color: colors.subtext }}>上游估算成本仅统计有倍率快照的 Token 请求，不会使用当前倍率补算历史缺口。</Text>
              {upstreamNotice ? <Text style={{ marginTop: 12, fontSize: 12, lineHeight: 18, color: colors.warning }}>{upstreamNotice}</Text> : null}
              {dailyUsageNotice ? <Text style={{ marginTop: upstreamNotice ? 7 : 12, fontSize: 12, lineHeight: 18, color: colors.danger }}>{dailyUsageNotice}</Text> : null}
            </Section>

            <Section title="今日模型用量与上游费用" subtitle="按请求模型汇总调用次数、Token 与请求时上游费用 · 不含 ShitRouter">
              {upstreamCostsQuery.isLoading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 }}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={{ fontSize: 12, color: colors.subtext }}>正在汇总模型用量</Text>
                </View>
              ) : upstreamCostsQuery.error ? (
                <Text style={{ paddingVertical: 4, fontSize: 12, lineHeight: 18, color: colors.warning }}>模型级费用统计暂不可用：{getErrorMessage(upstreamCostsQuery.error)}</Text>
              ) : (
                <UpstreamModelUsageSummary items={upstreamModelUsage} />
              )}
            </Section>

            <Section title="今日上游费用排行" subtitle="按上游估算成本从高到低 · 每项按请求时倍率分段 · 不含 ShitRouter">
              {upstreamCostGroupFilterOptions.length > 0 ? (
                <View style={{ marginBottom: 13 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Layers3 color={colors.subtext} size={14} />
                      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>按分组筛选</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.subtext }}>显示 {filteredUpstreamCostRanking.length} 个</Text>
                  </View>
                  <View style={{ marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <UpstreamCostGroupFilterChip
                      label="全部分组"
                      count={upstreamCostRanking.length}
                      selected={upstreamCostGroupFilterId === null}
                      onPress={() => setUpstreamCostGroupFilterId(null)}
                    />
                    {upstreamCostGroupFilterOptions.map((group) => (
                      <UpstreamCostGroupFilterChip
                        key={group.id}
                        label={group.name}
                        count={group.accountCount}
                        selected={upstreamCostGroupFilterId === group.id}
                        onPress={() => setUpstreamCostGroupFilterId(group.id)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              {todayStatsQuery.isLoading || upstreamCostsQuery.isLoading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 }}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={{ fontSize: 12, color: colors.subtext }}>正在汇总今日上游费用</Text>
                </View>
              ) : (
                <UpstreamCostRankingList
                  items={filteredUpstreamCostRanking}
                  groupNameById={upstreamCostGroupNameById}
                  error={upstreamCostsQuery.error}
                  todayStats={todayStatsQuery.data?.stats}
                  todayStatsLoading={todayStatsQuery.isLoading}
                  todayStatsError={todayStatsQuery.error || todayStatsQuery.data?.first_token_stats_error}
                  cacheHitRates={cacheHitRateQuery.data}
                  cacheHitRateLoading={cacheHitRateQuery.isLoading}
                  cacheHitRateError={cacheHitRateQuery.error}
                />
              )}
            </Section>

            {actionableAccounts.length > 0 ? (
              <Section title="需要处理" subtitle="错误、限流与临时调度阻断">
                {actionableAccounts.slice(0, 3).map(({ account, recovery }, index) => {
                  const isRecovering = recoveringAccountId === account.id && recoveryMutation.isPending;

                  return (
                    <View key={account.id} style={{ paddingTop: index === 0 ? 0 : 13, paddingBottom: 13, borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                        <Activity color={recovery.severity === 'danger' ? colors.danger : colors.warning} size={17} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{account.name}</Text>
                          <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 11, color: colors.subtext }}>{account.platform} · {recovery.label}</Text>
                          <Text numberOfLines={3} style={{ marginTop: 5, fontSize: 12, lineHeight: 18, color: recovery.severity === 'danger' ? colors.danger : colors.warning }}>{recovery.detail}</Text>
                        </View>
                      </View>
                      <View style={{ marginTop: 10, flexDirection: 'row', gap: 8 }}>
                        <Pressable
                          accessibilityLabel={`恢复账号 ${account.name} 的运行状态`}
                          accessibilityRole="button"
                          disabled={isRecovering}
                          onPress={() => handleRecover(account)}
                          style={({ pressed }) => ({ flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 8, backgroundColor: colors.primary, opacity: isRecovering ? 0.55 : pressed ? 0.78 : 1 })}
                        >
                          {isRecovering ? <ActivityIndicator color="#ffffff" size="small" /> : <RotateCcw color="#ffffff" size={15} />}
                          <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>{isRecovering ? '正在恢复' : '恢复状态'}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel="打开账号清单"
                          accessibilityRole="button"
                          onPress={() => router.navigate('/(tabs)/accounts')}
                          style={({ pressed }) => ({ width: 44, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#f2f3f3', opacity: pressed ? 0.72 : 1 })}
                        >
                          <ChevronRight color={colors.text} size={18} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
                {actionableAccounts.length > 3 ? (
                  <Pressable onPress={() => router.navigate('/(tabs)/accounts')} style={({ pressed }) => ({ paddingTop: 4, opacity: pressed ? 0.7 : 1 })}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>另有 {actionableAccounts.length - 3} 个待处理账号</Text>
                  </Pressable>
                ) : null}
              </Section>
            ) : null}

          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
