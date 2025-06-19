# Deployment Guide - Anava Web Installer

## Quick Start (Vercel - Recommended)

### 1. Prepare for Deployment
```bash
cd web-installer
npm install
npm run build  # Test that it builds
```

### 2. Get Google OAuth Credentials
1. Go to: https://console.cloud.google.com/apis/credentials
2. Create credentials → OAuth client ID → Web application
3. Add these Authorized JavaScript origins:
   - `http://localhost:3000` (for development)
   - `https://anava-installer.vercel.app` (for Vercel preview)
   - `https://install.anava.ai` (for production)

### 3. Deploy to Vercel
```bash
# First time setup
npx vercel

# Questions:
# - Set up and deploy? Y
# - Which scope? (select your account)
# - Link to existing project? N
# - Project name? anava-installer
# - Directory? ./
# - Build command? (default)
# - Output directory? (default)
# - Development command? (default)

# Add environment variable when prompted:
# NEXT_PUBLIC_GOOGLE_CLIENT_ID = your-oauth-client-id
```

### 4. Deploy to Production
```bash
npx vercel --prod
```

Your installer is now live at: `https://anava-installer.vercel.app`

## Custom Domain Setup

### Option A: Using anava.ai domain

1. **Add to Vercel**:
   ```bash
   vercel domains add install.anava.ai
   ```

2. **Update DNS** (at your domain registrar):
   ```
   Type: CNAME
   Name: install
   Value: cname.vercel-dns.com
   ```

3. **Update OAuth** (in Google Cloud Console):
   - Add `https://install.anava.ai` to authorized origins

### Option B: Using subdomain of existing site

If you have `anava.com` or similar:
- `installer.anava.com`
- `setup.anava.com`
- `cloud.anava.com`

## Alternative Hosting Options

### GitHub Pages (Free)
```bash
# Add to package.json scripts:
"deploy:github": "next build && touch out/.nojekyll && git add out -f && git commit -m 'Deploy' && git subtree push --prefix out origin gh-pages"

# Deploy:
npm run deploy:github
```
URL: `https://[username].github.io/anava-installer`

### Firebase Hosting
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Initialize
firebase init hosting
# - Use existing project
# - Public directory: out
# - Single-page app: Yes
# - GitHub actions: No

# Deploy
npm run build
firebase deploy
```
URL: `https://[project-id].web.app`

### Netlify (Drag & Drop)
1. Run `npm run build`
2. Go to https://app.netlify.com
3. Drag the `out` folder to the browser
4. Done!

## Environment Variables

For all platforms, you need to set:
```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
```

### Vercel
- Set in dashboard: Project Settings → Environment Variables
- Or during deployment CLI prompts

### Netlify
- Set in: Site Settings → Environment Variables

### GitHub Pages
- Add to GitHub Secrets
- Reference in workflow file

## Post-Deployment Checklist

- [ ] Test OAuth flow
- [ ] Verify API calls work
- [ ] Check mobile responsive
- [ ] Test error scenarios
- [ ] Update OAuth redirect URIs
- [ ] Add domain to Google Search Console
- [ ] Set up analytics (optional)
- [ ] Create link from main website

## Monitoring

### Vercel Analytics (Free)
```bash
npm install @vercel/analytics
```

Add to `_app.tsx`:
```typescript
import { Analytics } from '@vercel/analytics/react';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ChakraProvider theme={theme}>
      <Component {...pageProps} />
      <Analytics />
    </ChakraProvider>
  );
}
```

## Updating

### Vercel (Automatic with Git)
```bash
git add .
git commit -m "Update installer"
git push origin main
# Automatically deploys!
```

### Manual
```bash
npx vercel --prod
```

## SSL/HTTPS

All recommended platforms provide automatic HTTPS:
- ✅ Vercel - Automatic
- ✅ Netlify - Automatic  
- ✅ GitHub Pages - Automatic
- ✅ Firebase - Automatic

No configuration needed!

## Cost

For your expected traffic levels:
- Vercel: **FREE** (100GB bandwidth/month)
- Netlify: **FREE** (100GB bandwidth/month)
- GitHub Pages: **FREE** (100GB bandwidth/month)
- Firebase: **FREE** (10GB bandwidth/month)

You won't exceed free tiers unless you have thousands of daily installs.

## Professional Touch

### 1. Add a Status Page
Create `https://status.anava.ai` using:
- Upptime (GitHub-based, free)
- Better Stack (free tier)
- Instatus (free tier)

### 2. Add Documentation Site
Create `https://docs.anava.ai` using:
- Docusaurus
- GitBook
- Nextra

### 3. Analytics Dashboard
Show installation metrics at `https://metrics.anava.ai`:
- Total installations
- Popular regions
- Success rate
- Average time to complete

## Summary

**Recommended Setup**:
1. Deploy to Vercel (5 minutes)
2. Get temporary URL working
3. Add custom domain when ready
4. Keep GitHub as backup hosting

This gives you:
- Professional presence
- Zero hosting costs
- Global performance
- Automatic deployments
- SSL included

The installer will be available at:
- `https://install.anava.ai` (production)
- `https://anava-installer.vercel.app` (backup)
- `http://localhost:3000` (development)