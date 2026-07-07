import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // CheqPay brand palette. Brand hues are fixed; the neutral tokens are
        // CSS-variable driven (RGB channels in globals.css) so the app can
        // switch between dark and light themes at runtime via
        // <html data-theme="light">.
        brand: "#6B5B95",
        "brand-dark": "#574A7A",
        "brand-light": "#8A7BB5",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-soft": "rgb(var(--c-surface-soft) / <alpha-value>)",
        card: "rgb(var(--c-card) / <alpha-value>)",
        circle: "rgb(var(--c-circle) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        // legacy aliases
        primary: "#6B5B95",
        "primary-dark": "#574A7A",
        "primary-light": "#8A7BB5",
        secondary: "#9A93AD",
        danger: "#EF4444",
        warning: "#F59E0B",
        success: "#34C759",
        info: "#3B82F6",
      },
      fontFamily: {
        sans: ["system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
