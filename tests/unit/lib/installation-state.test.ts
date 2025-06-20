import { InstallationStateManager, SavedInstallationState } from '../../../src/lib/installation-state';

describe('InstallationStateManager', () => {
  const mockLocalStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    key: jest.fn(),
    length: 0
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true
    });
  });

  describe('save', () => {
    it('should save installation state to localStorage', () => {
      const state: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: '2024-01-01T00:00:00Z',
        completedSteps: ['step1', 'step2'],
        resources: {
          serviceAccount: {
            email: 'test@test-project.iam.gserviceaccount.com',
            created: true
          }
        }
      };

      InstallationStateManager.save(state);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'anava-installation-state',
        expect.stringContaining('"projectId":"test-project"')
      );
    });

    it('should update lastUpdated timestamp when saving', () => {
      const state: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: '2024-01-01T00:00:00Z',
        completedSteps: [],
        resources: {}
      };

      const beforeSave = new Date();
      InstallationStateManager.save(state);
      const savedCall = mockLocalStorage.setItem.mock.calls[0][1];
      const savedState = JSON.parse(savedCall);
      const savedDate = new Date(savedState.lastUpdated);

      expect(savedDate.getTime()).toBeGreaterThanOrEqual(beforeSave.getTime());
    });

    it('should handle localStorage errors gracefully', () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        InstallationStateManager.save({
          projectId: 'test',
          projectName: 'Test',
          startedAt: '2024-01-01T00:00:00Z',
          lastUpdated: '2024-01-01T00:00:00Z',
          completedSteps: [],
          resources: {}
        });
      }).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to save installation state:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('load', () => {
    it('should load state for matching project ID', () => {
      const savedState: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: new Date().toISOString(),
        completedSteps: ['step1'],
        resources: {}
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(savedState));

      const loaded = InstallationStateManager.load('test-project');

      expect(loaded).toEqual(savedState);
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('anava-installation-state');
    });

    it('should return null for different project ID', () => {
      const savedState: SavedInstallationState = {
        projectId: 'other-project',
        projectName: 'Other Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: new Date().toISOString(),
        completedSteps: [],
        resources: {}
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(savedState));

      const loaded = InstallationStateManager.load('test-project');

      expect(loaded).toBeNull();
    });

    it('should return null for expired state (>24 hours)', () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 25);

      const savedState: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: oldDate.toISOString(),
        lastUpdated: oldDate.toISOString(),
        completedSteps: [],
        resources: {}
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(savedState));

      const loaded = InstallationStateManager.load('test-project');

      expect(loaded).toBeNull();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('anava-installation-state');
    });

    it('should handle invalid JSON gracefully', () => {
      mockLocalStorage.getItem.mockReturnValue('invalid json');

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const loaded = InstallationStateManager.load('test-project');

      expect(loaded).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle localStorage errors gracefully', () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error('SecurityError');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const loaded = InstallationStateManager.load('test-project');

      expect(loaded).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('updateStep', () => {
    it('should add new completed step', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      InstallationStateManager.updateStep('test-project', 'Enabling APIs', {
        serviceAccount: {
          email: 'test@test.iam.gserviceaccount.com',
          created: true
        }
      });

      const savedCall = mockLocalStorage.setItem.mock.calls[0][1];
      const savedState = JSON.parse(savedCall);

      expect(savedState.completedSteps).toContain('Enabling APIs');
      expect(savedState.resources.serviceAccount).toBeDefined();
    });

    it('should not duplicate completed steps', () => {
      const existingState: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: new Date().toISOString(),
        completedSteps: ['Enabling APIs'],
        resources: {}
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(existingState));

      InstallationStateManager.updateStep('test-project', 'Enabling APIs');

      const savedCall = mockLocalStorage.setItem.mock.calls[0][1];
      const savedState = JSON.parse(savedCall);

      expect(savedState.completedSteps.filter((s: string) => s === 'Enabling APIs')).toHaveLength(1);
    });

    it('should merge resources correctly', () => {
      const existingState: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: new Date().toISOString(),
        completedSteps: [],
        resources: {
          serviceAccount: {
            email: 'old@test.iam.gserviceaccount.com',
            created: true
          }
        }
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(existingState));

      InstallationStateManager.updateStep('test-project', 'Creating API Gateway', {
        apiGateway: {
          apiId: 'test-api',
          configId: 'test-config',
          gatewayId: 'test-gateway',
          created: true,
          url: 'https://test.gateway.dev'
        }
      });

      const savedCall = mockLocalStorage.setItem.mock.calls[0][1];
      const savedState = JSON.parse(savedCall);

      expect(savedState.resources.serviceAccount).toBeDefined();
      expect(savedState.resources.apiGateway).toBeDefined();
      expect(savedState.resources.apiGateway.url).toBe('https://test.gateway.dev');
    });
  });

  describe('clear', () => {
    it('should remove installation state from localStorage', () => {
      InstallationStateManager.clear();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('anava-installation-state');
    });

    it('should handle errors gracefully', () => {
      mockLocalStorage.removeItem.mockImplementation(() => {
        throw new Error('SecurityError');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => InstallationStateManager.clear()).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('hasCompletedStep', () => {
    it('should return true for completed step', () => {
      const state: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: new Date().toISOString(),
        completedSteps: ['Enabling APIs', 'Creating service accounts'],
        resources: {}
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(state));

      expect(InstallationStateManager.hasCompletedStep('test-project', 'Enabling APIs')).toBe(true);
    });

    it('should return false for incomplete step', () => {
      const state: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: new Date().toISOString(),
        completedSteps: ['Enabling APIs'],
        resources: {}
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(state));

      expect(InstallationStateManager.hasCompletedStep('test-project', 'Creating API Gateway')).toBe(false);
    });

    it('should return false when no state exists', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      expect(InstallationStateManager.hasCompletedStep('test-project', 'Any Step')).toBe(false);
    });
  });

  describe('getResources', () => {
    it('should return resources for project', () => {
      const state: SavedInstallationState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: '2024-01-01T00:00:00Z',
        lastUpdated: new Date().toISOString(),
        completedSteps: [],
        resources: {
          apiKey: {
            keyId: 'test-key',
            value: 'test-api-key',
            created: true
          }
        }
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(state));

      const resources = InstallationStateManager.getResources('test-project');

      expect(resources).toEqual(state.resources);
    });

    it('should return null when no state exists', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      const resources = InstallationStateManager.getResources('test-project');

      expect(resources).toBeNull();
    });
  });
});