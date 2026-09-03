import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    environment: "node",
    // The probe flows write JSON to disk and render PDFs; the default 5s is
    // tight for the first pdfkit/exceljs import in a cold process.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: false,
  },
});
