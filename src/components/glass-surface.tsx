import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, StyleSheet, View } from 'react-native';

import { glass, radius, shadow, type GlassTier } from '@/src/theme';

type GlassSurfaceProps = {
  children: ReactNode;
  tier?: GlassTier;
  /** 圆角，默认大圆角卡片 */
  cornerRadius?: number;
  /** 是否使用更强的悬浮阴影（浮层、头部壳体） */
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * 毛玻璃表面。
 *
 * 结构：外层负责圆角与阴影，内层负责裁剪，这样阴影不会被 overflow 吃掉。
 * Android 端使用 expo-blur 的 dimezis 实现；不支持时退化为半透明填充，
 * 视觉上仍是同一套材质层级（不会因为平台差异变成纯白卡片）。
 */
export function GlassSurface({
  children,
  tier = 'card',
  cornerRadius = radius.lg,
  elevated = false,
  style,
  contentStyle,
}: GlassSurfaceProps) {
  return (
    <View style={[{ borderRadius: cornerRadius }, elevated ? shadow.card : shadow.soft, style]}>
      <View style={{ borderRadius: cornerRadius, overflow: 'hidden' }}>
        <BlurView
          intensity={glass.blur[tier]}
          tint="light"
          {...(Platform.OS === 'android' ? { experimentalBlurMethod: 'dimezisBlurView' as const } : {})}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.fill[tier] }]} />
        {/* 顶部高光与描边：玻璃没有边缘会显得像一张发灰的卡片 */}
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: cornerRadius, borderWidth: 1, borderColor: glass.border },
          ]}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: glass.highlight,
          }}
        />
        <View style={contentStyle}>{children}</View>
      </View>
    </View>
  );
}
