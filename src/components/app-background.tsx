import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * 背景平面：玻璃必须有可采样的背景，纯白平面不会产生材质感。
 * 这里用极浅的灰阶渐变 + 两处柔和光斑，保持黑白质感的同时让玻璃有东西可折射。
 */
export function AppBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="pageBase" x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="0.55" stopColor="#f7f8f8" />
            <Stop offset="1" stopColor="#eef1f1" />
          </LinearGradient>
          <RadialGradient id="topGlow" cx="0.2" cy="0.06" r="0.55">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="bottomShade" cx="0.85" cy="0.98" r="0.6">
            <Stop offset="0" stopColor="#c9d0d0" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#c9d0d0" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#pageBase)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#topGlow)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bottomShade)" />
        <Circle cx="82%" cy="14%" r="150" fill="#ffffff" fillOpacity="0.5" />
        <Circle cx="10%" cy="86%" r="190" fill="#dfe4e4" fillOpacity="0.45" />
      </Svg>
    </View>
  );
}
