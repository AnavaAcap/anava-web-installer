/**
 * Security Tests for Input Sanitization
 */

import {
  sanitizeString,
  sanitizeProjectId,
  sanitizeRegion,
  sanitizeUrl,
  sanitizeErrorMessage,
  validators
} from '../../lib/input-sanitizer';

describe('Input Sanitization', () => {
  describe('sanitizeString', () => {
    it('should escape HTML special characters', () => {
      const maliciousInput = '<script>alert("xss")</script>';
      const sanitized = sanitizeString(maliciousInput);
      
      expect(sanitized).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
      expect(sanitized).not.toContain('<');
      expect(sanitized).not.toContain('>');
    });

    it('should handle quotes and apostrophes', () => {
      const input = `He said "Hello" and she said 'Hi'`;
      const sanitized = sanitizeString(input);
      
      expect(sanitized).toBe('He said &quot;Hello&quot; and she said &#x27;Hi&#x27;');
    });

    it('should handle forward slashes', () => {
      const input = 'path/to/file';
      const sanitized = sanitizeString(input);
      
      expect(sanitized).toBe('path&#x2F;to&#x2F;file');
    });

    it('should trim whitespace', () => {
      const input = '  test  ';
      const sanitized = sanitizeString(input);
      
      expect(sanitized).toBe('test');
    });

    it('should handle non-string input', () => {
      expect(sanitizeString(null as any)).toBe('');
      expect(sanitizeString(undefined as any)).toBe('');
      expect(sanitizeString(123 as any)).toBe('');
    });
  });

  describe('sanitizeProjectId', () => {
    it('should allow valid GCP project ID characters', () => {
      const validId = 'test-project-123';
      const sanitized = sanitizeProjectId(validId);
      
      expect(sanitized).toBe('test-project-123');
    });

    it('should remove invalid characters', () => {
      const invalidId = 'Test_Project@123!';
      const sanitized = sanitizeProjectId(invalidId);
      
      expect(sanitized).toBe('testproject123');
    });

    it('should convert to lowercase', () => {
      const uppercaseId = 'TEST-PROJECT';
      const sanitized = sanitizeProjectId(uppercaseId);
      
      expect(sanitized).toBe('test-project');
    });

    it('should truncate to 30 characters', () => {
      const longId = 'a'.repeat(50);
      const sanitized = sanitizeProjectId(longId);
      
      expect(sanitized).toHaveLength(30);
    });

    it('should handle non-string input', () => {
      expect(sanitizeProjectId(null as any)).toBe('');
      expect(sanitizeProjectId(undefined as any)).toBe('');
      expect(sanitizeProjectId(123 as any)).toBe('');
    });
  });

  describe('sanitizeRegion', () => {
    it('should allow valid region characters', () => {
      const validRegion = 'us-central1';
      const sanitized = sanitizeRegion(validRegion);
      
      expect(sanitized).toBe('us-central1');
    });

    it('should remove invalid characters', () => {
      const invalidRegion = 'US_Central@1!';
      const sanitized = sanitizeRegion(invalidRegion);
      
      expect(sanitized).toBe('uscentral1');
    });

    it('should convert to lowercase', () => {
      const uppercaseRegion = 'US-CENTRAL1';
      const sanitized = sanitizeRegion(uppercaseRegion);
      
      expect(sanitized).toBe('us-central1');
    });

    it('should truncate to 50 characters', () => {
      const longRegion = 'a'.repeat(100);
      const sanitized = sanitizeRegion(longRegion);
      
      expect(sanitized).toHaveLength(50);
    });
  });

  describe('sanitizeUrl', () => {
    it('should allow valid HTTPS URLs', () => {
      const validUrl = 'https://example.com/path';
      const sanitized = sanitizeUrl(validUrl);
      
      expect(sanitized).toBe('https://example.com/path');
    });

    it('should reject HTTP URLs', () => {
      const httpUrl = 'http://example.com/path';
      const sanitized = sanitizeUrl(httpUrl);
      
      expect(sanitized).toBe('');
    });

    it('should reject malformed URLs', () => {
      const malformedUrl = 'not-a-url';
      const sanitized = sanitizeUrl(malformedUrl);
      
      expect(sanitized).toBe('');
    });

    it('should handle non-string input', () => {
      expect(sanitizeUrl(null as any)).toBe('');
      expect(sanitizeUrl(undefined as any)).toBe('');
      expect(sanitizeUrl(123 as any)).toBe('');
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('should sanitize string errors', () => {
      const errorString = '<script>alert("error")</script>';
      const sanitized = sanitizeErrorMessage(errorString);
      
      expect(sanitized).toBe('&lt;script&gt;alert(&quot;error&quot;)&lt;&#x2F;script&gt;');
    });

    it('should sanitize Error objects', () => {
      const error = new Error('<script>alert("error")</script>');
      const sanitized = sanitizeErrorMessage(error);
      
      expect(sanitized).toBe('&lt;script&gt;alert(&quot;error&quot;)&lt;&#x2F;script&gt;');
    });

    it('should handle unknown error types', () => {
      const unknownError = { toString: () => 'custom error' };
      const sanitized = sanitizeErrorMessage(unknownError);
      
      expect(sanitized).toBe('An unknown error occurred');
    });
  });

  describe('Validators', () => {
    describe('projectId validator', () => {
      it('should validate correct project IDs', () => {
        expect(validators.projectId('test-project-123')).toBe(true);
        expect(validators.projectId('my-project')).toBe(true);
        expect(validators.projectId('project123')).toBe(true);
      });

      it('should reject invalid project IDs', () => {
        expect(validators.projectId('test')).toBe(false); // too short
        expect(validators.projectId('a'.repeat(31))).toBe(false); // too long
        expect(validators.projectId('Test-Project')).toBe(false); // uppercase
        expect(validators.projectId('test_project')).toBe(false); // underscore
        expect(validators.projectId('test@project')).toBe(false); // special char
      });
    });

    describe('region validator', () => {
      it('should validate correct regions', () => {
        expect(validators.region('us-central1')).toBe(true);
        expect(validators.region('europe-west1')).toBe(true);
        expect(validators.region('asia-southeast1')).toBe(true);
      });

      it('should reject invalid regions', () => {
        expect(validators.region('')).toBe(false); // empty
        expect(validators.region('a'.repeat(51))).toBe(false); // too long
        expect(validators.region('US-CENTRAL1')).toBe(false); // uppercase
        expect(validators.region('us_central1')).toBe(false); // underscore
        expect(validators.region('us@central1')).toBe(false); // special char
      });
    });

    describe('email validator', () => {
      it('should validate correct emails', () => {
        expect(validators.email('test@example.com')).toBe(true);
        expect(validators.email('user.name@domain.co.uk')).toBe(true);
        expect(validators.email('user+tag@example.org')).toBe(true);
      });

      it('should reject invalid emails', () => {
        expect(validators.email('invalid-email')).toBe(false);
        expect(validators.email('@example.com')).toBe(false);
        expect(validators.email('user@')).toBe(false);
        expect(validators.email('user@domain')).toBe(false);
        expect(validators.email('')).toBe(false);
      });
    });
  });
});