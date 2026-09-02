import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

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
    wrap: 'rounded-[8px] bg-[#edf0ee] px-2.5 py-1',
    text: 'text-[10px] font-semibold uppercase tracking-[1px] text-[#56615d]',
  },
  success: {
    wrap: 'rounded-[8px] bg-[#e7f2ee] px-2.5 py-1',
    text: 'text-[10px] font-semibold uppercase tracking-[1px] text-[#1f6759]',
  },
  muted: {
    wrap: 'rounded-[8px] bg-[#edf0ee] px-2.5 py-1',
    text: 'text-[10px] font-semibold uppercase tracking-[1px] text-[#65706c]',
  },
  warning: {
    wrap: 'rounded-[8px] bg-[#fff0c7] px-2.5 py-1',
    text: 'text-[10px] font-semibold uppercase tracking-[1px] text-[#8a5a12]',
  },
  danger: {
    wrap: 'rounded-[8px] bg-[#ffe7e0] px-2.5 py-1',
    text: 'text-[10px] font-semibold uppercase tracking-[1px] text-[#a5412c]',
  },
};

export function ListCard({ title, meta, badge, badgeTone = 'default', children, icon: Icon }: ListCardProps) {
  const badgeClass = badgeClassMap[badgeTone];

  return (
    <View className="rounded-[8px] border border-[#dfe5e1] bg-white p-3.5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1" style={{ minWidth: 0 }}>
          <View className="flex-row items-center gap-2" style={{ minWidth: 0 }}>
            {Icon ? <Icon color="#65706c" size={16} /> : null}
            <Text
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.86}
              className="flex-1 text-[15px] font-semibold leading-5 text-[#17201d]"
            >
              {title}
            </Text>
          </View>
          {meta ? <Text numberOfLines={1} className="mt-1 text-xs text-[#65706c]">{meta}</Text> : null}
        </View>
        {badge ? (
          <View className={badgeClass.wrap} style={{ flexShrink: 0 }}>
            <Text className={badgeClass.text}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {children ? <View className="mt-3">{children}</View> : null}
    </View>
  );
}
