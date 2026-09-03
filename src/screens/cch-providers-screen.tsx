import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Server } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { getCchProviderHealth, getCchProviderSlots, listCchProviders } from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';
import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';

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
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  <Text style={{ color: '#65706c', fontSize: 11 }}>今日调用 {provider.statistics?.todayCalls ?? 0}</Text>
                  <Text style={{ color: '#65706c', fontSize: 11 }}>今日费用 {formatCost(provider.statistics?.todayCost)}</Text>
                  <Text style={{ color: '#65706c', fontSize: 11 }}>并发 {slot ? `${slot.usedSlots} / ${slot.totalSlots}` : '--'}</Text>
                </View>
              </ListCard>
            );
          })}
        </>
      )}
    </ScreenShell>
  );
}
