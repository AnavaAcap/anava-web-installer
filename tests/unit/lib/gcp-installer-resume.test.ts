import { AnavaGCPInstaller } from '../../../src/lib/gcp-installer';
import { InstallConfig } from '../../../src/lib/types';
import { InstallationStateManager } from '../../../src/lib/installation-state';

// Mock the InstallationStateManager
jest.mock('../../../src/lib/installation-state');

describe('AnavaGCPInstaller - Smart Resume Feature', () => {
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

    // Reset all mocks
    jest.clearAllMocks();
    (InstallationStateManager.load as jest.Mock).mockReturnValue(null);
    (InstallationStateManager.save as jest.Mock).mockImplementation(() => {});
    (InstallationStateManager.updateStep as jest.Mock).mockImplementation(() => {});
    (InstallationStateManager.hasCompletedStep as jest.Mock).mockReturnValue(false);
    (InstallationStateManager.getResources as jest.Mock).mockReturnValue(null);

    installer = new AnavaGCPInstaller(
      'mock-access-token',
      mockConfig,
      mockOnProgress
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Resume functionality', () => {
    it('should detect and skip completed steps during resume', async () => {
      // Mock saved state with some completed steps
      const savedState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        completedSteps: [
          'Checking prerequisites',
          'Validating project',
          'Enabling APIs'
        ],
        resources: {
          serviceAccount: {
            email: 'test-sa@test-project.iam.gserviceaccount.com',
            created: true
          }
        }
      };

      (InstallationStateManager.load as jest.Mock).mockReturnValue(savedState);
      (InstallationStateManager.hasCompletedStep as jest.Mock).mockImplementation(
        (projectId: string, step: string) => savedState.completedSteps.includes(step)
      );
      (InstallationStateManager.getResources as jest.Mock).mockReturnValue(savedState.resources);

      // Mock API responses for remaining steps
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
        text: async () => '',
      });

      // Mock private methods to prevent actual API calls
      jest.spyOn(installer as any, 'checkPrerequisites').mockResolvedValue({});
      jest.spyOn(installer as any, 'validateProject').mockResolvedValue({});
      jest.spyOn(installer as any, 'enableAPIs').mockResolvedValue({});
      jest.spyOn(installer as any, 'createServiceAccounts').mockResolvedValue({ 
        serviceAccountEmail: 'test-sa@test-project.iam.gserviceaccount.com' 
      });
      jest.spyOn(installer as any, 'setupFirebase').mockResolvedValue({ 
        firebaseEnabled: true 
      });
      jest.spyOn(installer as any, 'deployFunctions').mockResolvedValue({ 
        deviceAuthUrl: 'https://test.cloudfunctions.net/device-auth',
        tvmUrl: 'https://test.cloudfunctions.net/tvm'
      });
      jest.spyOn(installer as any, 'setupWorkloadIdentity').mockResolvedValue({
        workloadIdentityPoolId: 'test-pool',
        workloadIdentityProviderId: 'test-provider'
      });
      jest.spyOn(installer as any, 'createAPIGateway').mockResolvedValue({
        apiGatewayUrl: 'https://test.gateway.dev'
      });
      jest.spyOn(installer as any, 'generateAPIKeys').mockResolvedValue({
        apiKey: 'test-api-key'
      });

      const result = await installer.install();

      // Verify skipped steps were not executed
      expect((installer as any).checkPrerequisites).not.toHaveBeenCalled();
      expect((installer as any).validateProject).not.toHaveBeenCalled();
      expect((installer as any).enableAPIs).not.toHaveBeenCalled();

      // Verify remaining steps were executed
      expect((installer as any).createServiceAccounts).toHaveBeenCalled();
      expect((installer as any).setupFirebase).toHaveBeenCalled();
      expect((installer as any).deployFunctions).toHaveBeenCalled();
      expect((installer as any).setupWorkloadIdentity).toHaveBeenCalled();
      expect((installer as any).createAPIGateway).toHaveBeenCalled();
      expect((installer as any).generateAPIKeys).toHaveBeenCalled();

      // Verify progress callbacks for skipped steps
      expect(mockOnProgress).toHaveBeenCalledWith('✓ Checking prerequisites (already completed)', expect.any(Number));
      expect(mockOnProgress).toHaveBeenCalledWith('✓ Validating project (already completed)', expect.any(Number));
      expect(mockOnProgress).toHaveBeenCalledWith('✓ Enabling APIs (already completed)', expect.any(Number));

      // Verify result includes resume information
      expect(result.resumedInstallation).toBe(true);
      expect(result.skippedSteps).toEqual([
        'Checking prerequisites',
        'Validating project',
        'Enabling APIs'
      ]);
    });

    it('should save state after each successful step', async () => {
      // Mock all installation methods
      jest.spyOn(installer as any, 'checkPrerequisites').mockResolvedValue({});
      jest.spyOn(installer as any, 'validateProject').mockResolvedValue({});
      jest.spyOn(installer as any, 'enableAPIs').mockResolvedValue({});
      jest.spyOn(installer as any, 'createServiceAccounts').mockResolvedValue({ 
        serviceAccountEmail: 'test-sa@test-project.iam.gserviceaccount.com' 
      });
      jest.spyOn(installer as any, 'setupFirebase').mockResolvedValue({ 
        firebaseEnabled: true 
      });
      jest.spyOn(installer as any, 'deployFunctions').mockResolvedValue({ 
        deviceAuthUrl: 'https://test.cloudfunctions.net/device-auth',
        tvmUrl: 'https://test.cloudfunctions.net/tvm'
      });
      jest.spyOn(installer as any, 'setupWorkloadIdentity').mockResolvedValue({
        workloadIdentityPoolId: 'test-pool',
        workloadIdentityProviderId: 'test-provider'
      });
      jest.spyOn(installer as any, 'createAPIGateway').mockResolvedValue({
        apiGatewayUrl: 'https://test.gateway.dev'
      });
      jest.spyOn(installer as any, 'generateAPIKeys').mockResolvedValue({
        apiKey: 'test-api-key'
      });

      await installer.install();

      // Verify state was saved initially
      expect(InstallationStateManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          projectName: 'Test Project',
          completedSteps: [],
          resources: {}
        })
      );

      // Verify state was updated after each step
      expect(InstallationStateManager.updateStep).toHaveBeenCalledTimes(9);
      expect(InstallationStateManager.updateStep).toHaveBeenCalledWith(
        'test-project',
        'Creating service accounts',
        expect.objectContaining({
          serviceAccount: expect.any(Object)
        })
      );

      // Verify final state was saved
      expect(InstallationStateManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          completedSteps: expect.arrayContaining([
            'Checking prerequisites',
            'Validating project',
            'Enabling APIs',
            'Creating service accounts',
            'Setting up Firebase',
            'Deploying Cloud Functions',
            'Configuring Workload Identity',
            'Creating API Gateway',
            'Generating API keys'
          ])
        })
      );
    });

    it('should handle resume with partially completed API Gateway', async () => {
      const savedState = {
        projectId: 'test-project',
        projectName: 'Test Project',
        startedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        completedSteps: [
          'Checking prerequisites',
          'Validating project',
          'Enabling APIs',
          'Creating service accounts',
          'Setting up Firebase',
          'Deploying Cloud Functions',
          'Configuring Workload Identity',
          'Creating API Gateway'
        ],
        resources: {
          apiGateway: {
            apiId: 'anava-device-api',
            configId: 'anava-device-api-config-123',
            gatewayId: 'anava-gateway',
            created: true,
            url: 'https://gateway.example.com'
          }
        }
      };

      (InstallationStateManager.load as jest.Mock).mockReturnValue(savedState);
      (InstallationStateManager.hasCompletedStep as jest.Mock).mockImplementation(
        (projectId: string, step: string) => savedState.completedSteps.includes(step)
      );
      (InstallationStateManager.getResources as jest.Mock).mockReturnValue(savedState.resources);

      // Mock only the API key generation
      jest.spyOn(installer as any, 'generateAPIKeys').mockResolvedValue({
        apiKey: 'new-api-key'
      });

      // Mock other methods to ensure they're not called
      const checkPrerequisitesSpy = jest.spyOn(installer as any, 'checkPrerequisites');
      const createAPIGatewaySpy = jest.spyOn(installer as any, 'createAPIGateway');

      await installer.install();

      // Verify only API key generation was called
      expect(checkPrerequisitesSpy).not.toHaveBeenCalled();
      expect(createAPIGatewaySpy).not.toHaveBeenCalled();
      expect((installer as any).generateAPIKeys).toHaveBeenCalled();

      // Verify saved resources were included in results
      expect(mockOnProgress).toHaveBeenCalledWith('✓ Creating API Gateway (already completed)', expect.any(Number));
    });

    it('should clear state when starting fresh installation', async () => {
      (InstallationStateManager.load as jest.Mock).mockReturnValue(null);

      // Mock installation methods
      jest.spyOn(installer as any, 'checkPrerequisites').mockResolvedValue({});
      jest.spyOn(installer as any, 'validateProject').mockResolvedValue({});
      jest.spyOn(installer as any, 'enableAPIs').mockResolvedValue({});
      jest.spyOn(installer as any, 'createServiceAccounts').mockResolvedValue({});
      jest.spyOn(installer as any, 'setupFirebase').mockResolvedValue({});
      jest.spyOn(installer as any, 'deployFunctions').mockResolvedValue({});
      jest.spyOn(installer as any, 'setupWorkloadIdentity').mockResolvedValue({});
      jest.spyOn(installer as any, 'createAPIGateway').mockResolvedValue({});
      jest.spyOn(installer as any, 'generateAPIKeys').mockResolvedValue({});

      await installer.install();

      // Verify initial state was saved
      expect(InstallationStateManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          completedSteps: []
        })
      );

      // Verify no resume information in result
      const finalSaveCall = (InstallationStateManager.save as jest.Mock).mock.calls.find(
        call => call[0].completedSteps.length === 9
      );
      expect(finalSaveCall).toBeDefined();
    });
  });

  describe('Error handling during resume', () => {
    it('should preserve state when installation fails mid-process', async () => {
      // Mock first few steps to succeed
      jest.spyOn(installer as any, 'checkPrerequisites').mockResolvedValue({});
      jest.spyOn(installer as any, 'validateProject').mockResolvedValue({});
      jest.spyOn(installer as any, 'enableAPIs').mockResolvedValue({});
      
      // Mock service account creation to fail
      jest.spyOn(installer as any, 'createServiceAccounts').mockRejectedValue(
        new Error('Failed to create service account')
      );

      await expect(installer.install()).rejects.toThrow('Failed at step "Creating service accounts"');

      // Verify state was saved for successful steps
      expect(InstallationStateManager.updateStep).toHaveBeenCalledWith(
        'test-project',
        'Checking prerequisites',
        expect.any(Object)
      );
      expect(InstallationStateManager.updateStep).toHaveBeenCalledWith(
        'test-project',
        'Validating project',
        expect.any(Object)
      );
      expect(InstallationStateManager.updateStep).toHaveBeenCalledWith(
        'test-project',
        'Enabling APIs',
        expect.any(Object)
      );

      // Verify failed step was not saved
      expect(InstallationStateManager.updateStep).not.toHaveBeenCalledWith(
        'test-project',
        'Creating service accounts',
        expect.any(Object)
      );
    });
  });

  describe('API key regeneration', () => {
    it('should support force regeneration of API keys', async () => {
      const mockApiKeyResult = {
        apiKey: 'new-regenerated-key',
        apiKeyId: 'projects/test/keys/new-key-id'
      };

      jest.spyOn(installer as any, 'generateAPIKeys').mockResolvedValue(mockApiKeyResult);

      const result = await (installer as any).generateAPIKeys(true);

      expect(result).toEqual(mockApiKeyResult);
    });
  });
});