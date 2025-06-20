# Version Management

## Automatic Version Updates

The CI/CD pipeline includes automated version management that updates the UI version badge and related files.

### How It Works

1. **Manual Version Updates**: Use GitHub Actions workflow dispatch
2. **Automatic Patch Updates**: Triggered after successful main branch deployments
3. **Multi-file Updates**: Updates package.json, UI badge, and documentation

### Manual Version Update

Use the GitHub Actions "Version Update" workflow:

1. Go to Actions tab in GitHub
2. Select "Version Update" workflow
3. Click "Run workflow"
4. Choose version type (patch/minor/major)
5. Enter optional descriptor (e.g., "SECURITY", "FEATURE", "ENHANCED")

### Version Components

- **Version Number**: Semantic versioning (e.g., 2.1.0)
- **Descriptor**: Functional label (e.g., RESILIENT, SECURITY, ENHANCED)
- **Format**: `v{version}-{descriptor}` (e.g., v2.1.0-RESILIENT)

### Automated Updates Include

- `package.json` version field
- UI badge in `src/pages/index.tsx`
- Version note in UI
- Current version in `CLAUDE.md`

### NPM Scripts

```bash
# Update to specific version and descriptor
npm run version:update 2.2.0 SECURITY

# Bump patch version (2.1.0 → 2.1.1)
npm run version:patch

# Bump minor version (2.1.0 → 2.2.0)
npm run version:minor  

# Bump major version (2.1.0 → 3.0.0)
npm run version:major
```

### Release Creation

- **Minor/Major** version updates automatically create GitHub releases
- **Patch** updates only update version numbers
- Releases include deployment links and changelog

### Current Version Display

The version is displayed in:
- UI header badge
- Build-time environment variables
- Git SHA and build timestamp available via `process.env`

### Environment Variables

- `NEXT_PUBLIC_APP_VERSION`: Package.json version
- `NEXT_PUBLIC_BUILD_TIME`: Build timestamp
- `NEXT_PUBLIC_GIT_SHA`: Git commit SHA