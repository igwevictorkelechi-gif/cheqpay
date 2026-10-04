import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#6B5B95",
        "brand-dark": "#574A7A",
        "brand-light": "#8A7BB5",
        gold: "#F5C97B",
        surface: "#0E0C14",
        card: "#1A1724",
        circle: "#262234",
        border: "#2E2A3D",
        ink: "#F4F2F9",
        muted: "#9A93AD",
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};

export default config;
