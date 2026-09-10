import type { LucideIcon } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { colors, iconButtonStyle } from '@/src/theme';

type IconButtonProps = {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger' | 'muted';
  disabled?: boolean;
};

export function IconButton({ icon: Icon, label, onPress, tone = 'default', disabled = false }: IconButtonProps) {
  const tint = tone === 'danger' ? colors.danger : tone === 'muted' ? colors.subtext : colors.primary;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [iconButtonStyle, { opacity: disabled ? 0.5 : pressed ? 0.72 : 1 }]}
    >
      <Icon color={tint} size={17} />
    </Pressable>
  );
}
