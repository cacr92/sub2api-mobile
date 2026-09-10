import { Redirect, Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { ChartNoAxesCombined, KeyRound, Server, Settings2, Store, Users } from 'lucide-react-native';
import { Platform, StyleSheet, View } from 'react-native';

import { adminConfigState, hasAuthenticatedAdminSession } from '@/src/store/admin-config';
import { serviceModeState } from '@/src/store/service-mode';
import { glass } from '@/src/theme';

const { useSnapshot } = require('valtio/react');

export default function TabsLayout() {
  const serviceMode = useSnapshot(serviceModeState);
  const config = useSnapshot(adminConfigState);
  const isCch = serviceMode.mode === 'cch';

  if (!isCch && !hasAuthenticatedAdminSession(config)) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      initialRouteName="monitor"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#111315',
        tabBarInactiveTintColor: '#8b9094',
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopColor: glass.borderSoft,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 84,
          paddingTop: 10,
          paddingBottom: 18,
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView
            intensity={glass.blur.chrome}
            tint="light"
            {...(Platform.OS === 'android' ? { experimentalBlurMethod: 'dimezisBlurView' as const } : {})}
            style={StyleSheet.absoluteFill}
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.fill.chrome }]} />
          </BlurView>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="monitor"
        options={{
          title: '概览',
          tabBarIcon: ({ color, size }) => <ChartNoAxesCombined color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          title: isCch ? '供应商' : '账号详情',
          tabBarIcon: ({ color, size }) => isCch ? <Server color={color} size={size} /> : <KeyRound color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: '用户',
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="model-plaza"
        options={{
          title: isCch ? '模型定价' : '模型广场',
          tabBarIcon: ({ color, size }) => <Store color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color, size }) => <Settings2 color={color} size={size} />,
        }}
      />
      <Tabs.Screen name="groups" options={{ href: null }} />
    </Tabs>
  );
}
