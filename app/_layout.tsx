import '@/src/global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { queryClient } from '@/src/lib/query-client';
import { markPerformance } from '@/src/lib/performance';
import { adminConfigState, hydrateAdminConfig } from '@/src/store/admin-config';
import { cchConfigState, hydrateCchConfig } from '@/src/store/cch-config';
import { hydrateServiceMode, serviceModeState } from '@/src/store/service-mode';

const { useSnapshot } = require('valtio/react');

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const config = useSnapshot(adminConfigState);
  const cchConfig = useSnapshot(cchConfigState);
  const serviceMode = useSnapshot(serviceModeState);

  useEffect(() => {
    Promise.all([hydrateAdminConfig(), hydrateCchConfig(), hydrateServiceMode()])
      .then(() => markPerformance('config_hydrated'))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if ((previousState === 'inactive' || previousState === 'background') && nextState === 'active') {
        void queryClient.refetchQueries({ queryKey: ['cch'], type: 'active' });
      }
      previousState = nextState;
    });
    return () => subscription.remove();
  }, []);

  const isReady = config.hydrated && cchConfig.hydrated && serviceMode.hydrated;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        {!isReady ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}>
            <ActivityIndicator color="#111315" />
          </View>
        ) : (
          <Stack initialRouteName="(tabs)" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="login" />
            <Stack.Screen
              name="users/[id]"
              options={{
                animation: 'slide_from_right',
                presentation: 'card',
                headerShown: true,
                title: '用户详情',
                headerBackTitle: '返回',
                headerTintColor: '#111315',
                headerStyle: { backgroundColor: '#ffffff' },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="users/create-account"
              options={{
                animation: 'slide_from_right',
                presentation: 'card',
                headerShown: true,
                title: '添加账号',
                headerBackTitle: '返回',
                headerTintColor: '#111315',
                headerStyle: { backgroundColor: '#ffffff' },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="users/create-user"
              options={{
                animation: 'slide_from_right',
                presentation: 'card',
                headerShown: true,
                title: '添加用户',
                headerBackTitle: '返回',
                headerTintColor: '#111315',
                headerStyle: { backgroundColor: '#ffffff' },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="accounts/create"
              options={{
                animation: 'slide_from_right',
                presentation: 'card',
                headerShown: true,
                title: '添加账号',
                headerBackTitle: '返回',
                headerTintColor: '#111315',
                headerStyle: { backgroundColor: '#ffffff' },
                headerShadowVisible: false,
              }}
            />
            <Stack.Screen
              name="accounts/overview"
              options={{
                animation: 'slide_from_right',
                presentation: 'card',
                headerShown: true,
                title: '账号清单',
                headerBackTitle: '返回',
                headerTintColor: '#111315',
                headerStyle: { backgroundColor: '#ffffff' },
                headerShadowVisible: false,
              }}
            />
          </Stack>
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
