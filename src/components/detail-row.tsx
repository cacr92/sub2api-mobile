import { Text, View } from 'react-native';

type DetailRowProps = {
  label: string;
  value: string;
};

export function DetailRow({ label, value }: DetailRowProps) {
  return (
    <View className="flex-row items-start justify-between gap-4 border-b border-[#e8e9e9] py-3 last:border-b-0">
      <Text className="text-sm text-[#5f6468]">{label}</Text>
      <Text className="max-w-[62%] text-right text-sm font-medium text-[#111315]">{value}</Text>
    </View>
  );
}
