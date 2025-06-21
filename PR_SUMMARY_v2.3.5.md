# v2.3.5 Critical Fixes Summary

## Overview
This release resolves all critical API key generation issues and implements a persistent retry strategy for API Gateway operations.

## Key Fixes

### 1. Service Management API Format Fix
- **Issue**: "Unknown name 'openapi' at 'service_config'" error
- **Root Cause**: Retry flow was using incorrect format `{ openapi: spec }` instead of proper Service Management API format
- **Fix**: Corrected to use `{ configSource: { files: [...] } }` format
- **Impact**: API key generation now works reliably in retry scenarios

### 2. Persistent Retry Strategy  
- **Issue**: API key creation timing out after 5 minutes
- **Root Cause**: Conservative timeout values and lack of persistence
- **Fix**: Increased timeout to 25 minutes matching gcloud CLI behavior
- **Philosophy**: "Keep trying until there's an error that kills it"
- **Impact**: No more manual intervention required for API key creation

### 3. 409 ALREADY_EXISTS Handling
- **Issue**: Unnecessary retries for existing workload identity resources
- **Fix**: Treat 409 errors as success conditions
- **Impact**: Faster installation for existing projects

### 4. Cloud Billing API Timing
- **Issue**: 403 errors when checking billing status
- **Fix**: Enable Cloud Billing API before use with proper retry logic
- **Impact**: Smooth billing verification for Firebase Blaze projects

### 5. Unicode Encoding Fix
- **Issue**: "characters outside of Latin1 range" error
- **Fix**: Use Unicode-safe base64 encoding: `btoa(unescape(encodeURIComponent()))`
- **Impact**: Proper handling of emojis and special characters

### 6. Prerequisites Display Fix
- **Issue**: Empty prerequisites steps due to base64 decoding failure
- **Fix**: Bypass HTML sanitization for prerequisites, use `atob` instead of `Buffer.from`
- **Impact**: Clear manual setup instructions when needed

### 7. Firebase Web API Key Loading
- **Issue**: "NOT RETRIEVED" showing for Firebase Web API Key
- **Fix**: Load from saved state: `savedResources.firebaseApp.appId`
- **Impact**: Proper display of Firebase API key on resume

## Testing
All fixes have been tested in production on installer.anava.ai and are working correctly.

## Version
- Package version: 2.3.5
- UI Badge: v2.3.5-SERVICE-CONFIG-FIX

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>