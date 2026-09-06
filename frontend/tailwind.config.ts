import type { Config } from "tailwindcss";
const config: Config = { darkMode: "class", content: ["./app/**/*.{ts,tsx}"], theme: { extend: { colors: { ink: "#0b0f19", panel: "#121827", line: "#243047", electric: "#7cf7c8" }, boxShadow: { glow: "0 0 32px rgba(124,247,200,.12)" } } }, plugins: [] };
export default config;
