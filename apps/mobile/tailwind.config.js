module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cheqpay brand palette
        brand: '#0A8A3C',
        'brand-dark': '#067A33',
        surface: '#E9EEE9',
        'surface-soft': '#DDE4DD',
        ink: '#0F1419',
        muted: '#6B7280',
        // legacy aliases (kept so existing screens keep compiling)
        primary: '#0A8A3C',
        secondary: '#067A33',
        danger: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
        success: '#0A8A3C',
        dark: '#0F1419',
        light: '#F3F4F6',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
