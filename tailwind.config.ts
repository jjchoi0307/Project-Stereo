import type { Config } from "tailwindcss";

// SMG identity — see DESIGN.md. Grounded in the real brand: vivid green + blue
// on clean white, friendly sans, soft rounded forms, subtle elevation. Warm and
// trustworthy, built for the Korean-American seniors SMG serves.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#142433", // primary text (cool, blue-tinted near-black)
        ink2: "#5b6b7a", // secondary text
        line: "#e4e9f0", // soft cool hairline/border
        ground: "#f5f8fc", // clean app background (faint cool blue, NOT grey-green)
        paper: "#eef3fb", // faint tint for sub-surfaces / hovers / table headers on white
        surface: "#ffffff", // white cards
        accent: "#047a32", // interactive green — AA-safe as fill+white-text and as text-on-white
        "accent-strong": "#036628", // hover / pressed / engraving
        brand: "#00a840", // SMG vivid identity green — marks, bars, active, accents
        blue: "#005098", // SMG secondary blue — links, trust accents
        // Functional semantics
        pos: "#00a840",
        warn: "#b07514",
        neg: "#c23b3b",
        ai: "#6b46c1",
        prov: "#005098",
      },
      fontFamily: {
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        none: "0px",
        sm: "6px",
        DEFAULT: "8px",
        md: "8px",
        lg: "10px",
        xl: "12px",
        "2xl": "16px",
        "3xl": "20px",
        full: "9999px",
      },
      boxShadow: {
        none: "none",
        // Soft, single, brand-tinted elevation — clean cards, not boxes.
        sm: "0 1px 2px rgba(16,40,60,.05)",
        DEFAULT: "0 1px 2px rgba(16,40,60,.04), 0 2px 8px rgba(16,40,60,.06)",
        card: "0 1px 2px rgba(16,40,60,.04), 0 2px 10px rgba(16,40,60,.06)",
        hero: "0 4px 14px -4px rgba(0,80,152,.18)",
      },
    },
  },
  plugins: [],
};

export default config;
