/**
 * 全局视觉主题
 *
 * 目标：克制、信息密度高的运维界面。层级用「表面 + 间距」表达，
 * 不用 1px 分隔线把卡片切成方方正正的格子。
 */
import type { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  /** 页面底色：纯白 */
  page: '#ffffff',
  /** 卡片表面：纯白 */
  card: '#ffffff',
  /** 卡片内的次级块（替代分隔线） */
  surface: '#f6f7f7',
  /** 更重的填充面（输入框、图标底） */
  mutedCard: '#f2f3f3',
  mutedSurface: '#f2f3f3',
  /** 极浅描边，仅用于区分同色相邻表面 */
  border: '#e8e9e9',
  borderStrong: '#d9dbdb',

  text: '#111315',
  subtext: '#5f6468',
  faint: '#8b9094',
  muted: '#8b9094',

  /** 强调色也是黑色：整体保持黑白，只有危险态用红 */
  primary: '#111315',
  primaryInk: '#000000',
  primarySoft: '#f2f3f3',

  warning: '#5f6468',
  warningSoft: '#f2f3f3',

  danger: '#d92d20',
  dangerSoft: '#fdecea',
  dangerBg: '#fdecea',

  success: '#111315',
  successSoft: '#f2f3f3',
  successBg: '#f2f3f3',
} as const;

export const radius = {
  xs: 8,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

export const shadow = {
  /** 卡片：极轻的悬浮感，避免用描边硬切 */
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  /** 次级表面 */
  soft: {
    shadowColor: '#000000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
} as const;

/**
 * 毛玻璃材质分层
 *
 * - chrome：顶部/导航等外层壳体，透明度和模糊最高
 * - card：主卡片
 * - inset：卡片内部的小块（数据格），尽量接近实底以保证可读性
 */
export const glass = {
  fill: {
    chrome: 'rgba(255,255,255,0.66)',
    card: 'rgba(255,255,255,0.78)',
    inset: 'rgba(255,255,255,0.62)',
  },
  border: 'rgba(255,255,255,0.6)',
  borderSoft: 'rgba(17,19,21,0.06)',
  highlight: 'rgba(255,255,255,0.85)',
  insetFill: 'rgba(255,255,255,0.55)',
  blur: {
    chrome: 60,
    card: 45,
    inset: 28,
  },
} as const;

export type GlassTier = keyof typeof glass.blur;

type Weight = TextStyle['fontWeight'];

export const cardStyle: ViewStyle = {
  backgroundColor: colors.card,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  padding: spacing.lg,
  ...shadow.card,
};

export const tileStyle: ViewStyle = {
  backgroundColor: colors.surface,
  borderRadius: radius.md,
  padding: spacing.md,
};

export const iconButtonStyle: ViewStyle = {
  width: 40,
  height: 40,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radius.pill,
  backgroundColor: colors.card,
  ...shadow.soft,
};

export const inputStyle: TextStyle & ViewStyle = {
  minHeight: 46,
  borderRadius: radius.md,
  backgroundColor: 'rgba(255,255,255,0.62)',
  borderWidth: 1,
  borderColor: glass.borderSoft,
  paddingHorizontal: 14,
  color: colors.text,
  fontSize: 14,
};

export const primaryButtonStyle: ViewStyle = {
  minHeight: 46,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  borderRadius: radius.md,
  backgroundColor: colors.primary,
};

export const pillStyle: ViewStyle = {
  borderRadius: radius.pill,
  paddingHorizontal: 10,
  paddingVertical: 4,
};

export const text = {
  screenTitle: { fontSize: 26, fontWeight: '700' as Weight, color: colors.text },
  screenSubtitle: { fontSize: 13, color: colors.subtext },
  cardTitle: { fontSize: 16, fontWeight: '700' as Weight, color: colors.text },
  cardSubtitle: { fontSize: 12, lineHeight: 18, color: colors.subtext },
  label: { fontSize: 11, color: colors.subtext },
  faint: { fontSize: 10, color: colors.faint },
  metric: { fontSize: 22, fontWeight: '700' as Weight, color: colors.text, fontVariant: ['tabular-nums'] as const },
  metricSmall: { fontSize: 19, fontWeight: '700' as Weight, color: colors.text, fontVariant: ['tabular-nums'] as const },
} satisfies Record<string, TextStyle>;
