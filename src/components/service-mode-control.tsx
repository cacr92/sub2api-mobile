import { Server } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { serviceModeState, setServiceMode, type ServiceMode } from '@/src/store/service-mode';

const { useSnapshot } = require('valtio/react');

const options: Array<{ mode: ServiceMode; label: string }> = [
  { mode: 'sub2api', label: 'Sub2API' },
  { mode: 'cch', label: 'CCH' },
];

export function ServiceModeControl({ compact = false }: { compact?: boolean }) {
  const serviceMode = useSnapshot(serviceModeState);

  return (
    <View style={{ borderWidth: 1, borderColor: '#e8e9e9', borderRadius: 8, backgroundColor: '#ffffff', padding: compact ? 4 : 12 }}>
      {!compact ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Server color="#111315" size={17} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: '#111315', fontSize: 14, fontWeight: '700' }}>当前管理服务</Text>
            <Text style={{ marginTop: 2, color: '#5f6468', fontSize: 11 }}>切换后，概览、供应商、用户和模型页面会显示对应服务的数据。</Text>
          </View>
        </View>
      ) : null}
      <View style={{ marginTop: compact ? 0 : 12, flexDirection: 'row', borderWidth: 1, borderColor: '#e8e9e9', borderRadius: 8, overflow: 'hidden' }}>
        {options.map((option, index) => {
          const selected = serviceMode.mode === option.mode;

          return (
            <Pressable
              key={option.mode}
              accessibilityLabel={`切换到 ${option.label}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => void setServiceMode(option.mode)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: compact ? 38 : 42,
                alignItems: 'center',
                justifyContent: 'center',
                borderLeftWidth: index === 0 ? 0 : 1,
                borderLeftColor: '#e8e9e9',
                backgroundColor: selected ? '#111315' : '#ffffff',
                opacity: pressed ? 0.76 : 1,
              })}
            >
              <Text style={{ color: selected ? '#ffffff' : '#5f6468', fontSize: 13, fontWeight: '700' }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
