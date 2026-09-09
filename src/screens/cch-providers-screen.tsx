import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, RefreshCw, RotateCcw, Server } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { compareCchProvidersByLiveActivity, getCchProviderSlotSnapshot } from '@/src/lib/cch-metrics';
import { formatTokenValue } from '@/src/lib/formatters';
import {
  getCchProviderHealth,
  getCchProviderSlots,
  getCchSystemSettings,
  listCchProviders,
  probeCchProvidersUpstreamBilling,
  resetCchProviderCircuit,
  updateCchAutoSortProviderPriority,
} from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';
import type { CchProvider, CchProviderCircuit, CchProviderSlot, CchProviderStatistics } from '@/src/types/cch';

const { useSnapshot } = require('valtio/react');

const colors = {
  card: '#ffffff',
  border: '#dfe5e1',
  mutedSurface: '#edf0ee',
  text: '#17201d',
  subtext: '#65706c',
  primary: '#1f6759',
  primarySoft: '#e7f2ee',
  warning: '#946313',
  warningSoft: '#fff0c7',
  danger: '#b84a32',
  dangerSoft: '#ffe7e0',
};

function formatCost(value: string | number | undefined) {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(amount > 0 && amount < 0.01 ? 4 : 2)}` : '--';
}

function formatMultiplier(value: string | number | null | undefined) {
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
  expanded,
  onToggleDetails,
  onResetCircuit,
  resetPending,
}: {
  provider: CchProvider;
  circuit?: CchProviderCircuit;
  slot?: CchProviderSlot;
  expanded: boolean;
  onToggleDetails: () => void;
  onResetCircuit: () => void;
  resetPending: boolean;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const snapshot = getCchProviderSlotSnapshot(slot);
  const isCircuitOpen = circuit?.circuitState === 'open';
  const isCircuitRecovering = circuit?.circuitState === 'half-open';
  // ponytail: provider-slots is the only per-provider live source; unlimited providers stay untracked until CCH exposes active provider IDs.
  const hasLiveTracking = snapshot.totalSlots > 0 || snapshot.isActive;
  const stateColor = isCircuitOpen ? colors.danger : isCircuitRecovering ? colors.warning : snapshot.isActive ? colors.primary : colors.subtext;
  const stateBackground = isCircuitOpen ? colors.dangerSoft : isCircuitRecovering ? colors.warningSoft : snapshot.isActive ? colors.primarySoft : colors.mutedSurface;
  const stateLabel = isCircuitOpen
    ? '熔断中'
    : isCircuitRecovering
      ? '恢复检测'
      : snapshot.isActive
        ? '正在调用'
        : provider.isEnabled
          ? hasLiveTracking ? '空闲' : '未追踪'
          : '已停用';
  const capacityLabel = !slot
    ? '--'
    : snapshot.totalSlots > 0
      ? `${snapshot.usedSlots} / ${snapshot.totalSlots}`
      : snapshot.isActive
        ? `${snapshot.usedSlots} / 无上限`
        : '--';
  const detailButtonLabel = expanded ? `收起 ${provider.name} 的运行详情` : `展开 ${provider.name} 的运行详情`;
  const metricsPerRow = viewportWidth >= 720 ? 4 : 2;
  const probe = provider.upstreamBillingProbe;
  const probeMultiplier = probe?.effectiveRateMultiplier;
  const nextProbeAt = provider.upstreamBillingProbeNextAt ?? probe?.nextProbeAt;
  const headlineMetrics = [
    {
      label: '今日总倍率',
      value: formatMultiplier(provider.statistics?.effectiveRateMultiplier),
      meta: provider.statistics?.effectiveRateMultiplier == null ? '暂无有效倍率' : '按上游费用加权',
      color: provider.statistics?.effectiveRateMultiplier == null ? colors.text : colors.primary,
    },
    {
      label: '今日费用',
      value: formatCost(provider.statistics?.todayCost),
      meta: `今日 ${provider.statistics?.todayCalls ?? 0} 次`,
      color: colors.text,
    },
    {
      label: '缓存命中',
      value: formatPercent(provider.statistics?.cacheHitRate),
      meta: provider.statistics?.totalTokens === undefined ? 'Token --' : `Token ${formatTokenValue(provider.statistics.totalTokens)}`,
      color: colors.text,
    },
    {
      label: '首字延迟',
      value: formatLatency(provider.statistics?.avgTtftMs),
      meta: provider.statistics?.lastCallModel
        ? `${provider.statistics.lastCallModel} · ${formatRecentCallTime(provider.statistics.lastCallTime)}`
        : `最近 ${formatRecentCallTime(provider.statistics?.lastCallTime)}`,
      color: colors.text,
    },
  ];

  return (
    <View style={{ overflow: 'hidden', borderRadius: 8, borderColor: snapshot.isActive ? '#bdd9d0' : colors.border, borderWidth: 1, backgroundColor: colors.card }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 8, height: 8, marginTop: 6, borderRadius: 4, backgroundColor: stateColor }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{provider.name} <Text style={{ fontSize: 10, fontWeight: '600', color: stateColor }}>· 并发 {capacityLabel}</Text></Text>
            <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 11, color: colors.subtext }}>{provider.providerType || '未知类型'} · {provider.isEnabled ? '已启用' : '已停用'}</Text>
          </View>
          {isCircuitOpen ? (
            <Pressable
              accessibilityLabel={`恢复 ${provider.name} 的 Key 熔断`}
              accessibilityRole="button"
              disabled={resetPending}
              onPress={onResetCircuit}
              style={({ pressed }) => ({ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, borderRadius: 8, backgroundColor: colors.dangerSoft, paddingHorizontal: 8, opacity: resetPending ? 0.55 : pressed ? 0.72 : 1 })}
            >
              {resetPending ? <ActivityIndicator color={colors.danger} size="small" /> : <RotateCcw color={colors.danger} size={13} />}
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.danger }}>{resetPending ? '恢复中' : '恢复熔断'}</Text>
            </Pressable>
          ) : (
            <View style={{ flexShrink: 0, borderRadius: 8, backgroundColor: stateBackground, paddingHorizontal: 8, paddingVertical: 5 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: stateColor }}>{stateLabel}</Text>
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, borderTopColor: colors.border, borderTopWidth: 1 }}>
          {headlineMetrics.map((metric, index) => (
            <View key={metric.label} style={{ width: metricsPerRow === 4 ? '25%' : '50%', minWidth: 0, minHeight: 76, borderTopColor: colors.border, borderTopWidth: index >= metricsPerRow ? 1 : 0, borderLeftColor: colors.border, borderLeftWidth: index % metricsPerRow === 0 ? 0 : 1, paddingLeft: index % metricsPerRow === 0 ? 0 : 12, paddingTop: 11, paddingBottom: 9 }}>
              <Text style={{ fontSize: 10, color: colors.subtext }}>{metric.label}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={{ marginTop: 4, fontSize: 20, fontWeight: '700', color: metric.color }}>{metric.value}</Text>
              <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 10, color: metric.color === colors.primary ? colors.primary : colors.subtext }}>{metric.meta}</Text>
            </View>
          ))}
        </View>

      </View>

      <Pressable
        accessibilityLabel={detailButtonLabel}
        accessibilityRole="button"
        onPress={onToggleDetails}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopColor: colors.border, borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10, opacity: pressed ? 0.68 : 1 })}
      >
        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.subtext }}>{expanded ? '收起运行详情' : '查看运行详情'}</Text>
        {expanded ? <ChevronUp color={colors.subtext} size={16} /> : <ChevronDown color={colors.subtext} size={16} />}
      </Pressable>

      {expanded ? (
        <View style={{ borderTopColor: colors.border, borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 2 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <DetailMetric label="当前倍率" value={formatMultiplier(provider.costMultiplier)} />
            <DetailMetric label="探测倍率" value={formatMultiplier(probeMultiplier)} tone={probe?.status === 'failed' ? 'warning' : undefined} />
            <DetailMetric label="探测状态" value={probeStatusLabel(provider)} tone={probe?.status === 'failed' || probe?.status === 'unsupported' ? 'warning' : undefined} />
            <DetailMetric label="最近探测" value={formatProbeTime(probe?.lastAttemptAt)} />
            <DetailMetric label="下次探测" value={provider.upstreamBillingProbeEnabled === false ? '已关闭' : formatProbeTime(nextProbeAt)} />
            <DetailMetric label="请求时加权" value={formatMultiplier(provider.statistics?.effectiveRateMultiplier)} />
            <DetailMetric label="上游估算" value={provider.statistics?.todayUpstreamCost === undefined ? '--' : formatCost(provider.statistics.todayUpstreamCost)} />
            <DetailMetric label="费用覆盖" value={coverageLabel(provider.statistics)} tone={provider.statistics?.upstreamCostStatus === 'partial' ? 'warning' : undefined} />
            <DetailMetric label="总 Token" value={provider.statistics?.totalTokens === undefined ? '--' : formatTokenValue(provider.statistics.totalTokens)} />
            <DetailMetric label="成功率" value={formatPercent(provider.statistics?.successRate)} />
          </View>

          <View style={{ borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 11, paddingBottom: 11 }}>
            <Text style={{ fontSize: 10, color: colors.subtext }}>限制</Text>
            <Text style={{ marginTop: 4, fontSize: 11, lineHeight: 18, color: colors.text }}>会话 {provider.limitConcurrentSessions === undefined ? '--' : provider.limitConcurrentSessions} · 5 小时 {formatLimit(provider.limit5hUsd)} · 日 {formatLimit(provider.limitDailyUsd)} · 周 {formatLimit(provider.limitWeeklyUsd)} · 月 {formatLimit(provider.limitMonthlyUsd)} · 累计 {formatLimit(provider.limitTotalUsd)}</Text>
          </View>

          {(provider.statistics?.models ?? []).length > 0 ? (
            <View style={{ borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 11, paddingBottom: 11 }}>
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
    </View>
  );
}

export function CchProvidersScreen() {
  const config = useSnapshot(cchConfigState);
  const hasSession = hasCchAdminSession(config);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
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
  const providers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return [...providerItems]
      .filter((provider) => !keyword || `${provider.name} ${provider.providerType ?? ''}`.toLowerCase().includes(keyword))
      .sort((left, right) => compareCchProvidersByLiveActivity(left, right, slotsByProviderId));
  }, [providerItems, search, slotsByProviderId]);
  const activeProviderCount = useMemo(
    () => providerItems.filter((provider) => getCchProviderSlotSnapshot(slotsByProviderId.get(provider.id)).isActive).length,
    [providerItems, slotsByProviderId]
  );

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

  async function refresh() {
    await Promise.allSettled([providersQuery.refetch(), healthQuery.refetch(), slotsQuery.refetch(), systemSettingsQuery.refetch()]);
  }

  function confirmCircuitReset(provider: CchProvider) {
    Alert.alert('恢复 Key 熔断', `确认恢复“${provider.name}”的 Key 熔断状态？`, [
      { text: '取消', style: 'cancel' },
      { text: '恢复熔断', style: 'destructive', onPress: () => resetCircuitMutation.mutate(provider.id) },
    ]);
  }

  return (
    <ScreenShell
      title="供应商"
      subtitle={slotsQuery.data ? `正在调用 ${activeProviderCount} 家 · 实时并发每 5 秒更新` : 'CCH 上游供应商、熔断状态与实时并发'}
      variant="minimal"
      refreshing={providersQuery.isRefetching || healthQuery.isRefetching || slotsQuery.isRefetching}
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
            placeholderTextColor="#8a948f"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 13, color: colors.text, fontSize: 14 }}
          />
          <View style={{ overflow: 'hidden', borderRadius: 8, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 11 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>上游倍率探测</Text>
                <Text style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>每 1 小时自动探测，可立即刷新全部供应商。</Text>
              </View>
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
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopColor: colors.border, borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 11 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>按探测倍率自动排序</Text>
                <Text style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>每 2 小时执行；关闭后保留手动排序。</Text>
              </View>
              <Switch
                accessibilityLabel="切换按探测倍率自动排序"
                value={systemSettingsQuery.data?.autoSortProviderPriorityEnabled ?? false}
                disabled={systemSettingsQuery.isLoading || autoSortMutation.isPending || systemSettingsQuery.isError}
                onValueChange={(enabled) => autoSortMutation.mutate(enabled)}
                trackColor={{ false: colors.mutedSurface, true: colors.primarySoft }}
                thumbColor={systemSettingsQuery.data?.autoSortProviderPriorityEnabled ? colors.primary : '#ffffff'}
              />
            </View>
          </View>
          {systemSettingsQuery.error ? <Text style={{ fontSize: 11, lineHeight: 17, color: colors.warning }}>自动排序设置暂不可用：{getCchErrorMessage(systemSettingsQuery.error)}</Text> : null}
          {automationFeedback ? <Text style={{ fontSize: 11, lineHeight: 17, color: automationFeedback.tone === 'success' ? colors.primary : colors.danger }}>{automationFeedback.message}</Text> : null}
          {slotsQuery.error ? <Text style={{ fontSize: 11, lineHeight: 17, color: colors.warning }}>实时并发暂不可用：{getCchErrorMessage(slotsQuery.error)}</Text> : null}
          {healthQuery.error ? <Text style={{ fontSize: 11, lineHeight: 17, color: colors.warning }}>熔断状态暂不可用：{getCchErrorMessage(healthQuery.error)}</Text> : null}
          {providersQuery.isLoading ? <Text style={{ color: colors.subtext, fontSize: 13 }}>正在读取供应商...</Text> : null}
          {providersQuery.error ? <ListCard title="供应商读取失败" meta={getCchErrorMessage(providersQuery.error)} icon={Server} badge="异常" badgeTone="danger" /> : null}
          {!providersQuery.isLoading && !providersQuery.error && providers.length === 0 ? <ListCard title="没有可见供应商" meta="当前筛选条件下没有 CCH 供应商。" icon={Server} /> : null}
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              circuit={healthQuery.data?.[`${provider.id}`]}
              slot={slotsByProviderId.get(provider.id)}
              expanded={expandedProviderId === provider.id}
              onToggleDetails={() => setExpandedProviderId((current) => current === provider.id ? null : provider.id)}
              onResetCircuit={() => confirmCircuitReset(provider)}
              resetPending={resetCircuitMutation.isPending && resetCircuitMutation.variables === provider.id}
            />
          ))}
        </>
      )}
    </ScreenShell>
  );
}
