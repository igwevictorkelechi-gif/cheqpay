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
        // Cheqpay brand palette
        brand: "#0A8A3C",
        "brand-dark": "#067A33",
        surface: "#E9EEE9",
        "surface-soft": "#DDE4DD",
        circle: "#D7DDD7",
        ink: "#0F1419",
        muted: "#6B7280",
        // legacy aliases
        primary: "#0A8A3C",
        "primary-dark": "#067A33",
        "primary-light": "#D1FAE5",
        secondary: "#6B7280",
        danger: "#EF4444",
        warning: "#F59E0B",
        success: "#0A8A3C",
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
