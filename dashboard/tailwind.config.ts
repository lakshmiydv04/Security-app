import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0F1115', raised: '#181B22', high: '#20242D' },
        line: '#2B303B',
        body: '#F2F4F8',
        muted: '#9AA3B2',
        // Reserved: used for nothing except "a stream is live".
        live: '#FF4D4F',
        shield: '#3DDC97',
        accent: '#5B8DEF',
        locked: '#F5A623',
      },
    },
  },
  plugins: [],
};

export default config;
