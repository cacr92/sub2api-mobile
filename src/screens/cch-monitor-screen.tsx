import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  Activity,
  Clock3,
  RefreshCw,
  Server,
  Settings2,
  ShieldAlert,
  Wifi,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { summarizeCchProviders } from '@/src/lib/cch-metrics';
import { formatDisplayTime, formatTokenValue } from '@/src/lib/formatters';
import {
  getCchConcurrentSessions,
  getCchHealth,
  getCchOverview,
  getCchProviderHealth,
  getCchProviderSlots,
  getCchProxyStatus,
  getCchRealtime,
  getCchUsers,
  listCchProviders,
} from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';
import type { CchActivity, CchProvider, CchProviderCircuit, CchProviderSlot, CchServerIdentity } from '@/src/types/cch';

const { useSnapshot } = require('valtio/react');

type MetricTone = 'primary' | 'warning' | 'danger';

const colors = {
  page: '#f3f5f3',
  card: '#ffffff',
  mutedCard: '#edf0ee',
  primary: '#1f6759',
  primarySoft: '#e7f2ee',
  text: '#17201d',
  subtext: '#65706c',
  border: '#dfe5e1',
  warning: '#946313',
  danger: '#b84a32',
  dangerBg: '#fff1ed',
};

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

function formatMultiplier(value?: string | number | null) {
  const multiplier = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(multiplier) ? `${multiplier.toFixed(2)}x` : '--';
}

function formatCoverage(covered?: number, uncovered?: number) {
  if (covered === undefined || uncovered === undefined || covered + uncovered === 0) return '--';
  return `${((covered / (covered + uncovered)) * 100).toFixed(1)}%`;
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

function formatLimitedCount(value: number | undefined, hasMore?: boolean) {
  if (value === undefined) return '--';
  return `${formatNumber(value)}${hasMore ? '+' : ''}`;
}

function getCircuitLabel(circuit?: CchProviderCircuit) {
  switch (circuit?.circuitState) {
    case 'open':
      return '熔断中';
    case 'half-open':
      return '恢复检测';
    case 'closed':
      return '正常';
    default:
      return '未返回';
  }
}

function getCircuitTone(circuit?: CchProviderCircuit): MetricTone | undefined {
  if (circuit?.circuitState === 'open') return 'danger';
  if (circuit?.circuitState === 'half-open') return 'warning';
  if (circuit?.circuitState === 'closed') return 'primary';
  return undefined;
}

function Section({ title, subtitle, children, right }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ marginHorizontal: -16, backgroundColor: colors.card, borderColor: colors.border, borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{title}</Text>
          {subtitle ? <Text style={{ marginTop: 5, fontSize: 12, lineHeight: 18, color: colors.subtext }}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <View style={{ marginTop: 14 }}>{children}</View>
    </View>
  );
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string; tone?: MetricTone }> }) {
  const compact = items.length > 3;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopColor: colors.border, borderTopWidth: 1, borderBottomColor: colors.border, borderBottomWidth: 1 }}>
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
}: {
  providers: CchProvider[];
  healthByProviderId: Record<string, CchProviderCircuit | undefined>;
  slotsByProviderId: Map<number, CchProviderSlot>;
}) {
  const rows = [...providers]
    .sort((left, right) => {
      const calls = toFiniteNumber(right.statistics?.todayCalls) - toFiniteNumber(left.statistics?.todayCalls);
      if (calls !== 0) return calls;
      return toFiniteNumber(right.statistics?.todayCost) - toFiniteNumber(left.statistics?.todayCost);
    })
    .slice(0, 5);

  if (rows.length === 0) {
    return <Text style={{ paddingVertical: 4, fontSize: 12, color: colors.subtext }}>当前没有可见供应商。</Text>;
  }

  return (
    <View style={{ borderTopColor: colors.border, borderTopWidth: 1 }}>
      {rows.map((provider) => {
        const circuit = healthByProviderId[`${provider.id}`];
        const slot = slotsByProviderId.get(provider.id);
        const tone = getCircuitTone(circuit) ?? (provider.isEnabled ? 'primary' : undefined);
        const slotText = slot ? `${formatNumber(slot.usedSlots)} / ${formatNumber(slot.totalSlots)}` : '--';

        return (
          <View key={provider.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{provider.name}</Text>
              <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 11, color: colors.subtext }}>{provider.providerType || '未知类型'} · 当前倍率 {formatMultiplier(provider.costMultiplier)} · 并发 {slotText}</Text>
              <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>
                今日 {formatNumber(toFiniteNumber(provider.statistics?.todayCalls))} 次 · 计费 {formatMoney(toFiniteNumber(provider.statistics?.todayCost))} · 上游 {provider.statistics?.todayUpstreamCost === undefined ? '--' : formatMoney(toFiniteNumber(provider.statistics.todayUpstreamCost))}
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>
                覆盖 {formatCoverage(provider.statistics?.coveredRequestCount, provider.statistics?.uncoveredRequestCount)} · Token {provider.statistics?.totalTokens === undefined ? '--' : formatTokenValue(provider.statistics.totalTokens)} · 缓存 {formatPercent(provider.statistics?.cacheHitRate)}
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>
                请求时加权 {formatMultiplier(provider.statistics?.effectiveRateMultiplier)} · 成功 {formatPercent(provider.statistics?.successRate)} · TTFT {formatLatency(provider.statistics?.avgTtftMs)}
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 3, fontSize: 10, color: colors.subtext }}>
                最近调用 {formatDisplayTime(provider.statistics?.lastCallTime)}{provider.statistics?.lastCallModel ? ` · ${provider.statistics.lastCallModel}` : ''}
              </Text>
            </View>
            <View style={{ width: 74, minWidth: 0, alignItems: 'flex-end', paddingTop: 1 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ width: '100%', textAlign: 'right', fontSize: 12, fontWeight: '700', color: tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'primary' ? colors.primary : colors.subtext }}>
                {getCircuitLabel(circuit)}
              </Text>
              <Text style={{ marginTop: 3, fontSize: 10, color: provider.isEnabled ? colors.subtext : colors.warning }}>{provider.isEnabled ? '已启用' : '已停用'}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SlotRows({ slots }: { slots: CchProviderSlot[] }) {
  const rows = [...slots]
    .filter((slot) => slot.totalSlots > 0 || slot.usedSlots > 0)
    .sort((left, right) => {
      const leftUsage = left.totalSlots > 0 ? left.usedSlots / left.totalSlots : 1;
      const rightUsage = right.totalSlots > 0 ? right.usedSlots / right.totalSlots : 1;
      return rightUsage - leftUsage || right.usedSlots - left.usedSlots;
    })
    .slice(0, 5);

  if (rows.length === 0) {
    return <Text style={{ paddingVertical: 4, fontSize: 12, color: colors.subtext }}>当前没有供应商并发插槽配置。</Text>;
  }

  return (
    <View style={{ borderTopColor: colors.border, borderTopWidth: 1 }}>
      {rows.map((slot) => {
        const ratio = slot.totalSlots > 0 ? slot.usedSlots / slot.totalSlots : 0;
        const tone = ratio >= 0.9 ? colors.danger : ratio >= 0.7 ? colors.warning : colors.primary;

        return (
          <View key={slot.providerId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 11 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{slot.name}</Text>
              <View style={{ height: 5, overflow: 'hidden', borderRadius: 3, marginTop: 7, backgroundColor: colors.mutedCard }}>
                <View style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, height: '100%', backgroundColor: tone }} />
              </View>
            </View>
            <Text style={{ width: 65, textAlign: 'right', fontSize: 13, fontWeight: '700', color: tone }}>{formatNumber(slot.usedSlots)} / {formatNumber(slot.totalSlots)}</Text>
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
  const queryScope = config.baseUrl;

  const healthQuery = useQuery({
    queryKey: ['cch', 'health', queryScope],
    queryFn: getCchHealth,
    enabled: config.hydrated,
    staleTime: 60_000,
    retry: false,
  });
  const overviewQuery = useQuery({
    queryKey: ['cch', 'overview', queryScope],
    queryFn: getCchOverview,
    enabled: hasCchSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const concurrentSessionsQuery = useQuery({
    queryKey: ['cch', 'concurrent-sessions', queryScope],
    queryFn: getCchConcurrentSessions,
    enabled: hasCchSession,
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });
  const providersQuery = useQuery({
    queryKey: ['cch', 'providers', queryScope],
    queryFn: listCchProviders,
    enabled: hasCchSession,
    staleTime: 60_000,
    retry: false,
  });
  const providerHealthQuery = useQuery({
    queryKey: ['cch', 'provider-health', queryScope],
    queryFn: getCchProviderHealth,
    enabled: hasCchSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const providerSlotsQuery = useQuery({
    queryKey: ['cch', 'provider-slots', queryScope],
    queryFn: getCchProviderSlots,
    enabled: hasCchSession,
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });
  const usersQuery = useQuery({
    queryKey: ['cch', 'users', queryScope],
    queryFn: () => getCchUsers(),
    enabled: hasCchSession,
    staleTime: 60_000,
    retry: false,
  });
  const proxyStatusQuery = useQuery({
    queryKey: ['cch', 'proxy-status', queryScope],
    queryFn: getCchProxyStatus,
    enabled: hasCchSession,
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });
  const realtimeQuery = useQuery({
    queryKey: ['cch', 'realtime', queryScope],
    queryFn: getCchRealtime,
    enabled: hasCchSession,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const providers = providersQuery.data?.items ?? [];
  const providerHealth = providerHealthQuery.data ?? {};
  const providerSlots = providerSlotsQuery.data?.items ?? [];
  const providerSummary = useMemo(
    () => summarizeCchProviders(providers, providerHealth, providerSlots),
    [providerHealth, providerSlots, providers]
  );
  const slotsByProviderId = useMemo(
    () => new Map<number, CchProviderSlot>(providerSlots.map((slot) => [slot.providerId, slot])),
    [providerSlots]
  );
  const userSummary = useMemo(() => {
    const users = usersQuery.data?.items ?? [];
    let keyCount = 0;
    let enabledKeyCount = 0;
    let enabledUserCount = 0;

    for (const user of users) {
      if (user.isEnabled !== false) enabledUserCount += 1;
      for (const key of user.keys ?? []) {
        keyCount += 1;
        if (key.isEnabled !== false) enabledKeyCount += 1;
      }
    }

    return { userCount: users.length, enabledUserCount, keyCount, enabledKeyCount };
  }, [usersQuery.data?.items]);
  const activeProxyRequests = useMemo(
    () => (proxyStatusQuery.data?.users ?? []).reduce((total, user) => total + user.activeCount, 0),
    [proxyStatusQuery.data?.users]
  );
  const hasMoreUsers = usersQuery.data?.pageInfo.hasMore === true;
  const activeActivities = realtimeQuery.data?.activityStream ?? [];
  const openedCircuits = useMemo(
    () => providers.filter((provider) => providerHealth[`${provider.id}`]?.circuitState === 'open'),
    [providerHealth, providers]
  );

  const isRefreshing = healthQuery.isRefetching
    || overviewQuery.isRefetching
    || concurrentSessionsQuery.isRefetching
    || providersQuery.isRefetching
    || providerHealthQuery.isRefetching
    || providerSlotsQuery.isRefetching
    || usersQuery.isRefetching
    || proxyStatusQuery.isRefetching
    || realtimeQuery.isRefetching;

  async function refetchAll() {
    const requests: Array<Promise<unknown>> = [healthQuery.refetch()];

    if (hasCchSession) {
      requests.push(
        overviewQuery.refetch(),
        concurrentSessionsQuery.refetch(),
        providersQuery.refetch(),
        providerHealthQuery.refetch(),
        providerSlotsQuery.refetch(),
        usersQuery.refetch(),
        proxyStatusQuery.refetch(),
        realtimeQuery.refetch()
      );
    }

    await Promise.allSettled(requests);
  }

  const overview = overviewQuery.data;
  const currentConcurrency = concurrentSessionsQuery.data ?? overview?.concurrentSessions;
  const systemComponents = healthQuery.data?.components;

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
            <Text style={{ fontSize: 13, lineHeight: 20, color: colors.subtext }}>填写并验证 CCH Admin Key 后，将读取流量、供应商、熔断器、插槽、用户与代理状态。</Text>
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
            <Section title="今日运行" subtitle="CCH 管理范围内的当前汇总">
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
                    { label: '今日请求', value: formatNumber(overview.todayRequests), tone: 'primary' },
                    { label: '今日费用', value: formatMoney(overview.todayCost), tone: 'primary' },
                    { label: '错误率', value: `${overview.todayErrorRate.toFixed(1)}%`, tone: overview.todayErrorRate > 5 ? 'danger' : overview.todayErrorRate > 1 ? 'warning' : undefined },
                    { label: '平均响应', value: formatLatency(overview.avgResponseTime) },
                    { label: '最近 1 分钟', value: formatNumber(overview.recentMinuteRequests), tone: 'primary' },
                    { label: '当前并发', value: formatNumber(currentConcurrency), tone: 'primary' },
                  ]} />
                  <Text style={{ marginTop: 12, fontSize: 11, color: colors.subtext }}>昨日同期请求 {formatNumber(overview.yesterdaySamePeriodRequests)} · 费用 {formatMoney(overview.yesterdaySamePeriodCost)} · 响应 {formatLatency(overview.yesterdaySamePeriodAvgResponseTime)}</Text>
                </>
              ) : <Text style={{ fontSize: 12, color: colors.subtext }}>当前没有可用的运行汇总。</Text>}
            </Section>

            <Section title="服务组件" subtitle="CCH 健康检查返回的基础依赖状态">
              <MetricGrid items={[
                { label: '数据库', value: systemComponents?.database?.status === 'up' ? '正常' : systemComponents?.database?.status || '--', tone: systemComponents?.database?.status === 'up' ? 'primary' : systemComponents?.database ? 'danger' : undefined },
                { label: 'Redis', value: systemComponents?.redis?.status === 'up' ? '正常' : systemComponents?.redis?.status || '--', tone: systemComponents?.redis?.status === 'up' ? 'primary' : systemComponents?.redis ? 'danger' : undefined },
                { label: '代理', value: systemComponents?.proxy?.status === 'up' ? '正常' : systemComponents?.proxy?.status || '--', tone: systemComponents?.proxy?.status === 'up' ? 'primary' : systemComponents?.proxy ? 'danger' : undefined },
              ]} />
              <Text style={{ marginTop: 12, fontSize: 11, color: colors.subtext }}>数据库 {formatLatency(systemComponents?.database?.latencyMs)} · Redis {formatLatency(systemComponents?.redis?.latencyMs)} · 代理 {formatLatency(systemComponents?.proxy?.latencyMs)}</Text>
            </Section>

            <Section title="供应商状态" subtitle="倍率、计费、上游估算、Token、性能与熔断器">
              {providersQuery.isLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}><ActivityIndicator color={colors.primary} /></View>
              ) : providersQuery.error ? (
                <Text style={{ paddingVertical: 4, fontSize: 12, lineHeight: 18, color: colors.warning }}>供应商数据暂不可用：{getCchErrorMessage(providersQuery.error)}</Text>
              ) : (
                <>
                  <MetricGrid items={[
                    { label: '供应商', value: formatNumber(providerSummary.total), tone: 'primary' },
                    { label: '已启用', value: formatNumber(providerSummary.enabled), tone: 'primary' },
                    { label: '今日调用', value: formatNumber(providerSummary.todayCalls), tone: 'primary' },
                    { label: '今日计费', value: formatMoney(providerSummary.todayCost), tone: 'primary' },
                    { label: '上游估算', value: providerSummary.hasEnhancedStatistics ? formatMoney(providerSummary.todayUpstreamCost) : '--', tone: 'primary' },
                    { label: '费用覆盖', value: providerSummary.hasEnhancedStatistics ? formatCoverage(providerSummary.coveredRequestCount, providerSummary.uncoveredRequestCount) : '--', tone: providerSummary.uncoveredRequestCount > 0 ? 'warning' : undefined },
                    { label: '总 Token', value: providerSummary.hasEnhancedStatistics ? formatTokenValue(providerSummary.totalTokens) : '--' },
                    { label: '缓存命中', value: providerSummary.hasEnhancedStatistics ? formatPercent(providerSummary.cacheHitRate) : '--' },
                    { label: '请求时加权', value: providerSummary.hasEnhancedStatistics ? formatMultiplier(providerSummary.effectiveRateMultiplier) : '--' },
                    { label: '熔断中', value: providerHealthQuery.data ? formatNumber(providerSummary.circuitOpen) : '--', tone: providerHealthQuery.data && providerSummary.circuitOpen > 0 ? 'danger' : undefined },
                    { label: '恢复检测', value: providerHealthQuery.data ? formatNumber(providerSummary.circuitHalfOpen) : '--', tone: providerHealthQuery.data && providerSummary.circuitHalfOpen > 0 ? 'warning' : undefined },
                    { label: '已停用', value: formatNumber(providerSummary.disabled) },
                  ]} />
                  {providerSummary.hasEnhancedStatistics ? <Text style={{ marginTop: 12, fontSize: 11, lineHeight: 17, color: colors.subtext }}>Token：输入 {formatTokenValue(providerSummary.inputTokens)} · 输出 {formatTokenValue(providerSummary.outputTokens)} · 缓存写 {formatTokenValue(providerSummary.cacheCreationTokens)} · 缓存读 {formatTokenValue(providerSummary.cacheReadTokens)}</Text> : null}
                  {providerSummary.hasEnhancedStatistics && providerSummary.uncoveredRequestCount > 0 ? <Text style={{ marginTop: 6, fontSize: 11, lineHeight: 17, color: colors.warning }}>有 {formatNumber(providerSummary.uncoveredRequestCount)} 个请求缺少有效的请求时 Group 倍率；上游估算只包含已覆盖部分。</Text> : null}
                  {providerHealthQuery.error ? <Text style={{ marginTop: 12, fontSize: 11, lineHeight: 17, color: colors.warning }}>熔断状态暂不可用：{getCchErrorMessage(providerHealthQuery.error)}</Text> : null}
                  <ProviderRows providers={providers} healthByProviderId={providerHealth} slotsByProviderId={slotsByProviderId} />
                </>
              )}
            </Section>

            <Section title="供应商并发" subtitle="供应商插槽的当前占用">
              {providerSlotsQuery.isLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}><ActivityIndicator color={colors.primary} /></View>
              ) : providerSlotsQuery.error ? (
                <Text style={{ paddingVertical: 4, fontSize: 12, lineHeight: 18, color: colors.warning }}>插槽数据暂不可用：{getCchErrorMessage(providerSlotsQuery.error)}</Text>
              ) : (
                <>
                  <MetricGrid items={[
                    { label: '已用插槽', value: formatNumber(providerSummary.slotUsed), tone: providerSummary.slotUsed > 0 ? 'primary' : undefined },
                    { label: '插槽容量', value: formatNumber(providerSummary.slotCapacity) },
                    { label: '承载供应商', value: formatNumber(providerSummary.activeSlotProviders), tone: providerSummary.activeSlotProviders > 0 ? 'primary' : undefined },
                  ]} />
                  <SlotRows slots={providerSlots} />
                </>
              )}
            </Section>

            <Section title="用户与 API Key" subtitle="CCH 列表接口每次最多返回 100 个用户">
              <MetricGrid items={[
                { label: '已加载用户', value: formatLimitedCount(usersQuery.data ? userSummary.userCount : undefined, hasMoreUsers), tone: 'primary' },
                { label: '启用用户', value: formatLimitedCount(usersQuery.data ? userSummary.enabledUserCount : undefined, hasMoreUsers), tone: 'primary' },
                { label: '已加载 Key', value: formatLimitedCount(usersQuery.data ? userSummary.keyCount : undefined, hasMoreUsers), tone: 'primary' },
                { label: '启用 Key', value: formatLimitedCount(usersQuery.data ? userSummary.enabledKeyCount : undefined, hasMoreUsers), tone: 'primary' },
                { label: '代理活动用户', value: proxyStatusQuery.data ? formatNumber(proxyStatusQuery.data.users.filter((user) => user.activeCount > 0).length) : '--' },
                { label: '活跃代理请求', value: proxyStatusQuery.data ? formatNumber(activeProxyRequests) : '--', tone: activeProxyRequests > 0 ? 'primary' : undefined },
              ]} />
              {usersQuery.error ? <Text style={{ marginTop: 12, fontSize: 11, lineHeight: 17, color: colors.warning }}>用户统计暂不可用：{getCchErrorMessage(usersQuery.error)}</Text> : null}
              {proxyStatusQuery.error ? <Text style={{ marginTop: usersQuery.error ? 7 : 12, fontSize: 11, lineHeight: 17, color: colors.warning }}>代理状态暂不可用：{getCchErrorMessage(proxyStatusQuery.error)}</Text> : null}
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
