import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  CircleAlert,
  Info,
  RefreshCw,
  Search,
  Store,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { ScreenShell } from '@/src/components/screen-shell';
import { getModelPlaza } from '@/src/services/admin';
import { adminConfigState, hasAuthenticatedAdminSession } from '@/src/store/admin-config';
import { radius, shadow } from '@/src/theme';
import type {
  ModelPlazaGroup,
  ModelPlazaModel,
  ModelPlazaOfficialPricing,
  ModelPlazaPricing,
  ModelPlazaPricingInterval,
} from '@/src/types/admin';

const { useSnapshot } = require('valtio/react');

const colors = {
  page: '#ffffff',
  card: '#ffffff',
  text: '#111315',
  subtext: '#5f6468',
  muted: '#8b9094',
  border: '#e8e9e9',
  primary: '#111315',
  primarySoft: '#f6f7f7',
  warning: '#5f6468',
  danger: '#d92d20',
  dangerSoft: '#fdecea',
};

type FilterValue = number | 'all';

type PlatformTone = {
  accent: string;
  soft: string;
};

function platformTone(platform: string): PlatformTone {
  const normalized = platform.trim().toLowerCase();
  if (normalized.includes('openai')) return { accent: '#111315', soft: '#f6f7f7' };
  if (normalized.includes('anthropic') || normalized.includes('claude')) return { accent: '#5f6468', soft: '#f6f7f7' };
  if (normalized.includes('gemini') || normalized.includes('google')) return { accent: '#111315', soft: '#f6f7f7' };
  if (normalized.includes('grok') || normalized.includes('xai')) return { accent: '#111315', soft: '#f6f7f7' };
  return { accent: colors.primary, soft: colors.primarySoft };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasPrice(value: number | null | undefined) {
  return value !== null && value !== undefined;
}

function formatDecimal(value: number, maximumFractionDigits = 6) {
  if (!Number.isFinite(value)) return '--';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });
}

function formatUsdPerMillion(value: number | null | undefined, multiplier = 1) {
  const numberValue = finiteNumber(value);
  const rate = finiteNumber(multiplier) ?? 1;
  if (numberValue === null || !Number.isFinite(rate)) return '--';
  return `$${formatDecimal(numberValue * rate * 1_000_000)}`;
}

function formatUsdPerRequest(value: number | null | undefined, multiplier = 1, unit = '次') {
  const numberValue = finiteNumber(value);
  const rate = finiteNumber(multiplier) ?? 1;
  if (numberValue === null || !Number.isFinite(rate)) return '--';
  return `$${formatDecimal(numberValue * rate)} / ${unit}`;
}

function formatOfficial(value: number | null | undefined) {
  return formatUsdPerMillion(value, 1);
}

function formatRate(value: number | null | undefined) {
  const numberValue = finiteNumber(value);
  return numberValue === null ? '--' : `${Number(numberValue.toPrecision(6))}x`;
}

function billingMode(pricing: ModelPlazaPricing | null) {
  return pricing?.billing_mode?.trim().toLowerCase() || 'token';
}

function billingModeLabel(pricing: ModelPlazaPricing | null) {
  switch (billingMode(pricing)) {
    case 'image':
      return '按图';
    case 'per_request':
      return '按次';
    case 'video':
      return '按视频';
    default:
      return 'Token';
  }
}

function perRequestUnit(pricing: ModelPlazaPricing | null) {
  switch (billingMode(pricing)) {
    case 'image':
      return '张';
    case 'video':
      return '段';
    default:
      return '次';
  }
}

function formatTokenCount(value: number) {
  if (!Number.isFinite(value)) return '--';
  if (value >= 1_000_000) return `${String(Math.round((value / 1_000_000) * 100) / 100)}M`;
  if (value >= 1_000) return `${String(Math.round((value / 1_000) * 100) / 100)}K`;
  return String(value);
}

function intervalLabel(interval: ModelPlazaPricingInterval) {
  if (interval.tier_label?.trim()) return interval.tier_label.trim();
  if (interval.max_tokens === null || interval.max_tokens === undefined) {
    return `>${formatTokenCount(interval.min_tokens)}`;
  }
  if (interval.min_tokens === 0) return `≤${formatTokenCount(interval.max_tokens)}`;
  return `${formatTokenCount(interval.min_tokens)}–${formatTokenCount(interval.max_tokens)}`;
}

function effectiveRate(group: ModelPlazaGroup) {
  return group.user_rate_multiplier ?? group.rate_multiplier;
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : '';
  const normalized = message.toLowerCase();

  if (normalized.includes('not enabled') || normalized.includes('model plaza is not enabled') || normalized.includes('http_404') || normalized.includes('404')) {
    return '当前服务器尚未启用模型广场。请在设置页打开“启用模型广场”。';
  }
  if (normalized.includes('authentication required') || normalized.includes('http_401') || normalized.includes('401')) {
    return '当前服务器要求已登录账号会话；管理员账号登录服务端网页后也可以访问，但手机端保存的 Admin Key 不能代替该会话。';
  }
  if (normalized.includes('backend mode') || normalized.includes('http_403') || normalized.includes('403')) {
    return '当前服务器在后台模式下要求管理员账号的 JWT 会话；手机端保存的 Admin Key 不能代替该网页登录会话。';
  }
  if (message === 'BASE_URL_REQUIRED') return '请先在设置页填写服务器地址。';
  if (message === 'ADMIN_API_KEY_REQUIRED') return '请先在设置页填写 Admin Key。';
  if (message === 'INVALID_SERVER_RESPONSE') return '服务器返回的数据格式不正确。';
  return message || '暂时无法读取模型广场，请检查服务器连接。';
}

function FilterChip({
  label,
  selected,
  disabled,
  onPress,
  tone,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  tone?: PlatformTone;
}) {
  const backgroundColor = selected ? tone?.accent ?? colors.primary : tone?.soft ?? colors.card;
  const textColor = selected ? '#ffffff' : tone?.accent ?? colors.subtext;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 34,
        justifyContent: 'center',
        borderRadius: 8,
        borderWidth: selected ? 0 : 1,
        borderColor: tone?.accent ? `${tone.accent}44` : colors.border,
        backgroundColor,
        paddingHorizontal: 12,
        opacity: disabled ? 0.38 : pressed ? 0.72 : 1,
      })}
    >
      <Text numberOfLines={1} style={{ color: textColor, fontSize: 12, fontWeight: selected ? '700' : '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ width: 38, color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
        {children}
      </ScrollView>
    </View>
  );
}

function PriceCell({
  label,
  paid,
  official,
}: {
  label: string;
  paid?: string;
  official?: string;
}) {
  if (!paid && !official) return null;

  return (
    <View style={{ width: '50%', minWidth: 0, paddingRight: 8, paddingVertical: 4 }}>
      <Text style={{ color: colors.muted, fontSize: 10 }}>{label}</Text>
      {paid ? <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={{ marginTop: 2, color: colors.text, fontSize: 13, fontWeight: '700' }}>{paid}</Text> : null}
      {official ? <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={{ marginTop: 2, color: colors.subtext, fontSize: 10 }}>官方 {official}</Text> : null}
    </View>
  );
}

function TokenInterval({ interval, rate, official }: { interval: ModelPlazaPricingInterval; rate: number; official: ModelPlazaOfficialPricing | null }) {
  return (
    <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
      <Text style={{ color: colors.subtext, fontSize: 10, fontWeight: '600' }}>{intervalLabel(interval)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
        <PriceCell label="输入" paid={formatUsdPerMillion(interval.input_price, rate)} official={formatOfficial(official?.input_price)} />
        <PriceCell label="输出" paid={formatUsdPerMillion(interval.output_price, rate)} official={formatOfficial(official?.output_price)} />
        {hasPrice(interval.cache_write_price) || hasPrice(interval.cache_read_price) ? (
          <PriceCell
            label="缓存写入 / 读取"
            paid={`${formatUsdPerMillion(interval.cache_write_price, rate)} / ${formatUsdPerMillion(interval.cache_read_price, rate)}`}
            official={`${formatOfficial(official?.cache_write_price)} / ${formatOfficial(official?.cache_read_price)}`}
          />
        ) : null}
      </View>
    </View>
  );
}

function ModelPricingRow({ model, rate }: { model: ModelPlazaModel; rate: number }) {
  const pricing = model.pricing;
  const mode = billingMode(pricing);
  const intervals = pricing?.intervals ?? [];
  const requestIntervals = intervals.filter((interval) => hasPrice(interval.per_request_price));
  const unit = perRequestUnit(pricing);
  const hasCache = hasPrice(pricing?.cache_write_price) || hasPrice(pricing?.cache_read_price);
  const isToken = mode === 'token';

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Text selectable numberOfLines={3} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 }}>{model.name}</Text>
        <View style={{ borderRadius: 6, backgroundColor: colors.primarySoft, paddingHorizontal: 7, paddingVertical: 3 }}>
          <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700' }}>{billingModeLabel(pricing)}</Text>
        </View>
      </View>

      {!pricing ? (
        <Text style={{ marginTop: 8, color: colors.muted, fontSize: 11 }}>服务端未提供价格</Text>
      ) : isToken ? (
        intervals.length > 0 ? (
          intervals.map((interval, index) => <TokenInterval key={`${model.name}-interval-${index}`} interval={interval} rate={rate} official={model.official_pricing} />)
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
            <PriceCell label="输入 / 1M Token" paid={formatUsdPerMillion(pricing.input_price, rate)} official={formatOfficial(model.official_pricing?.input_price)} />
            <PriceCell label="输出 / 1M Token" paid={formatUsdPerMillion(pricing.output_price, rate)} official={formatOfficial(model.official_pricing?.output_price)} />
            {hasCache ? (
              <PriceCell
                label="缓存写入 / 读取"
                paid={`${formatUsdPerMillion(pricing.cache_write_price, rate)} / ${formatUsdPerMillion(pricing.cache_read_price, rate)}`}
                official={`${formatOfficial(model.official_pricing?.cache_write_price)} / ${formatOfficial(model.official_pricing?.cache_read_price)}`}
              />
            ) : null}
          </View>
        )
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
          {requestIntervals.length === 0 ? <PriceCell label={`实付 / ${unit}`} paid={formatUsdPerRequest(pricing.per_request_price, rate, unit)} /> : null}
          {hasPrice(pricing.image_input_price) ? <PriceCell label="图片输入" paid={formatUsdPerRequest(pricing.image_input_price, rate, '张')} /> : null}
          {hasPrice(pricing.image_output_price) ? <PriceCell label="图片输出" paid={formatUsdPerRequest(pricing.image_output_price, rate, '张')} /> : null}
          {hasPrice(model.official_pricing?.input_price) || hasPrice(model.official_pricing?.output_price) ? (
            <PriceCell label="官方 Token 参考" official={`${formatOfficial(model.official_pricing?.input_price)} / ${formatOfficial(model.official_pricing?.output_price)}`} />
          ) : null}
        </View>
      )}

      {!isToken && requestIntervals.length > 0 ? (
        <View style={{ marginTop: 5 }}>
          {requestIntervals.map((interval, index) => (
            <Text key={`${model.name}-request-${index}`} style={{ marginTop: 3, color: colors.subtext, fontSize: 10 }}>
              {intervalLabel(interval)} · {formatUsdPerRequest(interval.per_request_price, rate, unit)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function GroupSection({ group, collapsed, onToggle }: { group: ModelPlazaGroup; collapsed: boolean; onToggle: () => void }) {
  const tone = platformTone(group.platform);
  const rate = effectiveRate(group);
  const customRate = group.user_rate_multiplier !== undefined && group.user_rate_multiplier !== group.rate_multiplier;
  const peakNote = group.peak_rate_enabled && group.peak_start && group.peak_end
    ? `高峰 ${group.peak_start}-${group.peak_end} · ${formatRate(group.peak_rate_multiplier)}`
    : '';

  return (
    <View style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: radius.md }}>
      <Pressable
        accessibilityLabel={`${group.name}${collapsed ? '，展开' : '，收起'}`}
        accessibilityRole="button"
        onPress={onToggle}
        style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 14, backgroundColor: tone.soft, opacity: pressed ? 0.78 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <Text numberOfLines={2} style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{group.name}</Text>
              <View style={{ borderRadius: 6, backgroundColor: tone.accent, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700' }}>{group.platform || '未知平台'}</Text>
              </View>
              {group.is_exclusive ? <Badge label="专属" color="#111315" background="#f6f7f7" /> : null}
              {group.subscription_type === 'subscription' ? <Badge label="订阅" color="#111315" background="#f6f7f7" /> : null}
            </View>
            <View style={{ marginTop: 7, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              {customRate ? <Text style={{ color: colors.muted, fontSize: 11, textDecorationLine: 'line-through' }}>{formatRate(group.rate_multiplier)}</Text> : null}
              <Text style={{ color: tone.accent, fontSize: 12, fontWeight: '800' }}>{formatRate(rate)}</Text>
              <Text style={{ color: colors.subtext, fontSize: 11 }}>{group.models.length} 个模型</Text>
            </View>
            {group.description?.trim() ? <Text numberOfLines={2} style={{ marginTop: 7, color: colors.subtext, fontSize: 11, lineHeight: 17 }}>{group.description.trim()}</Text> : null}
            {peakNote ? <Text style={{ marginTop: 5, color: colors.warning, fontSize: 10 }}>{peakNote}</Text> : null}
          </View>
          <ChevronDown color={tone.accent} size={20} style={{ transform: [{ rotate: collapsed ? '-90deg' : '0deg' }] }} />
        </View>
      </Pressable>
      {!collapsed ? (
        <View style={{ paddingHorizontal: 14 }}>
          {group.models.map((model) => <ModelPricingRow key={`${group.id}-${model.name}`} model={model} rate={rate} />)}
        </View>
      ) : null}
    </View>
  );
}

function Badge({ label, color, background }: { label: string; color: string; background: string }) {
  return (
    <View style={{ borderRadius: 6, backgroundColor: background, paddingHorizontal: 7, paddingVertical: 3 }}>
      <Text style={{ color, fontSize: 10, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function ModelPlazaScreen() {
  const config = useSnapshot(adminConfigState);
  const connected = hasAuthenticatedAdminSession(config);
  const [search, setSearch] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [selectedGroupId, setSelectedGroupId] = useState<FilterValue>('all');
  const [selectedRate, setSelectedRate] = useState<FilterValue>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ['model-plaza'],
    queryFn: getModelPlaza,
    enabled: connected,
    retry: false,
    staleTime: 60_000,
  });

  const groups = query.data?.groups ?? [];
  const platforms = useMemo(
    () => [...new Set(groups.map((group) => group.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [groups]
  );
  const rates = useMemo(
    () => [...new Set(groups.map((group) => effectiveRate(group)))].sort((a, b) => a - b),
    [groups]
  );

  const filteredGroups = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return groups
      .filter((group) => selectedPlatform === 'all' || group.platform === selectedPlatform)
      .filter((group) => selectedGroupId === 'all' || group.id === selectedGroupId)
      .filter((group) => selectedRate === 'all' || effectiveRate(group) === selectedRate)
      .map((group) => keyword
        ? { ...group, models: group.models.filter((model) => model.name.toLowerCase().includes(keyword)) }
        : group)
      .filter((group) => group.models.length > 0)
      .sort((left, right) => effectiveRate(left) - effectiveRate(right) || left.name.localeCompare(right.name));
  }, [groups, search, selectedGroupId, selectedPlatform, selectedRate]);

  const groupOptions = useMemo(() => groups.map((group) => ({ id: group.id, name: group.name, platform: group.platform, rate: effectiveRate(group) })), [groups]);

  function platformEnabled(platform: string) {
    return groupOptions.some((group) => group.platform === platform
      && (selectedGroupId === 'all' || group.id === selectedGroupId)
      && (selectedRate === 'all' || group.rate === selectedRate));
  }

  function groupEnabled(group: { platform: string; rate: number }) {
    return (selectedPlatform === 'all' || group.platform === selectedPlatform)
      && (selectedRate === 'all' || group.rate === selectedRate);
  }

  function rateEnabled(rate: number) {
    return groupOptions.some((group) => group.rate === rate
      && (selectedPlatform === 'all' || group.platform === selectedPlatform)
      && (selectedGroupId === 'all' || group.id === selectedGroupId));
  }

  function toggleGroup(groupId: number) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  const totalModels = useMemo(() => new Set(groups.flatMap((group) => group.models.map((model) => model.name))).size, [groups]);
  const errorMessage = getErrorMessage(query.error);

  return (
    <ScreenShell
      title="模型广场"
      subtitle="按分组查看可用模型与价格"
      variant="minimal"
      refreshing={query.isRefetching}
      onRefresh={() => {
        void query.refetch();
      }}
      right={(
        <Pressable
          accessibilityLabel="刷新模型广场"
          accessibilityRole="button"
          onPress={() => void query.refetch()}
          style={({ pressed }) => ({ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.68 : 1 })}
        >
          <RefreshCw color={colors.primary} size={17} />
        </Pressable>
      )}
    >
      {!connected ? (
        <StatePanel icon={<Store color={colors.primary} size={22} />} title="尚未连接服务器" message="请先在设置页添加服务器和 Admin Key。" />
      ) : query.isLoading ? (
        <StatePanel icon={<ActivityIndicator color={colors.primary} />} title="正在读取模型广场" message="正在同步服务端分组和价格。" />
      ) : query.isError ? (
        <StatePanel icon={<CircleAlert color={colors.danger} size={22} />} title="暂时无法读取" message={errorMessage} actionLabel="重新读取" onAction={() => void query.refetch()} danger />
      ) : (
        <>
          {query.data?.description?.trim() ? (
            <View style={{ borderLeftWidth: 3, borderLeftColor: colors.primary, backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Info color={colors.primary} size={15} />
                <Text selectable style={{ flex: 1, color: colors.subtext, fontSize: 12, lineHeight: 19 }}>{query.data.description.trim()}</Text>
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
            <Metric label="分组" value={groups.length} />
            <Metric label="模型" value={totalModels} />
            <Metric label="平台" value={platforms.length} />
          </View>

          <View style={{ gap: 10, backgroundColor: colors.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.page, paddingHorizontal: 10 }}>
              <Search color={colors.subtext} size={16} />
              <TextInput
                accessibilityLabel="搜索模型"
                value={search}
                onChangeText={setSearch}
                placeholder="搜索模型名称"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ flex: 1, minHeight: 42, paddingHorizontal: 9, color: colors.text, fontSize: 13 }}
              />
              {search ? (
                <Pressable accessibilityLabel="清除模型搜索" accessibilityRole="button" onPress={() => setSearch('')} hitSlop={8}>
                  <X color={colors.subtext} size={16} />
                </Pressable>
              ) : null}
            </View>
            <FilterRow label="平台">
              <FilterChip label="全部" selected={selectedPlatform === 'all'} onPress={() => setSelectedPlatform('all')} />
              {platforms.map((platform) => <FilterChip key={platform} label={platform} tone={platformTone(platform)} selected={selectedPlatform === platform} disabled={!platformEnabled(platform)} onPress={() => setSelectedPlatform(platform)} />)}
            </FilterRow>
            <FilterRow label="分组">
              <FilterChip label="全部" selected={selectedGroupId === 'all'} onPress={() => setSelectedGroupId('all')} />
              {groupOptions.map((group) => <FilterChip key={group.id} label={group.name} tone={platformTone(group.platform)} selected={selectedGroupId === group.id} disabled={!groupEnabled(group)} onPress={() => setSelectedGroupId(group.id)} />)}
            </FilterRow>
            <FilterRow label="倍率">
              <FilterChip label="全部" selected={selectedRate === 'all'} onPress={() => setSelectedRate('all')} />
              {rates.map((rate) => <FilterChip key={rate} label={formatRate(rate)} selected={selectedRate === rate} disabled={!rateEnabled(rate)} onPress={() => setSelectedRate(rate)} />)}
            </FilterRow>
          </View>

          {filteredGroups.length > 0 ? filteredGroups.map((group) => (
            <GroupSection key={group.id} group={group} collapsed={collapsedGroups.has(group.id)} onToggle={() => toggleGroup(group.id)} />
          )) : (
            <StatePanel icon={<Search color={colors.subtext} size={22} />} title="没有匹配结果" message={search.trim() ? '换一个模型名称或清除筛选条件。' : '服务端暂时没有可展示的模型分组。'} />
          )}
        </>
      )}
    </ScreenShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 11 }}>
      <Text style={{ color: colors.subtext, fontSize: 10 }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={{ marginTop: 4, color: colors.text, fontSize: 18, fontWeight: '800' }}>{value}</Text>
    </View>
  );
}

function StatePanel({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  danger = false,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  danger?: boolean;
}) {
  return (
    <View style={{ alignItems: 'center', borderWidth: 1, borderColor: danger ? '#fdecea' : colors.border, backgroundColor: danger ? colors.dangerSoft : colors.card, paddingHorizontal: 20, paddingVertical: 28 }}>
      {icon}
      <Text style={{ marginTop: 10, color: danger ? colors.danger : colors.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>
      <Text style={{ marginTop: 6, color: colors.subtext, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => ({ marginTop: 14, minHeight: 40, justifyContent: 'center', borderRadius: 8, backgroundColor: colors.primary, paddingHorizontal: 18, opacity: pressed ? 0.74 : 1 })}>
          <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
