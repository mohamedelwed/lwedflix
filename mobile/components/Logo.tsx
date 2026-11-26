import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

// The LWEDFLIX wordmark (src/components/LwedflixLogo.tsx), drawn as paths on
// a 100-unit cap height. Keep the two in step.
const GLYPHS = [
  { x: 0, d: 'M0 0H18V84H46V100H0Z' },
  { x: 43, d: 'M0 0H16L25 62L34 0H50L59 62L68 0H84L69 100H53L42 38L31 100H15Z' },
  { x: 131, d: 'M0 0H44V16H18V42H40V58H18V84H44V100H0Z' },
  { x: 182, d: 'M0 0H26C41 0 50 10 50 26V74C50 90 41 100 26 100H0ZM18 16V84H25C30 84 32 81 32 74V26C32 19 30 16 25 16Z' },
  { x: 239, d: 'M0 0H42V16H18V43H38V59H18V100H0Z' },
  { x: 288, d: 'M0 0H18V84H46V100H0Z' },
  { x: 339, d: 'M0 0H18V100H0Z' },
  { x: 364, d: 'M0 0H19L27 33L35 0H54L38 50L54 100H35L27 67L19 100H0L16 50Z' },
];

export default function Logo({ height = 20 }: { height?: number }) {
  return (
    <Svg width={(height * 418) / 100} height={height} viewBox="0 0 418 100" accessibilityLabel="Lwedflix">
      <Defs>
        <LinearGradient id="lwedflixFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffc24d" />
          <Stop offset="0.45" stopColor="#ff9900" />
          <Stop offset="1" stopColor="#ff6200" />
        </LinearGradient>
      </Defs>
      {GLYPHS.map((g) => (
        <Path key={g.x} d={g.d} transform={`translate(${g.x} 0)`} fill="url(#lwedflixFill)" fillRule="evenodd" />
      ))}
    </Svg>
  );
}
