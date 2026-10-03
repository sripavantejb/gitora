import { type Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  darkMode: "class",
  content: ["./src/**/*.tsx"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
        inter: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
        archivo: ["var(--font-archivo-black)", ...defaultTheme.fontFamily.sans],
        display: [
          "var(--font-space-grotesk)",
          ...defaultTheme.fontFamily.sans,
        ],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "max(0px, calc(var(--radius) - 2px))",
        sm: "max(0px, calc(var(--radius) - 4px))",
      },
      colors: {
        ink: "#0a0a0a",
        paper: "#f0f0f0",
        lime: { DEFAULT: "#c8f542" },
        sky: { DEFAULT: "#96c8ff" },
        orange: { DEFAULT: "#ff4e00" },
        purple: { DEFAULT: "#c3a4f6" },
        green: { DEFAULT: "#2fdf92" },
        pink: { DEFAULT: "#fca5cc" },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
    },
  },
} satisfies Config;
