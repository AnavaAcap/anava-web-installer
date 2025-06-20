/**
 * Secure Token Manager
 * Handles OAuth tokens securely without exposing them to XSS attacks
 */

export class SecureTokenManager {
  private static tokenStore = new Map<string, string>();
  private static readonly TOKEN_KEY = 'gcp_access_token';
  
  /**
   * Store token securely (in memory only, not localStorage)
   */
  static storeToken(token: string): string {
    const tokenId = this.generateTokenId();
    this.tokenStore.set(tokenId, token);
    return tokenId;
  }
  
  /**
   * Retrieve token by ID
   */
  static getToken(tokenId: string): string | null {
    return this.tokenStore.get(tokenId) || null;
  }
  
  /**
   * Clear token from memory
   */
  static clearToken(tokenId: string): void {
    this.tokenStore.delete(tokenId);
  }
  
  /**
   * Clear all tokens
   */
  static clearAllTokens(): void {
    this.tokenStore.clear();
  }
  
  /**
   * Generate secure token ID
   */
  private static generateTokenId(): string {
    return `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Check if token is still valid (basic check)
   */
  static isTokenValid(tokenId: string): boolean {
    return this.tokenStore.has(tokenId);
  }
}

/**
 * Secure API client that uses token IDs instead of raw tokens
 */
export class SecureApiClient {
  private tokenId: string;
  
  constructor(tokenId: string) {
    this.tokenId = tokenId;
  }
  
  /**
   * Make authenticated API call
   */
  async makeRequest(url: string, options: RequestInit = {}): Promise<Response> {
    const token = SecureTokenManager.getToken(this.tokenId);
    if (!token) {
      throw new Error('Authentication token not found or expired');
    }
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };
    
    return fetch(url, {
      ...options,
      headers,
    });
  }
  
  /**
   * Fetch GCP projects
   */
  async fetchProjects(): Promise<any> {
    const response = await this.makeRequest(
      'https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE'
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch projects: ${response.status}`);
    }
    
    return response.json();
  }
}