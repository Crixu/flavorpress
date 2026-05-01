import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "macos/build/**",
      "next-env.d.ts",
      "coverage/**",
      ".data/**",
    ],
  },
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      // Stylistic; entities inside copy are common in the existing app.
      "react/no-unescaped-entities": "off",
      // The strict React 19 / eslint-plugin-react-hooks 6 rules surface real
      // smells but pre-date most of this codebase. Run them as warnings so
      // they show in editors without blocking CI; address in a dedicated pass.
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["scripts/**/*.ts", "**/*.config.{ts,mjs,js}", "vitest.setup.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
];
