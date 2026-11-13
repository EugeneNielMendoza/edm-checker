/** @type {import('tailwindcss').Config} */
// Sesimi brand theme. Colours that change between light and dark mode point at CSS variables
// defined in client/src/index.css, so one class (e.g. `bg-surface`) works in both themes.
module.exports = {
  content: ["./client/app.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    // Phone/tablet below 641px, tablet 641–900px, desktop 901px and up.
    screens: { sm: "641px", md: "901px" },
    extend: {
      colors: {
        // Fixed brand colours (Sesimi style guide)
        teal: "#002a2e",
        cyan: "#7af1ff",
        pink: "#f9cade",
        lime: "#d1ff3b",
        orange: "#f74c07",
        // Theme colours (light/dark)
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        topbar: "var(--topbar)",
        brand: {
          DEFAULT: "var(--brand)",
          strong: "var(--brand-strong)",
          ink: "var(--brand-ink)",
          soft: "var(--brand-soft)",
        },
        done: { DEFAULT: "var(--done)", ink: "var(--done-ink)" },
        pass: "var(--pass)",
        fail: { DEFAULT: "var(--fail)", soft: "var(--fail-soft)", line: "var(--fail-line)" },
        warn: { DEFAULT: "var(--warn)", soft: "var(--warn-soft)" },
        chip: {
          run: "var(--chip-run-bg)",
          "run-ink": "var(--chip-run-ink)",
          done: "var(--chip-done-bg)",
          "done-ink": "var(--chip-done-ink)",
        },
      },
      fontFamily: {
        sans: ['"Schibsted Grotesk"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
      },
      borderRadius: { card: "14px" },
      boxShadow: {
        card: "var(--shadow)",
        frame: "0 1px 3px rgba(0, 0, 0, .12), 0 16px 40px -18px rgba(0, 0, 0, .35)",
        dialog: "0 30px 80px -20px rgba(0, 0, 0, .45)",
      },
      keyframes: { "pulse-soft": { "50%": { opacity: ".55" } } },
      animation: { "pulse-soft": "pulse-soft 1.2s ease-in-out infinite" },
    },
  },
  plugins: [],
};
