import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Store } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ListCard } from '@/src/components/list-card';
import { IconButton } from '@/src/components/icon-button';
import { ScreenShell } from '@/src/components/screen-shell';
import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { getCchModelPrices } from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';
import { inputStyle } from '@/src/theme';

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
        <IconButton icon={RefreshCw} label="刷新 CCH 模型定价" onPress={() => void modelsQuery.refetch()} />
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
            placeholderTextColor="#8b9094"
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
          />
          {modelsQuery.isLoading ? <Text style={{ color: '#5f6468', fontSize: 13 }}>正在读取模型价格...</Text> : null}
          {modelsQuery.error ? <ListCard title="模型价格读取失败" meta={getCchErrorMessage(modelsQuery.error)} icon={Store} badge="异常" badgeTone="danger" /> : null}
          {!modelsQuery.isLoading && !modelsQuery.error && models.length === 0 ? <ListCard title="没有匹配的模型价格" meta="当前 CCH 价格表为空，或没有匹配搜索条件。" icon={Store} /> : null}
          {models.map((model) => (
            <ListCard key={model.id} title={model.modelName} meta={`来源：${sourceLabel(model.source)}`} icon={Store} badge={model.source === 'manual' ? '手动' : '同步'} badgeTone={model.source === 'manual' ? 'warning' : 'success'}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={{ color: '#5f6468', fontSize: 11 }}>价格字段 {Object.keys(model.priceData).length}</Text>
                <Text style={{ color: '#5f6468', fontSize: 11 }}>更新 {new Date(model.updatedAt).toLocaleDateString('zh-CN')}</Text>
              </View>
            </ListCard>
          ))}
          {modelsQuery.data && modelsQuery.data.total > models.length ? <Text style={{ color: '#5f6468', fontSize: 11 }}>当前显示前 {models.length} 条，CCH 共 {modelsQuery.data.total} 条模型价格。</Text> : null}
        </>
      )}
    </ScreenShell>
  );
}
