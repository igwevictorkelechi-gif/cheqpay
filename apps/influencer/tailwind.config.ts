import type { Config } from "tailwindcss";

// Colours are CSS variables (globals.css) so the whole portal follows the
// device's light or dark appearance, Apple-style. `<alpha-value>` keeps
// opacity utilities such as bg-card/90 working.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: v("brand"),
        "brand-dark": v("brand-dark"),
        "brand-light": v("brand-light"),
        gold: v("gold"),
        surface: v("surface"),
        card: v("card"),
        circle: v("circle"),
        border: v("border"),
        ink: v("ink"),
        muted: v("muted"),
        good: v("good"),
        warn: v("warn"),
        bad: v("bad"),
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', '"SF Pro Display"', '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
      },
      opacity: { 12: "0.12" },
      borderRadius: { "4xl": "28px" },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 28px rgb(0 0 0 / 0.06)",
        float: "0 10px 40px rgb(0 0 0 / 0.18)",
      },
      transitionTimingFunction: { spring: "cubic-bezier(0.32, 0.72, 0, 1)" },
    },
  },
  plugins: [],
};

export default config;
