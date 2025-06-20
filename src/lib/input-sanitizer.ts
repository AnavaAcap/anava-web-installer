/**
 * Input Sanitization Utilities
 * Prevents XSS attacks by sanitizing user input
 */

/**
 * Sanitize string input to prevent XSS
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();
}

/**
 * Sanitize project ID (alphanumeric, hyphens only)
 */
export function sanitizeProjectId(projectId: string): string {
  if (typeof projectId !== 'string') {
    return '';
  }
  
  // GCP project IDs: lowercase letters, digits, hyphens, 6-30 chars
  return projectId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 30);
}

/**
 * Sanitize region (alphanumeric, hyphens only)
 */
export function sanitizeRegion(region: string): string {
  if (typeof region !== 'string') {
    return '';
  }
  
  // GCP regions: lowercase letters, digits, hyphens
  return region
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 50);
}

/**
 * Validate and sanitize URL
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== 'string') {
    return '';
  }
  
  try {
    const parsed = new URL(url);
    // Only allow https URLs for security
    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed');
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Sanitize error messages for display
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return sanitizeString(error);
  }
  
  if (error instanceof Error) {
    return sanitizeString(error.message);
  }
  
  return 'An unknown error occurred';
}

/**
 * Validate input against expected patterns
 */
export const validators = {
  projectId: (input: string): boolean => {
    return /^[a-z0-9-]{6,30}$/.test(input);
  },
  
  region: (input: string): boolean => {
    return /^[a-z0-9-]+$/.test(input) && input.length > 0 && input.length < 50;
  },
  
  email: (input: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  }
};