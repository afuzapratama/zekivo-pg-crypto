import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "test-results/**",
      ".devnet/**",
      "playwright-report/**",
      "**/.next/**",
      "**/node_modules/**",
      "apps/web/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
);
