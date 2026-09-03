import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound, Save, Server } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { ServiceModeControl } from '@/src/components/service-mode-control';
import { ScreenShell } from '@/src/components/screen-shell';
import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { getCchHealth, getCchOverview } from '@/src/services/cch';
import { cchConfigState, saveCchConfig } from '@/src/store/cch-config';

const { useSnapshot } = require('valtio/react');

const connectionSchema = z.object({
  baseUrl: z.string().trim().url('请输入有效的 CCH 地址'),
  apiKey: z.string().trim().min(1, '请输入 CCH Admin Key'),
});

type ConnectionValues = z.infer<typeof connectionSchema>;
type ConnectionState = 'idle' | 'checking' | 'success' | 'error';

export function CchSettingsScreen() {
  const config = useSnapshot(cchConfigState);
  const queryClient = useQueryClient();
  const [showApiKey, setShowApiKey] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const form = useForm<ConnectionValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: { baseUrl: config.baseUrl, apiKey: config.apiKey },
  });
  const healthQuery = useQuery({
    queryKey: ['cch', 'health', config.baseUrl],
    queryFn: getCchHealth,
    enabled: config.hydrated,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!config.hydrated) return;
    form.reset({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  }, [config.apiKey, config.baseUrl, config.hydrated, form]);

  async function saveConnection(values: ConnectionValues) {
    const previousConfig = { baseUrl: config.baseUrl, apiKey: config.apiKey };
    setConnectionState('checking');
    setConnectionMessage('正在验证 CCH 管理接口...');

    try {
      await saveCchConfig(values);
      queryClient.removeQueries({ queryKey: ['cch'] });
      await Promise.all([getCchHealth(), getCchOverview()]);
      setConnectionState('success');
      setConnectionMessage('CCH 管理接口已连接。');
    } catch (error) {
      await saveCchConfig(previousConfig);
      setConnectionState('error');
      setConnectionMessage(getCchErrorMessage(error));
    }
  }

  const identity = healthQuery.data;
  const healthy = identity?.status.toLowerCase() === 'healthy';

  return (
    <ScreenShell
      title="设置"
      subtitle="CCH 管理连接与服务切换"
      variant="minimal"
      refreshing={healthQuery.isRefetching}
      onRefresh={() => healthQuery.refetch().then(() => undefined)}
    >
      <ServiceModeControl />
      <View style={{ borderRadius: 8, borderWidth: 1, borderColor: '#dfe5e1', backgroundColor: '#ffffff', padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: healthy ? '#e7f2ee' : '#edf0ee' }}>
            <Server color={healthy ? '#1f6759' : '#65706c'} size={18} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: '#17201d', fontSize: 14, fontWeight: '700' }}>CCH 服务状态</Text>
            <Text numberOfLines={1} style={{ marginTop: 3, color: '#65706c', fontSize: 12 }}>{config.baseUrl}</Text>
            <Text style={{ marginTop: 5, color: healthy ? '#1f6759' : healthQuery.error ? '#b84a32' : '#65706c', fontSize: 11 }}>
              {healthQuery.isLoading ? '正在检测' : healthy ? `服务正常${identity?.version ? ` · v${identity.version.replace(/^v/i, '')}` : ''}` : healthQuery.error ? getCchErrorMessage(healthQuery.error) : '等待检测'}
            </Text>
          </View>
        </View>
      </View>
      <View style={{ borderRadius: 8, borderWidth: 1, borderColor: '#dfe5e1', backgroundColor: '#ffffff', padding: 14 }}>
        <Text style={{ color: '#17201d', fontSize: 16, fontWeight: '700' }}>CCH 管理连接</Text>
        <Text style={{ marginTop: 4, color: '#65706c', fontSize: 11, lineHeight: 17 }}>CCH Admin Key 仅用于本机连接，网页端不会持久化保存。</Text>
        <View style={{ marginTop: 14, gap: 13 }}>
          <View>
            <Text style={{ marginBottom: 7, color: '#65706c', fontSize: 12, fontWeight: '600' }}>CCH 地址</Text>
            <Controller
              control={form.control}
              name="baseUrl"
              render={({ field: { onChange, value } }) => (
                <TextInput
                  value={value}
                  onChangeText={onChange}
                  placeholder="https://cch.cacr.site"
                  placeholderTextColor="#89928e"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={{ minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: '#dfe5e1', backgroundColor: '#edf0ee', paddingHorizontal: 13, color: '#17201d', fontSize: 14 }}
                />
              )}
            />
          </View>
          <View>
            <Text style={{ marginBottom: 7, color: '#65706c', fontSize: 12, fontWeight: '600' }}>CCH Admin Key</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Controller
                control={form.control}
                name="apiKey"
                render={({ field: { onChange, value } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="输入 CCH Admin Key"
                    placeholderTextColor="#89928e"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showApiKey}
                    style={{ flex: 1, minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: '#dfe5e1', backgroundColor: '#edf0ee', paddingHorizontal: 13, color: '#17201d', fontSize: 14 }}
                  />
                )}
              />
              <Pressable accessibilityLabel={showApiKey ? '隐藏 CCH Admin Key' : '显示 CCH Admin Key'} accessibilityRole="button" onPress={() => setShowApiKey((value) => !value)} style={({ pressed }) => ({ width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#edf0ee', opacity: pressed ? 0.7 : 1 })}>
                {showApiKey ? <EyeOff color="#65706c" size={18} /> : <Eye color="#65706c" size={18} />}
              </Pressable>
            </View>
          </View>
          {form.formState.errors.baseUrl || form.formState.errors.apiKey ? (
            <View style={{ borderRadius: 8, backgroundColor: '#fff1ed', paddingHorizontal: 12, paddingVertical: 10 }}>
              <Text style={{ color: '#b84a32', fontSize: 12 }}>{form.formState.errors.baseUrl?.message || form.formState.errors.apiKey?.message}</Text>
            </View>
          ) : null}
          {connectionMessage ? (
            <View style={{ borderRadius: 8, backgroundColor: connectionState === 'success' ? '#e7f2ee' : '#fff1ed', paddingHorizontal: 12, paddingVertical: 10 }}>
              <Text style={{ color: connectionState === 'success' ? '#1f6759' : '#b84a32', fontSize: 12 }}>{connectionMessage}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityLabel="保存并验证 CCH 管理连接"
            accessibilityRole="button"
            disabled={connectionState === 'checking'}
            onPress={form.handleSubmit(saveConnection)}
            style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 8, backgroundColor: '#1f6759', opacity: connectionState === 'checking' ? 0.55 : pressed ? 0.78 : 1 })}
          >
            {connectionState === 'checking' ? <ActivityIndicator color="#ffffff" size="small" /> : <Save color="#ffffff" size={16} />}
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>{connectionState === 'checking' ? '正在验证' : '保存并验证'}</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ borderRadius: 8, borderWidth: 1, borderColor: '#dfe5e1', backgroundColor: '#ffffff', padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
          <KeyRound color="#65706c" size={16} />
          <Text style={{ flex: 1, color: '#65706c', fontSize: 11, lineHeight: 18 }}>CCH 模式只显示 CCH 管理接口已提供的监控和只读列表，避免把 Sub2API 的运行设置或写操作错误地发送到 CCH。</Text>
        </View>
      </View>
    </ScreenShell>
  );
}
