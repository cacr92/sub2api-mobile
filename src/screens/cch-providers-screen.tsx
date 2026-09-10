import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { ChevronDown, ChevronUp, Layers3, Pin, PinOff, RefreshCw, RotateCcw, Server } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { ListCard } from '@/src/components/list-card';
import { GlassSurface } from '@/src/components/glass-surface';
import { ScreenShell } from '@/src/components/screen-shell';
import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { compareCchProvidersByLiveActivity, getCchProviderSlotSnapshot, resolveCchProviderGroups, resolveCchProviderMultiplier, summarizeCchProxyStatus } from '@/src/lib/cch-metrics';
import { formatTokenValue } from '@/src/lib/formatters';
import {
  getCchProviderHealth,
  getCchProviderSlots,
  getCchSystemSettings,
  getCchProxyStatus,
  listCchProviders,
  probeCchProvidersUpstreamBilling,
  resetCchProviderCircuit,
  resetCchProviderCircuitsBatch,
  setCchProviderPriorityLocked,
  updateCchAutoSortProviderPriority,
} from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';
import { colors as themeColors, glass, inputStyle, radius, spacing } from '@/src/theme';
import type { CchProvider, CchProviderCircuit, CchProviderSlot, CchProviderStatistics } from '@/src/types/cch';

const { useSnapshot } = require('valtio/react');

const colors = themeColors;

function formatCost(value: string | number | undefined) {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(amount > 0 && amount < 0.01 ? 4 : 2)}` : '--';
}

function formatMultiplier(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '--';
  const multiplier = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(multiplier) ? `${multiplier.toFixed(2)}x` : '--';
}

function formatPercent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--';
}

function formatLatency(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function coverageLabel(statistics?: CchProviderStatistics) {
  if (statistics?.todayUpstreamCost === undefined) return '旧版服务未返回';
  const covered = statistics.coveredRequestCount ?? 0;
  const uncovered = statistics.uncoveredRequestCount ?? 0;
  const prefix = statistics.upstreamCostStatus === 'estimated'
    ? '完整'
    : statistics.upstreamCostStatus === 'partial'
      ? '部分'
      : '无快照';
  return `${prefix} ${covered} / ${covered + uncovered}`;
}

function formatLimit(value: number | null | undefined) {
  return typeof value === 'number' && value > 0 ? formatCost(value) : '--';
}

function formatRecentCallTime(value?: string | null) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';

  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `${hours}:${minutes}`;

  return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
}

function formatProbeTime(value?: string | null) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
}

function probeStatusLabel(provider: CchProvider) {
  if (provider.upstreamBillingProbeEnabled === undefined) return '服务未返回探测状态';
  if (!provider.upstreamBillingProbeEnabled) return '自动探测已关闭';
  const snapshot = provider.upstreamBillingProbe;
  if (!snapshot) return '尚未探测';
  if (snapshot.status === 'ok') return '探测成功';
  if (snapshot.status === 'unsupported') return '上游不支持';
  return typeof snapshot.effectiveRateMultiplier === 'number'
    ? '探测失败，沿用上次倍率'
    : '探测失败';
}

function GroupFilterChip({
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
      accessibilityLabel={`筛选供应商分组 ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        maxWidth: '100%',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary : '#f6f7f7',
        paddingHorizontal: 11,
        paddingVertical: 8,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <Text numberOfLines={1} style={{ maxWidth: 180, flexShrink: 1, color: selected ? '#ffffff' : colors.text, fontSize: 11, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color: selected ? '#f6f7f7' : colors.subtext, fontSize: 10, fontWeight: '700' }}>{count}</Text>
    </Pressable>
  );
}

function DetailMetric({ label, value, tone }: { label: string; value: string; tone?: 'default' | 'warning' }) {
  return (
    <View style={{ width: '50%', minWidth: 0, paddingRight: 8, paddingBottom: 12 }}>
      <Text numberOfLines={1} style={{ fontSize: 10, color: colors.subtext }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ marginTop: 4, fontSize: 13, fontWeight: '700', color: tone === 'warning' ? colors.warning : colors.text }}>{value}</Text>
    </View>
  );
}

function ProviderCard({
  provider,
  circuit,
  slot,
  activeRequestCount,
  liveDataAvailable,
  expanded,
  onToggleDetails,
  onResetCircuit,
  resetPending,
  onTogglePriorityLock,
  priorityLockPending,
}: {
  provider: CchProvider;
  circuit?: CchProviderCircuit;
  slot?: CchProviderSlot;
  activeRequestCount?: number;
  liveDataAvailable: boolean;
  expanded: boolean;
  onToggleDetails: () => void;
  onResetCircuit: () => void;
  resetPending: boolean;
  onTogglePriorityLock: () => void;
  priorityLockPending: boolean;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const slotSnapshot = getCchProviderSlotSnapshot(slot);
  const snapshot = activeRequestCount === undefined
    ? slotSnapshot
    : {
      usedSlots: activeRequestCount,
      totalSlots: provider.limitConcurrentSessions ?? slotSnapshot.totalSlots,
      isActive: activeRequestCount > 0,
      utilization: (provider.limitConcurrentSessions ?? slotSnapshot.totalSlots) > 0
        ? Math.min(1, activeRequestCount / (provider.limitConcurrentSessions ?? slotSnapshot.totalSlots))
        : 0,
    };
  const isCircuitOpen = circuit?.circuitState === 'open';
  const isCircuitRecovering = circuit?.circuitState === 'half-open';
  const hasSessionObservation = Boolean(slot);
  const stateColor = isCircuitOpen
    ? colors.danger
    : isCircuitRecovering
      ? colors.warning
      : liveDataAvailable && snapshot.isActive
        ? colors.primary
        : !liveDataAvailable && hasSessionObservation
          ? colors.warning
          : colors.subtext;
  const stateBackground = isCircuitOpen
    ? colors.dangerSoft
    : isCircuitRecovering
      ? colors.warningSoft
      : liveDataAvailable && snapshot.isActive
        ? colors.primarySoft
        : colors.mutedSurface;
  const stateLabel = isCircuitOpen
    ? '熔断中'
    : isCircuitRecovering
      ? '恢复检测'
      : provider.isEnabled
        ? liveDataAvailable
          ? snapshot.isActive ? '正在调用' : '空闲'
          : hasSessionObservation ? '会话观察' : '实时待确认'
        : '已停用';
  const capacityLabel = !slot
    ? '实时待确认'
    : liveDataAvailable
      ? snapshot.totalSlots > 0
        ? `${snapshot.usedSlots} / ${snapshot.totalSlots}`
        : `${snapshot.usedSlots} / 无上限`
      : snapshot.totalSlots > 0
        ? `会话 ${snapshot.usedSlots} / ${snapshot.totalSlots}`
        : `会话 ${snapshot.usedSlots}`;
  const detailButtonLabel = expanded ? `收起 ${provider.name} 的运行详情` : `展开 ${provider.name} 的运行详情`;
  const metricsPerRow = viewportWidth >= 720 ? 3 : 2;
  const probe = provider.upstreamBillingProbe;
  const probeMultiplier = probe?.effectiveRateMultiplier;
  const resolvedMultiplier = resolveCchProviderMultiplier(provider);
  const nextProbeAt = provider.upstreamBillingProbeNextAt ?? probe?.nextProbeAt;
  const statistics = provider.statistics;
  const hasTodayTraffic = (statistics?.todayCalls ?? 0) > 0;
  const tokenBreakdown = [
    statistics?.inputTokens === undefined ? null : `输入 ${formatTokenValue(statistics.inputTokens)}`,
    statistics?.outputTokens === undefined ? null : `输出 ${formatTokenValue(statistics.outputTokens)}`,
  ].filter((part): part is string => part !== null);
  const headlineMetrics = [
    {
      label: '今日总倍率',
      value: formatMultiplier(resolvedMultiplier.value),
      meta: resolvedMultiplier.source === 'probe'
        ? '探测返回'
        : resolvedMultiplier.source === 'historical-probe'
          ? '沿用上次探测'
          : resolvedMultiplier.source === 'manual'
            ? '用户设置'
            : '暂无有效倍率',
      color: resolvedMultiplier.value === null ? colors.text : colors.primary,
    },
    {
      label: '今日费用',
      value: formatCost(statistics?.todayCost),
      meta: `今日 ${statistics?.todayCalls ?? 0} 次`,
      color: colors.text,
    },
    {
      label: '今日 Token',
      value: hasTodayTraffic && statistics?.totalTokens !== undefined
        ? formatTokenValue(statistics.totalTokens)
        : '--',
      meta: hasTodayTraffic && tokenBreakdown.length > 0 ? tokenBreakdown.join(' · ') : '今日无调用',
      color: hasTodayTraffic && statistics?.totalTokens !== undefined ? colors.primary : colors.text,
    },
    {
      label: '缓存命中',
      value: formatPercent(statistics?.cacheHitRate),
      meta: statistics?.cacheReadTokens === undefined
        ? '缓存读 --'
        : `缓存读 ${formatTokenValue(statistics.cacheReadTokens)}`,
      color: colors.text,
    },
    {
      label: '首字延迟',
      value: formatLatency(statistics?.avgTtftMs),
      meta: statistics?.lastCallModel
        ? `${statistics.lastCallModel} · ${formatRecentCallTime(statistics.lastCallTime)}`
        : `最近 ${formatRecentCallTime(statistics?.lastCallTime)}`,
      color: colors.text,
    },
    {
      label: '成功率',
      value: formatPercent(statistics?.successRate),
      meta: statistics === undefined || statistics.coveredRequestCount === undefined
        ? '暂无统计'
        : `费用覆盖 ${statistics.coveredRequestCount}/${statistics.todayCalls}`,
      color: colors.text,
    },
  ];

  return (
    <GlassSurface tier="card" contentStyle={{ paddingTop: 2 }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 8, height: 8, marginTop: 6, borderRadius: 4, backgroundColor: stateColor }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{provider.name}</Text>
            <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 16, color: colors.subtext }}>{provider.providerType || '未知类型'} · {provider.isEnabled ? '已启用' : '已停用'}{provider.groupTag ? ` · ${provider.groupTag}` : ''}{provider.priorityLocked ? ' · 已固定置顶' : ''}</Text>
          </View>
          <View style={{ flexShrink: 0, alignItems: 'flex-end', gap: 6 }}>
            <Pressable
              accessibilityLabel={provider.priorityLocked ? `取消固定 ${provider.name} 的供应商顺序` : `置顶并固定 ${provider.name}`}
              accessibilityRole="button"
              disabled={priorityLockPending}
              onPress={onTogglePriorityLock}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, borderRadius: 8, backgroundColor: provider.priorityLocked ? colors.primarySoft : colors.mutedSurface, paddingHorizontal: 8, opacity: priorityLockPending ? 0.55 : pressed ? 0.72 : 1 })}
            >
              {priorityLockPending ? <ActivityIndicator color={colors.primary} size="small" /> : provider.priorityLocked ? <PinOff color={colors.primary} size={13} /> : <Pin color={colors.subtext} size={13} />}
              <Text style={{ fontSize: 10, fontWeight: '700', color: provider.priorityLocked ? colors.primary : colors.subtext }}>{provider.priorityLocked ? '取消固定' : '置顶固定'}</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ borderRadius: 8, backgroundColor: colors.mutedSurface, paddingHorizontal: 8, paddingVertical: 5 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.subtext }}>并发 {capacityLabel}</Text>
              </View>
              {isCircuitOpen ? (
                <Pressable
                  accessibilityLabel={`恢复 ${provider.name} 的 Key 熔断`}
                  accessibilityRole="button"
                  disabled={resetPending}
                  onPress={onResetCircuit}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, borderRadius: 8, backgroundColor: colors.dangerSoft, paddingHorizontal: 8, opacity: resetPending ? 0.55 : pressed ? 0.72 : 1 })}
                >
                  {resetPending ? <ActivityIndicator color={colors.danger} size="small" /> : <RotateCcw color={colors.danger} size={13} />}
                  <Text style={{ fontSize: 10, fontWeight: '700', color: colors.danger }}>{resetPending ? '恢复中' : '恢复熔断'}</Text>
                </Pressable>
              ) : (
                <View style={{ borderRadius: 8, backgroundColor: stateBackground, paddingHorizontal: 8, paddingVertical: 5 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: stateColor }}>{stateLabel}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -4 }}>
          {headlineMetrics.map((metric) => (
            <View key={metric.label} style={{ width: `${100 / metricsPerRow}%`, padding: 4 }}>
              <View style={{ minHeight: 74, justifyContent: 'center', borderRadius: 12, backgroundColor: glass.insetFill, paddingHorizontal: 11, paddingVertical: 10 }}>
                <Text style={{ fontSize: 10, color: colors.subtext }}>{metric.label}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={{ marginTop: 4, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'], color: metric.color }}>{metric.value}</Text>
                <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 10, color: metric.color === colors.primary ? colors.primary : colors.subtext }}>{metric.meta}</Text>
              </View>
            </View>
          ))}
        </View>

      </View>

      <Pressable
        accessibilityLabel={detailButtonLabel}
        accessibilityRole="button"
        onPress={onToggleDetails}
        style={({ pressed }) => ({ marginHorizontal: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, backgroundColor: glass.insetFill, paddingHorizontal: 12, paddingVertical: 10, opacity: pressed ? 0.68 : 1 })}
      >
        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.subtext }}>{expanded ? '收起运行详情' : '查看运行详情'}</Text>
        {expanded ? <ChevronUp color={colors.subtext} size={16} /> : <ChevronDown color={colors.subtext} size={16} />}
      </Pressable>

      {expanded ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 6 }}>
            <DetailMetric label="当前倍率" value={formatMultiplier(provider.costMultiplier)} />
            <DetailMetric label="探测倍率" value={formatMultiplier(probeMultiplier)} tone={probe?.status === 'failed' ? 'warning' : undefined} />
            <DetailMetric label="探测状态" value={probeStatusLabel(provider)} tone={probe?.status === 'failed' || probe?.status === 'unsupported' ? 'warning' : undefined} />
            <DetailMetric label="最近探测" value={formatProbeTime(probe?.lastAttemptAt)} />
            <DetailMetric label="下次探测" value={provider.upstreamBillingProbeEnabled === false ? '已关闭' : formatProbeTime(nextProbeAt)} />
            <DetailMetric label="请求时加权" value={formatMultiplier(provider.statistics?.effectiveRateMultiplier)} />
            <DetailMetric label="上游估算" value={provider.statistics?.todayUpstreamCost === undefined ? '--' : formatCost(provider.statistics.todayUpstreamCost)} />
            <DetailMetric label="费用覆盖" value={coverageLabel(provider.statistics)} tone={provider.statistics?.upstreamCostStatus === 'partial' ? 'warning' : undefined} />
            <DetailMetric label="缓存写" value={provider.statistics?.cacheCreationTokens === undefined ? '--' : formatTokenValue(provider.statistics.cacheCreationTokens)} />
          </View>

          <View style={{ borderRadius: 12, backgroundColor: glass.insetFill, padding: 12, marginBottom: 10 }}>
            <Text style={{ fontSize: 10, color: colors.subtext }}>限制</Text>
            <Text style={{ marginTop: 4, fontSize: 11, lineHeight: 18, color: colors.text }}>会话 {provider.limitConcurrentSessions === undefined ? '--' : provider.limitConcurrentSessions} · 5 小时 {formatLimit(provider.limit5hUsd)} · 日 {formatLimit(provider.limitDailyUsd)} · 周 {formatLimit(provider.limitWeeklyUsd)} · 月 {formatLimit(provider.limitMonthlyUsd)} · 累计 {formatLimit(provider.limitTotalUsd)}</Text>
          </View>

          {(provider.statistics?.models ?? []).length > 0 ? (
            <View style={{ borderRadius: 12, backgroundColor: glass.insetFill, padding: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 10, color: colors.subtext }}>模型调用</Text>
              {(provider.statistics?.models ?? []).map((model) => (
                <View key={model.model} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: '600', color: colors.text }}>{model.model}</Text>
                  <Text numberOfLines={1} style={{ color: colors.subtext, fontSize: 10 }}>{model.todayCalls} 次 · {formatTokenValue(model.totalTokens)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </GlassSurface>
  );
}

export function CchProvidersScreen() {
  const config = useSnapshot(cchConfigState);
  const hasSession = hasCchAdminSession(config);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [expandedProviderId, setExpandedProviderId] = useState<number | null>(null);
  const [automationFeedback, setAutomationFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);
  const scope = config.baseUrl;
  const providersQuery = useQuery({
    queryKey: ['cch', 'providers', scope],
    queryFn: listCchProviders,
    enabled: hasSession,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const healthQuery = useQuery({
    queryKey: ['cch', 'provider-health', scope],
    queryFn: getCchProviderHealth,
    enabled: hasSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const slotsQuery = useQuery({
    queryKey: ['cch', 'provider-slots', scope],
    queryFn: getCchProviderSlots,
    enabled: hasSession,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const proxyStatusQuery = useQuery({
    queryKey: ['cch', 'proxy-status', scope],
    queryFn: getCchProxyStatus,
    enabled: hasSession,
    staleTime: 2_000,
    refetchInterval: 5_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const systemSettingsQuery = useQuery({
    queryKey: ['cch', 'system-settings', scope],
    queryFn: getCchSystemSettings,
    enabled: hasSession,
    staleTime: 60_000,
    retry: false,
  });
  const slotsByProviderId = useMemo(
    () => new Map((slotsQuery.data?.items ?? []).map((slot) => [slot.providerId, slot])),
    [slotsQuery.data?.items]
  );
  const providerItems = providersQuery.data?.items ?? [];
  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const provider of providerItems) {
      for (const group of resolveCchProviderGroups(provider.groupTag)) {
        counts.set(group, (counts.get(group) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => {
        if (left.name === 'default') return -1;
        if (right.name === 'default') return 1;
        return left.name.localeCompare(right.name, 'zh-CN');
      });
  }, [providerItems]);
  const liveStatus = useMemo(() => {
    return summarizeCchProxyStatus(proxyStatusQuery.data?.users ?? []);
  }, [proxyStatusQuery.data?.users]);
  const liveDataAvailable = proxyStatusQuery.isSuccess && liveStatus.hasProviderDetails;
  const liveSlotsByProviderId = useMemo(() => {
    if (!liveDataAvailable) return slotsByProviderId;
    return new Map(providerItems.map((provider) => {
      const fallback = slotsByProviderId.get(provider.id);
      return [provider.id, {
        providerId: provider.id,
        name: provider.name,
        usedSlots: liveStatus.activeRequestsByProviderId.get(provider.id) ?? 0,
        totalSlots: provider.limitConcurrentSessions ?? fallback?.totalSlots ?? 0,
      }];
    }));
  }, [liveDataAvailable, liveStatus.activeRequestsByProviderId, providerItems, slotsByProviderId]);
  const providers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return [...providerItems]
      .filter((provider) => !keyword || `${provider.name} ${provider.providerType ?? ''} ${provider.groupTag ?? ''}`.toLowerCase().includes(keyword))
      .filter((provider) => selectedGroup === null || resolveCchProviderGroups(provider.groupTag).includes(selectedGroup))
      .sort((left, right) => compareCchProvidersByLiveActivity(left, right, liveSlotsByProviderId));
  }, [liveSlotsByProviderId, providerItems, search, selectedGroup]);
  const activeProviderCount = useMemo(
    () => providerItems.filter((provider) => getCchProviderSlotSnapshot(liveSlotsByProviderId.get(provider.id)).isActive).length,
    [liveSlotsByProviderId, providerItems]
  );

  useFocusEffect(useCallback(() => {
    if (!hasSession) return;
    void queryClient.refetchQueries({ queryKey: ['cch'], type: 'active' });
  }, [hasSession, queryClient]));

  const probeAllMutation = useMutation({
    mutationFn: probeCchProvidersUpstreamBilling,
    onSuccess: async (result) => {
      setAutomationFeedback({
        tone: result.failed > 0 ? 'danger' : 'success',
        message: `探测完成：成功 ${result.ok}，不支持 ${result.unsupported}，失败 ${result.failed}。`,
      });
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['cch', 'providers', scope] }),
        queryClient.invalidateQueries({ queryKey: ['cch', 'provider-health', scope] }),
      ]);
    },
    onError: (error) => setAutomationFeedback({ tone: 'danger', message: `批量探测失败：${getCchErrorMessage(error)}` }),
  });
  const autoSortMutation = useMutation({
    mutationFn: updateCchAutoSortProviderPriority,
    onSuccess: (settings) => {
      queryClient.setQueryData(['cch', 'system-settings', scope], settings);
      setAutomationFeedback({
        tone: 'success',
        message: settings.autoSortProviderPriorityEnabled ? '自动排序已开启。' : '自动排序已关闭，可继续手动排序。',
      });
    },
    onError: (error) => setAutomationFeedback({ tone: 'danger', message: `更新自动排序失败：${getCchErrorMessage(error)}` }),
  });
  const resetCircuitMutation = useMutation({
    mutationFn: resetCchProviderCircuit,
    onSuccess: async () => {
      setAutomationFeedback({ tone: 'success', message: 'Key 熔断状态已恢复。' });
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['cch', 'provider-health', scope] }),
        queryClient.invalidateQueries({ queryKey: ['cch', 'providers', scope] }),
      ]);
    },
    onError: (error) => setAutomationFeedback({ tone: 'danger', message: `恢复 Key 熔断失败：${getCchErrorMessage(error)}` }),
  });
  const resetAllCircuitsMutation = useMutation({
    mutationFn: resetCchProviderCircuitsBatch,
    onSuccess: async (count) => {
      setAutomationFeedback({ tone: 'success', message: `已恢复 ${count} 家供应商的熔断状态。` });
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['cch', 'provider-health', scope] }),
        queryClient.invalidateQueries({ queryKey: ['cch', 'providers', scope] }),
      ]);
    },
    onError: (error) => setAutomationFeedback({ tone: 'danger', message: `一键恢复熔断失败：${getCchErrorMessage(error)}` }),
  });
  const priorityLockMutation = useMutation({
    mutationFn: ({ providerId, locked }: { providerId: number; locked: boolean }) =>
      setCchProviderPriorityLocked(providerId, locked),
    onSuccess: async (provider) => {
      setAutomationFeedback({ tone: 'success', message: provider.priorityLocked ? `已将 ${provider.name} 置顶并固定。` : `已取消 ${provider.name} 的固定顺序。` });
      await queryClient.invalidateQueries({ queryKey: ['cch', 'providers', scope] });
    },
    onError: (error) => setAutomationFeedback({ tone: 'danger', message: `更新固定顺序失败：${getCchErrorMessage(error)}` }),
  });

  async function refresh() {
    await Promise.allSettled([providersQuery.refetch(), healthQuery.refetch(), slotsQuery.refetch(), proxyStatusQuery.refetch(), systemSettingsQuery.refetch()]);
  }

  function confirmCircuitReset(provider: CchProvider) {
    Alert.alert('恢复 Key 熔断', `确认恢复“${provider.name}”的 Key 熔断状态？`, [
      { text: '取消', style: 'cancel' },
      { text: '恢复熔断', style: 'destructive', onPress: () => resetCircuitMutation.mutate(provider.id) },
    ]);
  }

  function confirmCircuitResetAll() {
    const openProviderIds = Object.entries(healthQuery.data ?? {})
      .filter(([, circuit]) => circuit.circuitState === 'open')
      .map(([id]) => Number(id));
    if (openProviderIds.length === 0) {
      setAutomationFeedback({ tone: 'success', message: '当前没有熔断中的供应商。' });
      return;
    }
    Alert.alert('一键恢复熔断', `确认恢复 ${openProviderIds.length} 家熔断供应商？`, [
      { text: '取消', style: 'cancel' },
      { text: '恢复全部', style: 'destructive', onPress: () => resetAllCircuitsMutation.mutate(openProviderIds) },
    ]);
  }

  return (
    <ScreenShell
      title="供应商"
      subtitle={liveDataAvailable ? `正在调用 ${activeProviderCount} 家 · 当前请求每 5 秒更新` : 'CCH 上游供应商、熔断状态与实时并发'}
      variant="minimal"
      refreshing={providersQuery.isRefetching || healthQuery.isRefetching || slotsQuery.isRefetching || proxyStatusQuery.isRefetching}
      onRefresh={refresh}
      right={(
        <Pressable accessibilityLabel="刷新 CCH 供应商" accessibilityRole="button" onPress={() => void refresh()} style={({ pressed }) => ({ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.72 : 1 })}>
          <RefreshCw color={colors.primary} size={17} />
        </Pressable>
      )}
    >
      {!hasSession ? (
        <ListCard title="尚未连接 CCH" meta="请在设置页选择 CCH 并填写 CCH Admin Key。" icon={Server} />
      ) : (
        <>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="搜索供应商或类型"
            placeholderTextColor="#8b9094"
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
          />
          {groupOptions.length > 0 ? (
            <GlassSurface cornerRadius={radius.md} contentStyle={{ gap: 10, padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Layers3 color={colors.subtext} size={14} />
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>供应商分组</Text>
                </View>
                <Text style={{ color: colors.subtext, fontSize: 11 }}>显示 {providers.length} / {providerItems.length} 家</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <GroupFilterChip label="全部分组" count={providerItems.length} selected={selectedGroup === null} onPress={() => setSelectedGroup(null)} />
                {groupOptions.map((group) => (
                  <GroupFilterChip
                    key={group.name}
                    label={group.name === 'default' ? '默认分组' : group.name}
                    count={group.count}
                    selected={selectedGroup === group.name}
                    onPress={() => setSelectedGroup(group.name)}
                  />
                ))}
              </View>
            </GlassSurface>
          ) : null}
          <GlassSurface cornerRadius={radius.md} contentStyle={{ padding: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 11 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>上游倍率探测</Text>
                <Text style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>每 1 小时自动探测，可立即刷新全部供应商。</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable
                  accessibilityLabel="探测全部供应商的上游倍率"
                  accessibilityRole="button"
                  disabled={probeAllMutation.isPending}
                  onPress={() => probeAllMutation.mutate()}
                  style={({ pressed }) => ({ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, backgroundColor: colors.primary, paddingHorizontal: 10, opacity: probeAllMutation.isPending ? 0.55 : pressed ? 0.76 : 1 })}
                >
                  {probeAllMutation.isPending ? <ActivityIndicator color="#ffffff" size="small" /> : <RefreshCw color="#ffffff" size={14} />}
                  <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>{probeAllMutation.isPending ? '探测中' : '立即探测'}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="一键恢复全部熔断的供应商"
                  accessibilityRole="button"
                  disabled={resetAllCircuitsMutation.isPending}
                  onPress={confirmCircuitResetAll}
                  style={({ pressed }) => ({ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, backgroundColor: colors.dangerSoft, paddingHorizontal: 10, opacity: resetAllCircuitsMutation.isPending ? 0.55 : pressed ? 0.76 : 1 })}
                >
                  {resetAllCircuitsMutation.isPending ? <ActivityIndicator color={colors.danger} size="small" /> : <RotateCcw color={colors.danger} size={14} />}
                  <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>{resetAllCircuitsMutation.isPending ? '恢复中' : '一键恢复熔断'}</Text>
                </Pressable>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4, borderTopColor: glass.borderSoft, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 11 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>按探测倍率自动排序</Text>
                <Text style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>每 2 小时执行；关闭后保留手动排序。</Text>
              </View>
              <Switch
                accessibilityLabel="切换按探测倍率自动排序"
                value={systemSettingsQuery.data?.autoSortProviderPriorityEnabled ?? false}
                disabled={systemSettingsQuery.isLoading || autoSortMutation.isPending || systemSettingsQuery.isError}
                onValueChange={(enabled) => autoSortMutation.mutate(enabled)}
                trackColor={{ false: colors.mutedSurface, true: '#111315' }}
                thumbColor="#ffffff"
              />
            </View>
          </GlassSurface>
          {systemSettingsQuery.error ? <Text style={{ fontSize: 11, lineHeight: 17, color: colors.warning }}>自动排序设置暂不可用：{getCchErrorMessage(systemSettingsQuery.error)}</Text> : null}
          {automationFeedback ? <Text style={{ fontSize: 11, lineHeight: 17, color: automationFeedback.tone === 'success' ? colors.primary : colors.danger }}>{automationFeedback.message}</Text> : null}
          {slotsQuery.error ? <Text style={{ fontSize: 11, lineHeight: 17, color: colors.warning }}>会话观察暂不可用：{getCchErrorMessage(slotsQuery.error)}</Text> : null}
          {proxyStatusQuery.error ? <Text style={{ fontSize: 11, lineHeight: 17, color: colors.warning }}>当前请求暂不可用；供应商仅显示会话观察：{getCchErrorMessage(proxyStatusQuery.error)}</Text> : null}
          {proxyStatusQuery.isSuccess && !liveStatus.hasProviderDetails ? <Text style={{ fontSize: 11, lineHeight: 17, color: colors.warning }}>当前请求明细不完整；供应商仅显示会话观察。</Text> : null}
          {healthQuery.error ? <Text style={{ fontSize: 11, lineHeight: 17, color: colors.warning }}>熔断状态暂不可用：{getCchErrorMessage(healthQuery.error)}</Text> : null}
          {providersQuery.isLoading ? <Text style={{ color: colors.subtext, fontSize: 13 }}>正在读取供应商...</Text> : null}
          {providersQuery.error ? <ListCard title="供应商读取失败" meta={getCchErrorMessage(providersQuery.error)} icon={Server} badge="异常" badgeTone="danger" /> : null}
          {!providersQuery.isLoading && !providersQuery.error && providers.length === 0 ? <ListCard title="没有可见供应商" meta="当前筛选条件下没有 CCH 供应商。" icon={Server} /> : null}
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              circuit={healthQuery.data?.[`${provider.id}`]}
              slot={liveSlotsByProviderId.get(provider.id)}
              activeRequestCount={liveDataAvailable ? liveStatus.activeRequestsByProviderId.get(provider.id) ?? 0 : undefined}
              liveDataAvailable={liveDataAvailable}
              expanded={expandedProviderId === provider.id}
              onToggleDetails={() => setExpandedProviderId((current) => current === provider.id ? null : provider.id)}
              onResetCircuit={() => confirmCircuitReset(provider)}
              resetPending={resetCircuitMutation.isPending && resetCircuitMutation.variables === provider.id}
              onTogglePriorityLock={() => priorityLockMutation.mutate({ providerId: provider.id, locked: !provider.priorityLocked })}
              priorityLockPending={priorityLockMutation.isPending && priorityLockMutation.variables?.providerId === provider.id}
            />
          ))}
        </>
      )}
    </ScreenShell>
  );
}
