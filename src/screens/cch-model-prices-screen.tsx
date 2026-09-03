import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Store } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { getCchModelPrices } from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';

const { useSnapshot } = require('valtio/react');

function sourceLabel(source: 'cloud' | 'litellm' | 'manual') {
  if (source === 'manual') return '手动';
  return source === 'cloud' ? '云端' : 'LiteLLM';
}

export function CchModelPricesScreen() {
  const config = useSnapshot(cchConfigState);
  const hasSession = hasCchAdminSession(config);
  const [search, setSearch] = useState('');
  const scope = config.baseUrl;
  const modelsQuery = useQuery({
    queryKey: ['cch', 'model-prices', scope, search],
    queryFn: () => getCchModelPrices(search),
    enabled: hasSession,
    staleTime: 60_000,
    retry: false,
  });
  const models = modelsQuery.data?.items ?? [];

  return (
    <ScreenShell
      title="模型定价"
      subtitle={modelsQuery.data ? `CCH 已配置 ${modelsQuery.data.total} 个模型价格` : 'CCH 模型价格表'}
      variant="minimal"
      refreshing={modelsQuery.isRefetching}
      onRefresh={() => modelsQuery.refetch().then(() => undefined)}
      right={(
        <Pressable accessibilityLabel="刷新 CCH 模型定价" accessibilityRole="button" onPress={() => void modelsQuery.refetch()} style={({ pressed }) => ({ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dfe5e1', opacity: pressed ? 0.72 : 1 })}>
          <RefreshCw color="#1f6759" size={17} />
        </Pressable>
      )}
    >
      {!hasSession ? (
        <ListCard title="尚未连接 CCH" meta="请在设置页选择 CCH 并填写 CCH Admin Key。" icon={Store} />
      ) : (
        <>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="搜索模型名称"
            placeholderTextColor="#8a948f"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#dfe5e1', backgroundColor: '#ffffff', paddingHorizontal: 13, color: '#17201d', fontSize: 14 }}
          />
          {modelsQuery.isLoading ? <Text style={{ color: '#65706c', fontSize: 13 }}>正在读取模型价格...</Text> : null}
          {modelsQuery.error ? <ListCard title="模型价格读取失败" meta={getCchErrorMessage(modelsQuery.error)} icon={Store} badge="异常" badgeTone="danger" /> : null}
          {!modelsQuery.isLoading && !modelsQuery.error && models.length === 0 ? <ListCard title="没有匹配的模型价格" meta="当前 CCH 价格表为空，或没有匹配搜索条件。" icon={Store} /> : null}
          {models.map((model) => (
            <ListCard key={model.id} title={model.modelName} meta={`来源：${sourceLabel(model.source)}`} icon={Store} badge={model.source === 'manual' ? '手动' : '同步'} badgeTone={model.source === 'manual' ? 'warning' : 'success'}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={{ color: '#65706c', fontSize: 11 }}>价格字段 {Object.keys(model.priceData).length}</Text>
                <Text style={{ color: '#65706c', fontSize: 11 }}>更新 {new Date(model.updatedAt).toLocaleDateString('zh-CN')}</Text>
              </View>
            </ListCard>
          ))}
          {modelsQuery.data && modelsQuery.data.total > models.length ? <Text style={{ color: '#65706c', fontSize: 11 }}>当前显示前 {models.length} 条，CCH 共 {modelsQuery.data.total} 条模型价格。</Text> : null}
        </>
      )}
    </ScreenShell>
  );
}
