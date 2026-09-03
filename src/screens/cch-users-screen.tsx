import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { getCchErrorMessage } from '@/src/lib/cch-fetch';
import { getCchProxyStatus, getCchUsers } from '@/src/services/cch';
import { cchConfigState, hasCchAdminSession } from '@/src/store/cch-config';

const { useSnapshot } = require('valtio/react');

export function CchUsersScreen() {
  const config = useSnapshot(cchConfigState);
  const hasSession = hasCchAdminSession(config);
  const [search, setSearch] = useState('');
  const scope = config.baseUrl;
  const usersQuery = useQuery({
    queryKey: ['cch', 'users', scope, search],
    queryFn: () => getCchUsers(search),
    enabled: hasSession,
    staleTime: 60_000,
    retry: false,
  });
  const proxyStatusQuery = useQuery({
    queryKey: ['cch', 'proxy-status', scope],
    queryFn: getCchProxyStatus,
    enabled: hasSession,
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: false,
  });
  const activeRequestsByUserId = useMemo(
    () => new Map((proxyStatusQuery.data?.users ?? []).map((user) => [user.userId, user.activeCount])),
    [proxyStatusQuery.data?.users]
  );
  const users = usersQuery.data?.items ?? [];

  return (
    <ScreenShell
      title="用户"
      subtitle="CCH 用户、API Key 与当前代理活动"
      variant="minimal"
      refreshing={usersQuery.isRefetching || proxyStatusQuery.isRefetching}
      onRefresh={async () => { await Promise.allSettled([usersQuery.refetch(), proxyStatusQuery.refetch()]); }}
      right={(
        <Pressable accessibilityLabel="刷新 CCH 用户" accessibilityRole="button" onPress={() => void Promise.allSettled([usersQuery.refetch(), proxyStatusQuery.refetch()])} style={({ pressed }) => ({ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dfe5e1', opacity: pressed ? 0.72 : 1 })}>
          <RefreshCw color="#1f6759" size={17} />
        </Pressable>
      )}
    >
      {!hasSession ? (
        <ListCard title="尚未连接 CCH" meta="请在设置页选择 CCH 并填写 CCH Admin Key。" icon={Users} />
      ) : (
        <>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="搜索用户"
            placeholderTextColor="#8a948f"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#dfe5e1', backgroundColor: '#ffffff', paddingHorizontal: 13, color: '#17201d', fontSize: 14 }}
          />
          {usersQuery.isLoading ? <Text style={{ color: '#65706c', fontSize: 13 }}>正在读取用户...</Text> : null}
          {usersQuery.error ? <ListCard title="用户读取失败" meta={getCchErrorMessage(usersQuery.error)} icon={Users} badge="异常" badgeTone="danger" /> : null}
          {!usersQuery.isLoading && !usersQuery.error && users.length === 0 ? <ListCard title="没有匹配的用户" meta="CCH 当前用户列表为空，或没有匹配搜索条件。" icon={Users} /> : null}
          {users.map((user) => {
            const keys = user.keys ?? [];
            const enabledKeys = keys.filter((key) => key.isEnabled !== false).length;
            const activeRequests = activeRequestsByUserId.get(user.id) ?? 0;

            return (
              <ListCard key={user.id} title={user.name || `用户 #${user.id}`} meta={`ID ${user.id}`} icon={Users} badge={user.isEnabled === false ? '已停用' : '已启用'} badgeTone={user.isEnabled === false ? 'muted' : 'success'}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  <Text style={{ color: '#65706c', fontSize: 11 }}>Key {enabledKeys} / {keys.length}</Text>
                  <Text style={{ color: activeRequests > 0 ? '#1f6759' : '#65706c', fontSize: 11 }}>当前请求 {activeRequests}</Text>
                </View>
              </ListCard>
            );
          })}
          {usersQuery.data?.pageInfo.hasMore ? <Text style={{ color: '#65706c', fontSize: 11 }}>当前显示首批 100 位匹配用户，CCH 仍有更多结果。</Text> : null}
        </>
      )}
    </ScreenShell>
  );
}
