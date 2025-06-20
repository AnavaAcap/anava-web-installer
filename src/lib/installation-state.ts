export interface SavedInstallationState {
  projectId: string;
  projectName: string;
  startedAt: string;
  lastUpdated: string;
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

export class InstallationStateManager {
  static save(state: SavedInstallationState): void {
    try {
      const stateWithTimestamp = {
        ...state,
        lastUpdated: new Date().toISOString()
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
    return state?.completedSteps.includes(step) || false;
  }

  static getResources(projectId: string): SavedInstallationState['resources'] | null {
    const state = this.load(projectId);
    return state?.resources || null;
  }
}