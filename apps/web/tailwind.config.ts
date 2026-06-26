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
        // CheqPay brand palette (dark theme)
        brand: "#6B5B95",
        "brand-dark": "#574A7A",
        "brand-light": "#8A7BB5",
        surface: "#14121A",
        "surface-soft": "#1F1B29",
        card: "#1F1B29",
        circle: "#2C2738",
        border: "#2A2535",
        ink: "#F4F3F7",
        muted: "#9A93AD",
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
