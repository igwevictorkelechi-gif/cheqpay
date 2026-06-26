import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // CheqPay brand purple scale
        brand: {
          50: '#F2F0F7',
          100: '#E5E1EF',
          200: '#CDC6DF',
          300: '#AFA4CB',
          400: '#8A7BB5',
          500: '#6B5B95',
          600: '#5E4F85',
          700: '#574A7A',
          800: '#463B61',
          900: '#3A3150',
          DEFAULT: '#6B5B95',
        },
        primary: '#6B5B95',
        'primary-dark': '#574A7A',
        danger: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
        success: '#34C759',
      },
    },
  },
  plugins: [],
};

export default config;
