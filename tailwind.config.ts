import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // SMG brand-ish neutrals + a calm clinical accent. Tune later.
        ink: "#0f172a",
        accent: "#0d6e6e",
      },
    },
  },
  plugins: [],
};

export default config;
