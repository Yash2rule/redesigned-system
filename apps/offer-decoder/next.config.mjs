/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@probes/core", "@probes/ui", "@probes/billing", "@probes/analytics", "@probes/auth"],
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  serverExternalPackages: ["pdfkit", "exceljs", "postgres"],
};
