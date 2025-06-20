/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Note: Headers are configured via Vercel for static export

  // Disable source maps in production
  productionBrowserSourceMaps: false,

  // Environment variables that will be available in the browser
  env: {
    // These will be replaced at build time
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || '2.1.0'
  },

  // Webpack configuration for additional security
  webpack: (config, { isServer }) => {
    // Disable webpack's node polyfills
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }

    return config;
  },
}

module.exports = nextConfig