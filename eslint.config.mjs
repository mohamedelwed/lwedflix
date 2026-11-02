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
    // Electron shell, build scripts and e2e harnesses (plain JS), and generated output.
    "electron/**",
    "scripts/**",
    "tests/e2e/**",
    "server-bundle/**",
    "release/**",
    "brag-output*/**",
  ]),
]);

export default eslintConfig;
