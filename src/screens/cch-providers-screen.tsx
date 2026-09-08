import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Server } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { formatDisplayTime, formatTokenValue } from '@/src/lib/formatters';
import { getCchProviderHealth, getCchProviderSlots, listCchProviders } from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';
import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import type { CchProviderStatistics } from '@/src/types/cch';

const { useSnapshot } = require('valtio/react');

function circuitLabel(state?: 'closed' | 'open' | 'half-open') {
  if (state === 'open') return '熔断中';
  if (state === 'half-open') return '恢复检测';
  return state === 'closed' ? '正常' : '未检测';
}

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

export function CchProvidersScreen() {
  const config = useSnapshot(cchConfigState);
  const hasSession = hasCchAdminSession(config);
  const [search, setSearch] = useState('');
  const scope = config.baseUrl;
  const providersQuery = useQuery({
    queryKey: ['cch', 'providers', scope],
    queryFn: listCchProviders,
    enabled: hasSession,
    staleTime: 60_000,
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
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });
  const providers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return [...(providersQuery.data?.items ?? [])]
      .filter((provider) => !keyword || `${provider.name} ${provider.providerType ?? ''}`.toLowerCase().includes(keyword))
      .sort((left, right) => (right.statistics?.todayCalls ?? 0) - (left.statistics?.todayCalls ?? 0));
  }, [providersQuery.data?.items, search]);
  const slotsByProviderId = useMemo(
    () => new Map((slotsQuery.data?.items ?? []).map((slot) => [slot.providerId, slot])),
    [slotsQuery.data?.items]
  );

  return (
    <ScreenShell
      title="供应商"
      subtitle="CCH 上游供应商、熔断状态与并发插槽"
      variant="minimal"
      refreshing={providersQuery.isRefetching || healthQuery.isRefetching || slotsQuery.isRefetching}
      onRefresh={async () => { await Promise.allSettled([providersQuery.refetch(), healthQuery.refetch(), slotsQuery.refetch()]); }}
      right={(
        <Pressable accessibilityLabel="刷新 CCH 供应商" accessibilityRole="button" onPress={() => void Promise.allSettled([providersQuery.refetch(), healthQuery.refetch(), slotsQuery.refetch()])} style={({ pressed }) => ({ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dfe5e1', opacity: pressed ? 0.72 : 1 })}>
          <RefreshCw color="#1f6759" size={17} />
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
            style={{ minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#dfe5e1', backgroundColor: '#ffffff', paddingHorizontal: 13, color: '#17201d', fontSize: 14 }}
          />
          {providersQuery.isLoading ? <Text style={{ color: '#65706c', fontSize: 13 }}>正在读取供应商...</Text> : null}
          {providersQuery.error ? <ListCard title="供应商读取失败" meta={getCchErrorMessage(providersQuery.error)} icon={Server} badge="异常" badgeTone="danger" /> : null}
          {!providersQuery.isLoading && !providersQuery.error && providers.length === 0 ? <ListCard title="没有可见供应商" meta="当前筛选条件下没有 CCH 供应商。" icon={Server} /> : null}
          {providers.map((provider) => {
            const circuit = healthQuery.data?.[`${provider.id}`];
            const slot = slotsByProviderId.get(provider.id);
            const badge = circuitLabel(circuit?.circuitState);
            const badgeTone = circuit?.circuitState === 'open' ? 'danger' : circuit?.circuitState === 'half-open' ? 'warning' : provider.isEnabled ? 'success' : 'muted';

            return (
              <ListCard key={provider.id} title={provider.name} meta={`${provider.providerType || '未知类型'} · ${provider.isEnabled ? '已启用' : '已停用'}`} icon={Server} badge={badge} badgeTone={badgeTone}>
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>当前倍率 {formatMultiplier(provider.costMultiplier)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>请求时加权 {formatMultiplier(provider.statistics?.effectiveRateMultiplier)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>并发 {slot ? `${slot.usedSlots} / ${slot.totalSlots}` : '--'}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>会话上限 {provider.limitConcurrentSessions === undefined ? '--' : provider.limitConcurrentSessions}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>5 小时上限 {formatLimit(provider.limit5hUsd)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>日上限 {formatLimit(provider.limitDailyUsd)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>周上限 {formatLimit(provider.limitWeeklyUsd)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>月上限 {formatLimit(provider.limitMonthlyUsd)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>累计上限 {formatLimit(provider.limitTotalUsd)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>今日调用 {provider.statistics?.todayCalls ?? 0}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>今日计费 {formatCost(provider.statistics?.todayCost)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>上游估算 {provider.statistics?.todayUpstreamCost === undefined ? '--' : formatCost(provider.statistics.todayUpstreamCost)}</Text>
                    <Text style={{ color: provider.statistics?.upstreamCostStatus === 'partial' ? '#946313' : '#65706c', fontSize: 11 }}>覆盖 {coverageLabel(provider.statistics)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>Token {provider.statistics?.totalTokens === undefined ? '--' : formatTokenValue(provider.statistics.totalTokens)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>输入 {provider.statistics?.inputTokens === undefined ? '--' : formatTokenValue(provider.statistics.inputTokens)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>输出 {provider.statistics?.outputTokens === undefined ? '--' : formatTokenValue(provider.statistics.outputTokens)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>缓存写 {provider.statistics?.cacheCreationTokens === undefined ? '--' : formatTokenValue(provider.statistics.cacheCreationTokens)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>缓存读 {provider.statistics?.cacheReadTokens === undefined ? '--' : formatTokenValue(provider.statistics.cacheReadTokens)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>缓存命中 {formatPercent(provider.statistics?.cacheHitRate)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>平均 TTFT {formatLatency(provider.statistics?.avgTtftMs)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>成功率 {formatPercent(provider.statistics?.successRate)}</Text>
                    <Text style={{ color: '#65706c', fontSize: 11 }}>最近调用 {formatDisplayTime(provider.statistics?.lastCallTime)}{provider.statistics?.lastCallModel ? ` · ${provider.statistics.lastCallModel}` : ''}</Text>
                  </View>
                  {(provider.statistics?.models ?? []).map((model) => (
                    <View key={model.model} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderTopWidth: 1, borderTopColor: '#edf0ee', paddingTop: 7 }}>
                      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: '#17201d', fontSize: 11, fontWeight: '600' }}>{model.model}</Text>
                      <Text style={{ color: '#65706c', fontSize: 10 }}>{model.todayCalls} 次 · {formatTokenValue(model.totalTokens)} · 上游 {model.upstreamCostStatus === 'unavailable' ? '--' : formatCost(model.todayUpstreamCost)}</Text>
                    </View>
                  ))}
                </View>
              </ListCard>
            );
          })}
        </>
      )}
    </ScreenShell>
  );
}
