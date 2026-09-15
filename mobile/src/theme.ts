export const theme = {
  color: {
    bg: '#0F1115',
    surface: '#181B22',
    surfaceRaised: '#20242D',
    border: '#2B303B',
    text: '#F2F4F8',
    textMuted: '#9AA3B2',
    // The indicator colour is deliberately high-contrast and reserved: it is
    // used for nothing except "a stream is live".
    live: '#FF4D4F',
    shield: '#3DDC97',
    accent: '#5B8DEF',
    danger: '#FF4D4F',
    locked: '#F5A623',
  },
  space: (n: number) => n * 4,
  radius: { sm: 8, md: 12, lg: 18, pill: 999 },
  font: {
    title: 26,
    heading: 19,
    body: 15,
    small: 13,
    mono: 22,
  },
} as const;
