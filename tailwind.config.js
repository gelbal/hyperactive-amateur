import plugin from "tailwindcss/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      gridTemplateColumns: {
        16: "repeat(16, minmax(0, 1fr))",
      },
    },
  },
  plugins: [
    // Tailwind 3.4 ships no pointer variants (they arrive in v4), so the
    // pointer-coarse:/any-pointer-coarse: classes across the mobile touch
    // pass are silently dropped from the build unless defined here.
    // Guarded by src/tailwindPointerVariants.test.ts.
    plugin(({ addVariant }) => {
      addVariant("pointer-coarse", "@media (pointer: coarse)");
      addVariant("any-pointer-coarse", "@media (any-pointer: coarse)");
    }),
  ],
};
