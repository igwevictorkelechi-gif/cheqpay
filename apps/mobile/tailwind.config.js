module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cheqpay brand palette (dark theme)
        brand: '#6B5B95',
        'brand-dark': '#574A7A',
        'brand-light': '#8A7BB5',
        surface: '#14121A',
        'surface-soft': '#1F1B29',
        card: '#1F1B29',
        circle: '#2C2738',
        border: '#2A2535',
        ink: '#F4F3F7',
        muted: '#9A93AD',
        // legacy aliases (kept so existing screens keep compiling)
        primary: '#6B5B95',
        secondary: '#574A7A',
        danger: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
        success: '#34C759',
        dark: '#14121A',
        light: '#1F1B29',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
