# 🚀 Deploy Your Web Installer to Vercel - RIGHT NOW!

## Quick Deploy (2 minutes)

### Step 1: Deploy to Vercel

Run this command in your terminal:

```bash
cd /Users/ryanwager/batonDescribe/web-installer
vercel
```

You'll be asked a few questions:

1. **Set up and deploy "~/batonDescribe/web-installer"?** → **Y**
2. **Which scope do you want to deploy to?** → Select your account
3. **Link to existing project?** → **N** (No)
4. **What's your project's name?** → **anava-installer** (or press Enter for default)
5. **In which directory is your code located?** → **./** (press Enter)
6. **Want to override the settings?** → **N**

The deployment will start and you'll get a URL like:
`https://anava-installer-xxxxx.vercel.app`

### Step 2: Add Environment Variable

After deployment, run:

```bash
vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID
```

When prompted:
- **Value:** (You'll add your OAuth client ID later)
- **Environment:** Select all (Production, Preview, Development)

For now, just enter a placeholder value like `pending-oauth-setup`

### Step 3: Deploy to Production

```bash
vercel --prod
```

This gives you your production URL!

## 🎉 Success! You now have:

1. **Preview URL**: `https://anava-installer-xxxxx.vercel.app`
2. **Production URL**: `https://anava-installer.vercel.app`

## Next Steps (After OAuth Setup)

### 1. Get Google OAuth Credentials

1. Go to: https://console.cloud.google.com/apis/credentials
2. Click "Create Credentials" → "OAuth client ID"
3. Application type: **Web application**
4. Name: **Anava Installer**
5. Authorized JavaScript origins:
   - `http://localhost:3000`
   - `https://anava-installer.vercel.app`
   - Your custom domain (if you add one)
6. Click "Create"
7. Copy the Client ID

### 2. Update Vercel Environment

```bash
vercel env rm NEXT_PUBLIC_GOOGLE_CLIENT_ID
vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID
# Paste your real OAuth client ID
```

### 3. Redeploy

```bash
vercel --prod
```

## Test Your Live Installer

Visit your production URL and you'll see:
- Beautiful landing page ✅
- "Connect Google Cloud Account" button ✅
- Professional UI ✅

Once you add the OAuth client ID, the full flow will work!

## Custom Domain (Optional)

Want `install.anava.ai`? Super easy:

```bash
vercel domains add install.anava.ai
```

Then update your DNS with the values Vercel provides.

---

## Troubleshooting

### If deployment fails:
```bash
# Check Node version
node --version  # Should be 18+

# Clear cache and retry
rm -rf .next node_modules
npm install
npm run build
vercel
```

### View deployment logs:
```bash
vercel logs
```

### List all deployments:
```bash
vercel ls
```

---

**Ready? Run `vercel` now and let's get this live!** 🚀