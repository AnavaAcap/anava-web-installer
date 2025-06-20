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

## Task Management & Planning
**ALWAYS use TodoWrite/TodoRead for complex tasks:**
- Use TodoWrite tool for complex multi-step tasks (3+ steps or non-trivial work)
- Mark todos as in_progress before starting work, completed immediately after finishing
- Only have ONE task in_progress at any time
- Use for user-provided task lists, complex features, or systematic comparisons
- Skip for single straightforward tasks or trivial operations
- Critical for planning and tracking progress visibility

## Systematic Analysis & Comparison Methodology
**When comparing implementations (e.g., bash script vs TypeScript):**
1. Use Task tool to search and catalog all components systematically
2. Create comprehensive lists (APIs, permissions, configurations)
3. Use mcp__multi-ai-collab__gemini_code_review for thorough analysis
4. Document gaps with specific line numbers and missing elements
5. Implement fixes with version-aware migration logic
6. Update tests to validate all new components

## Multi-AI Collaboration Tools
**Leverage collaboration tools for complex analysis:**
- `mcp__multi-ai-collab__gemini_code_review` - Code review and gap analysis
- `mcp__multi-ai-collab__gemini_think_deep` - Deep technical analysis
- `mcp__multi-ai-collab__gemini_architecture` - System design decisions
- `mcp__multi-ai-collab__gemini_debug` - Complex debugging scenarios
- Use when dealing with large codebases or systematic comparisons

## Version Management & Migration Logic
When updating versions:
- Update `src/pages/index.tsx` Badge component AND `package.json`
- Format: `vX.Y.Z-DESCRIPTOR` (e.g., v2.1.2-SECURITY)
- Add NOTE explaining changes in UI

**CRITICAL: Handle Existing User Migrations**
- Add version tracking to installation state for backward compatibility
- Force re-run of critical steps when infrastructure changes (APIs, permissions)
- Use version-based step invalidation to ensure users get fixes
- Test migration logic thoroughly before deployment
- Document breaking changes and migration paths

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
- **CRITICAL**: Enable managed service after API Gateway creation (prevents auth errors)

### Build & Deployment Issues
**Common build failures and solutions:**
- ESLint errors: Temporarily disable with `eslint: { ignoreDuringBuilds: true }` in next.config.js
- Type errors: Fix immediately or deployment will fail
- Test timeouts: Check for infinite loops or missing mocks
- Vercel deployment status: Use `vercel ls` to check deployment state
- Always test build locally before pushing: `npm run build`

### Infrastructure Changes Protocol  
**When modifying core infrastructure (APIs, permissions, gateway config):**
1. Identify all affected components systematically (use comparison methodology)
2. Implement version-based migration logic for existing users
3. Add comprehensive tests covering new infrastructure
4. Force re-run critical steps for pre-existing installations
5. Test end-to-end including authentication flows
6. Monitor logs after deployment for authentication errors

### Git Workflow Notes
- Security fixes may need manual merge verification
- Check that security code actually reaches main branch
- Test security features after any merge
- Use descriptive commit messages with 🤖 Generated with Claude Code footer

## Enhanced Tool Usage Policy
**Optimize tool usage for performance and accuracy:**
- Use Task tool for broad searches and unknown file locations
- Use Glob/Grep for specific patterns when you know the scope
- Batch multiple tool calls in single responses for performance
- Use Read tool for specific file paths you know exist
- Prefer Task tool for complex systematic searches (APIs, permissions, configurations)
- Use mcp__multi-ai-collab tools for thorough analysis and review

## Key Commands
```bash
# Deployment verification
vercel ls && vercel env ls
git push origin main

# Pre-deployment validation
npm test && npm run type-check && npm run build

# Security validation
npm test -- --testPathPattern=security

# Infrastructure testing (after API/permission changes)
npm test -- --testPathPattern=gcp-installer
npm test -- --testPathPattern=installation-state

# Version migration testing
npm test -- --testNamePattern="v2.1.2.*re-run"

# Build troubleshooting
npm run build --verbose
vercel logs [deployment-url]
```