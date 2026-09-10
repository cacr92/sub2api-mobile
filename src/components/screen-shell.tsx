import type { PropsWithChildren, ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { AppBackground } from '@/src/components/app-background';
import { GlassSurface } from '@/src/components/glass-surface';
import { colors as themeColors } from '@/src/theme';

type ScreenShellProps = PropsWithChildren<{
  title: string;
  subtitle: string;
  titleAside?: ReactNode;
  right?: ReactNode;
  variant?: 'card' | 'minimal';
  scroll?: boolean;
  bottomInsetClassName?: string;
  horizontalInsetClassName?: string;
  contentGapClassName?: string;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  safeAreaEdges?: Edge[];
  showHeader?: boolean;
}>;

function ScreenHeader({
  title,
  subtitle,
  titleAside,
  right,
  variant,
}: Pick<ScreenShellProps, 'title' | 'subtitle' | 'titleAside' | 'right' | 'variant'>) {
  if (variant === 'minimal') {
    return (
      <View className="mt-4 flex-row items-start justify-between gap-4 px-1 py-1">
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-[22px] font-bold text-[#111315]">{title}</Text>
            {titleAside}
          </View>
          {subtitle ? (
            <Text numberOfLines={1} className="mt-1.5 text-[12px] leading-4 text-[#5f6468]">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View className="items-end justify-start">{right}</View> : null}
      </View>
    );
  }

  return (
    <GlassSurface tier="chrome" elevated style={{ marginTop: 16 }} contentStyle={{ paddingHorizontal: 18, paddingVertical: 18 }}>
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1">
          <Text className="text-[24px] font-bold text-[#111315]">{title}</Text>
          <Text numberOfLines={1} className="mt-1 text-xs leading-4 text-[#5f6468]">
            {subtitle}
          </Text>
        </View>
        {right}
      </View>
    </GlassSurface>
  );
}

export function ScreenShell({
  title,
  subtitle,
  titleAside,
  right,
  children,
  variant = 'card',
  scroll = true,
  bottomInsetClassName = 'pb-24',
  horizontalInsetClassName = 'px-5',
  contentGapClassName = 'mt-4 gap-4',
  refreshing = false,
  onRefresh,
  safeAreaEdges = ['top', 'bottom'],
  showHeader = true,
}: ScreenShellProps) {
  if (!scroll) {
    return (
      <SafeAreaView edges={safeAreaEdges} style={{ flex: 1, backgroundColor: themeColors.page }}>
        <AppBackground />
        <View className={`flex-1 ${horizontalInsetClassName} ${bottomInsetClassName}`}>
          {showHeader ? <ScreenHeader title={title} subtitle={subtitle} titleAside={titleAside} right={right} variant={variant} /> : null}
          <View className={`flex-1 ${contentGapClassName}`}>{children}</View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={safeAreaEdges} style={{ flex: 1, backgroundColor: themeColors.page }}>
      <AppBackground />
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColors.primary} /> : undefined}
      >
        <View className={`${horizontalInsetClassName} ${bottomInsetClassName}`}>
          {showHeader ? <ScreenHeader title={title} subtitle={subtitle} titleAside={titleAside} right={right} variant={variant} /> : null}
          <View className={contentGapClassName}>{children}</View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
