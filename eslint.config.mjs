import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // scripts/*.js are standalone Node/CommonJS utility scripts -- never
  // part of the Next.js app bundle (not imported from src/, not covered
  // by tsconfig's `include`, no npm script wires them into the build).
  // require() is the correct, working import style there, not a bug the
  // no-require-imports rule (aimed at app/TypeScript ESM source) should
  // flag. Confirmed via scrape-shopvox-material-tiers.js's 4 flagged
  // imports before adding this override.
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
