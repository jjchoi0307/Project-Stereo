import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // SMG brand-ish neutrals + a calm clinical accent.
        ink: "#0f172a",
        accent: "#0d6e6e",
      },
      fontFamily: {
        sans: ["'Montserrat'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        hero: "0 8px 24px -12px rgba(13,110,110,.35)",
      },
    },
  },
  plugins: [],
};

export default config;
