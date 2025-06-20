#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get version and descriptor from command line args
const version = process.argv[2];
const descriptor = process.argv[3] || 'RELEASE';

if (!version) {
  console.error('Usage: node update-version.js <version> [descriptor]');
  console.error('Example: node update-version.js 2.2.0 ENHANCED');
  process.exit(1);
}

const versionString = `v${version}-${descriptor}`;

// Update package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

// Update UI badge in index.tsx
const indexPath = path.join(__dirname, '..', 'src', 'pages', 'index.tsx');
let indexContent = fs.readFileSync(indexPath, 'utf8');

// Replace the version badge (handle both potential formats)
indexContent = indexContent.replace(
  /<Badge colorScheme="green" ml={2}>v[\d\.]+-[A-Z]+<\/Badge>/,
  `<Badge colorScheme="green" ml={2}>${versionString}</Badge>`
).replace(
  /<Badge colorScheme="green" ml={2}>v[\d\.]+-[A-Z]+<\/Badge>/,
  `<Badge colorScheme="green" ml={2}>${versionString}</Badge>`
);

// Replace the version note (handle multiple possible formats)
indexContent = indexContent.replace(
  /NOTE: v[\d\.]+-[A-Z]+ - [^<]+/,
  `NOTE: ${versionString} - Latest version with smart resume and comprehensive security`
).replace(
  /NOTE: v[\d\.]+ - [^<]+/,
  `NOTE: ${versionString} - Latest version with smart resume and comprehensive security`
);

fs.writeFileSync(indexPath, indexContent);

// Update CLAUDE.md current version
const claudePath = path.join(__dirname, '..', 'CLAUDE.md');
let claudeContent = fs.readFileSync(claudePath, 'utf8');

claudeContent = claudeContent.replace(
  /- \*\*Current Version\*\*: v[\d\.]+-[A-Z]+/,
  `- **Current Version**: ${versionString}`
);

fs.writeFileSync(claudePath, claudeContent);

console.log(`✅ Updated version to ${versionString} in:`);
console.log(`  - package.json: ${version}`);
console.log(`  - UI badge: ${versionString}`);
console.log(`  - Version note: ${versionString}`);
console.log(`  - CLAUDE.md: ${versionString}`);