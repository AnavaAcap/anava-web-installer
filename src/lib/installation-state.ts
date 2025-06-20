export interface SavedInstallationState {
  projectId: string;
  projectName: string;
  startedAt: string;
  lastUpdated: string;
  version?: string; // Track installer version for migration logic
  completedSteps: string[];
  resources: {
    serviceAccount?: {
      email: string;
      created: boolean;
    };
    firebaseApp?: {
      appId: string;
      created: boolean;
    };
    cloudFunctions?: {
      deployed: boolean;
      urls?: Record<string, string>;
    };
    workloadIdentity?: {
      poolId: string;
      providerId: string;
      created: boolean;
    };
    apiGateway?: {
      apiId: string;
      configId: string;
      gatewayId: string;
      created: boolean;
      url?: string;
    };
    apiKey?: {
      keyId: string;
      value: string;
      created: boolean;
    };
  };
  installResult?: any;
}

import { SecureStorage, sanitizeForStorage } from './secure-storage';

const STORAGE_KEY = 'anava-installation-state';
const CURRENT_VERSION = 'v2.1.2-SECURITY';

// Steps that need to be re-run for v2.1.2 due to critical API/permission fixes
const CRITICAL_STEPS_V2_1_2 = [
  'Enabling APIs',        // Added 10 missing APIs
  'Creating API Gateway', // Added managed service enablement
  'Creating service accounts' // Added logging permissions
];

export class InstallationStateManager {
  static save(state: SavedInstallationState): void {
    try {
      const stateWithTimestamp = {
        ...state,
        lastUpdated: new Date().toISOString(),
        version: CURRENT_VERSION
      };
      
      // Sanitize sensitive data before storage
      const sanitizedState = sanitizeForStorage(stateWithTimestamp);
      
      // Store securely with encryption
      SecureStorage.setItem(STORAGE_KEY, sanitizedState);
    } catch (error) {
      console.error('Failed to save installation state:', error);
    }
  }

  static load(projectId: string): SavedInstallationState | null {
    try {
      const state = SecureStorage.getItem<SavedInstallationState>(STORAGE_KEY);
      if (!state) return null;
      
      // Check if this is for the same project
      if (state.projectId !== projectId) return null;
      
      // Check if state is not too old (24 hours)
      const lastUpdated = new Date(state.lastUpdated);
      const now = new Date();
      const hoursSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceUpdate > 24) {
        this.clear();
        return null;
      }

      return state;
    } catch (error) {
      console.error('Failed to load installation state:', error);
      return null;
    }
  }

  static updateStep(projectId: string, step: string, resources?: Partial<SavedInstallationState['resources']>): void {
    const current = this.load(projectId) || {
      projectId,
      projectName: '',
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      completedSteps: [],
      resources: {}
    };

    if (!current.completedSteps.includes(step)) {
      current.completedSteps.push(step);
    }

    if (resources) {
      current.resources = { ...current.resources, ...resources };
    }

    this.save(current);
  }

  static clear(): void {
    try {
      SecureStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear installation state:', error);
    }
  }

  static hasCompletedStep(projectId: string, step: string): boolean {
    const state = this.load(projectId);
    if (!state || !state.completedSteps.includes(step)) {
      return false;
    }

    // Force re-run of critical steps if they were completed before v2.1.2-SECURITY
    if (CRITICAL_STEPS_V2_1_2.includes(step)) {
      const stateVersion = state.version;
      
      // If no version recorded or it's before v2.1.2, force re-run
      if (!stateVersion || stateVersion !== CURRENT_VERSION) {
        console.log(`Force re-running "${step}" due to critical v2.1.2 updates (APIs and permissions)`);
        return false;
      }
    }

    return true;
  }

  static getResources(projectId: string): SavedInstallationState['resources'] | null {
    const state = this.load(projectId);
    return state?.resources || null;
  }
}