import { Redirect, router } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { ServiceModeControl } from '@/src/components/service-mode-control';
import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { getAdminSettings, getDashboardStats } from '@/src/services/admin';
import { getCchOverview } from '@/src/services/cch';
import { queryClient } from '@/src/lib/query-client';
import { adminConfigState, hasAuthenticatedAdminSession, saveAdminConfig } from '@/src/store/admin-config';
import { cchConfigState, hasCchAdminSession, saveCchConfig } from '@/src/store/cch-config';
import { serviceModeState, setServiceMode, type ServiceMode } from '@/src/store/service-mode';

const { useSnapshot } = require('valtio/react');

const sub2ApiSchema = z
  .object({
    baseUrl: z.string().min(1, '请输入服务器地址'),
    adminKey: z.string(),
  })
  .refine((values) => values.adminKey.trim().length > 0, {
    path: ['adminKey'],
    message: '请输入 Admin Key',
  });

const cchSchema = z.object({
  baseUrl: z.string().trim().url('请输入有效的 CCH 地址'),
  adminKey: z.string().trim().min(1, '请输入 CCH Admin Key'),
});

type FormValues = z.infer<typeof sub2ApiSchema>;
type ConnectionState = 'idle' | 'checking' | 'error';
type LoginConnectionFormProps = {
  mode: ServiceMode;
  baseUrl: string;
  adminKey: string;
};

const colors = {
  page: '#f4efe4',
  card: '#fbf8f2',
  mutedCard: '#f1ece2',
  primary: '#1d5f55',
  text: '#16181a',
  subtext: '#6f665c',
  border: '#e7dfcf',
  dangerBg: '#fbf1eb',
  danger: '#c25d35',
};

function getSub2ApiConnectionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    switch (error.message) {
      case 'BASE_URL_REQUIRED':
        return '请先填写服务器地址。';
      case 'ADMIN_API_KEY_REQUIRED':
        return '请先填写 Admin Key。';
      case 'INVALID_SERVER_RESPONSE':
        return '当前地址返回的数据不正确，请确认它是可用的管理接口。';
      default:
        return error.message;
    }
  }

  return '连接失败，请检查服务器地址、Admin Key 和网络连通性。';
}

function LoginConnectionForm({ mode, baseUrl, adminKey }: LoginConnectionFormProps) {
  const isCch = mode === 'cch';
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(isCch ? cchSchema : sub2ApiSchema),
    defaultValues: {
      baseUrl,
      adminKey,
    },
  });
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [showAdminKey, setShowAdminKey] = useState(false);

  async function connect(values: FormValues) {
    setConnectionState('checking');
    setConnectionMessage('正在验证服务器连接...');

    if (isCch) {
      const previousConfig = { baseUrl: cchConfigState.baseUrl, apiKey: cchConfigState.apiKey };

      try {
        await saveCchConfig({ baseUrl: values.baseUrl, apiKey: values.adminKey });
        queryClient.clear();
        await getCchOverview();
        await setServiceMode('cch');
        router.replace('/monitor');
      } catch (error) {
        await saveCchConfig(previousConfig);
        setConnectionState('error');
        setConnectionMessage(getCchErrorMessage(error));
      }

      return;
    }

    try {
      await saveAdminConfig({ baseUrl: values.baseUrl, adminApiKey: values.adminKey });
      queryClient.clear();
      await queryClient.fetchQuery({ queryKey: ['admin-settings'], queryFn: getAdminSettings });
      await queryClient.prefetchQuery({ queryKey: ['monitor-stats'], queryFn: getDashboardStats });
      await setServiceMode('sub2api');
      router.replace('/monitor');
    } catch (error) {
      setConnectionState('error');
      setConnectionMessage(getSub2ApiConnectionErrorMessage(error));
    }
  }

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 18, gap: 16 }}>
      <View>
        <Text style={{ marginBottom: 8, fontSize: 12, color: colors.subtext }}>{isCch ? 'CCH 地址' : '服务器地址'}</Text>
        <Controller
          control={control}
          name="baseUrl"
          render={({ field: { onChange, value } }) => (
            <TextInput
              value={value}
              onChangeText={(text) => {
                if (connectionState !== 'idle') {
                  setConnectionState('idle');
                  setConnectionMessage('');
                }
                onChange(text);
              }}
              placeholder={isCch ? 'https://cch.cacr.site' : '例如：https://api.example.com'}
              placeholderTextColor="#9b9081"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{ backgroundColor: colors.mutedCard, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.text }}
            />
          )}
        />
      </View>

      <View>
        <Text style={{ marginBottom: 8, fontSize: 12, color: colors.subtext }}>{isCch ? 'CCH Admin Key' : 'Admin Key'}</Text>
        <Controller
          control={control}
          name="adminKey"
          render={({ field: { onChange, value } }) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={value}
                onChangeText={(text) => {
                  if (connectionState !== 'idle') {
                    setConnectionState('idle');
                    setConnectionMessage('');
                  }
                  onChange(text);
                }}
                placeholder={isCch ? '输入 CCH Admin Key' : 'admin-xxxxxxxx'}
                placeholderTextColor="#9b9081"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showAdminKey}
                style={{
                  flex: 1,
                  backgroundColor: colors.mutedCard,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  fontSize: 16,
                  color: colors.text,
                }}
              />
              <Pressable
                accessibilityLabel={showAdminKey ? `隐藏 ${isCch ? 'CCH Admin Key' : 'Admin Key'}` : `显示 ${isCch ? 'CCH Admin Key' : 'Admin Key'}`}
                accessibilityRole="button"
                onPress={() => setShowAdminKey((value) => !value)}
                style={{ backgroundColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#4e463e' }}>{showAdminKey ? '隐藏' : '显示'}</Text>
              </Pressable>
            </View>
          )}
        />
      </View>

      {formState.errors.baseUrl || formState.errors.adminKey ? (
        <View style={{ borderRadius: 14, backgroundColor: colors.dangerBg, paddingHorizontal: 14, paddingVertical: 12 }}>
          <Text style={{ color: colors.danger, fontSize: 14 }}>{formState.errors.baseUrl?.message || formState.errors.adminKey?.message}</Text>
        </View>
      ) : null}

      {connectionMessage ? (
        <View style={{ borderRadius: 14, backgroundColor: colors.dangerBg, paddingHorizontal: 14, paddingVertical: 12 }}>
          <Text style={{ color: colors.danger, fontSize: 14 }}>{connectionMessage}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel="进入应用"
        accessibilityRole="button"
        style={{ backgroundColor: connectionState === 'checking' ? '#7ca89f' : colors.primary, borderRadius: 18, paddingVertical: 15, alignItems: 'center' }}
        disabled={connectionState === 'checking'}
        onPress={handleSubmit(connect)}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{connectionState === 'checking' ? '连接中...' : '进入应用'}</Text>
      </Pressable>
    </View>
  );
}

export default function LoginScreen() {
  const config = useSnapshot(adminConfigState);
  const cchConfig = useSnapshot(cchConfigState);
  const serviceMode = useSnapshot(serviceModeState);
  const isCch = serviceMode.mode === 'cch';
  const hasAccount = isCch ? hasCchAdminSession(cchConfig) : hasAuthenticatedAdminSession(config);

  if (hasAccount) return <Redirect href="/monitor" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingVertical: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ flex: 1, justifyContent: 'center', gap: 20 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 34, fontWeight: '800', color: colors.text }}>{isCch ? 'CCH 管理员登录' : '管理员入口'}</Text>
            <Text style={{ fontSize: 14, lineHeight: 22, color: colors.subtext }}>
              {isCch
                ? '填写 CCH 地址和 CCH Admin Key。验证通过后即可查看 CCH 的监控和管理数据。'
                : '首次进入请填写服务器地址和 Admin Key。连接成功后即可进入应用，并在“设置”页管理多个服务器。'}
            </Text>
          </View>
          <ServiceModeControl compact />
          <LoginConnectionForm
            key={serviceMode.mode}
            mode={serviceMode.mode}
            baseUrl={isCch ? cchConfig.baseUrl : config.baseUrl}
            adminKey={isCch ? cchConfig.apiKey : config.adminApiKey}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
