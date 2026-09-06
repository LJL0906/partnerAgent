import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { colors } from '@/theme/colors';

export function AssistantAvatar({ size = 36 }: { size?: number }) {
  return (
    <Svg accessibilityLabel="伙伴" height={size} viewBox="0 0 40 40" width={size}>
      <Circle cx="20" cy="20" fill="#EEF1FF" r="20" />
      <Circle cx="31" cy="9" fill="#DDE2FF" opacity={0.7} r="8" />
      <Circle cx="8" cy="31" fill="#E0F6F1" opacity={0.8} r="7" />
      <Path d="M20 5.5v3" stroke={colors.violet500} strokeLinecap="round" strokeWidth={1.5} />
      <Circle cx="20" cy="4.5" fill={colors.violet500} r="1.5" />
      <Rect fill="#FCFEFF" height="22" rx="8" stroke="#A7B5E8" strokeWidth="1" width="25" x="7.5" y="10" />
      <Circle cx="14.5" cy="19" fill={colors.brand500} r="2" />
      <Circle cx="25.5" cy="19" fill={colors.brand500} r="2" />
      <Path d="M15.5 24c2.6 2.1 6.4 2.1 9 0" fill="none" stroke={colors.violet500} strokeLinecap="round" strokeWidth="1.5" />
      <Circle cx="32.5" cy="29" fill="#C7F1E8" r="3" stroke="#8ACFC1" strokeWidth="1" />
      <Path d="m32.5 26.8.65 1.55 1.55.65-1.55.65-.65 1.55-.65-1.55-1.55-.65 1.55-.65.65-1.55Z" fill="#FFFFFF" />
      <Ellipse cx="20" cy="34.5" fill="#D9DEFA" opacity={0.7} rx="9" ry="1.5" />
    </Svg>
  );
}



