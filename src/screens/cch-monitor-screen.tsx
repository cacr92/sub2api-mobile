import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import {
  Activity,
  Clock3,
  RefreshCw,
  Server,
  Settings2,
  ShieldAlert,
  Wifi,
} from 'lucide-react-native';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { compareCchProvidersByLiveActivity, getCchProviderSlotSnapshot, summarizeCchProviders, summarizeCchProxyStatus } from '@/src/lib/cch-metrics';
import { formatTokenValue } from '@/src/lib/formatters';
import {
  getCchHealth,
  getCchOverview,
  getCchProviderHealth,
  getCchProviderSlots,
  getCchProxyStatus,
  getCchRealtime,
  listCchProviders,
} from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';
import { GlassSurface } from '@/src/components/glass-surface';
import { colors as themeColors, glass, radius, spacing, tileStyle } from '@/src/theme';
import type { CchActivity, CchProvider, CchProviderCircuit, CchProviderSlot, CchServerIdentity } from '@/src/types/cch';

const { useSnapshot } = require('valtio/react');

type MetricTone = 'primary' | 'warning' | 'danger';

const colors = themeColors;

function toFiniteNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatNumber(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatMoney(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const digits = Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

function formatLatency(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '--';
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function formatPercent(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--';
}

function formatMultiplier(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toFixed(2)}x` : '--';
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

function Section({ title, subtitle, children, right }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <GlassSurface contentStyle={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{title}</Text>
          {subtitle ? <Text style={{ marginTop: 5, fontSize: 12, lineHeight: 18, color: colors.subtext }}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <View style={{ marginTop: 14 }}>{children}</View>
    </GlassSurface>
  );
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string; tone?: MetricTone }> }) {
  const compact = items.length > 3;
  const columns = 3;
  // 末行不足一行时让这几格平分整行宽度，避免最后一个指标孤零零占一整行
  const lastRowCount = items.length % columns === 0 ? columns : items.length % columns;
  const lastRowStart = items.length - lastRowCount;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginVertical: -5 }}>
      {items.map((item, index) => {
        const inLastRow = index >= lastRowStart;
        const columnIndex = inLastRow ? index - lastRowStart : index % columns;
        const rowCount = inLastRow ? lastRowCount : columns;

        return (
          <View key={item.label} style={{ width: `${100 / rowCount}%`, padding: 5 }}>
            <View style={[tileStyle, { backgroundColor: glass.insetFill, minHeight: compact ? 66 : 76, justifyContent: 'center' }]}>
              <Text numberOfLines={1} style={{ fontSize: 11, color: colors.subtext }}>{item.label}</Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.65}
                style={{
                  marginTop: compact ? 4 : 6,
                  fontSize: compact ? 19 : 22,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
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
          </View>
        );
      })}
    </View>
  );
}

function CchIdentityBand({ identity, baseUrl, loading }: { identity?: CchServerIdentity; baseUrl: string; loading: boolean }) {
  const healthy = identity?.status.toLowerCase() === 'healthy';

  return (
    <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
        <View style={{ width: 39, height: 39, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: healthy ? colors.primarySoft : colors.mutedCard }}>
          <Server color={healthy ? colors.primary : colors.subtext} size={19} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>CC Hub</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 11, color: colors.subtext }}>{baseUrl}</Text>
          <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: healthy ? colors.primary : identity ? colors.danger : colors.subtext }} />
            <Text style={{ fontSize: 11, color: healthy ? colors.primary : identity ? colors.danger : colors.subtext }}>
              {loading ? '正在检测' : healthy ? '服务正常' : identity ? identity.status : '等待检测'}
            </Text>
          </View>
        </View>
      </View>
      <View style={{ marginTop: 13, flexDirection: 'row', borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 11 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 10, color: colors.subtext }}>版本</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ marginTop: 5, fontSize: 13, fontWeight: '700', color: colors.text }}>{identity?.version ? `v${identity.version.replace(/^v/i, '')}` : '--'}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, borderLeftColor: colors.border, borderLeftWidth: 1, paddingLeft: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Wifi color={colors.subtext} size={12} />
            <Text style={{ fontSize: 10, color: colors.subtext }}>连接耗时</Text>
          </View>
          <Text style={{ marginTop: 5, fontSize: 13, fontWeight: '700', color: colors.text }}>{formatLatency(identity?.latencyMs)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, borderLeftColor: colors.border, borderLeftWidth: 1, paddingLeft: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Clock3 color={colors.subtext} size={12} />
            <Text style={{ fontSize: 10, color: colors.subtext }}>检测时间</Text>
          </View>
          <Text style={{ marginTop: 5, fontSize: 13, fontWeight: '700', color: colors.text }}>{formatCheckedAt(identity?.checkedAt)}</Text>
        </View>
      </View>
    </View>
  );
}

function ProviderRows({
  providers,
  healthByProviderId,
  slotsByProviderId,
  liveDataAvailable,
}: {
  providers: CchProvider[];
  healthByProviderId: Record<string, CchProviderCircuit | undefined>;
  slotsByProviderId: Map<number, CchProviderSlot>;
  liveDataAvailable: boolean;
}) {
  const rows = [...providers]
    .sort((left, right) => compareCchProvidersByLiveActivity(left, right, slotsByProviderId))
    .slice(0, 5);

  if (rows.length === 0) {
    return <Text style={{ paddingVertical: 4, fontSize: 12, color: colors.subtext }}>当前没有可见供应商。</Text>;
  }

  return (
    <View style={{ borderTopColor: colors.border, borderTopWidth: 1 }}>
      {rows.map((provider) => {
        const circuit = healthByProviderId[`${provider.id}`];
        const slot = slotsByProviderId.get(provider.id);
        const slotSnapshot = getCchProviderSlotSnapshot(slot);
        const hasSessionObservation = Boolean(slot);
        const slotText = !slot
          ? '实时待确认'
          : liveDataAvailable
            ? slotSnapshot.totalSlots > 0
              ? `${formatNumber(slotSnapshot.usedSlots)} / ${formatNumber(slotSnapshot.totalSlots)}`
              : `${formatNumber(slotSnapshot.usedSlots)} / 无上限`
            : slotSnapshot.totalSlots > 0
              ? `会话 ${formatNumber(slotSnapshot.usedSlots)} / ${formatNumber(slotSnapshot.totalSlots)}`
              : `会话 ${formatNumber(slotSnapshot.usedSlots)}`;
        const stateLabel = circuit?.circuitState === 'open'
          ? '熔断中'
          : circuit?.circuitState === 'half-open'
            ? '恢复检测'
            : !provider.isEnabled
              ? '已停用'
              : liveDataAvailable
                ? slotSnapshot.isActive ? '正在调用' : '空闲'
                : hasSessionObservation ? '会话观察' : '实时待确认';
        const stateColor = circuit?.circuitState === 'open'
          ? colors.danger
          : circuit?.circuitState === 'half-open' || !provider.isEnabled
            ? colors.warning
            : liveDataAvailable && slotSnapshot.isActive
              ? colors.primary
              : !liveDataAvailable && hasSessionObservation
                ? colors.warning
              : colors.subtext;
        const todayCalls = provider.statistics
          ? formatNumber(toFiniteNumber(provider.statistics.todayCalls))
          : '--';
        const metrics = [
          { label: '费用', value: provider.statistics ? formatMoney(toFiniteNumber(provider.statistics.todayCost)) : '--', tone: colors.primary },
          { label: '缓存', value: formatPercent(provider.statistics?.cacheHitRate), tone: colors.text },
          { label: '首字', value: formatLatency(provider.statistics?.avgTtftMs), tone: colors.text },
          { label: '探测倍率', value: formatMultiplier(provider.upstreamBillingProbe?.effectiveRateMultiplier), tone: provider.upstreamBillingProbe?.effectiveRateMultiplier === undefined ? colors.text : colors.primary },
        ];
        const metricsPerRow = 2;

        return (
          <View key={provider.id} style={[tileStyle, { backgroundColor: glass.insetFill, marginBottom: 10 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
              <View style={{ width: 7, height: 7, marginTop: 6, borderRadius: 4, backgroundColor: stateColor }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{provider.name}</Text>
                <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>{provider.providerType || '未知类型'} · 今日 {todayCalls} 次</Text>
              </View>
              <View style={{ flexShrink: 0, alignItems: 'flex-end', gap: 5 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.subtext }}>并发 {slotText}</Text>
                <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: '700', color: stateColor }}>{stateLabel}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 11 }}>
              {metrics.map((metric, index) => (
                <View key={metric.label} style={{ width: '50%', minWidth: 0, paddingVertical: 4, paddingHorizontal: index % metricsPerRow === 0 ? 0 : 10 }}>
                  <Text style={{ fontSize: 10, color: colors.subtext }}>{metric.label}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={{ marginTop: 4, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], color: metric.tone }}>{metric.value}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ActivityRows({ activities }: { activities: CchActivity[] }) {
  if (activities.length === 0) {
    return <Text style={{ paddingVertical: 4, fontSize: 12, color: colors.subtext }}>当前没有近期调用记录。</Text>;
  }

  return (
    <View style={{ borderTopColor: colors.border, borderTopWidth: 1 }}>
      {activities.slice(0, 5).map((activity, index) => {
        const isError = typeof activity.status === 'number' && activity.status >= 400;
        const statusLabel = activity.status === 0 ? '进行中' : activity.status ? `${activity.status}` : '--';

        return (
          <View key={activity.id || `${activity.startTime ?? 'activity'}-${index}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 11 }}>
            <Activity color={isError ? colors.danger : colors.primary} size={16} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{activity.model || '未知模型'}</Text>
              <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>{activity.provider || '供应商未确认'} · {activity.user || '用户未确认'}</Text>
            </View>
            <View style={{ width: 66, minWidth: 0, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: isError ? colors.danger : colors.text }}>{statusLabel}</Text>
              <Text style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>{formatLatency(activity.latency)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function CchMonitorScreen() {
  const config = useSnapshot(cchConfigState);
  const hasCchSession = hasCchAdminSession(config);
  const queryClient = useQueryClient();
  const queryScope = config.baseUrl;

  const healthQuery = useQuery({
    queryKey: ['cch', 'health', queryScope],
    queryFn: getCchHealth,
    enabled: config.hydrated,
    staleTime: 60_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const overviewQuery = useQuery({
    queryKey: ['cch', 'overview', queryScope],
    queryFn: getCchOverview,
    enabled: hasCchSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const providersQuery = useQuery({
    queryKey: ['cch', 'providers', queryScope],
    queryFn: listCchProviders,
    enabled: hasCchSession,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const providerHealthQuery = useQuery({
    queryKey: ['cch', 'provider-health', queryScope],
    queryFn: getCchProviderHealth,
    enabled: hasCchSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const providerSlotsQuery = useQuery({
    queryKey: ['cch', 'provider-slots', queryScope],
    queryFn: getCchProviderSlots,
    enabled: hasCchSession,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const proxyStatusQuery = useQuery({
    queryKey: ['cch', 'proxy-status', queryScope],
    queryFn: getCchProxyStatus,
    enabled: hasCchSession,
    staleTime: 2_000,
    refetchInterval: 5_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const realtimeQuery = useQuery({
    queryKey: ['cch', 'realtime', queryScope],
    queryFn: getCchRealtime,
    enabled: hasCchSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });

  const providers = providersQuery.data?.items ?? [];
  const providerHealth = providerHealthQuery.data ?? {};
  const providerSlots = providerSlotsQuery.data?.items ?? [];
  const providerSummary = useMemo(
    () => summarizeCchProviders(providers, providerHealth, providerSlots),
    [providerHealth, providerSlots, providers]
  );
  const hasTokenStatistics = providersQuery.isSuccess && providers.some((provider) => provider.statistics?.totalTokens !== undefined);
  const slotsByProviderId = useMemo(
    () => new Map<number, CchProviderSlot>(providerSlots.map((slot) => [slot.providerId, slot])),
    [providerSlots]
  );
  const liveStatus = useMemo(() => {
    return summarizeCchProxyStatus(proxyStatusQuery.data?.users ?? []);
  }, [proxyStatusQuery.data?.users]);
  const liveDataAvailable = proxyStatusQuery.isSuccess && liveStatus.hasProviderDetails;
  const liveSlotsByProviderId = useMemo(() => {
    if (!liveDataAvailable) return slotsByProviderId;
    return new Map<number, CchProviderSlot>(providers.map((provider) => {
      const fallback = slotsByProviderId.get(provider.id);
      return [provider.id, {
        providerId: provider.id,
        name: provider.name,
        usedSlots: liveStatus.activeRequestsByProviderId.get(provider.id) ?? 0,
        totalSlots: provider.limitConcurrentSessions ?? fallback?.totalSlots ?? 0,
      }];
    }));
  }, [liveDataAvailable, liveStatus.activeRequestsByProviderId, providers, slotsByProviderId]);
  const activeActivities = realtimeQuery.data?.activityStream ?? [];
  const openedCircuits = useMemo(
    () => providers.filter((provider) => providerHealth[`${provider.id}`]?.circuitState === 'open'),
    [providerHealth, providers]
  );

  const isRefreshing = healthQuery.isRefetching
    || overviewQuery.isRefetching
    || providersQuery.isRefetching
    || providerHealthQuery.isRefetching
    || providerSlotsQuery.isRefetching
    || proxyStatusQuery.isRefetching
    || realtimeQuery.isRefetching;

  async function refetchAll() {
    const requests: Array<Promise<unknown>> = [healthQuery.refetch()];

    if (hasCchSession) {
      requests.push(
        overviewQuery.refetch(),
        providersQuery.refetch(),
        providerHealthQuery.refetch(),
        providerSlotsQuery.refetch(),
        proxyStatusQuery.refetch(),
        realtimeQuery.refetch()
      );
    }

    await Promise.allSettled(requests);
  }

  useFocusEffect(useCallback(() => {
    if (!hasCchSession) return;
    void queryClient.refetchQueries({ queryKey: ['cch'], type: 'active' });
  }, [hasCchSession, queryClient]));

  const overview = overviewQuery.data;
  const currentConcurrency = liveDataAvailable ? liveStatus.totalActiveRequests : undefined;
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 36, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refetchAll()} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 26, fontWeight: '700', color: colors.text }}>CCH 概览</Text>
            <Text style={{ marginTop: 5, fontSize: 13, color: colors.subtext }}>运行、流量、供应商与并发状态</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              accessibilityLabel="打开 CCH 设置"
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => ({ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, opacity: pressed ? 0.72 : 1 })}
            >
              <Settings2 color={colors.subtext} size={18} />
            </Pressable>
            <Pressable
              accessibilityLabel="刷新 CCH 监控"
              accessibilityRole="button"
              disabled={isRefreshing}
              onPress={() => void refetchAll()}
              style={({ pressed }) => ({ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, opacity: isRefreshing ? 0.55 : pressed ? 0.72 : 1 })}
            >
              <RefreshCw color={colors.primary} size={18} />
            </Pressable>
          </View>
        </View>

        <CchIdentityBand identity={healthQuery.data} baseUrl={config.baseUrl} loading={healthQuery.isLoading || healthQuery.isRefetching} />

        {healthQuery.error ? (
          <Section title="服务检测失败">
            <Text style={{ fontSize: 13, lineHeight: 20, color: colors.danger }}>{getCchErrorMessage(healthQuery.error)}</Text>
          </Section>
        ) : null}

        {!hasCchSession ? (
          <Section title="等待 CCH Admin Key" subtitle="服务健康可公开检测，运营监控需要 CCH Admin Key">
            <Text style={{ fontSize: 13, lineHeight: 20, color: colors.subtext }}>填写并验证 CCH Admin Key 后，将读取流量、供应商、熔断器、插槽和近期调用。</Text>
            <Pressable
              accessibilityLabel="打开 CCH 设置"
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 12, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.primary, paddingHorizontal: 14, opacity: pressed ? 0.78 : 1 })}
            >
              <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>配置 CCH</Text>
            </Pressable>
          </Section>
        ) : (
          <View style={{ gap: 12 }}>
            <Section title="今日总览" subtitle="全局费用、缓存命中、总倍率和当前运行状态">
              {overviewQuery.isLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 14 }}><ActivityIndicator color={colors.primary} /></View>
              ) : overviewQuery.error ? (
                <>
                  <Text style={{ fontSize: 13, lineHeight: 20, color: colors.danger }}>{getCchErrorMessage(overviewQuery.error)}</Text>
                  <Pressable
                    accessibilityLabel="检查 CCH 管理连接"
                    accessibilityRole="button"
                    onPress={() => router.push('/settings')}
                    style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 12, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.primary, paddingHorizontal: 14, opacity: pressed ? 0.78 : 1 })}
                  >
                    <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>检查连接</Text>
                  </Pressable>
                </>
              ) : overview ? (
                <>
                  <MetricGrid items={[
                    { label: '今日总费用', value: formatMoney(overview.todayCost), tone: 'primary' },
                    { label: '今日总 Token', value: hasTokenStatistics ? formatTokenValue(providerSummary.totalTokens) : '--', tone: hasTokenStatistics ? 'primary' : undefined },
                    { label: '总缓存命中', value: providerSummary.hasCacheStatistics ? formatPercent(providerSummary.cacheHitRate) : '--', tone: providerSummary.hasCacheStatistics ? 'primary' : undefined },
                    { label: '今日请求', value: formatNumber(overview.todayRequests), tone: 'primary' },
                    { label: '平均响应', value: formatLatency(overview.avgResponseTime) },
                    { label: '今日总倍率', value: providerSummary.hasEnhancedStatistics ? formatMultiplier(providerSummary.effectiveRateMultiplier) : '--', tone: providerSummary.hasEnhancedStatistics && providerSummary.effectiveRateMultiplier !== null ? 'primary' : undefined },
                    { label: '当前并发', value: currentConcurrency === undefined ? '--' : formatNumber(currentConcurrency), tone: currentConcurrency === undefined ? undefined : 'primary' },
                  ]} />
                  <Text style={{ marginTop: 12, fontSize: 11, lineHeight: 17, color: colors.subtext }}>最近 1 分钟 {formatNumber(overview.recentMinuteRequests)} 次 · 昨日同期 {formatNumber(overview.yesterdaySamePeriodRequests)} 次 · 费用 {formatMoney(overview.yesterdaySamePeriodCost)} · 响应 {formatLatency(overview.yesterdaySamePeriodAvgResponseTime)}</Text>
                </>
              ) : <Text style={{ fontSize: 12, color: colors.subtext }}>当前没有可用的运行汇总。</Text>}
            </Section>

            <Section title="供应商明细" subtitle="当前请求优先，名称后显示实时并发；探测倍率随供应商显示">
              {providersQuery.isLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}><ActivityIndicator color={colors.primary} /></View>
              ) : providersQuery.error ? (
                <Text style={{ paddingVertical: 4, fontSize: 12, lineHeight: 18, color: colors.warning }}>供应商数据暂不可用：{getCchErrorMessage(providersQuery.error)}</Text>
              ) : (
                <>
                  {providerHealthQuery.error ? <Text style={{ marginTop: 12, fontSize: 11, lineHeight: 17, color: colors.warning }}>熔断状态暂不可用：{getCchErrorMessage(providerHealthQuery.error)}</Text> : null}
                  {proxyStatusQuery.error ? <Text style={{ marginTop: 6, fontSize: 11, lineHeight: 17, color: colors.warning }}>当前请求暂不可用；供应商仅显示会话观察：{getCchErrorMessage(proxyStatusQuery.error)}</Text> : null}
                  {proxyStatusQuery.isSuccess && !liveStatus.hasProviderDetails ? <Text style={{ marginTop: 6, fontSize: 11, lineHeight: 17, color: colors.warning }}>当前请求明细不完整；供应商仅显示会话观察。</Text> : null}
                  <ProviderRows providers={providers} healthByProviderId={providerHealth} slotsByProviderId={liveSlotsByProviderId} liveDataAvailable={liveDataAvailable} />
                </>
              )}
            </Section>

            <Section title="近期调用" subtitle="CCH 实时活动流中的最近记录">
              {realtimeQuery.isLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}><ActivityIndicator color={colors.primary} /></View>
              ) : realtimeQuery.error ? (
                <Text style={{ paddingVertical: 4, fontSize: 12, lineHeight: 18, color: colors.warning }}>实时活动流暂不可用：{getCchErrorMessage(realtimeQuery.error)}</Text>
              ) : <ActivityRows activities={activeActivities} />}
            </Section>

            {openedCircuits.length > 0 ? (
              <Section title="需要处理" subtitle="当前处于熔断状态的供应商">
                {openedCircuits.slice(0, 5).map((provider, index) => {
                  const circuit = providerHealth[`${provider.id}`];
                  return (
                    <View key={provider.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : 1, paddingTop: index === 0 ? 0 : 12, paddingBottom: 12 }}>
                      <ShieldAlert color={colors.danger} size={17} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{provider.name}</Text>
                        <Text style={{ marginTop: 3, fontSize: 11, color: colors.danger }}>失败 {formatNumber(circuit?.failureCount)} 次{circuit?.recoveryMinutes !== null && circuit?.recoveryMinutes !== undefined ? ` · 约 ${circuit.recoveryMinutes} 分钟后恢复` : ''}</Text>
                      </View>
                    </View>
                  );
                })}
              </Section>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
