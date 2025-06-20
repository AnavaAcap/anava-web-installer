/**
 * Security Tests for Token Management
 */

import { SecureTokenManager, SecureApiClient } from '../../lib/secure-token-manager';

describe('SecureTokenManager', () => {
  beforeEach(() => {
    SecureTokenManager.clearAllTokens();
  });

  afterEach(() => {
    SecureTokenManager.clearAllTokens();
  });

  describe('Token Storage', () => {
    it('should store tokens securely without exposing them', () => {
      const mockToken = 'ya29.mock-access-token-123456789';
      const tokenId = SecureTokenManager.storeToken(mockToken);

      expect(tokenId).toBeDefined();
      expect(tokenId).not.toContain(mockToken);
      expect(tokenId).toMatch(/^token_\d+_[a-z0-9]+$/);
    });

    it('should retrieve stored tokens by ID', () => {
      const mockToken = 'ya29.mock-access-token-123456789';
      const tokenId = SecureTokenManager.storeToken(mockToken);

      const retrievedToken = SecureTokenManager.getToken(tokenId);
      expect(retrievedToken).toBe(mockToken);
    });

    it('should return null for non-existent token IDs', () => {
      const nonExistentId = 'token_123_nonexistent';
      const retrievedToken = SecureTokenManager.getToken(nonExistentId);
      expect(retrievedToken).toBeNull();
    });

    it('should clear individual tokens', () => {
      const mockToken = 'ya29.mock-access-token-123456789';
      const tokenId = SecureTokenManager.storeToken(mockToken);

      expect(SecureTokenManager.getToken(tokenId)).toBe(mockToken);
      
      SecureTokenManager.clearToken(tokenId);
      expect(SecureTokenManager.getToken(tokenId)).toBeNull();
    });

    it('should clear all tokens', () => {
      const token1 = SecureTokenManager.storeToken('token1');
      const token2 = SecureTokenManager.storeToken('token2');

      expect(SecureTokenManager.getToken(token1)).toBeDefined();
      expect(SecureTokenManager.getToken(token2)).toBeDefined();

      SecureTokenManager.clearAllTokens();
      
      expect(SecureTokenManager.getToken(token1)).toBeNull();
      expect(SecureTokenManager.getToken(token2)).toBeNull();
    });

    it('should validate token existence', () => {
      const mockToken = 'ya29.mock-access-token-123456789';
      const tokenId = SecureTokenManager.storeToken(mockToken);

      expect(SecureTokenManager.isTokenValid(tokenId)).toBe(true);
      
      SecureTokenManager.clearToken(tokenId);
      expect(SecureTokenManager.isTokenValid(tokenId)).toBe(false);
    });
  });
});

describe('SecureApiClient', () => {
  beforeEach(() => {
    SecureTokenManager.clearAllTokens();
    // Mock fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    SecureTokenManager.clearAllTokens();
    jest.restoreAllMocks();
  });

  it('should make authenticated requests with stored tokens', async () => {
    const mockToken = 'ya29.mock-access-token-123456789';
    const tokenId = SecureTokenManager.storeToken(mockToken);
    
    const mockResponse = {
      ok: true,
      json: async () => ({ projects: [] })
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    const client = new SecureApiClient(tokenId);
    await client.makeRequest('https://example.com/api');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': `Bearer ${mockToken}`,
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('should throw error for invalid token ID', async () => {
    const client = new SecureApiClient('invalid-token-id');
    
    await expect(client.makeRequest('https://example.com/api'))
      .rejects.toThrow('Authentication token not found or expired');
  });

  it('should fetch projects successfully', async () => {
    const mockToken = 'ya29.mock-access-token-123456789';
    const tokenId = SecureTokenManager.storeToken(mockToken);
    
    const mockProjects = { projects: [{ projectId: 'test-project', name: 'Test' }] };
    const mockResponse = {
      ok: true,
      json: async () => mockProjects
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    const client = new SecureApiClient(tokenId);
    const projects = await client.fetchProjects();

    expect(projects).toEqual(mockProjects);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': `Bearer ${mockToken}`
        })
      })
    );
  });

  it('should handle API errors appropriately', async () => {
    const mockToken = 'ya29.mock-access-token-123456789';
    const tokenId = SecureTokenManager.storeToken(mockToken);
    
    const mockResponse = {
      ok: false,
      status: 403,
      text: async () => 'Forbidden'
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    const client = new SecureApiClient(tokenId);
    
    await expect(client.fetchProjects())
      .rejects.toThrow('Failed to fetch projects: 403');
  });
});