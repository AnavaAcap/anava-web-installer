/**
 * Secure Storage Utilities
 * Provides encrypted storage for sensitive data
 */

// Simple XOR encryption for localStorage (not cryptographically secure, but better than plaintext)
// For production, consider using Web Crypto API for proper encryption
class SimpleEncryption {
  private static key = 'anava-installer-2024'; // In production, use a proper key derivation

  static encrypt(text: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(
        text.charCodeAt(i) ^ this.key.charCodeAt(i % this.key.length)
      );
    }
    // Use Unicode-safe base64 encoding
    return btoa(unescape(encodeURIComponent(result)));
  }

  static decrypt(encryptedText: string): string {
    try {
      // Use Unicode-safe base64 decoding
      const text = decodeURIComponent(escape(atob(encryptedText)));
      let result = '';
      for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(
          text.charCodeAt(i) ^ this.key.charCodeAt(i % this.key.length)
        );
      }
      return result;
    } catch {
      return '';
    }
  }
}

/**
 * Secure storage wrapper for localStorage
 */
export class SecureStorage {
  /**
   * Store data securely in localStorage
   */
  static setItem(key: string, value: any): void {
    try {
      const jsonString = JSON.stringify(value);
      const encrypted = SimpleEncryption.encrypt(jsonString);
      localStorage.setItem(key, encrypted);
    } catch (error) {
      console.error('Failed to store data securely:', error);
    }
  }

  /**
   * Retrieve data securely from localStorage
   */
  static getItem<T>(key: string): T | null {
    try {
      const encrypted = localStorage.getItem(key);
      if (!encrypted) return null;

      const decrypted = SimpleEncryption.decrypt(encrypted);
      if (!decrypted) return null;

      return JSON.parse(decrypted) as T;
    } catch (error) {
      console.error('Failed to retrieve data securely:', error);
      return null;
    }
  }

  /**
   * Remove item from localStorage
   */
  static removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to remove data:', error);
    }
  }

  /**
   * Clear all items with a specific prefix
   */
  static clearPrefix(prefix: string): void {
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Failed to clear prefixed data:', error);
    }
  }

  /**
   * Check if data exists and is valid
   */
  static hasValidItem(key: string): boolean {
    const item = this.getItem(key);
    return item !== null;
  }
}

/**
 * Sanitize data before storage to remove sensitive information
 */
export function sanitizeForStorage(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sanitized = { ...data };

  // Remove or mask sensitive fields
  const sensitiveFields = ['token', 'password', 'secret', 'key', 'apiKey'];
  
  function sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const result: any = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveFields.some(field => lowerKey.includes(field));
      
      if (isSensitive && typeof value === 'string') {
        // Mask sensitive data but keep some indication it exists
        result[key] = value ? '[PROTECTED]' : '';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = sanitizeObject(value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  return sanitizeObject(sanitized);
}