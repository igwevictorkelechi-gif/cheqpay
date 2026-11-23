module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // CheqPay brand palette. NativeWind v2 has no CSS variables, so the
        // themed neutrals ship as a LIGHT base plus a `-dark` counterpart, and
        // screens pair them as `bg-card dark:bg-card-dark`. The active scheme
        // is driven by NativeWindStyleSheet.setColorScheme in app/_layout.
        // (NativeWind registers `dark` as its own variant and forces Tailwind's
        // darkMode off, so no darkMode setting belongs here.)
        brand: '#6B5B95',
        'brand-dark': '#574A7A',
        'brand-light': '#8A7BB5',
        // v2: black / white pages; light cards step down to soft grey.
        surface: '#FFFFFF',
        'surface-dark': '#000000',
        'surface-soft': '#F6F5FA',
        'surface-soft-dark': '#1F1B29',
        card: '#F6F5FA',
        'card-dark': '#1F1B29',
        circle: '#EAE7F2',
        'circle-dark': '#2C2738',
        border: '#E0DDEA',
        'border-dark': 'rgba(255,255,255,0.10)',
        hairline: 'rgba(27,23,38,0.07)',
        'hairline-dark': 'rgba(255,255,255,0.06)',
        positive: '#1E9E4A',
        'positive-dark': '#34C759',
        ink: '#1B1726',
        'ink-dark': '#F4F3F7',
        muted: '#6E6880',
        'muted-dark': '#9A93AD',
        // legacy aliases (kept so existing screens keep compiling)
        primary: '#6B5B95',
        secondary: '#574A7A',
        danger: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
        success: '#34C759',
        dark: '#000000',
        light: '#1F1B29',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
