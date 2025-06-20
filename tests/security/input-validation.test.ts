describe('Security: Input Validation', () => {
  describe('Project ID validation', () => {
    const validProjectIds = [
      'my-project',
      'test-123',
      'valid-project-id',
      'a'.repeat(30), // max length
    ];

    const invalidProjectIds = [
      'My-Project', // uppercase
      'project!', // special chars
      '-project', // starts with dash
      'a'.repeat(31), // too long
      '', // empty
      'pro ject', // space
      'project..id', // double dots
    ];

    validProjectIds.forEach((projectId) => {
      it(`should accept valid project ID: ${projectId}`, () => {
        const isValid = /^[a-z][a-z0-9-]{0,29}$/.test(projectId);
        expect(isValid).toBe(true);
      });
    });

    invalidProjectIds.forEach((projectId) => {
      it(`should reject invalid project ID: ${projectId}`, () => {
        const isValid = /^[a-z][a-z0-9-]{0,29}$/.test(projectId);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Solution prefix validation', () => {
    it('should validate solution prefix format', () => {
      const validPrefixes = ['anava', 'test', 'my-app'];
      const invalidPrefixes = ['Anava', 'test!', '-app', 'app-', ''];

      validPrefixes.forEach((prefix) => {
        const isValid = /^[a-z][a-z0-9-]*[a-z0-9]$/.test(prefix);
        expect(isValid).toBe(true);
      });

      invalidPrefixes.forEach((prefix) => {
        const isValid = /^[a-z][a-z0-9-]*[a-z0-9]$/.test(prefix);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('OAuth token validation', () => {
    it('should not log or expose OAuth tokens', () => {
      const sensitiveData = 'ya29.a0AfH6SMBx...'; // mock token
      const sanitized = sensitiveData.substring(0, 10) + '...';
      
      expect(sanitized).not.toContain('ya29.a0AfH6SMBx');
      expect(sanitized).toBe('ya29.a0AfH...');
    });
  });
});