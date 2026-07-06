import plugin from "tailwindcss/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  // Test files are excluded: class-name literals inside test assertions must
  // not seed the JIT, or generated-CSS regression tests can pass on classes
  // no shipped component uses (and dead classes leak into the bundle).
  content: ["./index.html", "./src/**/!(*.test).{ts,tsx}"],
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
