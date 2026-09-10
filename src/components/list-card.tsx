import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { GlassSurface } from '@/src/components/glass-surface';
import { colors, pillStyle, radius } from '@/src/theme';

type ListCardProps = {
  title: string;
  meta?: string;
  badge?: string;
  badgeTone?: 'default' | 'success' | 'muted' | 'warning' | 'danger';
  children?: ReactNode;
  icon?: LucideIcon;
};

const badgeClassMap: Record<NonNullable<ListCardProps['badgeTone']>, { wrap: string; text: string }> = {
  default: {
    wrap: 'bg-[#f2f3f3]',
    text: 'text-[10px] font-semibold text-[#5f6468]',
  },
  success: {
    wrap: 'bg-[#f6f7f7]',
    text: 'text-[10px] font-semibold text-[#111315]',
  },
  muted: {
    wrap: 'bg-[#f2f3f3]',
    text: 'text-[10px] font-semibold text-[#5f6468]',
  },
  warning: {
    wrap: 'bg-[#f6f7f7]',
    text: 'text-[10px] font-semibold text-[#5f6468]',
  },
  danger: {
    wrap: 'bg-[#fdecea]',
    text: 'text-[10px] font-semibold text-[#d92d20]',
  },
};

export function ListCard({ title, meta, badge, badgeTone = 'default', children, icon: Icon }: ListCardProps) {
  const badgeClass = badgeClassMap[badgeTone];

  return (
    <GlassSurface contentStyle={{ padding: 14 }}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1" style={{ minWidth: 0 }}>
          <View className="flex-row items-center gap-2" style={{ minWidth: 0 }}>
            {Icon ? (
              <View style={{ width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
                <Icon color={colors.subtext} size={15} />
              </View>
            ) : null}
            <Text
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.86}
              className="flex-1 text-[15px] font-semibold leading-5 text-[#111315]"
            >
              {title}
            </Text>
          </View>
          {meta ? <Text numberOfLines={2} className="mt-1.5 text-xs leading-4 text-[#5f6468]">{meta}</Text> : null}
        </View>
        {badge ? (
          <View className={badgeClass.wrap} style={[pillStyle, { flexShrink: 0 }]}>
            <Text className={badgeClass.text}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {children ? <View style={{ marginTop: 12 }}>{children}</View> : null}
    </GlassSurface>
  );
}
