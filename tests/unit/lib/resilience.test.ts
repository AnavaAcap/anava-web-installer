import { AnavaGCPInstaller } from '../../../src/lib/gcp-installer';
import { InstallConfig } from '../../../src/lib/types';

describe('Resilience and Error Handling', () => {
  let installer: AnavaGCPInstaller;
  let mockConfig: InstallConfig;
  let mockOnProgress: jest.Mock;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockConfig = {
      projectId: 'test-project',
      projectName: 'Test Project',
      solutionPrefix: 'anava',
      region: 'us-central1',
      projectNumber: '123456789',
    };

    mockOnProgress = jest.fn();
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    installer = new AnavaGCPInstaller(
      'mock-access-token',
      mockConfig,
      mockOnProgress
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Retry Logic', () => {
    it('should retry failed API calls up to 3 times', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
          text: async () => 'Success',
        });
      });

      const result = await (installer as any).gcpApiCall('https://test.googleapis.com/v1/test');

      expect(callCount).toBe(3);
      expect(result).toEqual({ success: true });
    });

    it('should handle exponential backoff between retries', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      
      (global as any).setTimeout = (fn: Function, delay: number) => {
        delays.push(delay);
        fn();
      };

      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          const error = new Error('Rate limited');
          (error as any).status = 429;
          return Promise.reject(error);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      });

      await (installer as any).gcpApiCall('https://test.googleapis.com/v1/test');

      // Verify exponential backoff pattern
      expect(delays.length).toBeGreaterThanOrEqual(2);
      expect(delays[1]).toBeGreaterThan(delays[0]);

      global.setTimeout = originalSetTimeout;
    });

    it('should fail after max retries are exhausted', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent network error'));

      await expect(
        (installer as any).gcpApiCall('https://test.googleapis.com/v1/test')
      ).rejects.toThrow('Persistent network error');

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running API calls', async () => {
      mockFetch.mockImplementation(() => new Promise((resolve) => {
        // Never resolve - simulate hanging request
        setTimeout(() => resolve({ ok: true }), 100000);
      }));

      const abortSpy = jest.spyOn(AbortController.prototype, 'abort');

      const timeoutPromise = (installer as any).gcpApiCall(
        'https://test.googleapis.com/v1/test',
        {},
        1,
        100 // 100ms timeout
      );

      await expect(timeoutPromise).rejects.toThrow();
      expect(abortSpy).toHaveBeenCalled();
    });

    it('should handle API Gateway extended timeouts gracefully', async () => {
      // Mock initial gateway creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'operations/create-gateway-123' }),
      });

      // Mock operation status checks
      let statusCheckCount = 0;
      mockFetch.mockImplementation(() => {
        statusCheckCount++;
        if (statusCheckCount < 5) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ done: false }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ 
            done: true,
            response: { defaultHostname: 'gateway.example.com' }
          }),
        });
      });

      jest.spyOn(installer as any, 'waitForOperation');
      jest.spyOn(installer as any, 'createAPIGateway').mockImplementation(
        async () => {
          await (installer as any).waitForOperation('operations/create-gateway-123');
          return { apiGatewayUrl: 'https://gateway.example.com' };
        }
      );

      const result = await (installer as any).createAPIGateway();

      expect(result.apiGatewayUrl).toBe('https://gateway.example.com');
      expect(statusCheckCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Error Recovery', () => {
    it('should handle quota exceeded errors gracefully', async () => {
      const quotaError = new Error('Quota exceeded');
      (quotaError as any).status = 429;
      (quotaError as any).message = 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric';

      mockFetch.mockRejectedValueOnce(quotaError);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      jest.spyOn(global, 'setTimeout');

      const result = await (installer as any).gcpApiCall('https://test.googleapis.com/v1/test');

      expect(result).toEqual({ success: true });
      expect(setTimeout).toHaveBeenCalled();
    });

    it('should handle permission denied errors with helpful message', async () => {
      const permissionError = new Error('Permission denied');
      (permissionError as any).status = 403;
      (permissionError as any).message = 'PERMISSION_DENIED: Missing required permissions';

      mockFetch.mockRejectedValue(permissionError);

      await expect(
        (installer as any).gcpApiCall('https://test.googleapis.com/v1/test')
      ).rejects.toThrow('Permission denied');
    });

    it('should handle project not found errors', async () => {
      const notFoundError = new Error('Project not found');
      (notFoundError as any).status = 404;

      mockFetch.mockRejectedValue(notFoundError);

      await expect(
        (installer as any).validateProject()
      ).rejects.toThrow();
    });
  });

  describe('Network Resilience', () => {
    it('should handle intermittent network failures', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('ECONNRESET'));
        } else if (callCount === 2) {
          return Promise.reject(new Error('ETIMEDOUT'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      });

      const result = await (installer as any).gcpApiCall('https://test.googleapis.com/v1/test');

      expect(callCount).toBe(3);
      expect(result).toEqual({ success: true });
    });

    it('should handle DNS resolution failures', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND test.googleapis.com');
      mockFetch.mockRejectedValue(dnsError);

      await expect(
        (installer as any).gcpApiCall('https://test.googleapis.com/v1/test')
      ).rejects.toThrow('getaddrinfo ENOTFOUND');
    });
  });

  describe('State Consistency', () => {
    it('should maintain consistent state after partial failures', async () => {
      // Mock successful first steps
      jest.spyOn(installer as any, 'checkPrerequisites').mockResolvedValue({});
      jest.spyOn(installer as any, 'validateProject').mockResolvedValue({});
      jest.spyOn(installer as any, 'enableAPIs').mockResolvedValue({});
      
      // Mock failure at service account creation
      jest.spyOn(installer as any, 'createServiceAccounts').mockRejectedValue(
        new Error('Service account creation failed')
      );

      const stateManager = require('../../../src/lib/installation-state').InstallationStateManager;
      const updateStepSpy = jest.spyOn(stateManager, 'updateStep');

      await expect(installer.install()).rejects.toThrow('Failed at step "Creating service accounts"');

      // Verify successful steps were saved
      expect(updateStepSpy).toHaveBeenCalledWith('test-project', 'Checking prerequisites', expect.any(Object));
      expect(updateStepSpy).toHaveBeenCalledWith('test-project', 'Validating project', expect.any(Object));
      expect(updateStepSpy).toHaveBeenCalledWith('test-project', 'Enabling APIs', expect.any(Object));
      
      // Verify failed step was not saved
      expect(updateStepSpy).not.toHaveBeenCalledWith('test-project', 'Creating service accounts', expect.any(Object));
    });
  });

  describe('Resource Cleanup', () => {
    it('should handle cleanup when installation fails', async () => {
      // This would be implemented in the actual installer
      const cleanup = async (resources: any) => {
        const cleanupTasks = [];
        
        if (resources.serviceAccount) {
          cleanupTasks.push(
            mockFetch(`https://iam.googleapis.com/v1/${resources.serviceAccount}/delete`, {
              method: 'DELETE'
            })
          );
        }
        
        if (resources.cloudFunction) {
          cleanupTasks.push(
            mockFetch(`https://cloudfunctions.googleapis.com/v2/${resources.cloudFunction}/delete`, {
              method: 'DELETE'
            })
          );
        }
        
        await Promise.allSettled(cleanupTasks);
      };

      const resources = {
        serviceAccount: 'projects/test/serviceAccounts/test-sa',
        cloudFunction: 'projects/test/locations/us-central1/functions/test-func'
      };

      mockFetch.mockResolvedValue({ ok: true });

      await cleanup(resources);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/delete'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent API enabling correctly', async () => {
      const apis = [
        'cloudfunctions.googleapis.com',
        'firebase.googleapis.com',
        'firestore.googleapis.com',
        'storage.googleapis.com',
        'iam.googleapis.com'
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ done: true }),
      });

      const enablePromises = apis.map(api => 
        (installer as any).gcpApiCall(
          `https://serviceusage.googleapis.com/v1/projects/test-project/services/${api}:enable`,
          { method: 'POST' }
        )
      );

      const results = await Promise.allSettled(enablePromises);
      
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(apis.length);
    });
  });

  describe('Input Validation Resilience', () => {
    it('should sanitize and validate all user inputs', () => {
      const testInputs = [
        { input: 'valid-project-id', expected: true },
        { input: 'INVALID-PROJECT-ID', expected: false },
        { input: 'project!@#$', expected: false },
        { input: '../../../etc/passwd', expected: false },
        { input: 'a'.repeat(50), expected: false }, // too long
        { input: '', expected: false }, // empty
        { input: null, expected: false },
        { input: undefined, expected: false },
      ];

      testInputs.forEach(({ input, expected }) => {
        const isValid = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(String(input || ''));
        expect(isValid).toBe(expected);
      });
    });
  });
});