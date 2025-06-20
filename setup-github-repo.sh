#!/bin/bash

# GitHub Repository Setup Script
echo "🚀 Setting up GitHub repository for Anava Web Installer"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Please install it first:"
    echo "   brew install gh (macOS)"
    echo "   https://cli.github.com/manual/installation (other platforms)"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub. Running 'gh auth login'..."
    gh auth login
fi

# Repository configuration
read -p "Enter the GitHub organization or username (default: AnavaAcap): " GITHUB_OWNER
GITHUB_OWNER=${GITHUB_OWNER:-AnavaAcap}

read -p "Create repository as public or private? (public/private, default: public): " REPO_VISIBILITY
REPO_VISIBILITY=${REPO_VISIBILITY:-public}

echo ""
echo "📋 Repository Configuration:"
echo "   Owner: $GITHUB_OWNER"
echo "   Name: anava-web-installer"
echo "   Visibility: $REPO_VISIBILITY"
echo ""

read -p "Continue with repository creation? (y/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Repository creation cancelled"
    exit 1
fi

# Create the repository
echo "Creating repository..."
gh repo create "$GITHUB_OWNER/anava-web-installer" \
  --$REPO_VISIBILITY \
  --description "Secure web installer for Anava IoT Security Platform on Google Cloud" \
  --clone=false

# Set up git remote
echo "Setting up git remote..."
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$GITHUB_OWNER/anava-web-installer.git"

# Create initial branches
echo "Creating branches..."
git branch -M main
git checkout -b develop

# Initial commit
echo "Creating initial commit..."
git add -A
git commit -m "Initial commit: Standalone Anava Web Installer

- Extracted from batonDescribe monorepo
- Added IAM permission fixes for TVM endpoint
- Set up independent CI/CD pipeline
- Added comprehensive test framework
- Configured staging and production deployments"

# Push branches
echo "Pushing to GitHub..."
git push -u origin main
git push -u origin develop

# Set up branch protection
echo "Setting up branch protection rules..."
gh api repos/$GITHUB_OWNER/anava-web-installer/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["lint-and-typecheck","security-scan","test","build"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"dismiss_stale_reviews":true,"require_code_owner_reviews":true,"required_approving_review_count":1}' \
  --field restrictions=null \
  --silent || echo "Note: Branch protection may require admin permissions"

# Create initial issues
echo "Creating initial GitHub issues..."

gh issue create \
  --title "Set up Vercel deployment secrets" \
  --body "Configure the following secrets in GitHub repository settings:
- VERCEL_TOKEN
- VERCEL_ORG_ID  
- VERCEL_PROJECT_ID
- STAGING_GOOGLE_CLIENT_ID
- PRODUCTION_GOOGLE_CLIENT_ID
- STAGING_API_ENDPOINT
- PRODUCTION_API_ENDPOINT
- SNYK_TOKEN (for security scanning)" \
  --label "setup,infrastructure"

gh issue create \
  --title "Configure Vercel project" \
  --body "1. Import project to Vercel
2. Configure environment variables
3. Set up custom domains:
   - Production: install.anava.ai
   - Staging: install-staging.anava.ai
4. Update GitHub secrets with Vercel project details" \
  --label "setup,deployment"

gh issue create \
  --title "Complete test coverage" \
  --body "Add comprehensive tests for:
- [ ] GCP installer logic
- [ ] OAuth flow
- [ ] Error handling
- [ ] Security validations
- [ ] Integration tests with mock GCP APIs" \
  --label "testing"

echo ""
echo "✅ GitHub repository setup complete!"
echo ""
echo "Repository URL: https://github.com/$GITHUB_OWNER/anava-web-installer"
echo ""
echo "Next steps:"
echo "1. Review and configure the GitHub issues created"
echo "2. Set up Vercel deployment"
echo "3. Configure repository secrets"
echo "4. Update README with correct repository URLs"
echo ""
echo "Current branch: develop"
echo "Ready for development! 🎉"