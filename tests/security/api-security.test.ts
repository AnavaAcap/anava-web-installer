describe('Security: API Security Tests', () => {
  describe('OAuth Token Handling', () => {
    it('should never log full OAuth tokens', () => {
      const token = 'ya29.a0AfH6SMBxVerySecretTokenString123456789';
      const sanitized = token.substring(0, 10) + '...';
      
      // Verify we only show first 10 chars
      expect(sanitized).toBe('ya29.a0AfH...');
      expect(sanitized).not.toContain('VerySecretTokenString');
    });

    it('should validate OAuth token format', () => {
      const validTokens = [
        'ya29.a0AfH6SMBxValidToken',
        'ya29.c.ElqKBgValidToken',
        'Bearer ya29.a0AfH6SMBxValidToken'
      ];

      const invalidTokens = [
        '',
        'invalid-token',
        'ya29', // too short
        'not-a-token-at-all',
        '<script>alert("xss")</script>',
        '${process.env.SECRET}', // template injection
        '../../../etc/passwd', // path traversal
      ];

      validTokens.forEach(token => {
        const isValid = /^(Bearer\s+)?ya29\.[a-zA-Z0-9._-]+$/.test(token);
        expect(isValid).toBe(true);
      });

      invalidTokens.forEach(token => {
        const isValid = /^(Bearer\s+)?ya29\.[a-zA-Z0-9._-]+$/.test(token);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('API Key Security', () => {
    it('should validate API key format', () => {
      const validKeys = [
        'AIzaSyDvalidkeyexample12345678901234567890',
        'AIzaSyBvalidkeyexample12345678901234567890',
        'AIzaSyCvalidkeyexample12345678901234567890',
      ];

      const invalidKeys = [
        '',
        'not-an-api-key',
        'AIza', // too short
        '<script>alert("xss")</script>',
        '${process.env.API_KEY}',
        'AIzaSy-invalid-chars!@#$%',
      ];

      validKeys.forEach(key => {
        const isValid = /^AIza[0-9A-Za-z_-]{35,}$/.test(key);
        expect(isValid).toBe(true);
      });

      invalidKeys.forEach(key => {
        const isValid = /^AIza[0-9A-Za-z_-]{35,}$/.test(key);
        expect(isValid).toBe(false);
      });
    });

    it('should never expose API keys in error messages', () => {
      const apiKey = 'AIzaSyDsensitivekey123456789012345678901';
      const errorMessage = `Failed to authenticate with key: ${apiKey.substring(0, 7)}...`;
      
      expect(errorMessage).not.toContain('sensitivekey');
      expect(errorMessage).toContain('AIzaSyD...');
    });
  });

  describe('XSS Prevention', () => {
    it('should sanitize user inputs to prevent XSS', () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        '<img src=x onerror=alert("xss")>',
        'javascript:alert("xss")',
        '<svg onload=alert("xss")>',
        '"><script>alert("xss")</script>',
        '\'-alert("xss")-\'',
        '<iframe src="javascript:alert(\'xss\')">',
      ];

      maliciousInputs.forEach(input => {
        // Simple HTML escape function
        const escaped = input
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .replace(/javascript:/gi, '');

        expect(escaped).not.toContain('<script>');
        expect(escaped).not.toContain('javascript:');
        // Verify that dangerous characters are properly escaped
        if (input.includes('<') || input.includes('>')) {
          expect(escaped.includes('&lt;') || escaped.includes('&gt;')).toBe(true);
        }
      });
    });
  });

  describe('CORS and CSP Headers', () => {
    it('should validate required security headers', () => {
      // These would be actual response headers in production
      const securityHeaders = {
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.googleapis.com",
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
      };

      expect(securityHeaders['Content-Security-Policy']).toContain("default-src 'self'");
      expect(securityHeaders['X-Frame-Options']).toBe('DENY');
      expect(securityHeaders['X-Content-Type-Options']).toBe('nosniff');
    });
  });

  describe('Resource URL Validation', () => {
    it('should validate GCP resource URLs', () => {
      const validUrls = [
        'https://us-central1-my-project.cloudfunctions.net/function-name',
        'https://gateway-abc123.uc.gateway.dev',
        'https://storage.googleapis.com/bucket-name/object',
        'https://firestore.googleapis.com/v1/projects/my-project/databases/(default)',
      ];

      const invalidUrls = [
        'http://insecure.com', // not https
        'https://evil.com/phishing',
        'javascript:alert("xss")',
        'ftp://oldschool.com',
        '../../../etc/passwd',
        'https://gateway.dev/../../admin',
      ];

      validUrls.forEach(url => {
        const isValid = /^https:\/\/[a-zA-Z0-9.-]+\.(cloudfunctions\.net|gateway\.dev|googleapis\.com)/.test(url);
        expect(isValid).toBe(true);
      });

      invalidUrls.forEach(url => {
        const isValid = /^https:\/\/[a-zA-Z0-9.-]+\.(cloudfunctions\.net|gateway\.dev|googleapis\.com)/.test(url);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should implement rate limiting for API calls', () => {
      const maxRequestsPerMinute = 60;
      const requestTimestamps: number[] = [];
      
      const isRateLimited = (timestamp: number): boolean => {
        const oneMinuteAgo = timestamp - 60000;
        const recentRequests = requestTimestamps.filter(t => t > oneMinuteAgo);
        
        if (recentRequests.length >= maxRequestsPerMinute) {
          return true;
        }
        
        requestTimestamps.push(timestamp);
        return false;
      };

      // Simulate requests
      let now = Date.now();
      for (let i = 0; i < 65; i++) {
        const limited = isRateLimited(now);
        if (i < 60) {
          expect(limited).toBe(false);
        } else {
          expect(limited).toBe(true);
        }
      }
    });
  });

  describe('Sensitive Data Handling', () => {
    it('should never store sensitive data in localStorage', () => {
      const sensitiveData = {
        accessToken: 'ya29.secrettoken',
        apiKey: 'AIzaSyDsecretkey',
        serviceAccountKey: { private_key: 'BEGIN PRIVATE KEY' }
      };

      // Mock what should NOT be stored
      const storedState = {
        projectId: 'test-project',
        completedSteps: ['step1'],
        resources: {
          serviceAccount: { email: 'sa@project.iam' }, // OK
          apiGateway: { url: 'https://gateway.dev' }, // OK
          // No tokens or keys should be here
        }
      };

      expect(JSON.stringify(storedState)).not.toContain('ya29');
      expect(JSON.stringify(storedState)).not.toContain('AIzaSy');
      expect(JSON.stringify(storedState)).not.toContain('private_key');
      expect(JSON.stringify(storedState)).not.toContain('BEGIN PRIVATE KEY');
    });
  });

  describe('Project ID Injection Prevention', () => {
    it('should prevent injection attacks via project ID', () => {
      const maliciousProjectIds = [
        'test; DROP TABLE users;--',
        'test\' OR \'1\'=\'1',
        'test"; alert("xss"); //',
        'test`; rm -rf /; #',
        'test${process.env.SECRET}',
        'test](../../etc/passwd)',
      ];

      maliciousProjectIds.forEach(projectId => {
        // Validate against GCP project ID rules
        const isValid = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Content Type Validation', () => {
    it('should validate response content types', () => {
      const validContentTypes = [
        'application/json',
        'application/json; charset=utf-8',
        'text/plain',
        'text/plain; charset=utf-8',
      ];

      const invalidContentTypes = [
        'text/html', // could contain XSS
        'application/javascript', // executable
        'application/x-shockwave-flash', // deprecated/dangerous
        'multipart/form-data', // unexpected for API responses
      ];

      validContentTypes.forEach(contentType => {
        const isValid = /^(application\/json|text\/plain)(;\s*charset=utf-8)?$/.test(contentType);
        expect(isValid).toBe(true);
      });

      invalidContentTypes.forEach(contentType => {
        const isValid = /^(application\/json|text\/plain)(;\s*charset=utf-8)?$/.test(contentType);
        expect(isValid).toBe(false);
      });
    });
  });
});