/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable static export for hosting on Vercel/Netlify
  output: 'export',
  // Since we're using static export, we need to handle trailing slashes
  trailingSlash: true,
  // Environment variables that will be available in the browser
  env: {
    // These will be replaced at build time
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
  },
}

module.exports = nextConfig