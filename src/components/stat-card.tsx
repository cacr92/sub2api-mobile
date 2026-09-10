import type { LucideIcon } from 'lucide-react-native';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { Text, View } from 'react-native';

type StatCardProps = {
  label: string;
  value: string;
  tone?: 'light' | 'dark';
  trend?: 'up' | 'down';
  icon?: LucideIcon;
};

export function StatCard({ label, value, tone = 'light', trend, icon: Icon }: StatCardProps) {
  const dark = tone === 'dark';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : null;

  return (
    <View className={dark ? 'rounded-[24px] bg-[#111315] p-4' : 'rounded-[24px] bg-[#ffffff] p-4'}>
      <View className="flex-row items-center justify-between gap-3">
        <Text className={dark ? 'text-xs uppercase tracking-[1.5px] text-[#f6f7f7]' : 'text-xs uppercase tracking-[1.5px] text-[#5f6468]'}>
          {label}
        </Text>
        <View className="flex-row items-center gap-2">
          {TrendIcon ? <TrendIcon color={dark ? '#f6f7f7' : '#5f6468'} size={14} /> : null}
          {Icon ? <Icon color={dark ? '#f6f7f7' : '#5f6468'} size={14} /> : null}
        </View>
      </View>
      <Text className={dark ? 'mt-3 text-3xl font-bold text-white' : 'mt-3 text-3xl font-bold text-[#111315]'}>
        {value}
      </Text>
    </View>
  );
}
