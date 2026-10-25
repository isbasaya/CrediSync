const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // design-system/tokens.ts is imported from outside web/ (the monorepo
    // root) — this tells Next's output file tracing to look above the
    // package root instead of warning/misresolving at build time.
    outputFileTracingRoot: path.join(__dirname, '..'),
  },
};

module.exports = nextConfig;
