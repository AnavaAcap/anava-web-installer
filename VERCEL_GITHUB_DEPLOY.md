# Deploy Web Installer to Vercel via GitHub

## Prerequisites
- GitHub account
- Vercel account (free at vercel.com)
- Google Cloud Console access for OAuth setup

## Step 1: Connect Vercel to GitHub

1. Go to https://vercel.com/dashboard
2. Click "Add New..." → "Project"
3. Import from Git Repository
4. Connect your GitHub account if not already connected
5. Search for "batonDescribe"
6. Click "Import" next to the repository

## Step 2: Configure the Project

When importing, Vercel will show configuration options:

1. **Project Name**: `anava-web-installer` (or keep default)
2. **Framework Preset**: Next.js (should auto-detect)
3. **Root Directory**: Click "Edit" and set to `web-installer`
4. **Build and Output Settings**:
   - Build Command: `npm run build` (default)
   - Output Directory: `out` (should auto-detect from vercel.json)
5. **Environment Variables**: 
   - Add `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   - Value: `placeholder-will-update-later` (we'll update this after OAuth setup)

Click "Deploy"!

## Step 3: Wait for Initial Deployment

Vercel will:
1. Clone your repository
2. Install dependencies
3. Build the Next.js app
4. Deploy to their edge network

This takes about 2-3 minutes.

## Step 4: Set Up Google OAuth

While Vercel is deploying, set up OAuth:

1. Go to https://console.cloud.google.com/apis/credentials
2. Select your project or create a new one
3. Click "Create Credentials" → "OAuth client ID"
4. Application type: **Web application**
5. Name: `Anava Web Installer`
6. Authorized JavaScript origins:
   ```
   https://anava-web-installer.vercel.app
   https://anava-web-installer-*.vercel.app
   http://localhost:3000
   ```
7. Authorized redirect URIs: (same as origins)
8. Click "Create"
9. Copy the Client ID (looks like: `123456789-abcdef.apps.googleusercontent.com`)

## Step 5: Update Environment Variable

1. Go back to Vercel dashboard
2. Click on your project
3. Go to "Settings" tab
4. Click "Environment Variables"
5. Find `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
6. Click the three dots → "Edit"
7. Replace placeholder with your actual OAuth Client ID
8. Save

## Step 6: Redeploy with Real OAuth

1. Go to "Deployments" tab
2. Click the three dots on the latest deployment
3. Click "Redeploy"
4. Wait for deployment to complete

## Step 7: Test Your Deployment

1. Visit your deployment URL (shown in Vercel dashboard)
2. You should see the Anava installer homepage
3. Click "Connect Google Cloud Account"
4. OAuth flow should work with your Google account

## Automatic Deployments

From now on:
- Every push to `main` branch → Production deployment
- Every push to `feat/web-installer-proper` → Preview deployment
- Pull request comments will include preview URLs

## Custom Domain (Optional)

1. In Vercel project settings → "Domains"
2. Add your domain (e.g., `install.anava.ai`)
3. Follow DNS configuration instructions
4. Update OAuth credentials with new domain

## Troubleshooting

### Build Fails
- Check build logs in Vercel dashboard
- Common issue: Missing dependencies
- Solution: Ensure package.json is complete

### OAuth Not Working
- Verify OAuth origins match Vercel URLs exactly
- Check browser console for errors
- Ensure environment variable is set correctly

### 404 Errors
- Verify `vercel.json` has proper rewrites
- Check that `outputDirectory` is set to `out`

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID | `123456789-abc.apps.googleusercontent.com` |

## Success Checklist

- [ ] Vercel project imported from GitHub
- [ ] Root directory set to `web-installer`
- [ ] Initial deployment successful
- [ ] Google OAuth credentials created
- [ ] OAuth Client ID added to Vercel env vars
- [ ] Redeployed with real OAuth
- [ ] Tested OAuth flow works
- [ ] (Optional) Custom domain configured