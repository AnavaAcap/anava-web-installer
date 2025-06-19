# Anava Cloud Installer

A revolutionary web-based installer for the Anava IoT Security Platform on Google Cloud. No command line, no VMs, just click and install!

## Features

- **Zero Local Setup**: Runs entirely in the browser
- **OAuth Authentication**: Secure Google Cloud authentication
- **One-Click Deploy**: Complete infrastructure setup in minutes
- **Real-time Progress**: Visual feedback during installation
- **Professional UI**: Modern, responsive interface

## What It Installs

- ✅ 4 Service Accounts with proper IAM roles
- ✅ 2 Cloud Functions (Device Auth & Token Vending Machine)
- ✅ Workload Identity Federation setup
- ✅ API Gateway with OpenAPI specification
- ✅ Firestore database
- ✅ All required GCP APIs enabled
- ✅ API keys generated and configured

## Quick Start

### Option 1: Use Our Hosted Version
Visit: https://install.anava.ai (coming soon)

### Option 2: Deploy Your Own

1. **Setup Google OAuth**
   ```bash
   # Go to Google Cloud Console
   # APIs & Services > Credentials > Create Credentials > OAuth client ID
   # Application type: Web application
   # Authorized JavaScript origins: https://your-domain.vercel.app
   # Authorized redirect URIs: https://your-domain.vercel.app
   ```

2. **Deploy to Vercel (Recommended)**
   ```bash
   # Install dependencies
   npm install

   # Set environment variable
   export NEXT_PUBLIC_GOOGLE_CLIENT_ID="your-oauth-client-id"

   # Deploy
   npx vercel --prod
   ```

3. **Deploy to Netlify**
   ```bash
   # Build the static site
   npm run build

   # Deploy the 'out' directory to Netlify
   ```

## Development

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your Google OAuth client ID

# Run development server
npm run dev

# Build for production
npm run build
```

## Architecture

This installer uses:
- **Next.js** with static export for hosting anywhere
- **Google OAuth** for secure authentication
- **GCP REST APIs** for resource provisioning
- **Chakra UI** for professional interface
- **React Hooks** for state management

## Security

- No credentials stored locally
- OAuth tokens are short-lived
- All API calls use HTTPS
- Implements PKCE flow for enhanced security

## Comparison with Shell Script

| Feature | Shell Script | Web Installer |
|---------|--------------|---------------|
| Setup Required | VM + gcloud CLI | Just a browser |
| Time to Start | 30+ minutes | < 1 minute |
| User Experience | Terminal commands | Modern UI |
| Error Handling | Script output | Clear messages |
| Progress Tracking | Text logs | Visual progress |
| Accessibility | Linux knowledge needed | Anyone can use |

## Next Steps

After installation completes:

1. Copy the provided configuration to your IoT devices
2. Or run the setup command on each camera
3. Monitor your devices in the Google Cloud Console

## Roadmap

- [ ] Add support for custom Firebase projects
- [ ] Multi-region deployment options
- [ ] Terraform export for repeatability
- [ ] Batch device provisioning
- [ ] Cost estimation before deployment

## License

MIT