# Project Context for Claude

## Quick Reference
- **Current Version**: v2.1.2-SECURITY (Enterprise-ready, zero security vulnerabilities)
- **Domains**: installer.anava.ai (prod), dev.anava.ai (staging)
- **Architecture**: Secure web installer for Anava IoT Security Platform on GCP
- **Key Achievement**: Complete security overhaul with 76+ security tests

## Critical Security Architecture (DO NOT BREAK)
⚠️ **SECURITY-FIRST DESIGN** - All changes must maintain security standards:

### Token Management
- **NEVER use localStorage for OAuth tokens** - XSS vulnerability
- Use `SecureTokenManager` class (in-memory storage with tokenId references)
- Use `SecureApiClient` for all authenticated API calls
- Tokens auto-clear on component unmount

### Input Sanitization
- ALL user inputs go through `src/lib/input-sanitizer.ts`
- Use `sanitizeProjectId()`, `sanitizeRegion()`, `sanitizeErrorMessage()`
- HTML entity escaping prevents XSS attacks

### Key Security Modules
- `src/lib/secure-token-manager.ts` - OAuth token security
- `src/lib/input-sanitizer.ts` - XSS prevention
- `src/components/ErrorBoundary.tsx` - Safe error handling
- `next.config.js` - CSP headers configuration

## Testing & Quality
```bash
# Run all tests (unit, integration, security)
npm test

# Type checking
npm run type-check

# Build verification
npm run build
```
- **76+ security tests** covering all attack vectors
- Tests MUST pass before any deployment
- Security tests validate token handling, input sanitization, CSP headers

## Smart Resume Feature
- Installation state persists in localStorage (encrypted with XOR)
- Automatic detection of incomplete installations
- Resume from any step with progress tracking
- State expires after 24 hours

## Version Management
When updating versions:
- Update `src/pages/index.tsx` Badge component AND `package.json`
- Format: `vX.Y.Z-DESCRIPTOR` (e.g., v2.1.2-SECURITY)
- Add NOTE explaining changes in UI

## Development Planning
- **ROADMAP.md**: 4-phase evolution plan through v2.5.0-ADVANCED
- **REFLECTION.md**: Security sprint lessons learned
- Next phase: v2.2.0-RESILIENT (orchestration service, rollback capability)

## Deployment Checklist
After any deployment:
1. `vercel env ls` - verify NEXT_PUBLIC_GOOGLE_CLIENT_ID
2. `vercel ls` - check deployment status
3. Test OAuth flow end-to-end
4. Verify installer.anava.ai works
5. Check for console errors (no token logging!)

## Common Issues & Solutions

### OAuth "invalid_client" Error
1. Wrong Vercel project (use anava-web-installer, NOT web-installer)
2. Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID in Vercel env vars
3. OAuth client domains not authorized for installer.anava.ai
4. Redeploy after env var changes

### GCP API Gateway Issues
- Takes 10+ minutes to activate after creation
- Show progress with elapsed time and retry attempts
- Continue with warnings, don't fail hard
- Implement retry logic for API key generation

### Git Workflow Notes
- Security fixes may need manual merge verification
- Check that security code actually reaches main branch
- Test security features after any merge

## Key Commands
```bash
# Deployment
vercel ls && vercel env ls
git push origin main

# Development
npm test && npm run type-check && npm run build

# Security validation
npm test -- --testPathPattern=security
```