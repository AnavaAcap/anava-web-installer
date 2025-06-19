export interface InstallConfig {
  projectId: string;
  projectNumber?: string;
  region: string;
  solutionPrefix: string;
  managedService?: string;
}

export interface InstallStep {
  name: string;
  weight: number;
  fn: () => Promise<any>;
}

export interface InstallResult {
  success: boolean;
  apiGatewayUrl?: string;
  apiKey?: string;
  firebaseWebApiKey?: string;
  projectId: string;
  region: string;
  solutionPrefix?: string;
  setupCommand?: string;
  configurationSummary?: Record<string, any>;
  error?: string;
}

export type InstallStatus = 'ready' | 'authenticating' | 'selecting' | 'installing' | 'completed' | 'error';

export interface GoogleProject {
  projectId: string;
  name: string;
  projectNumber: string;
  lifecycleState: string;
}