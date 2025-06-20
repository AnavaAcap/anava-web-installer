# Anava Web Installer

A secure, one-click web installer for deploying the Anava IoT Security Platform on Google Cloud Platform (GCP).

## Overview

This standalone web application provides a user-friendly interface for installing and configuring all necessary GCP infrastructure components for the Anava platform, including:

- Vertex AI integration
- Cloud Functions for device authentication
- Token Vending Machine (TVM) for secure credential management
- API Gateway for secure endpoints
- Firebase integration for authentication and real-time data
- Workload Identity Federation for secure service-to-service communication

## Features

- **OAuth Authentication**: Secure Google OAuth integration for GCP access
- **One-Click Installation**: Automated setup of all required GCP services
- **Real-Time Progress Tracking**: Visual feedback during installation
- **Error Recovery**: Robust error handling with detailed diagnostics
- **Security First**: Implements least-privilege IAM policies and secure token management

## Prerequisites

- A Google Cloud Platform account with billing enabled
- A GCP project with Owner or Editor permissions
- Node.js 20+ and npm installed locally (for development)

## Quick Start

### Production Deployment

The installer is available at: [https://install.anava.ai](https://install.anava.ai)

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/anava-web-installer.git
   cd anava-web-installer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your Google OAuth client ID
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Architecture

The installer creates the following GCP resources:

### Service Accounts
- **Vertex AI SA**: Main service account for AI operations
- **Device Auth SA**: Handles device authentication via Firebase
- **TVM SA**: Token Vending Machine for secure credential distribution
- **API Gateway Invoker SA**: Service account for API Gateway operations

### IAM Roles
The installer configures precise IAM roles including:
- `roles/aiplatform.user` for Vertex AI operations
- `roles/iam.serviceAccountTokenCreator` for token generation
- `roles/firebaseauth.admin` for Firebase authentication
- `roles/iam.workloadIdentityUser` for federated authentication

### Cloud Functions
- **Device Authenticator**: Private function for device authentication
- **Token Vending Machine**: Secure token distribution for devices

### API Gateway
- Secure public endpoint for device communication
- OpenAPI specification with proper authentication

## Security

This installer implements multiple security layers:

1. **OAuth Authentication**: All operations require valid Google OAuth credentials
2. **Least Privilege IAM**: Each service account has minimal required permissions
3. **Workload Identity Federation**: Secure service-to-service authentication
4. **Private Cloud Functions**: Functions are not publicly accessible
5. **API Key Restrictions**: Generated API keys are restricted to specific origins

## Deployment

### Staging Deployment

Pushes to the `develop` branch automatically deploy to staging:
```bash
git push origin develop
```

### Production Deployment

Pushes to the `main` branch automatically deploy to production:
```bash
git push origin main
```

### Manual Deployment

Using Vercel CLI:
```bash
vercel --prod
```

## Testing

Run the test suite:
```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Security audit
npm run test:security
```

## CI/CD

The project uses GitHub Actions for continuous integration and deployment:

- **CI Pipeline**: Runs on all PRs (lint, type check, tests, security scan)
- **Staging Deploy**: Automatic deployment on push to `develop`
- **Production Deploy**: Automatic deployment on push to `main`
- **Security Scans**: Weekly automated security scanning

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Common Issues

1. **Billing Not Enabled**: Ensure your GCP project has billing enabled
2. **Insufficient Permissions**: Verify you have Owner/Editor role on the project
3. **API Enablement Failures**: Some APIs may take time to propagate
4. **OAuth Errors**: Ensure your OAuth client ID is correctly configured

### Debug Mode

Enable debug mode for detailed logging:
```bash
NEXT_PUBLIC_ENABLE_DEBUG=true npm run dev
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/yourusername/anava-web-installer/issues) page.

For security vulnerabilities, please email security@anava.ai directly.# Test deployment
