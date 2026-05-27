import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const sharedJsRules = {
  // This legacy React codebase keeps several extracted or feature-flagged helpers
  // in place. Keep lint focused on correctness errors instead of unused scaffolding.
  "no-unused-vars": "off",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-undef": "error",
};

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "android/**",
      "test-results/**",
      "playwright-report/**",
      "e2e/screenshots/**",
      "supabase/functions/**",
      "itinerary-builder.jsx",
      "public/**",
    ],
  },
  js.configs.recommended,

  {
    files: ["src/**/*.{js,jsx}"],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      ...react.configs.flat.recommended.plugins,
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "18" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...sharedJsRules,
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react/jsx-key": "warn",
      "react-hooks/exhaustive-deps": "off",
      // react-hooks v7 introduced opinionated rules that flag patterns common
      // in this legacy codebase. Disabled until we can refactor incrementally.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      // The codebase intentionally uses `false && <jsx />` to disable blocks
      // and emoji-stripping regexes that include presentation-form ranges.
      "no-constant-binary-expression": "off",
      "no-misleading-character-class": "off",
    },
  },

  {
    files: ["src/**/*.{js,jsx}", "vite.config.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["e2e/**/*.ts", "playwright.config.ts"],
  })),
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  {
    files: ["*.config.{js,ts}", "vite.config.js", "eslint.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Node scripts (one-off ops/backfill utilities). Allow standard Node globals.
  {
    files: ["scripts/**/*.{js,cjs,mjs,ts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
];
