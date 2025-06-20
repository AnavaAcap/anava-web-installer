/**
 * Security Tests for Secure Storage
 */

import { SecureStorage, sanitizeForStorage } from '../../lib/secure-storage';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    keys: () => Object.keys(store)
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('SecureStorage', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve data', () => {
      const testData = { message: 'hello world', number: 42 };
      
      SecureStorage.setItem('test-key', testData);
      const retrieved = SecureStorage.getItem('test-key');
      
      expect(retrieved).toEqual(testData);
    });

    it('should return null for non-existent keys', () => {
      const result = SecureStorage.getItem('non-existent');
      expect(result).toBeNull();
    });

    it('should remove items correctly', () => {
      const testData = { test: 'data' };
      
      SecureStorage.setItem('test-key', testData);
      expect(SecureStorage.getItem('test-key')).toEqual(testData);
      
      SecureStorage.removeItem('test-key');
      expect(SecureStorage.getItem('test-key')).toBeNull();
    });

    it('should validate item existence', () => {
      const testData = { test: 'data' };
      
      expect(SecureStorage.hasValidItem('test-key')).toBe(false);
      
      SecureStorage.setItem('test-key', testData);
      expect(SecureStorage.hasValidItem('test-key')).toBe(true);
      
      SecureStorage.removeItem('test-key');
      expect(SecureStorage.hasValidItem('test-key')).toBe(false);
    });
  });

  describe('Encryption', () => {
    it('should store data in encrypted form', () => {
      const sensitiveData = { password: 'secret123', token: 'abc123' };
      
      SecureStorage.setItem('sensitive-key', sensitiveData);
      
      // Check that the raw localStorage doesn't contain plaintext
      const rawStored = localStorageMock.getItem('sensitive-key');
      expect(rawStored).toBeDefined();
      expect(rawStored).not.toContain('secret123');
      expect(rawStored).not.toContain('abc123');
      expect(rawStored).not.toContain('password');
      expect(rawStored).not.toContain('token');
    });

    it('should decrypt data correctly', () => {
      const originalData = { message: 'encrypted message', id: 12345 };
      
      SecureStorage.setItem('encrypted-key', originalData);
      const decrypted = SecureStorage.getItem('encrypted-key');
      
      expect(decrypted).toEqual(originalData);
    });

    it('should handle corrupted encrypted data gracefully', () => {
      // Manually set corrupted data in localStorage
      localStorageMock.setItem('corrupted-key', 'invalid-base64-#@!');
      
      const result = SecureStorage.getItem('corrupted-key');
      expect(result).toBeNull();
    });
  });

  describe('Prefix Operations', () => {
    it('should clear items with specific prefix', () => {
      SecureStorage.setItem('prefix-item1', { data: 'test1' });
      SecureStorage.setItem('prefix-item2', { data: 'test2' });
      SecureStorage.setItem('other-item', { data: 'test3' });
      
      expect(SecureStorage.hasValidItem('prefix-item1')).toBe(true);
      expect(SecureStorage.hasValidItem('prefix-item2')).toBe(true);
      expect(SecureStorage.hasValidItem('other-item')).toBe(true);
      
      SecureStorage.clearPrefix('prefix-');
      
      expect(SecureStorage.hasValidItem('prefix-item1')).toBe(false);
      expect(SecureStorage.hasValidItem('prefix-item2')).toBe(false);
      expect(SecureStorage.hasValidItem('other-item')).toBe(true);
      
      // Verify removeItem was called for prefix items
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('prefix-item1');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('prefix-item2');
    });
  });

  describe('Error Handling', () => {
    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw errors
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw, but handle gracefully
      expect(() => {
        SecureStorage.setItem('test-key', { data: 'test' });
      }).not.toThrow();
    });

    it('should handle retrieval errors gracefully', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('Storage access denied');
      });

      const result = SecureStorage.getItem('test-key');
      expect(result).toBeNull();
    });
  });
});

describe('sanitizeForStorage', () => {
  it('should sanitize sensitive fields', () => {
    const sensitiveData = {
      username: 'testuser',
      password: 'secret123',
      apiKey: 'sk-1234567890',
      token: 'ya29.access-token',
      normalField: 'normal-value',
      nested: {
        secret: 'nested-secret',
        normalNested: 'normal-nested'
      }
    };

    const sanitized = sanitizeForStorage(sensitiveData);

    expect(sanitized.username).toBe('testuser');
    expect(sanitized.password).toBe('[PROTECTED]');
    expect(sanitized.apiKey).toBe('[PROTECTED]');
    expect(sanitized.token).toBe('[PROTECTED]');
    expect(sanitized.normalField).toBe('normal-value');
    expect(sanitized.nested.secret).toBe('[PROTECTED]');
    expect(sanitized.nested.normalNested).toBe('normal-nested');
  });

  it('should handle empty sensitive fields', () => {
    const data = {
      password: '',
      token: null,
      apiKey: undefined
    };

    const sanitized = sanitizeForStorage(data);

    expect(sanitized.password).toBe('');
    expect(sanitized.token).toBe(null);
    expect(sanitized.apiKey).toBe(undefined);
  });

  it('should handle arrays', () => {
    const data = {
      items: [
        { name: 'item1', secret: 'secret1' },
        { name: 'item2', secret: 'secret2' }
      ]
    };

    const sanitized = sanitizeForStorage(data);

    expect(sanitized.items[0].name).toBe('item1');
    expect(sanitized.items[0].secret).toBe('[PROTECTED]');
    expect(sanitized.items[1].name).toBe('item2');
    expect(sanitized.items[1].secret).toBe('[PROTECTED]');
  });

  it('should handle non-object inputs', () => {
    expect(sanitizeForStorage('string')).toBe('string');
    expect(sanitizeForStorage(123)).toBe(123);
    expect(sanitizeForStorage(null)).toBe(null);
    expect(sanitizeForStorage(undefined)).toBe(undefined);
  });

  it('should handle deep nesting', () => {
    const deepData = {
      level1: {
        level2: {
          level3: {
            secret: 'deep-secret',
            normal: 'normal-value'
          }
        }
      }
    };

    const sanitized = sanitizeForStorage(deepData);

    expect(sanitized.level1.level2.level3.secret).toBe('[PROTECTED]');
    expect(sanitized.level1.level2.level3.normal).toBe('normal-value');
  });
});