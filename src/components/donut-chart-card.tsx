import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type DonutChartCardProps = {
  title: string;
  subtitle: string;
  segments: DonutSegment[];
  centerLabel: string;
  centerValue: string;
};

export function DonutChartCard({
  title,
  subtitle,
  segments,
  centerLabel,
  centerValue,
}: DonutChartCardProps) {
  const total = Math.max(
    segments.reduce((sum, segment) => sum + segment.value, 0),
    1
  );
  const size = 152;
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <View className="rounded-[18px] bg-[#ffffff] p-4">
      <Text className="text-xs uppercase tracking-[1.6px] text-[#5f6468]">{title}</Text>
      <Text numberOfLines={1} className="mt-1 text-xs text-[#8b9094]">{subtitle}</Text>

      <View className="mt-4 items-center justify-center">
        <View className="items-center justify-center">
          <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="#e8e9e9"
              strokeWidth={strokeWidth}
              fill="none"
            />
            {segments.map((segment) => {
              const length = (segment.value / total) * circumference;
              const circleOffset = circumference - offset;
              offset += length;

              return (
                <Circle
                  key={segment.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={segment.color}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={circleOffset}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })}
          </Svg>

          <View className="absolute items-center">
            <Text className="text-xs uppercase tracking-[1.4px] text-[#5f6468]">{centerLabel}</Text>
            <Text className="mt-1 text-[28px] font-bold text-[#111315]">{centerValue}</Text>
          </View>
        </View>
      </View>

      <View className="mt-4 gap-2.5">
        {segments.map((segment) => {
          const percentage = Math.round((segment.value / total) * 100);

          return (
            <View key={segment.label} className="flex-row items-center justify-between rounded-[12px] bg-[#f6f7f7] px-3 py-2.5">
              <View className="flex-row items-center gap-3">
                <View className="h-3 w-3 rounded-full" style={{ backgroundColor: segment.color }} />
                <Text className="text-sm font-semibold text-[#111315]">{segment.label}</Text>
              </View>
              <Text className="text-xs text-[#111315]">{segment.value} · {percentage}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
