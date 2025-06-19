#!/bin/bash

echo "🚀 Deploying Anava Web Installer to Vercel"
echo ""

# Navigate to the correct directory
cd /Users/ryanwager/batonDescribe/web-installer

# Remove any existing Vercel configuration
rm -rf .vercel

# Deploy to Vercel
echo "Running vercel deployment..."
vercel --prod

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Visit your deployment URL"
echo "2. Set up Google OAuth credentials at: https://console.cloud.google.com/apis/credentials"
echo "3. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID environment variable in Vercel dashboard"
echo ""