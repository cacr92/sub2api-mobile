import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, Clock3, Eye, EyeOff, Gauge, Minus, Plus, Save, Server, ShieldAlert, Trash2, Wifi } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { ServiceModeControl } from '@/src/components/service-mode-control';
import { CchSettingsScreen } from '@/src/screens/cch-settings-screen';
import {
  getAdminSettings,
  getDashboardStats,
  getOverloadCooldownSettings,
  getRateLimit429CooldownSettings,
  getServerIdentity,
  getStreamTimeoutSettings,
  updateAdminSettings,
  updateOverloadCooldownSettings,
  updateRateLimit429CooldownSettings,
  updateStreamTimeoutSettings,
} from '@/src/services/admin';
import {
  adminConfigState,
  removeAdminAccount,
  saveAdminConfig,
  switchAdminAccount,
  type AdminAccountProfile,
} from '@/src/store/admin-config';
import type { AdminSettings, StreamTimeoutAction } from '@/src/types/admin';
import { serviceModeState } from '@/src/store/service-mode';
import { radius, shadow } from '@/src/theme';

const { useSnapshot } = require('valtio/react');

const connectionSchema = z
  .object({
    baseUrl: z.string().trim().min(1, '请输入服务器地址'),
    adminApiKey: z.string(),
  })
  .refine((values) => values.adminApiKey.trim().length > 0, {
    path: ['adminApiKey'],
    message: '请输入 Admin Key',
  });

const runtimeSettingsSchema = z.object({
  registrationEnabled: z.boolean(),
  emailVerifyEnabled: z.boolean(),
  passwordResetEnabled: z.boolean(),
  channelMonitorEnabled: z.boolean(),
  modelPlazaEnabled: z.boolean(),
  modelPlazaRequireAuth: z.boolean(),
  modelPlazaDescription: z.string(),
  defaultConcurrency: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

const overloadCooldownSchema = z.object({
  enabled: z.boolean(),
  cooldownMinutes: z.number().int().min(1).max(120),
});

const rateLimit429CooldownSchema = z.object({
  enabled: z.boolean(),
  cooldownSeconds: z.number().int().min(1).max(7_200),
});

const streamTimeoutSchema = z.object({
  enabled: z.boolean(),
  action: z.enum(['temp_unsched', 'error', 'none']),
  tempUnschedMinutes: z.number().int().min(1).max(60),
  thresholdCount: z.number().int().min(1).max(10),
  thresholdWindowMinutes: z.number().int().min(1).max(60),
});

type ConnectionFormValues = z.infer<typeof connectionSchema>;
type RuntimeSettingsValues = z.infer<typeof runtimeSettingsSchema>;
type OverloadCooldownValues = z.infer<typeof overloadCooldownSchema>;
type RateLimit429CooldownValues = z.infer<typeof rateLimit429CooldownSchema>;
type StreamTimeoutValues = z.infer<typeof streamTimeoutSchema>;
type ConnectionState = 'idle' | 'checking' | 'success' | 'error';
type SaveNotice = { message: string; tone: 'success' | 'danger' };
type ProtectionScope = 'overload' | 'rate-limit-429' | 'stream-timeout';
type ProtectionNotice = SaveNotice & { scope: ProtectionScope };

const runtimeProtectionKeys = {
  overload: ['runtime-protection', 'overload-cooldown'] as const,
  rateLimit429: ['runtime-protection', 'rate-limit-429-cooldown'] as const,
  streamTimeout: ['runtime-protection', 'stream-timeout'] as const,
};

const colors = {
  page: '#ffffff',
  card: '#ffffff',
  mutedCard: '#e8e9e9',
  primary: '#111315',
  primarySoft: '#f6f7f7',
  text: '#111315',
  subtext: '#5f6468',
  border: '#e8e9e9',
  dangerBg: '#fdecea',
  danger: '#d92d20',
  successBg: '#f6f7f7',
  success: '#111315',
};

function getConnectionErrorMessage(error: unknown) {
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

function getRuntimeProtectionErrorMessage(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : 'REQUEST_FAILED';

  if (message === 'HTTP_404') return '当前服务端版本尚未提供此项设置。';
  if (message === 'HTTP_401' || message === 'HTTP_403') return 'Admin Key 无权读取或修改此项设置。';
  return getConnectionErrorMessage(error);
}

function toRuntimeSettings(settings: AdminSettings): RuntimeSettingsValues {
  const concurrency = Number.isSafeInteger(settings.default_concurrency) && settings.default_concurrency >= 1
    ? settings.default_concurrency
    : 1;

  return {
    registrationEnabled: settings.registration_enabled === true,
    emailVerifyEnabled: settings.email_verify_enabled === true,
    passwordResetEnabled: settings.password_reset_enabled === true,
    channelMonitorEnabled: settings.channel_monitor_enabled !== false,
    modelPlazaEnabled: settings.model_plaza_enabled === true,
    modelPlazaRequireAuth: settings.model_plaza_require_auth === true,
    modelPlazaDescription: settings.model_plaza_description ?? '',
    defaultConcurrency: concurrency,
  };
}

function supportsModelPlazaSettings(settings?: AdminSettings) {
  if (!settings) return false;

  return ['model_plaza_enabled', 'model_plaza_require_auth', 'model_plaza_description']
    .some((key) => Object.prototype.hasOwnProperty.call(settings, key));
}

function formatLatency(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '--';
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function formatCheckedAt(value?: string) {
  if (!value) return '--';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '--';

  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function SettingsSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', paddingHorizontal: 16, paddingVertical: 16, ...shadow.card }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{title}</Text>
      {subtitle ? <Text style={{ marginTop: 5, fontSize: 12, lineHeight: 18, color: colors.subtext }}>{subtitle}</Text> : null}
      <View style={{ marginTop: 14 }}>{children}</View>
    </View>
  );
}

function SettingToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  showDivider = true,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  showDivider?: boolean;
}) {
  return (
    <View style={{ minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomColor: colors.border, borderBottomWidth: showDivider ? 1 : 0, paddingVertical: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{title}</Text>
        <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 17, color: colors.subtext }}>{subtitle}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#e8e9e9', true: '#5f6468' }}
        thumbColor={value ? colors.primary : '#ffffff'}
      />
    </View>
  );
}

function NumberSettingRow({
  title,
  subtitle,
  value,
  min,
  max,
  unit,
  onValueChange,
}: {
  title: string;
  subtitle: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onValueChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(`${value}`);

  useEffect(() => setDraft(`${value}`), [value]);

  function commitDraft() {
    const parsed = Number.parseInt(draft, 10);
    const normalized = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(`${normalized}`);
    if (normalized !== value) onValueChange(normalized);
  }

  return (
    <View style={{ minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{title}</Text>
        <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 17, color: colors.subtext }}>{subtitle}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' }}>
          <Pressable
            accessibilityLabel={`减少${title}`}
            accessibilityRole="button"
            disabled={value <= min}
            onPress={() => onValueChange(Math.max(min, value - 1))}
            style={({ pressed }) => ({ width: 36, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mutedCard, opacity: value <= min ? 0.4 : pressed ? 0.7 : 1 })}
          >
            <Minus color={colors.text} size={14} />
          </Pressable>
          <TextInput
            accessibilityLabel={title}
            value={draft}
            onChangeText={(text) => {
              if (/^\d*$/.test(text)) setDraft(text);
            }}
            onBlur={commitDraft}
            onSubmitEditing={commitDraft}
            keyboardType="number-pad"
            selectTextOnFocus
            style={{ width: 62, height: 38, paddingHorizontal: 4, textAlign: 'center', fontSize: 14, fontWeight: '700', color: colors.text, backgroundColor: colors.card }}
          />
          <Pressable
            accessibilityLabel={`增加${title}`}
            accessibilityRole="button"
            disabled={value >= max}
            onPress={() => onValueChange(Math.min(max, value + 1))}
            style={({ pressed }) => ({ width: 36, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mutedCard, opacity: value >= max ? 0.4 : pressed ? 0.7 : 1 })}
          >
            <Plus color={colors.text} size={14} />
          </Pressable>
        </View>
        <Text style={{ marginTop: 3, fontSize: 9, color: colors.subtext }}>{unit} · {min}-{max}</Text>
      </View>
    </View>
  );
}

const streamTimeoutActions: Array<{ value: StreamTimeoutAction; label: string }> = [
  { value: 'temp_unsched', label: '临时停用' },
  { value: 'error', label: '标记异常' },
  { value: 'none', label: '不处理' },
];

function StreamTimeoutActionControl({
  value,
  onValueChange,
}: {
  value: StreamTimeoutAction;
  onValueChange: (value: StreamTimeoutAction) => void;
}) {
  return (
    <View style={{ paddingVertical: 9 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>超时后的动作</Text>
      <View style={{ marginTop: 8, flexDirection: 'row', borderRadius: 8, padding: 3, backgroundColor: colors.mutedCard }}>
        {streamTimeoutActions.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityLabel={`流式超时动作：${option.label}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onValueChange(option.value)}
              style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: selected ? colors.card : 'transparent', opacity: pressed ? 0.72 : 1 })}
            >
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ fontSize: 11, fontWeight: selected ? '700' : '500', color: selected ? colors.primary : colors.subtext }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function InlineNotice({ notice }: { notice?: SaveNotice }) {
  if (!notice) return null;

  return (
    <View style={{ marginTop: 8, backgroundColor: notice.tone === 'success' ? colors.successBg : colors.dangerBg, paddingHorizontal: 12, paddingVertical: 9 }}>
      <Text style={{ color: notice.tone === 'success' ? colors.success : colors.danger, fontSize: 11, lineHeight: 17 }}>{notice.message}</Text>
    </View>
  );
}

function SettingSaveButton({
  label,
  pending,
  disabled,
  onPress,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled || pending}
      onPress={onPress}
      style={({ pressed }) => ({ marginTop: 10, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 8, backgroundColor: colors.primary, opacity: disabled || pending ? 0.46 : pressed ? 0.78 : 1 })}
    >
      {pending ? <ActivityIndicator color="#ffffff" size="small" /> : <Save color="#ffffff" size={15} />}
      <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>{pending ? '正在保存' : label}</Text>
    </Pressable>
  );
}

function ProtectionLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <View style={{ marginTop: 10, backgroundColor: colors.dangerBg, paddingHorizontal: 12, paddingVertical: 10 }}>
      <Text style={{ fontSize: 11, lineHeight: 17, color: colors.danger }}>{getRuntimeProtectionErrorMessage(error)}</Text>
      <Pressable
        accessibilityLabel="重新读取保护设置"
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 7, paddingVertical: 3, opacity: pressed ? 0.68 : 1 })}
      >
        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.danger }}>重新读取</Text>
      </Pressable>
    </View>
  );
}

function ServerCard({
  account,
  active,
  onSelect,
  onDelete,
}: {
  account: AdminAccountProfile;
  active: boolean;
  onSelect: () => Promise<void>;
  onDelete: () => void;
}) {
  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: active ? colors.primary : 'rgba(255,255,255,0.6)' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.primarySoft : colors.mutedCard, borderRadius: 8 }}>
          <Server color={active ? colors.primary : colors.subtext} size={17} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{account.label}</Text>
          <Text numberOfLines={2} style={{ marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.subtext }}>{account.baseUrl}</Text>
        </View>
        {active ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 }}>
            <Check color={colors.primary} size={12} />
            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700' }}>当前</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 13 }}>
        <Pressable
          accessibilityLabel={active ? `${account.label} 已是当前服务器` : `切换到服务器 ${account.label}`}
          accessibilityRole="button"
          disabled={active}
          onPress={() => void onSelect()}
          style={({ pressed }) => ({ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: active ? colors.mutedCard : colors.primary, opacity: active ? 0.72 : pressed ? 0.78 : 1 })}
        >
          <Text style={{ color: active ? colors.subtext : '#ffffff', fontSize: 12, fontWeight: '700' }}>{active ? '正在使用' : '切换服务器'}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`删除服务器 ${account.label}`}
          accessibilityRole="button"
          onPress={onDelete}
          style={({ pressed }) => ({ width: 42, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.dangerBg, opacity: pressed ? 0.72 : 1 })}
        >
          <Trash2 color={colors.danger} size={17} />
        </Pressable>
      </View>
    </View>
  );
}

function Sub2ApiSettingsScreen() {
  const config = useSnapshot(adminConfigState);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(config.accounts.length === 0);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const [protectionNotice, setProtectionNotice] = useState<ProtectionNotice | null>(null);
  const hasAdminConnection = Boolean(config.baseUrl.trim() && config.adminApiKey.trim());

  const connectionForm = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: { baseUrl: '', adminApiKey: '' },
  });
  const runtimeForm = useForm<RuntimeSettingsValues>({
    resolver: zodResolver(runtimeSettingsSchema),
    defaultValues: {
      registrationEnabled: false,
      emailVerifyEnabled: false,
      passwordResetEnabled: false,
      channelMonitorEnabled: true,
      modelPlazaEnabled: false,
      modelPlazaRequireAuth: false,
      modelPlazaDescription: '',
      defaultConcurrency: 1,
    },
  });
  const overloadCooldownForm = useForm<OverloadCooldownValues>({
    resolver: zodResolver(overloadCooldownSchema),
    defaultValues: { enabled: true, cooldownMinutes: 10 },
  });
  const rateLimit429Form = useForm<RateLimit429CooldownValues>({
    resolver: zodResolver(rateLimit429CooldownSchema),
    defaultValues: { enabled: true, cooldownSeconds: 5 },
  });
  const streamTimeoutForm = useForm<StreamTimeoutValues>({
    resolver: zodResolver(streamTimeoutSchema),
    defaultValues: {
      enabled: false,
      action: 'temp_unsched',
      tempUnschedMinutes: 5,
      thresholdCount: 3,
      thresholdWindowMinutes: 10,
    },
  });
  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: getAdminSettings,
    staleTime: 30_000,
  });
  const overloadCooldownQuery = useQuery({
    queryKey: runtimeProtectionKeys.overload,
    queryFn: getOverloadCooldownSettings,
    enabled: hasAdminConnection,
    staleTime: 60_000,
    retry: false,
  });
  const rateLimit429Query = useQuery({
    queryKey: runtimeProtectionKeys.rateLimit429,
    queryFn: getRateLimit429CooldownSettings,
    enabled: hasAdminConnection,
    staleTime: 60_000,
    retry: false,
  });
  const streamTimeoutQuery = useQuery({
    queryKey: runtimeProtectionKeys.streamTimeout,
    queryFn: getStreamTimeoutSettings,
    enabled: hasAdminConnection,
    staleTime: 60_000,
    retry: false,
  });
  const serverIdentityQuery = useQuery({
    queryKey: ['server-identity'],
    queryFn: getServerIdentity,
    enabled: hasAdminConnection,
    staleTime: 60_000,
    retry: false,
  });
  const modelPlazaSupported = supportsModelPlazaSettings(settingsQuery.data);
  const saveSettingsMutation = useMutation({
    mutationFn: (values: RuntimeSettingsValues) => {
      const settings: Parameters<typeof updateAdminSettings>[0] = {
        registration_enabled: values.registrationEnabled,
        email_verify_enabled: values.emailVerifyEnabled,
        password_reset_enabled: values.passwordResetEnabled,
        channel_monitor_enabled: values.channelMonitorEnabled,
        default_concurrency: values.defaultConcurrency,
      };

      if (modelPlazaSupported) {
        settings.model_plaza_enabled = values.modelPlazaEnabled;
        settings.model_plaza_require_auth = values.modelPlazaRequireAuth;
        settings.model_plaza_description = values.modelPlazaDescription.trim();
      }

      return updateAdminSettings(settings);
    },
  });
  const saveOverloadCooldownMutation = useMutation({
    mutationFn: (values: OverloadCooldownValues) => updateOverloadCooldownSettings({
      enabled: values.enabled,
      cooldown_minutes: values.cooldownMinutes,
    }),
  });
  const saveRateLimit429Mutation = useMutation({
    mutationFn: (values: RateLimit429CooldownValues) => updateRateLimit429CooldownSettings({
      enabled: values.enabled,
      cooldown_seconds: values.cooldownSeconds,
    }),
  });
  const saveStreamTimeoutMutation = useMutation({
    mutationFn: (values: StreamTimeoutValues) => updateStreamTimeoutSettings({
      enabled: values.enabled,
      action: values.action,
      temp_unsched_minutes: values.tempUnschedMinutes,
      threshold_count: values.thresholdCount,
      threshold_window_minutes: values.thresholdWindowMinutes,
    }),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    runtimeForm.reset(toRuntimeSettings(settingsQuery.data));
  }, [runtimeForm.reset, settingsQuery.data]);

  useEffect(() => {
    if (!overloadCooldownQuery.data) return;
    overloadCooldownForm.reset({
      enabled: overloadCooldownQuery.data.enabled,
      cooldownMinutes: overloadCooldownQuery.data.cooldown_minutes,
    });
  }, [overloadCooldownForm.reset, overloadCooldownQuery.data]);

  useEffect(() => {
    if (!rateLimit429Query.data) return;
    rateLimit429Form.reset({
      enabled: rateLimit429Query.data.enabled,
      cooldownSeconds: rateLimit429Query.data.cooldown_seconds,
    });
  }, [rateLimit429Form.reset, rateLimit429Query.data]);

  useEffect(() => {
    if (!streamTimeoutQuery.data) return;
    streamTimeoutForm.reset({
      enabled: streamTimeoutQuery.data.enabled,
      action: streamTimeoutQuery.data.action,
      tempUnschedMinutes: streamTimeoutQuery.data.temp_unsched_minutes,
      thresholdCount: streamTimeoutQuery.data.threshold_count,
      thresholdWindowMinutes: streamTimeoutQuery.data.threshold_window_minutes,
    });
  }, [streamTimeoutForm.reset, streamTimeoutQuery.data]);

  async function verifyAndEnter(successMessage: string) {
    setConnectionState('checking');
    setConnectionMessage('正在检测当前服务...');

    try {
      queryClient.clear();
      await queryClient.fetchQuery({ queryKey: ['admin-settings'], queryFn: getAdminSettings });
      await Promise.allSettled([
        queryClient.prefetchQuery({ queryKey: ['monitor-stats'], queryFn: getDashboardStats }),
        queryClient.prefetchQuery({ queryKey: ['server-identity'], queryFn: getServerIdentity }),
      ]);
      setConnectionState('success');
      setConnectionMessage(successMessage);
      router.replace('/monitor');
    } catch (error) {
      setConnectionState('error');
      setConnectionMessage(getConnectionErrorMessage(error));
    }
  }

  async function handleAdd(values: ConnectionFormValues) {
    await saveAdminConfig(values);
    connectionForm.reset({ baseUrl: '', adminApiKey: '' });
    setShowForm(false);
    await verifyAndEnter('服务器已添加并切换成功。');
  }

  async function handleSelect(account: AdminAccountProfile) {
    await switchAdminAccount(account.id);
    await verifyAndEnter(`已切换到 ${account.label}。`);
  }

  function handleDelete(account: AdminAccountProfile) {
    Alert.alert(
      '删除服务器',
      `将从本机移除 ${account.label} 的连接信息。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void removeAdminAccount(account.id).then(() => {
              queryClient.clear();
              setConnectionState('idle');
              setConnectionMessage('');
            });
          },
        },
      ]
    );
  }

  async function handleRefresh() {
    if (!config.baseUrl.trim()) return;
    setIsRefreshing(true);
    setSaveNotice(null);
    setProtectionNotice(null);

    try {
      await Promise.all([
        settingsQuery.refetch({ throwOnError: true }),
        queryClient.prefetchQuery({ queryKey: ['monitor-stats'], queryFn: getDashboardStats, staleTime: 0 }),
        serverIdentityQuery.refetch(),
        overloadCooldownQuery.refetch(),
        rateLimit429Query.refetch(),
        streamTimeoutQuery.refetch(),
      ]);
    } catch (error) {
      setSaveNotice({ message: getConnectionErrorMessage(error), tone: 'danger' });
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleSaveRuntimeSettings(values: RuntimeSettingsValues) {
    setSaveNotice(null);
    saveSettingsMutation.mutate(values, {
      onSuccess: async (updatedSettings) => {
        queryClient.setQueryData(['admin-settings'], updatedSettings);
        runtimeForm.reset(toRuntimeSettings(updatedSettings));
        setSaveNotice({ message: '服务器设置已保存并回读确认。', tone: 'success' });
        await queryClient.invalidateQueries({ queryKey: ['monitor-stats'] });
        await queryClient.invalidateQueries({ queryKey: ['model-plaza'] });
      },
      onError: (error) => setSaveNotice({ message: getConnectionErrorMessage(error), tone: 'danger' }),
    });
  }

  function handleSaveOverloadCooldown(values: OverloadCooldownValues) {
    setProtectionNotice(null);
    saveOverloadCooldownMutation.mutate(values, {
      onSuccess: (updated) => {
        queryClient.setQueryData(runtimeProtectionKeys.overload, updated);
        overloadCooldownForm.reset({ enabled: updated.enabled, cooldownMinutes: updated.cooldown_minutes });
        setProtectionNotice({ scope: 'overload', message: '529 过载冷却已保存并回读确认。', tone: 'success' });
      },
      onError: (error) => setProtectionNotice({
        scope: 'overload',
        message: getRuntimeProtectionErrorMessage(error),
        tone: 'danger',
      }),
    });
  }

  function handleSaveRateLimit429(values: RateLimit429CooldownValues) {
    setProtectionNotice(null);
    saveRateLimit429Mutation.mutate(values, {
      onSuccess: (updated) => {
        queryClient.setQueryData(runtimeProtectionKeys.rateLimit429, updated);
        rateLimit429Form.reset({ enabled: updated.enabled, cooldownSeconds: updated.cooldown_seconds });
        setProtectionNotice({ scope: 'rate-limit-429', message: '429 默认回避已保存并回读确认。', tone: 'success' });
      },
      onError: (error) => setProtectionNotice({
        scope: 'rate-limit-429',
        message: getRuntimeProtectionErrorMessage(error),
        tone: 'danger',
      }),
    });
  }

  function handleSaveStreamTimeout(values: StreamTimeoutValues) {
    setProtectionNotice(null);
    saveStreamTimeoutMutation.mutate(values, {
      onSuccess: (updated) => {
        queryClient.setQueryData(runtimeProtectionKeys.streamTimeout, updated);
        streamTimeoutForm.reset({
          enabled: updated.enabled,
          action: updated.action,
          tempUnschedMinutes: updated.temp_unsched_minutes,
          thresholdCount: updated.threshold_count,
          thresholdWindowMinutes: updated.threshold_window_minutes,
        });
        setProtectionNotice({ scope: 'stream-timeout', message: '流式超时保护已保存并回读确认。', tone: 'success' });
      },
      onError: (error) => setProtectionNotice({
        scope: 'stream-timeout',
        message: getRuntimeProtectionErrorMessage(error),
        tone: 'danger',
      }),
    });
  }

  const overloadEnabled = overloadCooldownForm.watch('enabled');
  const rateLimit429Enabled = rateLimit429Form.watch('enabled');
  const streamTimeoutEnabled = streamTimeoutForm.watch('enabled');
  const streamTimeoutAction = streamTimeoutForm.watch('action');
  const modelPlazaEnabled = runtimeForm.watch('modelPlazaEnabled');

  const settingsState = settingsQuery.isLoading
    ? '正在读取'
    : settingsQuery.isError
      ? '连接异常'
      : '连接正常';
  const currentAccount = config.accounts.find((account: AdminAccountProfile) => account.id === config.activeAccountId);
  const serverVersion = serverIdentityQuery.data?.version
    ? `v${serverIdentityQuery.data.version.replace(/^v/i, '')}`
    : '--';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 26, fontWeight: '700', color: colors.text }}>设置</Text>
            <Text style={{ marginTop: 5, fontSize: 13, color: colors.subtext }}>服务器连接与常用运行设置</Text>
          </View>
          <Pressable
            accessibilityLabel={showForm ? '关闭添加服务器表单' : '添加服务器'}
            accessibilityRole="button"
            onPress={() => {
              setShowForm((value) => !value);
              setConnectionState('idle');
              setConnectionMessage('');
            }}
            style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 8, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.78 : 1 })}
          >
            <Plus color="#ffffff" size={20} />
          </Pressable>
        </View>

        <ServiceModeControl />

        <SettingsSection title="当前服务器" subtitle={settingsQuery.data?.site_name || currentAccount?.label || 'Sub2API'}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: settingsQuery.isError ? colors.dangerBg : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Server color={settingsQuery.isError ? colors.danger : colors.primary} size={19} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.text }}>{config.baseUrl}</Text>
              <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: settingsQuery.isError ? colors.danger : colors.primary }} />
                <Text style={{ fontSize: 11, color: settingsQuery.isError ? colors.danger : colors.primary }}>{settingsState}</Text>
              </View>
            </View>
          </View>

          <View style={{ marginTop: 14, flexDirection: 'row', borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Gauge color={colors.subtext} size={13} />
                <Text style={{ fontSize: 10, color: colors.subtext }}>服务端版本</Text>
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ marginTop: 5, fontSize: 13, fontWeight: '700', color: colors.text }}>{serverVersion}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, borderLeftColor: colors.border, borderLeftWidth: 1, paddingLeft: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Wifi color={colors.subtext} size={13} />
                <Text style={{ fontSize: 10, color: colors.subtext }}>连接耗时</Text>
              </View>
              <Text style={{ marginTop: 5, fontSize: 13, fontWeight: '700', color: colors.text }}>{formatLatency(serverIdentityQuery.data?.latency_ms)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, borderLeftColor: colors.border, borderLeftWidth: 1, paddingLeft: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Clock3 color={colors.subtext} size={13} />
                <Text style={{ fontSize: 10, color: colors.subtext }}>检测时间</Text>
              </View>
              <Text style={{ marginTop: 5, fontSize: 13, fontWeight: '700', color: colors.text }}>{formatCheckedAt(serverIdentityQuery.data?.checked_at)}</Text>
            </View>
          </View>
          {serverIdentityQuery.isError && !settingsQuery.isError ? (
            <Text style={{ marginTop: 10, fontSize: 11, lineHeight: 17, color: colors.subtext }}>服务器连接正常，但当前版本未提供版本检测信息。</Text>
          ) : null}
        </SettingsSection>

        {showForm ? (
          <SettingsSection title="添加服务器">
            <View style={{ gap: 13 }}>
              <View>
                <Text style={{ marginBottom: 7, fontSize: 12, fontWeight: '600', color: colors.subtext }}>服务器地址</Text>
                <Controller
                  control={connectionForm.control}
                  name="baseUrl"
                  render={({ field: { onChange, value } }) => (
                    <TextInput
                      value={value}
                      onChangeText={onChange}
                      placeholder="https://api.example.com"
                      placeholderTextColor="#8b9094"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ minHeight: 48, backgroundColor: colors.mutedCard, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
                    />
                  )}
                />
              </View>

              <View>
                <Text style={{ marginBottom: 7, fontSize: 12, fontWeight: '600', color: colors.subtext }}>Admin Key</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Controller
                    control={connectionForm.control}
                    name="adminApiKey"
                    render={({ field: { onChange, value } }) => (
                      <TextInput
                        value={value}
                        onChangeText={onChange}
                        placeholder="admin-xxxxxxxx"
                        placeholderTextColor="#8b9094"
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry={!showAdminKey}
                        style={{ flex: 1, minHeight: 48, backgroundColor: colors.mutedCard, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
                      />
                    )}
                  />
                  <Pressable
                    accessibilityLabel={showAdminKey ? '隐藏 Admin Key' : '显示 Admin Key'}
                    accessibilityRole="button"
                    onPress={() => setShowAdminKey((value) => !value)}
                    style={({ pressed }) => ({ width: 46, height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mutedCard, borderRadius: 8, opacity: pressed ? 0.7 : 1 })}
                  >
                    {showAdminKey ? <EyeOff color={colors.subtext} size={18} /> : <Eye color={colors.subtext} size={18} />}
                  </Pressable>
                </View>
              </View>

              {connectionForm.formState.errors.baseUrl || connectionForm.formState.errors.adminApiKey ? (
                <View style={{ backgroundColor: colors.dangerBg, paddingHorizontal: 13, paddingVertical: 11 }}>
                  <Text style={{ color: colors.danger, fontSize: 13 }}>{connectionForm.formState.errors.baseUrl?.message || connectionForm.formState.errors.adminApiKey?.message}</Text>
                </View>
              ) : null}
              {connectionMessage ? (
                <View style={{ backgroundColor: connectionState === 'success' ? colors.successBg : colors.dangerBg, paddingHorizontal: 13, paddingVertical: 11 }}>
                  <Text style={{ color: connectionState === 'success' ? colors.success : colors.danger, fontSize: 13 }}>{connectionMessage}</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={connectionForm.handleSubmit(handleAdd)}
                  disabled={connectionState === 'checking'}
                  style={({ pressed }) => ({ flex: 1, minHeight: 44, backgroundColor: colors.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center', opacity: connectionState === 'checking' ? 0.55 : pressed ? 0.78 : 1 })}
                >
                  <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>{connectionState === 'checking' ? '正在检测' : '保存并使用'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setShowForm(false);
                    connectionForm.reset({ baseUrl: '', adminApiKey: '' });
                  }}
                  style={({ pressed }) => ({ minWidth: 86, minHeight: 44, backgroundColor: colors.mutedCard, borderRadius: 8, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.72 : 1 })}
                >
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>取消</Text>
                </Pressable>
              </View>
            </View>
          </SettingsSection>
        ) : null}

        {settingsQuery.isLoading ? (
          <SettingsSection title="服务器运行设置">
            <View style={{ alignItems: 'center', paddingVertical: 16 }}><ActivityIndicator color={colors.primary} /></View>
          </SettingsSection>
        ) : settingsQuery.isError ? (
          <SettingsSection title="服务器运行设置" subtitle="读取失败">
            <Text style={{ fontSize: 13, lineHeight: 20, color: colors.danger }}>{getConnectionErrorMessage(settingsQuery.error)}</Text>
            <Pressable onPress={() => void settingsQuery.refetch()} style={({ pressed }) => ({ marginTop: 12, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 })}>
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>重新读取</Text>
            </Pressable>
          </SettingsSection>
        ) : (
          <>
            <SettingsSection title="服务器运行设置" subtitle="注册与用户侧功能">
              <Controller
                control={runtimeForm.control}
                name="registrationEnabled"
                render={({ field: { onChange, value } }) => <SettingToggleRow title="开放注册" subtitle="允许新用户自行创建账号" value={value} onValueChange={onChange} />}
              />
              <Controller
                control={runtimeForm.control}
                name="emailVerifyEnabled"
                render={({ field: { onChange, value } }) => <SettingToggleRow title="邮箱验证" subtitle="注册与敏感操作使用邮箱验证码" value={value} onValueChange={onChange} />}
              />
              <Controller
                control={runtimeForm.control}
                name="passwordResetEnabled"
                render={({ field: { onChange, value } }) => <SettingToggleRow title="密码找回" subtitle="需要邮件服务可用" value={value} onValueChange={onChange} />}
              />
              <Controller
                control={runtimeForm.control}
                name="channelMonitorEnabled"
                render={({ field: { onChange, value } }) => <SettingToggleRow title="渠道监控" subtitle="向用户展示可用渠道状态" value={value} onValueChange={onChange} showDivider={false} />}
              />
            </SettingsSection>

            {modelPlazaSupported ? (
              <SettingsSection title="模型广场" subtitle="按分组向访客展示可用模型与价格">
                <Controller
                  control={runtimeForm.control}
                  name="modelPlazaEnabled"
                  render={({ field: { onChange, value } }) => (
                    <SettingToggleRow
                      title="启用模型广场"
                      subtitle="开启后可通过 /model-plaza 查看分组、模型和价格"
                      value={value}
                      onValueChange={onChange}
                    />
                  )}
                />
                {modelPlazaEnabled ? (
                  <Controller
                    control={runtimeForm.control}
                    name="modelPlazaRequireAuth"
                    render={({ field: { onChange, value } }) => (
                      <SettingToggleRow
                        title="要求登录"
                        subtitle="开启后需要已登录账号会话；管理员账号登录网页后同样可以查看"
                        value={value}
                        onValueChange={onChange}
                      />
                    )}
                  />
                ) : null}
                <View style={{ paddingTop: 11 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>广场说明</Text>
                  <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 17, color: colors.subtext }}>会显示在模型广场顶部；服务端网页支持 Markdown。</Text>
                  <Controller
                    control={runtimeForm.control}
                    name="modelPlazaDescription"
                    render={({ field: { onChange, value } }) => (
                      <TextInput
                        accessibilityLabel="模型广场说明"
                        multiline
                        value={value}
                        onChangeText={onChange}
                        placeholder="例如：价格按实际调用规则结算。"
                        placeholderTextColor="#8b9094"
                        textAlignVertical="top"
                        style={{ minHeight: 92, marginTop: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.mutedCard, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 13, lineHeight: 19 }}
                      />
                    )}
                  />
                </View>
              </SettingsSection>
            ) : null}

            <SettingsSection title="新用户默认值" subtitle="仅影响保存后创建的新用户">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>默认并发数</Text>
                  <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 17, color: colors.subtext }}>新用户可同时占用的请求数</Text>
                </View>
                <Controller
                  control={runtimeForm.control}
                  name="defaultConcurrency"
                  render={({ field: { onChange, value } }) => (
                    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' }}>
                      <Pressable
                        accessibilityLabel="减少默认并发数"
                        accessibilityRole="button"
                        disabled={value <= 1}
                        onPress={() => onChange(Math.max(1, value - 1))}
                        style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mutedCard, opacity: value <= 1 ? 0.45 : pressed ? 0.7 : 1 })}
                      >
                        <Minus color={colors.text} size={16} />
                      </Pressable>
                      <View style={{ width: 54, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card }}>
                        <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{value}</Text>
                      </View>
                      <Pressable
                        accessibilityLabel="增加默认并发数"
                        accessibilityRole="button"
                        disabled={value >= Number.MAX_SAFE_INTEGER}
                        onPress={() => onChange(Math.min(Number.MAX_SAFE_INTEGER, value + 1))}
                        style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mutedCard, opacity: value >= Number.MAX_SAFE_INTEGER ? 0.45 : pressed ? 0.7 : 1 })}
                      >
                        <Plus color={colors.text} size={16} />
                      </Pressable>
                    </View>
                  )}
                />
              </View>
            </SettingsSection>

            {saveNotice ? (
              <View style={{ backgroundColor: saveNotice.tone === 'success' ? colors.successBg : colors.dangerBg, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Text style={{ color: saveNotice.tone === 'success' ? colors.success : colors.danger, fontSize: 13, lineHeight: 19 }}>{saveNotice.message}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityLabel="保存服务器运行设置"
              accessibilityRole="button"
              disabled={!runtimeForm.formState.isDirty || saveSettingsMutation.isPending}
              onPress={runtimeForm.handleSubmit(handleSaveRuntimeSettings)}
              style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, backgroundColor: colors.primary, opacity: !runtimeForm.formState.isDirty || saveSettingsMutation.isPending ? 0.48 : pressed ? 0.78 : 1 })}
            >
              {saveSettingsMutation.isPending ? <ActivityIndicator color="#ffffff" size="small" /> : <Save color="#ffffff" size={17} />}
              <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>{saveSettingsMutation.isPending ? '正在保存' : '保存运行设置'}</Text>
            </Pressable>
          </>
        )}

        <SettingsSection title="上游调度保护" subtitle="异常响应后的自动回避与状态处理">
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 6 }}>
            <View style={{ width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6f7f7' }}>
              <ShieldAlert color="#5f6468" size={17} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>529 过载冷却</Text>
              <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 17, color: colors.subtext }}>上游返回过载时，临时避开对应账号。</Text>
            </View>
          </View>
          {overloadCooldownQuery.isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 14 }}><ActivityIndicator color={colors.primary} /></View>
          ) : overloadCooldownQuery.isError ? (
            <ProtectionLoadError error={overloadCooldownQuery.error} onRetry={() => void overloadCooldownQuery.refetch()} />
          ) : (
            <>
              <Controller
                control={overloadCooldownForm.control}
                name="enabled"
                render={({ field: { onChange, value } }) => (
                  <SettingToggleRow title="启用 529 冷却" subtitle="避免持续请求正在过载的上游" value={value} onValueChange={onChange} showDivider={false} />
                )}
              />
              {overloadEnabled ? (
                <Controller
                  control={overloadCooldownForm.control}
                  name="cooldownMinutes"
                  render={({ field: { onChange, value } }) => (
                    <NumberSettingRow title="冷却时长" subtitle="超过时长后重新参与调度" value={value} min={1} max={120} unit="分钟" onValueChange={onChange} />
                  )}
                />
              ) : null}
              <InlineNotice notice={protectionNotice?.scope === 'overload' ? protectionNotice : undefined} />
              <SettingSaveButton
                label="保存 529 冷却"
                pending={saveOverloadCooldownMutation.isPending}
                disabled={!overloadCooldownForm.formState.isDirty}
                onPress={overloadCooldownForm.handleSubmit(handleSaveOverloadCooldown)}
              />
            </>
          )}

          <View style={{ marginTop: 18, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 16 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>429 默认回避</Text>
            <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 17, color: colors.subtext }}>上游未返回明确重置时间时使用的兜底冷却。</Text>
            {rateLimit429Query.isLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 14 }}><ActivityIndicator color={colors.primary} /></View>
            ) : rateLimit429Query.isError ? (
              <ProtectionLoadError error={rateLimit429Query.error} onRetry={() => void rateLimit429Query.refetch()} />
            ) : (
              <>
                <Controller
                  control={rateLimit429Form.control}
                  name="enabled"
                  render={({ field: { onChange, value } }) => (
                    <SettingToggleRow title="启用 429 回避" subtitle="降低重复命中限流账号的概率" value={value} onValueChange={onChange} showDivider={false} />
                  )}
                />
                {rateLimit429Enabled ? (
                  <Controller
                    control={rateLimit429Form.control}
                    name="cooldownSeconds"
                    render={({ field: { onChange, value } }) => (
                      <NumberSettingRow title="回避时长" subtitle="仅在无法解析上游重置时间时生效" value={value} min={1} max={7_200} unit="秒" onValueChange={onChange} />
                    )}
                  />
                ) : null}
                <InlineNotice notice={protectionNotice?.scope === 'rate-limit-429' ? protectionNotice : undefined} />
                <SettingSaveButton
                  label="保存 429 回避"
                  pending={saveRateLimit429Mutation.isPending}
                  disabled={!rateLimit429Form.formState.isDirty}
                  onPress={rateLimit429Form.handleSubmit(handleSaveRateLimit429)}
                />
              </>
            )}
          </View>

          <View style={{ marginTop: 18, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 16 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>流式超时保护</Text>
            <Text style={{ marginTop: 3, fontSize: 11, lineHeight: 17, color: colors.subtext }}>在统计窗口内达到超时次数后执行指定动作。</Text>
            {streamTimeoutQuery.isLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 14 }}><ActivityIndicator color={colors.primary} /></View>
            ) : streamTimeoutQuery.isError ? (
              <ProtectionLoadError error={streamTimeoutQuery.error} onRetry={() => void streamTimeoutQuery.refetch()} />
            ) : (
              <>
                <Controller
                  control={streamTimeoutForm.control}
                  name="enabled"
                  render={({ field: { onChange, value } }) => (
                    <SettingToggleRow title="启用超时保护" subtitle="按下方阈值处理持续超时的账号" value={value} onValueChange={onChange} showDivider={false} />
                  )}
                />
                {streamTimeoutEnabled ? (
                  <>
                    <Controller
                      control={streamTimeoutForm.control}
                      name="action"
                      render={({ field: { onChange, value } }) => <StreamTimeoutActionControl value={value} onValueChange={onChange} />}
                    />
                    <Controller
                      control={streamTimeoutForm.control}
                      name="thresholdCount"
                      render={({ field: { onChange, value } }) => (
                        <NumberSettingRow title="触发次数" subtitle="窗口内累计多少次超时后处理" value={value} min={1} max={10} unit="次" onValueChange={onChange} />
                      )}
                    />
                    <Controller
                      control={streamTimeoutForm.control}
                      name="thresholdWindowMinutes"
                      render={({ field: { onChange, value } }) => (
                        <NumberSettingRow title="统计窗口" subtitle="累计超时次数的时间范围" value={value} min={1} max={60} unit="分钟" onValueChange={onChange} />
                      )}
                    />
                    {streamTimeoutAction === 'temp_unsched' ? (
                      <Controller
                        control={streamTimeoutForm.control}
                        name="tempUnschedMinutes"
                        render={({ field: { onChange, value } }) => (
                          <NumberSettingRow title="临时停用" subtitle="触发后暂停账号参与调度的时长" value={value} min={1} max={60} unit="分钟" onValueChange={onChange} />
                        )}
                      />
                    ) : null}
                  </>
                ) : null}
                <InlineNotice notice={protectionNotice?.scope === 'stream-timeout' ? protectionNotice : undefined} />
                <SettingSaveButton
                  label="保存超时保护"
                  pending={saveStreamTimeoutMutation.isPending}
                  disabled={!streamTimeoutForm.formState.isDirty}
                  onPress={streamTimeoutForm.handleSubmit(handleSaveStreamTimeout)}
                />
              </>
            )}
          </View>
        </SettingsSection>

        <View style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>服务器列表</Text>
          <Text style={{ marginTop: 4, marginBottom: 12, fontSize: 12, color: colors.subtext }}>本机保存的管理连接</Text>
          <View style={{ gap: 10 }}>
            {config.accounts.map((account: AdminAccountProfile) => (
              <ServerCard
                key={account.id}
                account={account}
                active={account.id === config.activeAccountId}
                onSelect={() => handleSelect(account)}
                onDelete={() => handleDelete(account)}
              />
            ))}
            {config.accounts.length === 0 ? (
              <View style={{ backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: radius.md, borderColor: 'rgba(255,255,255,0.6)', borderWidth: 1, padding: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>还没有服务器</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function SettingsScreen() {
  const serviceMode = useSnapshot(serviceModeState);
  return serviceMode.mode === 'cch' ? <CchSettingsScreen /> : <Sub2ApiSettingsScreen />;
}
