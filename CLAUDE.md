# Project Context for Claude

## Quick Reference
- **Current Version**: v2.1.2-SECURITY
- **Domains**: installer.anava.ai (prod), dev.anava.ai (staging)
- **Key Fix**: Extended API Gateway timeout from 2min to 10min

## Version Updates
When updating versions:
- Update both the UI badge and package.json
- Use format: vX.Y.Z-DESCRIPTOR (e.g., v2.1.0-RESILIENT)
- Add a NOTE explaining what changed

## Deployment Checklist
After any deployment:
1. Run `vercel env ls` to verify environment variables
2. Check `vercel ls` for deployment status
3. Test OAuth flow immediately
4. Verify both domains are working

## Common Issues & Solutions

### OAuth "invalid_client" Error
1. Check you're on the right Vercel project (anava-web-installer, NOT web-installer)
2. Verify NEXT_PUBLIC_GOOGLE_CLIENT_ID is set in Vercel env vars
3. Ensure OAuth client has correct domains authorized
4. Redeploy after adding env vars

### GCP Timeouts
- API Gateway can take 10+ minutes to activate
- Always implement progress updates showing elapsed time and retry attempts
- Continue with warnings instead of failing hard

## Key Commands
```bash
# Check deployment status
vercel ls

# Verify environment variables
vercel env ls

# Trigger deployment
git push origin main

# Check domains
vercel alias ls
```