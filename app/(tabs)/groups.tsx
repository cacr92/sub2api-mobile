import { useQuery } from '@tanstack/react-query';
import { Activity, FolderKanban, Layers3, Search } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';

import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { useDebouncedValue } from '@/src/hooks/use-debounced-value';
import { getGroupCapacitySummary, getOpsConcurrencyStats, listGroups } from '@/src/services/admin';
import type { GroupCapacitySummary, OpsGroupConcurrencyInfo } from '@/src/types/admin';

function getNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function GroupRuntimeSummary({
  runtime,
  capacity,
}: {
  runtime: OpsGroupConcurrencyInfo;
  capacity?: GroupCapacitySummary;
}) {
  const current = Math.trunc(getNonNegativeNumber(runtime.current_in_use));
  const max = Math.trunc(getNonNegativeNumber(runtime.max_capacity));
  const waiting = Math.trunc(getNonNegativeNumber(runtime.waiting_in_queue));
  const load = Math.round(getNonNegativeNumber(runtime.load_percentage));
  const progressWidth = `${Math.min(load, 100)}%` as `${number}%`;
  const hasQueue = waiting > 0;
  const supplementalMetrics = [
    capacity && capacity.sessions_max > 0
      ? `会话 ${capacity.sessions_used} / ${capacity.sessions_max}`
      : null,
    capacity && capacity.rpm_max > 0
      ? `RPM ${capacity.rpm_used} / ${capacity.rpm_max}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <View
      accessible
      accessibilityLabel={`分组正在调度，当前并发 ${current}，容量 ${max}，占用率 ${load}%，排队 ${waiting}`}
      className={hasQueue
        ? 'mt-3 border-y border-[#fdecea] bg-[#fdecea] px-3 py-2.5'
        : 'mt-3 border-y border-[#f6f7f7] bg-[#f6f7f7] px-3 py-2.5'}
    >
      <View className="flex-row items-center gap-2.5">
        <View className={hasQueue
          ? 'h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fdecea]'
          : 'h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f6f7f7]'}
        >
          <Activity color={hasQueue ? '#5f6468' : '#5f6468'} size={16} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className={hasQueue ? 'text-xs font-bold text-[#5f6468]' : 'text-xs font-bold text-[#5f6468]'}>
            {hasQueue ? '有请求排队' : '正在调度'}
          </Text>
          <Text className="mt-0.5 text-[10px] text-[#5f6468]">当前请求正在使用此分组中的上游账号</Text>
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} className="max-w-[96px] text-base font-bold text-[#111315]">
          {current}<Text className="text-[11px] font-semibold text-[#5f6468]"> / {max || '--'}</Text>
        </Text>
      </View>

      <View className="mt-2 h-1 overflow-hidden rounded-full bg-[#e8e9e9]">
        <View className="h-full rounded-full" style={{ width: progressWidth, backgroundColor: hasQueue ? '#d92d20' : '#5f6468' }} />
      </View>
      <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
        <Text className="text-[10px] font-medium text-[#5f6468]">占用率 {load}%</Text>
        {hasQueue ? <Text className="text-[10px] font-semibold text-[#5f6468]">排队 {waiting}</Text> : null}
        {supplementalMetrics.map((metric) => (
          <Text key={metric} className="text-[10px] font-medium text-[#5f6468]">{metric}</Text>
        ))}
      </View>
    </View>
  );
}

export default function GroupsScreen() {
  const [searchText, setSearchText] = useState('');
  const keyword = useDebouncedValue(searchText.trim(), 300);

  const groupsQuery = useQuery({
    queryKey: ['groups', keyword],
    queryFn: () => listGroups(keyword),
  });
  const opsConcurrencyQuery = useQuery({
    queryKey: ['ops-concurrency'],
    queryFn: getOpsConcurrencyStats,
    staleTime: 5_000,
    retry: false,
  });
  const capacityQuery = useQuery({
    queryKey: ['group-capacity-summary'],
    queryFn: getGroupCapacitySummary,
    staleTime: 30_000,
    retry: false,
  });

  const items = groupsQuery.data?.items ?? [];
  const capacityByGroupId = useMemo(
    () => new Map(capacityQuery.data?.map((capacity) => [capacity.group_id, capacity]) ?? []),
    [capacityQuery.data]
  );
  const errorMessage = groupsQuery.error instanceof Error ? groupsQuery.error.message : '';
  const listHeader = useMemo(
    () => (
      <View className="pb-4">
        <View className="flex-row items-center rounded-[24px] bg-[#ffffff] px-4 py-3">
          <Search color="#5f6468" size={18} />
          <TextInput
            defaultValue=""
            onChangeText={setSearchText}
            placeholder="搜索分组名称"
            placeholderTextColor="#8b9094"
            className="ml-3 flex-1 text-base text-[#111315]"
          />
        </View>
      </View>
    ),
    []
  );
  const renderItem = useCallback(
    ({ item: group }: { item: (typeof items)[number] }) => {
      const runtime = opsConcurrencyQuery.data?.enabled === true
        ? opsConcurrencyQuery.data.group?.[`${group.id}`]
        : undefined;
      const hasRuntime = runtime && (runtime.current_in_use > 0 || runtime.waiting_in_queue > 0);

      return (
        <ListCard
          title={group.name}
          meta={`${group.platform} · 倍率 ${group.rate_multiplier ?? 1} · ${group.subscription_type || 'standard'}`}
          badge={group.status || 'active'}
          icon={FolderKanban}
        >
          <View className="flex-row items-center gap-2">
            <Layers3 color="#5f6468" size={14} />
            <Text className="text-sm text-[#5f6468]">
              账号数 {group.account_count ?? 0} · {group.is_exclusive ? '独占分组' : '共享分组'}
            </Text>
          </View>
          {group.description?.trim() ? (
            <Text numberOfLines={2} className="mt-2 text-xs leading-4 text-[#5f6468]">{group.description.trim()}</Text>
          ) : null}
          {hasRuntime ? <GroupRuntimeSummary runtime={runtime} capacity={capacityByGroupId.get(group.id)} /> : null}
        </ListCard>
      );
    },
    [capacityByGroupId, opsConcurrencyQuery.data]
  );
  const emptyState = useMemo(
    () => <ListCard title="暂无分组" meta={errorMessage || '连上 Sub2API 后，这里会展示分组列表。'} icon={FolderKanban} />,
    [errorMessage]
  );

  return (
    <ScreenShell
      title="分组管理"
      subtitle=""
      titleAside={<Text className="text-[11px] text-[#5f6468]">查看分组与调度归属。</Text>}
      variant="minimal"
      scroll={false}
    >
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => `${item.id}`}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={groupsQuery.isRefetching || opsConcurrencyQuery.isRefetching || capacityQuery.isRefetching}
            onRefresh={() => {
              void groupsQuery.refetch();
              void opsConcurrencyQuery.refetch();
              void capacityQuery.refetch();
            }}
            tintColor="#111315"
          />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyState}
        ItemSeparatorComponent={() => <View className="h-4" />}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
      />
    </ScreenShell>
  );
}
