# Deployment Instructions for Anava Web Installer

## Prerequisites
- Vercel account
- GitHub repository connected to Vercel
- Google Cloud Console access for OAuth setup

## Deployment Steps

### 1. Deploy to Vercel via GitHub Integration

1. Go to [vercel.com](https://vercel.com) and log in
2. Click "New Project"
3. Import your GitHub repository
4. Select the `web-installer` directory as the root directory
5. Framework preset should auto-detect as Next.js
6. Add the following environment variable:
   ```
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-oauth-client-id-here
   ```
7. Click "Deploy"

### 2. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to APIs & Services → Credentials
3. Create or update your OAuth 2.0 Client ID with these settings:
   - Application type: Web application
   - Authorized JavaScript origins:
     - `https://your-project.vercel.app`
     - `https://web-installer-stable.vercel.app` (if using custom domain)
   - Authorized redirect URIs:
     - `https://your-project.vercel.app`
     - `https://web-installer-stable.vercel.app` (if using custom domain)

### 3. Set Up Custom Domain (Optional but Recommended)

To avoid constant OAuth reconfiguration:

1. In Vercel project settings, go to Domains
2. Add a custom domain like `install.anava.ai`
3. Update OAuth redirect URIs to include your custom domain
4. This provides a stable URL regardless of deployment changes

### 4. Update Environment Variables

1. In Vercel project settings, go to Environment Variables
2. Update `NEXT_PUBLIC_GOOGLE_CLIENT_ID` with your OAuth client ID
3. Redeploy to apply changes

## Testing

1. Visit your deployment URL
2. Click "Connect Google Cloud Account"
3. Authorize the application
4. Select your GCP project
5. Run the installation

## Troubleshooting

### OAuth Errors
- Ensure redirect URIs match exactly (including trailing slashes)
- Check that the OAuth client ID is correctly set in Vercel
- Verify the application is using the correct OAuth scopes

### Deployment Issues
- Check Vercel build logs for errors
- Ensure `next.config.js` has `output: 'export'` for static export
- Verify all dependencies are listed in `package.json`

### API Errors During Installation
- Ensure the Google account has necessary permissions in the GCP project
- Check that all required APIs are enabled
- Review browser console for detailed error messages

## Development

For local development:
```bash
cd web-installer
npm install
npm run dev
```

For production build:
```bash
npm run build
npm start
```

## Important Notes

1. The installer creates placeholder URLs for Cloud Functions and API Gateway since these require manual deployment
2. The Firebase Web API Key is retrieved automatically via API when possible
3. API Key generation may fail due to permissions - manual creation may be required
4. All 4 environment variables must be configured on the Axis cameras for proper operation