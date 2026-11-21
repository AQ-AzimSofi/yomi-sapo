import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext packages the standalone output into the Lambda function
  output: 'standalone',

  webpack: (config, { isServer }) => {
    // Exclude scripts directory from being watched
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules', '**/scripts/**', '**/.git'],
    };
    return config;
  },

  // Optimize serverless function size by excluding unnecessary files
  outputFileTracingExcludes: {
    '*': [
      '.next/cache/**/*',
      'node_modules/@swc/core/**/*',
      'node_modules/esbuild/**/*',
      'node_modules/webpack/**/*',
      'node_modules/terser/**/*',
      'scripts/**/*',
      '.git/**/*',
      '.sst/**/*',
      '.claude/**/*',
      'temp/**/*',
      '.env*',
    ],
  },

  // pg is only reached by the dev-only sync route; keep it out of the bundle.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
