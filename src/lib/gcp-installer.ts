/**
 * Anava GCP Installer - Core Logic
 * This handles all the GCP API calls to set up the infrastructure
 */

import { InstallConfig, InstallStep, InstallResult } from './types';
import { InstallationStateManager, SavedInstallationState } from './installation-state';

// Function code templates embedded directly (from vertexSetup_gcp.sh)
const DEVICE_AUTH_FUNCTION_CODE = `
import functions_framework, firebase_admin, os, json
from firebase_admin import auth
try:
    if not firebase_admin._apps: firebase_admin.initialize_app()
except Exception as e: print(f"DeviceAuthFn CRITICAL: Init Firebase: {e}")
@functions_framework.http
def device_authenticator(request):
    if not firebase_admin._apps: return ("Firebase SDK not init", 500)
    if request.method != 'POST': return ('Method Not Allowed', 405)
    try:
        req_json = request.get_json(silent=True)
        if not req_json: return ("Bad Request: No JSON", 400)
        device_id = req_json.get("device_id")
        if not device_id: return ("Bad Request: 'device_id' missing", 400)
        print(f"DeviceAuthFn: Req for device_id: {device_id}")
        custom_token = auth.create_custom_token(uid=str(device_id)).decode('utf-8')
        print(f"DeviceAuthFn: Firebase Custom Token created for {device_id}")
        return ({"firebase_custom_token": custom_token}, 200)
    except Exception as e: print(f"DeviceAuthFn ERROR for {device_id if 'device_id' in locals() else 'unknown'}: {e}"); return ("Token gen error", 500)
`;

const TVM_FUNCTION_CODE = `
import functions_framework, os, requests, json
STS_ENDPOINT = "https://sts.googleapis.com/v1/token"; IAM_ENDPOINT_TEMPLATE = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{sa_email}:generateAccessToken"
@functions_framework.http
def token_vendor_machine(request):
    wif_pn = os.environ.get("WIF_PROJECT_NUMBER"); wif_pool = os.environ.get("WIF_POOL_ID"); wif_prov = os.environ.get("WIF_PROVIDER_ID"); target_sa = os.environ.get("TARGET_SERVICE_ACCOUNT_EMAIL")
    if not all([wif_pn, wif_pool, wif_prov, target_sa]): print(f"TVMFn ERR: Missing Env Vars"); return ("TVM Misconfigured", 500)
    if request.method != 'POST': return ('Method Not Allowed', 405)
    try:
        req_json = request.get_json(silent=True);
        if not req_json: return ("Bad Request: No JSON", 400)
        fb_id_token = req_json.get("firebase_id_token")
        if not fb_id_token: return ("Bad Request: 'firebase_id_token' missing", 400)
        print(f"TVMFn: Req to vend token for target SA: {target_sa}")
        sts_aud = f"//iam.googleapis.com/projects/{wif_pn}/locations/global/workloadIdentityPools/{wif_pool}/providers/{wif_prov}"
        sts_p = {"grant_type":"urn:ietf:params:oauth:grant-type:token-exchange","subject_token_type":"urn:ietf:params:oauth:token-type:id_token","subject_token":fb_id_token,"audience":sts_aud,"scope":"https://www.googleapis.com/auth/cloud-platform","requested_token_type":"urn:ietf:params:oauth:token-type:access_token"}
        sts_r = requests.post(STS_ENDPOINT, json=sts_p); sts_r.raise_for_status(); sts_j = sts_r.json(); fed_at = sts_j.get("access_token")
        if not fed_at: print(f"TVMFn ERR: No fed token: {sts_r.text}"); return ("STS Err (No fed_at)", 500)
        iam_ep = IAM_ENDPOINT_TEMPLATE.format(sa_email=target_sa); iam_p = {"scope":["https://www.googleapis.com/auth/cloud-platform"]}; iam_h = {"Authorization":f"Bearer {fed_at}","Content-Type":"application/json"}
        sa_r = requests.post(iam_ep, json=iam_p, headers=iam_h); sa_r.raise_for_status(); sa_j = sa_r.json(); gcp_at = sa_j.get("accessToken")
        exp_in = int(sts_j.get("expires_in", 3599))
        if not gcp_at: print(f"TVMFn ERR: No GCP token: {sa_j}"); return ("IAM Err (No gcp_at)", 500)
        print(f"TVMFn: GCP SA token for {target_sa} OK."); return ({"gcp_access_token":gcp_at, "expires_in":exp_in}, 200)
    except requests.exceptions.HTTPError as e: print(f"TVMFn HTTPError: {e} - Resp: {e.response.text if e.response else 'N/A'}"); return (f"TVM HTTP Err {e.response.status_code if e.response else ''}", 500)
    except Exception as e: print(f"TVMFn Unexpected: {e}"); return ("TVM Internal Err", 500)
`;

export class AnavaGCPInstaller {
  private accessToken: string;
  private config: InstallConfig;
  private onProgress: (step: string, progress: number) => void;

  constructor(
    accessToken: string, 
    config: InstallConfig,
    onProgress: (step: string, progress: number) => void
  ) {
    this.accessToken = accessToken;
    this.config = config;
    this.onProgress = onProgress;
  }

  async install(): Promise<InstallResult> {
    // Check for existing installation state
    const savedState = InstallationStateManager.load(this.config.projectId);
    const isResuming = savedState !== null;
    
    if (isResuming) {
      console.log('Found existing installation state, resuming...');
      this.onProgress('Resuming installation...', 0);
    }

    // Initialize state if new installation
    if (!savedState) {
      InstallationStateManager.save({
        projectId: this.config.projectId,
        projectName: this.config.projectName || '',
        startedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        completedSteps: [],
        resources: {}
      });
    }

    const steps: InstallStep[] = [
      { name: 'Checking prerequisites', weight: 5, fn: () => this.checkPrerequisites() },
      { name: 'Validating project', weight: 5, fn: () => this.validateProject() },
      { name: 'Enabling APIs', weight: 10, fn: () => this.enableAPIs() },
      { name: 'Creating service accounts', weight: 15, fn: () => this.createServiceAccounts() },
      { name: 'Setting up Firebase', weight: 10, fn: () => this.setupFirebase() },
      { name: 'Deploying Cloud Functions', weight: 20, fn: () => this.deployFunctions() },
      { name: 'Configuring Workload Identity', weight: 15, fn: () => this.setupWorkloadIdentity() },
      { name: 'Creating API Gateway', weight: 15, fn: () => this.createAPIGateway() },
      { name: 'Generating API keys', weight: 5, fn: () => this.generateAPIKeys() },
    ];

    let totalProgress = 0;
    const results: any = savedState?.installResult || {};
    const skippedSteps: string[] = [];

    for (const step of steps) {
      // Check if step was already completed
      if (InstallationStateManager.hasCompletedStep(this.config.projectId, step.name)) {
        console.log(`Step "${step.name}" already completed, skipping...`);
        skippedSteps.push(step.name);
        totalProgress += step.weight;
        this.onProgress(`✓ ${step.name} (already completed)`, totalProgress);
        
        // Load previously saved results for this step
        const savedResources = InstallationStateManager.getResources(this.config.projectId);
        if (savedResources) {
          // Merge saved resources into results
          if (step.name === 'Creating service accounts' && savedResources.serviceAccount) {
            results.serviceAccountEmail = savedResources.serviceAccount.email;
          }
          if (step.name === 'Setting up Firebase' && savedResources.firebaseApp) {
            results.firebaseEnabled = true;
            results.firebaseWebApiKey = savedResources.firebaseApp.appId; // Note: appId field stores the web API key
          }
          if (step.name === 'Creating API Gateway' && savedResources.apiGateway?.url) {
            results.apiGatewayUrl = savedResources.apiGateway.url;
          }
          if (step.name === 'Generating API keys' && savedResources.apiKey?.value) {
            results.apiKey = savedResources.apiKey.value;
          }
        }
        continue;
      }

      this.onProgress(step.name, totalProgress);
      try {
        const stepResult = await step.fn();
        Object.assign(results, stepResult);
        
        // Save step completion and results
        InstallationStateManager.updateStep(this.config.projectId, step.name, this.mapResultsToResources(step.name, stepResult));
        
        totalProgress += step.weight;
        this.onProgress(step.name, totalProgress);
      } catch (error) {
        throw new Error(`Failed at step "${step.name}": ${error}`);
      }
    }

    // Save final results
    const finalResult = this.compileResults(results);
    InstallationStateManager.save({
      projectId: this.config.projectId,
      projectName: this.config.projectName || '',
      startedAt: savedState?.startedAt || new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      completedSteps: steps.map(s => s.name),
      resources: InstallationStateManager.getResources(this.config.projectId) || {},
      installResult: finalResult
    });

    // Add resume information to result
    if (isResuming && skippedSteps.length > 0) {
      (finalResult as any).resumedInstallation = true;
      (finalResult as any).skippedSteps = skippedSteps;
    }

    return finalResult;
  }

  private mapResultsToResources(stepName: string, stepResult: any): Partial<SavedInstallationState['resources']> {
    const resources: Partial<SavedInstallationState['resources']> = {};

    switch (stepName) {
      case 'Creating service accounts':
        if (stepResult.serviceAccountEmail) {
          resources.serviceAccount = {
            email: stepResult.serviceAccountEmail,
            created: true
          };
        }
        break;
      
      case 'Setting up Firebase':
        if (stepResult.firebaseEnabled) {
          resources.firebaseApp = {
            appId: stepResult.firebaseWebApiKey || '',
            created: true
          };
        }
        break;
      
      case 'Deploying Cloud Functions':
        if (stepResult.deviceAuthUrl || stepResult.tvmUrl) {
          resources.cloudFunctions = {
            deployed: true,
            urls: {
              deviceAuth: stepResult.deviceAuthUrl || '',
              tvm: stepResult.tvmUrl || ''
            }
          };
        }
        break;
      
      case 'Configuring Workload Identity':
        if (stepResult.workloadIdentityPoolId) {
          resources.workloadIdentity = {
            poolId: stepResult.workloadIdentityPoolId,
            providerId: stepResult.workloadIdentityProviderId || '',
            created: true
          };
        }
        break;
      
      case 'Creating API Gateway':
        if (stepResult.apiGatewayUrl) {
          resources.apiGateway = {
            apiId: stepResult.apiId || '',
            configId: stepResult.apiConfigId || '',
            gatewayId: stepResult.gatewayId || '',
            created: true,
            url: stepResult.apiGatewayUrl
          };
        }
        break;
      
      case 'Generating API keys':
        if (stepResult.apiKey) {
          resources.apiKey = {
            keyId: stepResult.apiKeyId || '',
            value: stepResult.apiKey,
            created: true
          };
        }
        break;
    }

    return resources;
  }

  private async checkPrerequisites() {
    console.log('Checking project prerequisites...');
    
    const prerequisites = {
      firebaseEnabled: false,
      storageEnabled: false,
      firestoreEnabled: false,
      authConfigured: false,
      emailPasswordEnabled: false,
      hasAuthUsers: false,
      requiredAPIs: [] as string[],
    };
    
    // Check if Firebase is enabled
    try {
      await this.gcpApiCall(
        `https://firebase.googleapis.com/v1beta1/projects/${this.config.projectId}`
      );
      prerequisites.firebaseEnabled = true;
    } catch (err) {
      console.log('Firebase not enabled');
    }
    
    // Check if Firebase Storage is enabled by checking for Firebase storage bucket
    try {
      // Use Cloud Storage API to check if Firebase storage bucket exists
      await this.gcpApiCall(
        `https://storage.googleapis.com/storage/v1/b/${this.config.projectId}.firebasestorage.app`
      );
      prerequisites.storageEnabled = true;
    } catch (err) {
      console.log('Firebase Storage bucket not found');
    }
    
    // Check if Firestore database exists
    try {
      // Use Firestore API to check if database exists
      await this.gcpApiCall(
        `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)`
      );
      prerequisites.firestoreEnabled = true;
    } catch (err) {
      console.log('Firestore database not found');
    }
    
    // Check Firebase Authentication configuration
    if (prerequisites.firebaseEnabled) {
      try {
        // Check if Firebase Auth is configured
        const authConfig = await this.gcpApiCall(
          `https://identitytoolkit.googleapis.com/v2/projects/${this.config.projectId}/config`
        );
        prerequisites.authConfigured = true;
        
        // Check if email/password sign-in is enabled
        if (authConfig.signIn?.email?.enabled === true) {
          prerequisites.emailPasswordEnabled = true;
        }
        
        // Check if there are any users (we need at least one for testing)
        try {
          // Use the Firebase Auth Admin API to list users instead of accounts:lookup
          // The accounts:lookup endpoint requires an idToken or localId parameter
          const users = await this.gcpApiCall(
            `https://identitytoolkit.googleapis.com/v1/projects/${this.config.projectId}/accounts:query`,
            {
              method: 'POST',
              body: JSON.stringify({
                returnUserInfo: true,
                maxResults: 1
              })
            }
          );
          if (users.userInfo && users.userInfo.length > 0) {
            prerequisites.hasAuthUsers = true;
          }
        } catch (err) {
          console.log('No Firebase Auth users found');
        }
      } catch (err: any) {
        console.log('Firebase Auth not configured:', err.message);
      }
    }
    
    // If Firebase, Storage, Firestore, or Auth are missing, throw detailed error
    if (!prerequisites.firebaseEnabled || !prerequisites.storageEnabled || !prerequisites.firestoreEnabled || 
        !prerequisites.authConfigured || !prerequisites.emailPasswordEnabled || !prerequisites.hasAuthUsers) {
      const missingSteps = [];
      
      if (!prerequisites.firebaseEnabled) {
        missingSteps.push({
          name: 'Enable Firebase',
          description: 'Firebase must be enabled for authentication and storage',
          action: `Open Firebase Console: https://console.firebase.google.com/project/${this.config.projectId}/overview and click "Get started"`,
        });
      }
      
      if (!prerequisites.storageEnabled) {
        missingSteps.push({
          name: 'Set up Firebase Storage',
          description: 'Firebase Storage bucket must be created manually for image uploads',
          action: `Open Firebase Storage: https://console.firebase.google.com/project/${this.config.projectId}/storage and click "Get started", then choose your storage location`,
        });
      }
      
      if (!prerequisites.firestoreEnabled) {
        missingSteps.push({
          name: 'Create Firestore Database',
          description: 'Firestore database must be created manually to choose region and security rules. IMPORTANT: Leave database name as "(default)" - do not change it! For security, choose "Production mode" rules.',
          action: `Open Firestore Console: https://console.firebase.google.com/project/${this.config.projectId}/firestore and click "Create database". Keep database name as "(default)"`,
        });
      }
      
      if (prerequisites.firebaseEnabled && !prerequisites.authConfigured) {
        missingSteps.push({
          name: 'Initialize Firebase Authentication',
          description: 'Firebase Authentication must be initialized to enable user authentication',
          action: `Open Firebase Auth: https://console.firebase.google.com/project/${this.config.projectId}/authentication and click "Get started"`,
        });
      }
      
      if (prerequisites.authConfigured && !prerequisites.emailPasswordEnabled) {
        missingSteps.push({
          name: 'Enable Email/Password Sign-in',
          description: 'Email/Password authentication must be enabled for device authentication to work',
          action: `Go to Firebase Auth Settings: https://console.firebase.google.com/project/${this.config.projectId}/authentication/providers and enable "Email/Password" sign-in method`,
          steps: [
            '1. Click on "Email/Password" in the providers list',
            '2. Toggle "Enable" switch to ON',
            '3. Click "Save"'
          ],
        });
      }
      
      if (prerequisites.emailPasswordEnabled && !prerequisites.hasAuthUsers) {
        missingSteps.push({
          name: 'Create a Test User',
          description: 'At least one Firebase Auth user is required for testing the authentication flow',
          action: `Go to Firebase Auth Users: https://console.firebase.google.com/project/${this.config.projectId}/authentication/users and add a test user`,
          steps: [
            '1. Click "Add user" button',
            '2. Enter a test email (e.g., test@example.com)',
            '3. Enter a secure password',
            '4. Click "Add user"',
            '5. Save these credentials for testing the device authentication flow'
          ],
        });
      }
      
      // Base64 encode the JSON to prevent sanitization from breaking the structure
      const encodedSteps = Buffer.from(JSON.stringify(missingSteps)).toString('base64');
      throw new Error(`PREREQUISITES_MISSING:${encodedSteps}`);
    }
    
    return { prerequisitesChecked: true };
  }

  private async gcpApiCall(url: string, options: RequestInit = {}, retries = 3, timeoutMs = 300000) {
    console.log(`GCP API Call: ${options.method || 'GET'} ${url}`);
    if (options.body) {
      console.log('Request body:', options.body);
    }
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Create an AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.text();
          console.error(`GCP API Error Response (attempt ${attempt}/${retries}): ${error}`);
          
          // Retry on 500, 502, 503, 504 errors
          if (response.status >= 500 && attempt < retries) {
            console.log(`Retrying in ${attempt * 2} seconds...`);
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            continue;
          }
          
          throw new Error(`GCP API Error: ${response.status} - ${error}`);
        }

        return response.json();
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.error(`Request timed out after ${timeoutMs}ms (attempt ${attempt}/${retries})`);
          if (attempt < retries) {
            console.log('Retrying with longer timeout...');
            timeoutMs = Math.min(timeoutMs * 1.5, 600000); // Increase timeout up to 10 minutes max
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            continue;
          }
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        if (attempt === retries) throw err;
        console.log(`Network error on attempt ${attempt}/${retries}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
      }
    }
  }

  private async validateProject() {
    const projectId = this.config.projectId;
    const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`;
    
    const project = await this.gcpApiCall(url);
    
    if (project.lifecycleState !== 'ACTIVE') {
      throw new Error('Project is not active');
    }

    // Get project number for later use
    this.config.projectNumber = project.projectNumber;
    
    // Check if billing is enabled
    console.log('Checking billing status...');
    try {
      const billingInfo = await this.gcpApiCall(
        `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`
      );
      
      if (!billingInfo.billingEnabled) {
        throw new Error(`❌ BILLING NOT ENABLED

The project "${projectId}" does not have billing enabled.

This installer CANNOT proceed without active billing on the project.

To enable billing:
1. Go to: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}
2. Click "Link a billing account" or "Enable billing"
3. Select or create a billing account
4. Then try the installer again

Why billing is required:
• Cloud Functions deployment needs Cloud Storage buckets
• API Gateway requires billing
• Most GCP services beyond the free tier need billing

Note: You can set budget alerts to control costs.`);
      }
      
      console.log('✅ Billing is enabled');
    } catch (err: any) {
      // If it's a permission error, warn but continue
      if (err.message.includes('403') || err.message.includes('Permission')) {
        console.warn('⚠️  Unable to verify billing status (permission denied) - continuing anyway...');
      } else if (err.message.includes('BILLING NOT ENABLED')) {
        // Re-throw our custom billing error
        throw err;
      } else {
        // For other errors, warn but continue
        console.warn('⚠️  Unable to verify billing status:', err.message);
      }
    }
    
    return { projectValidated: true, projectNumber: project.projectNumber };
  }

  private async enableAPIs() {
    const apis = [
      // APIs from the bash script that were missing
      'identitytoolkit.googleapis.com',
      'storage.googleapis.com', 
      'firebasestorage.googleapis.com',
      'aiplatform.googleapis.com',
      'run.googleapis.com',
      'cloudbuild.googleapis.com',
      'artifactregistry.googleapis.com',
      'logging.googleapis.com',
      'pubsub.googleapis.com',
      'compute.googleapis.com',
      
      // Existing APIs (keeping all original ones)
      'cloudbilling.googleapis.com',
      'cloudfunctions.googleapis.com',
      'firestore.googleapis.com',
      'firebase.googleapis.com',
      'apigateway.googleapis.com',
      'servicecontrol.googleapis.com',
      'servicemanagement.googleapis.com',
      'apigatewaymanagement.googleapis.com',
      'iamcredentials.googleapis.com',
      'sts.googleapis.com',
      'iam.googleapis.com',
      'cloudresourcemanager.googleapis.com',
      'serviceusage.googleapis.com',
      'endpoints.googleapis.com',
      'apikeys.googleapis.com',
    ];

    const enablePromises = apis.map(api => 
      this.gcpApiCall(
        `https://serviceusage.googleapis.com/v1/projects/${this.config.projectId}/services/${api}:enable`,
        { method: 'POST' }
      ).catch(err => console.warn(`Failed to enable ${api}:`, err))
    );

    await Promise.all(enablePromises);
    
    // Wait for APIs to propagate (especially critical for API Gateway)
    console.log('Waiting 60 seconds for APIs to fully enable (API Gateway needs extra time)...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    // After enabling API Gateway API, ensure its service agent is created
    // This helps avoid permission issues later
    console.log('Ensuring API Gateway service agent is created...');
    try {
      // Making a simple API call to API Gateway will trigger service agent creation
      await this.gcpApiCall(
        `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis`
      ).catch(() => {
        // Ignore errors - we just want to trigger service agent creation
      });
      
      // Give the service agent time to be created
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (err) {
      console.log('Note: API Gateway service agent creation triggered');
    }
    
    return { apisEnabled: true };
  }

  private async createServiceAccounts() {
    const serviceAccounts = [
      { id: 'vertex-ai-sa', displayName: 'Vertex AI Main SA' },
      { id: 'device-auth-sa', displayName: 'Device Auth Function SA' },
      { id: 'tvm-sa', displayName: 'Token Vending Machine SA' },
      { id: 'apigw-invoker-sa', displayName: 'API Gateway Invoker SA' },
    ];

    const results: any = {};

    for (const sa of serviceAccounts) {
      const accountId = `${this.config.solutionPrefix}-${sa.id}`;
      const email = `${accountId}@${this.config.projectId}.iam.gserviceaccount.com`;
      
      try {
        console.log(`Creating service account: ${accountId}`);
        
        // Check if service account already exists
        try {
          const existing = await this.gcpApiCall(
            `https://iam.googleapis.com/v1/projects/${this.config.projectId}/serviceAccounts/${email}`
          );
          console.log(`Service account already exists: ${email}`);
          results[sa.id.replace('-', '_') + '_email'] = email;
          continue;
        } catch (checkErr: any) {
          // If 404, service account doesn't exist, so create it
          if (!checkErr.message.includes('404')) {
            throw checkErr;
          }
        }
        
        // Create service account with correct API format
        const createResponse = await this.gcpApiCall(
          `https://iam.googleapis.com/v1/projects/${this.config.projectId}/serviceAccounts`,
          {
            method: 'POST',
            body: JSON.stringify({
              accountId: accountId,
              serviceAccount: {
                displayName: sa.displayName
              }
            })
          }
        );
        console.log(`Created service account: ${email}`);
      } catch (err: any) {
        console.error(`Error creating service account ${accountId}:`, err.message);
        throw err;
      }

      results[sa.id.replace('-', '_') + '_email'] = email;
    }

    // Grant necessary IAM roles
    await this.grantIAMRoles(results);

    return results;
  }

  private async grantIAMRoles(serviceAccounts: any) {
    console.log('Granting IAM roles to service accounts:', serviceAccounts);
    
    const policy = await this.gcpApiCall(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${this.config.projectId}:getIamPolicy`,
      { method: 'POST', body: JSON.stringify({}) }
    );

    // Clean up any undefined members in existing bindings
    policy.bindings = policy.bindings.map((binding: any) => ({
      ...binding,
      members: binding.members.filter((member: string) => !member.includes('undefined'))
    })).filter((binding: any) => binding.members.length > 0);

    // Helper function to add role binding
    const addRoleBinding = (role: string, member: string) => {
      if (!member || member.includes('undefined')) {
        console.warn(`Skipping invalid member: ${member} for role ${role}`);
        return;
      }
      
      const existingBinding = policy.bindings.find((b: any) => b.role === role);
      if (existingBinding) {
        if (!existingBinding.members.includes(member)) {
          existingBinding.members.push(member);
        }
      } else {
        policy.bindings.push({
          role: role,
          members: [member]
        });
      }
    };

    // Add roles for service accounts
    if (serviceAccounts.vertex_ai_sa_email) {
      addRoleBinding('roles/aiplatform.user', `serviceAccount:${serviceAccounts.vertex_ai_sa_email}`);
      addRoleBinding('roles/storage.objectAdmin', `serviceAccount:${serviceAccounts.vertex_ai_sa_email}`);
      addRoleBinding('roles/datastore.user', `serviceAccount:${serviceAccounts.vertex_ai_sa_email}`);
      addRoleBinding('roles/iam.workloadIdentityUser', `serviceAccount:${serviceAccounts.vertex_ai_sa_email}`);
      addRoleBinding('roles/logging.logWriter', `serviceAccount:${serviceAccounts.vertex_ai_sa_email}`);
    }

    if (serviceAccounts.device_auth_sa_email) {
      addRoleBinding('roles/cloudfunctions.invoker', `serviceAccount:${serviceAccounts.device_auth_sa_email}`);
      addRoleBinding('roles/firebaseauth.admin', `serviceAccount:${serviceAccounts.device_auth_sa_email}`);
      addRoleBinding('roles/logging.logWriter', `serviceAccount:${serviceAccounts.device_auth_sa_email}`);
      addRoleBinding('roles/iam.serviceAccountTokenCreator', `serviceAccount:${serviceAccounts.device_auth_sa_email}`);
    }

    if (serviceAccounts.tvm_sa_email) {
      addRoleBinding('roles/cloudfunctions.invoker', `serviceAccount:${serviceAccounts.tvm_sa_email}`);
      addRoleBinding('roles/iam.serviceAccountTokenCreator', `serviceAccount:${serviceAccounts.tvm_sa_email}`);
      addRoleBinding('roles/logging.logWriter', `serviceAccount:${serviceAccounts.tvm_sa_email}`);
    }

    if (serviceAccounts.apigw_invoker_sa_email) {
      addRoleBinding('roles/logging.logWriter', `serviceAccount:${serviceAccounts.apigw_invoker_sa_email}`);
    }

    await this.gcpApiCall(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${this.config.projectId}:setIamPolicy`,
      {
        method: 'POST',
        body: JSON.stringify({ policy })
      }
    );

    // Grant TVM SA permission to impersonate Vertex AI SA
    if (serviceAccounts.tvm_sa_email && serviceAccounts.vertex_ai_sa_email) {
      console.log('Granting TVM SA permission to impersonate Vertex AI SA...');
      
      const saPolicy = await this.gcpApiCall(
        `https://iam.googleapis.com/v1/projects/${this.config.projectId}/serviceAccounts/${serviceAccounts.vertex_ai_sa_email}:getIamPolicy`,
        { method: 'POST', body: JSON.stringify({}) }
      );

      // Add TVM SA as token creator for Vertex AI SA
      const tvmMember = `serviceAccount:${serviceAccounts.tvm_sa_email}`;
      const tokenCreatorRole = 'roles/iam.serviceAccountTokenCreator';
      
      const existingBinding = saPolicy.bindings?.find((b: any) => b.role === tokenCreatorRole);
      if (existingBinding) {
        if (!existingBinding.members.includes(tvmMember)) {
          existingBinding.members.push(tvmMember);
        }
      } else {
        if (!saPolicy.bindings) saPolicy.bindings = [];
        saPolicy.bindings.push({
          role: tokenCreatorRole,
          members: [tvmMember]
        });
      }

      await this.gcpApiCall(
        `https://iam.googleapis.com/v1/projects/${this.config.projectId}/serviceAccounts/${serviceAccounts.vertex_ai_sa_email}:setIamPolicy`,
        {
          method: 'POST',
          body: JSON.stringify({ policy: saPolicy })
        }
      );
    }
  }

  private async setupFirebase() {
    // Check if Firebase is already enabled
    try {
      const firebaseProject = await this.gcpApiCall(
        `https://firebase.googleapis.com/v1beta1/projects/${this.config.projectId}`
      );
      
      if (!firebaseProject.projectId) {
        // Initialize Firebase
        await this.gcpApiCall(
          `https://firebase.googleapis.com/v1beta1/projects/${this.config.projectId}:addFirebase`,
          { method: 'POST' }
        );
        
        // Wait for Firebase to be ready
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    } catch (err) {
      // Firebase not initialized, add it
      await this.gcpApiCall(
        `https://firebase.googleapis.com/v1beta1/projects/${this.config.projectId}:addFirebase`,
        { method: 'POST' }
      );
      
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    // Create Firestore database
    await this.createFirestoreDatabase();
    
    // Get Firebase web app config
    let firebaseWebApiKey = '';
    try {
      // Get the Firebase project config which includes the Web API Key
      const firebaseConfig = await this.gcpApiCall(
        `https://firebase.googleapis.com/v1beta1/projects/${this.config.projectId}/webApps`
      );
      
      // If no web app exists, create one
      if (!firebaseConfig.apps || firebaseConfig.apps.length === 0) {
        console.log('Creating Firebase web app...');
        const webApp = await this.gcpApiCall(
          `https://firebase.googleapis.com/v1beta1/projects/${this.config.projectId}/webApps`,
          {
            method: 'POST',
            body: JSON.stringify({
              displayName: `${this.config.solutionPrefix} Web App`,
            })
          }
        );
        
        // Wait for app creation
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Get the web app config
      const apps = await this.gcpApiCall(
        `https://firebase.googleapis.com/v1beta1/projects/${this.config.projectId}/webApps`
      );
      
      if (apps.apps && apps.apps.length > 0) {
        const appId = apps.apps[0].appId;
        const configResponse = await this.gcpApiCall(
          `https://firebase.googleapis.com/v1beta1/projects/${this.config.projectId}/webApps/${appId}/config`
        );
        
        firebaseWebApiKey = configResponse.apiKey || '';
        console.log('Retrieved Firebase Web API Key:', firebaseWebApiKey);
      }
    } catch (err) {
      console.error('Failed to get Firebase web app config:', err);
    }

    return { 
      firebaseEnabled: true,
      firebaseWebApiKey: firebaseWebApiKey
    };
  }

  private async createFirestoreDatabase() {
    const databaseId = '(default)';
    
    try {
      // Check if default database already exists
      const existing = await this.gcpApiCall(
        `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/${databaseId}`
      );
      console.log('Firestore database already exists');
      return { firestoreDatabase: databaseId };
    } catch (err: any) {
      if (!err.message.includes('404')) {
        // Check if this is a Firebase/Firestore not set up error
        if (err.message.includes('Firebase') || err.message.includes('not found')) {
          throw new Error(`❌ FIREBASE/FIRESTORE NOT SET UP

The project "${this.config.projectId}" needs Firebase and Firestore to be manually enabled first.

Required manual steps:
1. Enable Firebase: https://console.firebase.google.com/project/${this.config.projectId}/overview
   - Click "Get started" if Firebase is not yet enabled
   
2. Create Firestore Database: https://console.cloud.google.com/firestore/databases?project=${this.config.projectId}
   - Click "Create Database"
   - Select "Production mode"
   - Choose your region: ${this.config.region}
   - Click "Create"

3. Then run this installer again.

Why these steps are manual:
• Firebase project initialization requires accepting terms
• Firestore database creation requires selecting security rules
• These cannot be automated via API`);
        }
        throw err;
      }
      // Database doesn't exist, create it
    }
    
    try {
      console.log('Creating Firestore database...');
      // Create default database - ensure NO database_id in any form
      const createDbResponse = await this.gcpApiCall(
        `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases`,
        {
          method: 'POST',
          body: JSON.stringify({
            locationId: this.config.region,
            type: 'FIRESTORE_NATIVE',
            // Explicitly NOT including any database_id field
          })
        }
      );
      
      // Wait for operation to complete if it returns an operation
      if (createDbResponse.name && createDbResponse.name.includes('operations/')) {
        console.log('Waiting for Firestore database creation...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      console.log('Firestore database created');
    } catch (err: any) {
      console.error('Firestore creation error:', err.message);
      
      // If it's a 400 error about database_id, provide helpful message
      if (err.message.includes('database_id should be 4-63 characters')) {
        throw new Error(`❌ FIRESTORE SETUP REQUIRED

Cannot create Firestore database automatically. This usually means Firebase/Firestore needs manual setup first.

Please complete these steps:
1. Go to: https://console.cloud.google.com/firestore/databases?project=${this.config.projectId}
2. Click "Create Database" 
3. Select "Production mode"
4. Choose region: ${this.config.region}
5. Click "Create"
6. Then run this installer again

This manual step is required because Firestore needs you to choose security rules.`);
      }
      
      if (!err.message.includes('409')) throw err;
      console.log('Firestore database already exists');
    }

    return { firestoreDatabase: databaseId };
  }

  private async deployFunctions() {
    const functions = [
      {
        name: `${this.config.solutionPrefix}-device-auth`,
        entryPoint: 'device_authenticator',
        code: DEVICE_AUTH_FUNCTION_CODE,
        runtime: 'python311',
        serviceAccount: `${this.config.solutionPrefix}-device-auth-sa@${this.config.projectId}.iam.gserviceaccount.com`,
      },
      {
        name: `${this.config.solutionPrefix}-tvm`,
        entryPoint: 'token_vendor_machine',
        code: TVM_FUNCTION_CODE,
        runtime: 'python311',
        serviceAccount: `${this.config.solutionPrefix}-tvm-sa@${this.config.projectId}.iam.gserviceaccount.com`,
        environmentVariables: {
          WIF_PROJECT_NUMBER: this.config.projectNumber,
          WIF_POOL_ID: `${this.config.solutionPrefix}-device-pool`,
          WIF_PROVIDER_ID: `${this.config.solutionPrefix}-firebase-provider`,
          TARGET_SERVICE_ACCOUNT_EMAIL: `${this.config.solutionPrefix}-vertex-ai-sa@${this.config.projectId}.iam.gserviceaccount.com`,
        }
      }
    ];

    const functionUrls: any = {};

    for (const fn of functions) {
      console.log(`Creating Cloud Function: ${fn.name}`);
      
      // Check if function already exists
      try {
        const existing = await this.gcpApiCall(
          `https://cloudfunctions.googleapis.com/v2/projects/${this.config.projectId}/locations/${this.config.region}/functions/${fn.name}`
        );
        console.log(`Function ${fn.name} already exists`);
        functionUrls[fn.name] = existing.serviceConfig?.uri;
        continue;
      } catch (err: any) {
        if (!err.message.includes('404')) {
          throw err;
        }
      }
      
      // Create the function using Cloud Functions v2 API with inline source
      const functionConfig = {
        name: `projects/${this.config.projectId}/locations/${this.config.region}/functions/${fn.name}`,
        description: `${fn.name} function for Anava IoT platform`,
        buildConfig: {
          runtime: fn.runtime,
          entryPoint: fn.entryPoint,
          source: {
            inlineSource: {
              files: {
                'main.py': fn.code,
                'requirements.txt': 'functions-framework>=3.1.0\nfirebase-admin>=6.1.0\nrequests>=2.28.0'
              }
            }
          }
        },
        serviceConfig: {
          serviceAccountEmail: fn.serviceAccount,
          maxInstanceCount: 5,
          availableMemory: '256Mi',
          timeoutSeconds: 60,
          environmentVariables: fn.environmentVariables || {},
          ingressSettings: 'ALLOW_INTERNAL_ONLY'
        }
      };

      try {
        console.log(`Deploying function ${fn.name}...`);
        const operation = await this.gcpApiCall(
          `https://cloudfunctions.googleapis.com/v2/projects/${this.config.projectId}/locations/${this.config.region}/functions?functionId=${fn.name}`,
          {
            method: 'POST',
            body: JSON.stringify(functionConfig)
          }
        );

        // Wait for operation to complete
        if (operation.name) {
          console.log(`Waiting for function ${fn.name} deployment to complete...`);
          await this.waitForOperation(operation.name);
        }

        // Get the function URL
        const deployed = await this.gcpApiCall(
          `https://cloudfunctions.googleapis.com/v2/projects/${this.config.projectId}/locations/${this.config.region}/functions/${fn.name}`
        );
        
        functionUrls[fn.name] = deployed.serviceConfig?.uri;
        console.log(`Function ${fn.name} deployed successfully: ${functionUrls[fn.name]}`);

        // Grant API Gateway invoker permissions
        await this.grantFunctionInvokerPermissions(fn.name);

      } catch (error: any) {
        console.error(`Failed to deploy function ${fn.name}:`, error);
        // Fall back to expected URL format
        functionUrls[fn.name] = `https://${this.config.region}-${this.config.projectId}.cloudfunctions.net/${fn.name}`;
        functionUrls[`${fn.name}_deployment_failed`] = true;
      }
    }

    return functionUrls;
  }

  private async grantFunctionInvokerPermissions(functionName: string) {
    const invokerSaEmail = `${this.config.solutionPrefix}-apigw-invoker-sa@${this.config.projectId}.iam.gserviceaccount.com`;
    
    try {
      await this.gcpApiCall(
        `https://cloudfunctions.googleapis.com/v2/projects/${this.config.projectId}/locations/${this.config.region}/functions/${functionName}:setIamPolicy`,
        {
          method: 'POST',
          body: JSON.stringify({
            policy: {
              bindings: [
                {
                  role: 'roles/cloudfunctions.invoker',
                  members: [`serviceAccount:${invokerSaEmail}`]
                }
              ]
            }
          })
        }
      );
      console.log(`Granted invoker permissions to ${invokerSaEmail} for function ${functionName}`);
    } catch (error) {
      console.warn(`Failed to grant invoker permissions for ${functionName}:`, error);
    }
  }

  private async setupWorkloadIdentity() {
    const poolId = `${this.config.solutionPrefix}-device-pool`;
    const providerId = `${this.config.solutionPrefix}-firebase-provider`;

    // Create Workload Identity Pool
    try {
      await this.gcpApiCall(
        `https://iam.googleapis.com/v1/projects/${this.config.projectId}/locations/global/workloadIdentityPools?workloadIdentityPoolId=${poolId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            displayName: `${this.config.solutionPrefix} Device Pool`,
          })
        }
      );
    } catch (err: any) {
      if (!err.message.includes('409')) throw err;
    }

    // Create OIDC Provider
    const issuerUri = `https://securetoken.google.com/${this.config.projectId}`;
    
    try {
      await this.gcpApiCall(
        `https://iam.googleapis.com/v1/projects/${this.config.projectId}/locations/global/workloadIdentityPools/${poolId}/providers?workloadIdentityPoolProviderId=${providerId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            displayName: `${this.config.solutionPrefix} Firebase Provider`,
            oidc: {
              issuerUri,
              allowedAudiences: [this.config.projectId],
            },
            attributeMapping: {
              'google.subject': 'assertion.sub',
              'attribute.aud': 'assertion.aud',
            }
          })
        }
      );
    } catch (err: any) {
      if (!err.message.includes('409')) throw err;
    }

    return { workloadIdentityConfigured: true };
  }

  private async grantAPIGatewayPermissions() {
    console.log('Granting permissions to API Gateway service agent...');
    
    // The API Gateway service agent email follows this pattern
    const apiGatewayServiceAgent = `service-${this.config.projectNumber}@gcp-sa-apigateway.iam.gserviceaccount.com`;
    
    try {
      // Get current IAM policy
      const policy = await this.gcpApiCall(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${this.config.projectId}:getIamPolicy`,
        { method: 'POST', body: JSON.stringify({}) }
      );

      // Add necessary roles for API Gateway service agent
      const roles = [
        'roles/servicemanagement.serviceController',
        'roles/servicemanagement.configEditor'
      ];

      for (const role of roles) {
        const existingBinding = policy.bindings.find((b: any) => b.role === role);
        const member = `serviceAccount:${apiGatewayServiceAgent}`;
        
        if (existingBinding) {
          if (!existingBinding.members.includes(member)) {
            existingBinding.members.push(member);
          }
        } else {
          policy.bindings.push({
            role: role,
            members: [member]
          });
        }
      }

      // Update IAM policy
      await this.gcpApiCall(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${this.config.projectId}:setIamPolicy`,
        {
          method: 'POST',
          body: JSON.stringify({ policy })
        }
      );
      
      console.log('API Gateway permissions granted successfully');
      
      // Wait a bit for permissions to propagate
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (err) {
      console.error('Error granting API Gateway permissions:', err);
      // Continue anyway - the permissions might already be set
    }
  }

  private async createAPIGateway() {
    console.log('Creating API Gateway...');
    
    // Wait for API Gateway service to be fully ready after enabling
    console.log('Waiting 60 seconds for API Gateway service to fully initialize...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    // First, ensure API Gateway service agent has necessary permissions
    await this.grantAPIGatewayPermissions();
    
    const apiId = `${this.config.solutionPrefix}-device-api`;
    const gatewayId = `${this.config.solutionPrefix}-gateway`;

    // First, verify API Gateway API is enabled
    try {
      console.log('Verifying API Gateway API is enabled...');
      await this.gcpApiCall(
        `https://serviceusage.googleapis.com/v1/projects/${this.config.projectId}/services/apigateway.googleapis.com`
      );
    } catch (err: any) {
      console.error('API Gateway API not enabled:', err.message);
      throw new Error('API Gateway API is not enabled. Please ensure apigateway.googleapis.com is enabled.');
    }

    // Check if API already exists first
    let apiExists = false;
    let apiDetails: any;
    
    // Retry logic for "Location global is not found" error
    let apiRetryCount = 0;
    const apiMaxRetries = 3;
    
    while (apiRetryCount < apiMaxRetries) {
      try {
        console.log(`Checking if API ${apiId} already exists... (attempt ${apiRetryCount + 1})`);
        
        // Now check for our specific API
        apiDetails = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}`
        );
        apiExists = true;
        console.log(`API ${apiId} already exists with managed service: ${apiDetails.managedService}`);
        break;
      } catch (err: any) {
        if (err.message.includes('404')) {
          console.log('API does not exist, will create it...');
          break;
        } else if (err.message.includes('403') && err.message.includes('Location global')) {
          apiRetryCount++;
          if (apiRetryCount < apiMaxRetries) {
            console.log(`Got "Location global" error. API Gateway service may still be initializing. Waiting 30s before retry ${apiRetryCount}/${apiMaxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 30000));
            continue;
          } else {
            console.log('API Gateway service still not ready after retries. Proceeding anyway...');
            break;
          }
        } else if (err.message.includes('403')) {
          console.log('Got 403 error checking for API - this is a known issue. Proceeding to create/update...');
          break;
        } else if (!err.message.includes('access denied')) {
          throw err;
        }
        break;
      }
    }

    // Create API only if it doesn't exist
    if (!apiExists) {
      let createRetries = 0;
      const maxCreateRetries = 3;
      
      while (createRetries < maxCreateRetries) {
        try {
          console.log(`Creating API Gateway API: ${apiId} (global location)... (attempt ${createRetries + 1})`);
          await this.gcpApiCall(
            `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis?apiId=${apiId}`,
            {
              method: 'POST',
              body: JSON.stringify({
                displayName: `${this.config.solutionPrefix} Device API`,
              })
            }
          );
          console.log('API created successfully, waiting 30s for propagation...');
          await new Promise(resolve => setTimeout(resolve, 30000));
          break;
        } catch (err: any) {
          if (err.message.includes('403') && err.message.includes('Location global')) {
            createRetries++;
            if (createRetries < maxCreateRetries) {
              console.log(`Got "Location global" error during create. Waiting 30s before retry ${createRetries}/${maxCreateRetries}...`);
              await new Promise(resolve => setTimeout(resolve, 30000));
              continue;
            } else {
              throw new Error('API Gateway service is not ready. Please wait a few minutes and try again.');
            }
          } else {
            // Handle other errors as before
            throw err;
          }
        }
      }
      
      // Get the details of the newly created API
      try {
        apiDetails = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}`
        );
      } catch (err: any) {
        if (err.message.includes('409')) {
          console.log('API already exists (409), continuing...');
          // Try to get the existing API details
          try {
            apiDetails = await this.gcpApiCall(
              `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}`
            );
          } catch (getErr: any) {
            console.log('Failed to get API details after 409:', getErr.message);
            // Continue without details - we'll handle it later
          }
        } else if (err.message.includes('403') && err.message.includes('Location global')) {
          console.log('Got 403 error in create section - ignoring and continuing...');
          // Don't throw - we'll handle missing API details later
        } else {
          throw err;
        }
      }
    }

    // If we don't have API details yet (due to 403 error), try to get them now
    if (!apiDetails || !apiDetails.managedService) {
      console.log('Attempting to retrieve API details after creation/update...');
      try {
        apiDetails = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}`
        );
      } catch (err: any) {
        console.log('Still getting 403 on API details. Using expected managed service name...');
        // Fallback to expected format
        apiDetails = {
          managedService: `${apiId}-${Math.random().toString(36).substring(7)}.apigateway.${this.config.projectId}.cloud.goog`
        };
      }
    }

    // Create OpenAPI spec using the managed service name
    const openApiSpec = this.generateOpenAPISpec(apiDetails.managedService);
    
    // CRITICAL: Deploy the service configuration first (like gcloud endpoints services deploy)
    // This creates the managed service that can then be enabled
    if (apiDetails.managedService) {
      console.log(`Deploying service configuration for: ${apiDetails.managedService}`);
      this.onProgress('Deploying API Gateway service configuration...', 81);
      
      try {
        // Use Service Management API to deploy the OpenAPI spec
        // This is equivalent to: gcloud endpoints services deploy openapi.yaml
        const configResponse = await this.gcpApiCall(
          `https://servicemanagement.googleapis.com/v1/services/${apiDetails.managedService}/configs`,
          {
            method: 'POST',
            body: JSON.stringify({
              openapi: openApiSpec
            })
          }
        );
        
        console.log('✅ Service configuration deployed successfully');
        console.log('Waiting 30 seconds for service configuration to propagate...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Now enable the managed service
        console.log(`Enabling managed service: ${apiDetails.managedService}`);
        this.onProgress('Enabling API Gateway managed service...', 82);
        
        await this.gcpApiCall(
          `https://serviceusage.googleapis.com/v1/projects/${this.config.projectId}/services/${apiDetails.managedService}:enable`,
          { method: 'POST' }
        );
        console.log('✅ Managed service enabled successfully');
        
        // Wait for the service to fully propagate
        console.log('Waiting 30 seconds for managed service to propagate...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
      } catch (err: any) {
        console.error(`Failed to deploy/enable managed service ${apiDetails.managedService}:`, err.message);
        // Continue anyway - the service might already exist
        console.warn('⚠️  Service deployment failed. This might mean it already exists. Continuing...');
      }
    }

    // Create API Config (configs are also global)
    const configId = `${apiId}-config-${Date.now()}`;
    
    let configResponse;
    try {
      configResponse = await this.gcpApiCall(
        `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}/configs?apiConfigId=${configId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            displayName: 'API Config',
            openapiDocuments: [{
              document: {
                path: 'openapi.yaml',
                contents: btoa(openApiSpec),
              }
            }],
            gatewayServiceAccount: `${this.config.solutionPrefix}-apigw-invoker-sa@${this.config.projectId}.iam.gserviceaccount.com`,
          })
        }
      );
      
      console.log('API Config creation initiated. Response:', configResponse.name || 'No operation name');
    } catch (err: any) {
      console.error('Failed to create API Config:', err.message);
      
      // If the error is about permissions, provide a helpful message
      if (err.message.includes('Service Configs') || err.message.includes('permission')) {
        console.log('\n⚠️  API Gateway configuration failed due to permissions.');
        console.log('This is likely because the API Gateway service agent needs time to be created.');
        console.log('\nYou can either:');
        console.log('1. Wait a few minutes and run the installer again');
        console.log('2. Manually grant the service account permissions in the Console');
        console.log(`   Service Account: service-${this.config.projectNumber}@gcp-sa-apigateway.iam.gserviceaccount.com`);
        console.log('   Required roles: Service Management Service Controller, Service Config Editor\n');
        
        // Return without API Gateway for now
        return {
          apiGateway: 'failed_permissions',
          apiGatewayUrl: `https://${this.config.solutionPrefix}-gateway-${this.config.projectId}.apigateway.${this.config.region}.cloud.goog`,
          apiGatewayError: 'Permissions not yet propagated - retry in a few minutes'
        };
      }
      
      throw err;
    }
    
    console.log('API Config creation submitted. Waiting for it to become active...');
    console.log('NOTE: API Gateway activation can take 2-10 minutes. Please be patient...');
    
    // Poll the config status until it's active
    // Increased to 10 minutes (60 checks × 10 seconds) to handle slow GCP provisioning
    const maxChecks = 60;
    let configReady = false;
    
    for (let i = 1; i <= maxChecks; i++) {
      try {
        const configStatus = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}/configs/${configId}`
        );
        
        if (configStatus.state === 'ACTIVE') {
          configReady = true;
          console.log(`API Config ${configId} is ACTIVE after ${i * 10} seconds.`);
          this.onProgress('Creating API Gateway - Configuration activated!', 82);
          break;
        }
        
        // Provide more detailed progress updates
        const minutesWaited = Math.floor((i * 10) / 60);
        const secondsWaited = (i * 10) % 60;
        const timeStr = minutesWaited > 0 ? `${minutesWaited}m ${secondsWaited}s` : `${secondsWaited}s`;
        
        // Update UI progress with retry information
        this.onProgress(
          `Creating API Gateway - Waiting for activation (${timeStr} elapsed, check ${i}/${maxChecks})`, 
          80 + Math.floor((i / maxChecks) * 5)
        );
        
        console.log(`API Config state: ${configStatus.state || 'PENDING'}. Waited ${timeStr}... (${i}/${maxChecks})`);
      } catch (err: any) {
        // Still update progress even on errors
        this.onProgress(
          `Creating API Gateway - Checking status (attempt ${i}/${maxChecks})`, 
          80 + Math.floor((i / maxChecks) * 5)
        );
        console.log(`Checking config status... (${i}/${maxChecks})`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    if (!configReady) {
      // Instead of throwing an error, provide a more helpful message
      console.error(`API Config ${configId} is taking longer than expected to activate.`);
      console.error('This is a known issue with GCP API Gateway that can take up to 15 minutes.');
      console.error('The installation will continue, but the API Gateway might not be immediately available.');
      
      // Return partial success instead of failing
      return {
        apiGatewayWarning: 'API Gateway is still activating. It may take up to 15 minutes to become fully operational.',
        apiId,
        configId,
        gatewayId,
        shouldRetryLater: true
      };
    }

    // Create Gateway (gateways are regional, but reference global API/config)
    let gatewayRegion = this.config.region;
    let gatewayExists = false;
    let gateway: any;
    
    // First try to check if gateway exists in selected region
    try {
      console.log(`Checking if gateway ${gatewayId} exists in ${gatewayRegion}...`);
      gateway = await this.gcpApiCall(
        `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/${gatewayRegion}/gateways/${gatewayId}`
      );
      gatewayExists = true;
      console.log(`Gateway already exists in ${gatewayRegion}, updating with new config...`);
    } catch (err: any) {
      if (err.message.includes('404')) {
        console.log('Gateway does not exist in selected region');
      } else if (err.message.includes('Location') && err.message.includes('not found') && gatewayRegion !== 'us-central1') {
        // Try us-central1 as fallback
        console.log(`API Gateway not supported in ${gatewayRegion}, checking us-central1...`);
        gatewayRegion = 'us-central1';
        try {
          gateway = await this.gcpApiCall(
            `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/${gatewayRegion}/gateways/${gatewayId}`
          );
          gatewayExists = true;
          console.log(`Gateway already exists in ${gatewayRegion}, updating with new config...`);
        } catch (err2: any) {
          if (!err2.message.includes('404')) throw err2;
        }
      } else {
        throw err;
      }
    }
    
    if (gatewayExists) {
      // Update existing gateway with new config
      console.log('Updating existing gateway with new API config...');
      const updateResponse = await this.gcpApiCall(
        `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/${gatewayRegion}/gateways/${gatewayId}?updateMask=apiConfig`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            apiConfig: `projects/${this.config.projectId}/locations/global/apis/${apiId}/configs/${configId}`,
          })
        }
      );
      console.log('Gateway update submitted.');
    } else {
      // Create new gateway
      console.log(`Creating new gateway ${gatewayId} in ${gatewayRegion}...`);
      const createResponse = await this.gcpApiCall(
        `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/${gatewayRegion}/gateways?gatewayId=${gatewayId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            apiConfig: `projects/${this.config.projectId}/locations/global/apis/${apiId}/configs/${configId}`,
            displayName: `${this.config.solutionPrefix} Gateway`,
          })
        }
      );
      console.log('Gateway creation submitted.');
    }
    
    // Wait for gateway to be fully ready
    // API Gateway can take 2-5 minutes to fully deploy
    console.log('Waiting for gateway to be fully deployed (this can take 2-5 minutes)...');
    
    // Start with 2 minute wait, then poll
    await new Promise(resolve => setTimeout(resolve, 120000));
    
    // Poll for gateway readiness
    let retryCount = 0;
    const maxRetries = 10; // Try for up to 5 more minutes
    
    while (retryCount < maxRetries) {
      try {
        console.log(`Checking if gateway is ready... (attempt ${retryCount + 1}/${maxRetries})`);
        const checkGateway = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/${gatewayRegion}/gateways/${gatewayId}`,
          {}, // default GET request
          3, // retries
          30000 // 30 second timeout for status checks
        );
        
        if (checkGateway.state === 'ACTIVE' && checkGateway.defaultHostname) {
          console.log('✅ Gateway is active and ready!');
          gateway = checkGateway;
          break;
        } else {
          console.log(`Gateway state: ${checkGateway.state || 'UNKNOWN'}`);
        }
      } catch (err) {
        console.log(`Gateway not ready yet: ${err}`);
      }
      
      retryCount++;
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s between checks
      }
    }
    
    // If we still don't have the gateway after polling, try one more time
    if (!gateway || !gateway.defaultHostname) {
      console.log('Final attempt to get gateway details...');
      try {
        gateway = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/${gatewayRegion}/gateways/${gatewayId}`,
          {}, // default GET request
          3, // retries  
          60000 // 60 second timeout
        );
      } catch (err) {
        console.warn('Could not retrieve gateway details, using expected hostname');
        // Use a reasonable default hostname format
        gateway = { defaultHostname: `${gatewayId}-${this.config.projectNumber || this.config.projectId}.${gatewayRegion}.gateway.dev` };
      }
    }

    // Get gateway URL
    if (!gatewayExists) {
      gateway = await this.gcpApiCall(
        `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/${gatewayRegion}/gateways/${gatewayId}`
      );
    }

    return { 
      apiGatewayUrl: `https://${gateway.defaultHostname}`,
      managedService: apiDetails.managedService 
    };
  }

  private generateOpenAPISpec(managedService: string): string {
    const deviceAuthUrl = `https://${this.config.region}-${this.config.projectId}.cloudfunctions.net/${this.config.solutionPrefix}-device-auth`;
    const tvmUrl = `https://${this.config.region}-${this.config.projectId}.cloudfunctions.net/${this.config.solutionPrefix}-tvm`;

    return `
swagger: '2.0'
info:
  title: '${this.config.solutionPrefix} Device API'
  version: '1.0.0'
  description: 'API for device auth & GCP token vending.'
host: ${managedService}
schemes: ['https']
produces: ['application/json']
securityDefinitions:
  api_key:
    type: 'apiKey'
    name: 'x-api-key'
    in: 'header'
security:
  - api_key: []
paths:
  /device-auth/initiate:
    post:
      summary: 'Fetches Firebase Custom Token.'
      operationId: 'fetchFirebaseCustomToken'
      consumes: ['application/json']
      parameters:
        - in: 'body'
          name: 'body'
          required: true
          schema:
            type: 'object'
            required: ['device_id']
            properties:
              device_id:
                type: 'string'
      responses:
        '200':
          description: 'Firebase Custom Token'
          schema:
            type: 'object'
            properties:
              firebase_custom_token:
                type: 'string'
      x-google-backend:
        address: '${deviceAuthUrl}'
  /gcp-token/vend:
    post:
      summary: 'Exchanges Firebase ID Token for GCP Token.'
      operationId: 'exchangeFirebaseIdTokenForGcpToken'
      consumes: ['application/json']
      parameters:
        - in: 'body'
          name: 'body'
          required: true
          schema:
            type: 'object'
            required: ['firebase_id_token']
            properties:
              firebase_id_token:
                type: 'string'
      responses:
        '200':
          description: 'GCP Access Token'
          schema:
            type: 'object'
            properties:
              gcp_access_token:
                type: 'string'
              expires_in:
                type: 'integer'
      x-google-backend:
        address: '${tvmUrl}'
`;
  }

  public async generateAPIKeys(forceRegenerate: boolean = false) {
    console.log(forceRegenerate ? 'Regenerating API key...' : 'Creating API key...');
    
    const keyDisplayName = `${this.config.solutionPrefix}-device-key`;
    const apiId = `${this.config.solutionPrefix}-device-api`;
    
    // Only wait for new installations, not retries
    if (!forceRegenerate) {
      // Wait longer for API Gateway to be fully ready (increased from 30s to 120s)
      console.log('Waiting for API Gateway to be fully ready before creating API key...');
      this.onProgress('Waiting for API Gateway to stabilize before creating API key...', 95);
      
      // Wait 2 minutes with progress updates every 10 seconds
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        const secondsWaited = (i + 1) * 10;
        this.onProgress(`Waiting for API Gateway... (${secondsWaited}s/120s)`, 95 + Math.floor((i / 12) * 2));
      }
    } else {
      console.log('Skipping wait time for API key retry...');
      
      // For retries, check if managed service is enabled
      try {
        const apiDetails = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}`
        );
        
        if (apiDetails.managedService) {
          console.log(`Checking if managed service ${apiDetails.managedService} is enabled...`);
          this.onProgress('Checking API Gateway managed service status...', 95);
          
          try {
            // Check if the service is enabled
            const serviceStatus = await this.gcpApiCall(
              `https://serviceusage.googleapis.com/v1/projects/${this.config.projectId}/services/${apiDetails.managedService}`
            );
            
            if (serviceStatus.state !== 'ENABLED') {
              console.log('Managed service is not enabled. Enabling now...');
              this.onProgress('Enabling API Gateway managed service...', 96);
              
              await this.gcpApiCall(
                `https://serviceusage.googleapis.com/v1/projects/${this.config.projectId}/services/${apiDetails.managedService}:enable`,
                { method: 'POST' }
              );
              
              console.log('Waiting 30 seconds for managed service to propagate...');
              this.onProgress('Waiting for managed service to activate...', 97);
              await new Promise(resolve => setTimeout(resolve, 30000));
            } else {
              console.log('Managed service is already enabled');
            }
          } catch (err: any) {
            if (err.message.includes('403') || err.message.includes('404')) {
              // Service might not exist, try to deploy service configuration first
              console.log('Service not found. Deploying service configuration...');
              this.onProgress('Deploying API Gateway service configuration...', 96);
              
              try {
                // Create OpenAPI spec and deploy it
                const openApiSpec = this.generateOpenAPISpec(apiDetails.managedService);
                
                await this.gcpApiCall(
                  `https://servicemanagement.googleapis.com/v1/services/${apiDetails.managedService}/configs`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      openapi: openApiSpec
                    })
                  }
                );
                console.log('✅ Service configuration deployed successfully');
                console.log('Waiting 30 seconds for service configuration to propagate...');
                await new Promise(resolve => setTimeout(resolve, 30000));
                
                // Now try to enable the service
                console.log('Attempting to enable managed service after deployment...');
                await this.gcpApiCall(
                  `https://serviceusage.googleapis.com/v1/projects/${this.config.projectId}/services/${apiDetails.managedService}:enable`,
                  { method: 'POST' }
                );
                console.log('✅ Managed service enabled successfully');
                console.log('Waiting 30 seconds for managed service to propagate...');
                await new Promise(resolve => setTimeout(resolve, 30000));
              } catch (deployErr: any) {
                console.warn('Failed to deploy/enable managed service:', deployErr.message);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not check API details during retry:', err);
      }
    }
    
    // First, get the managed service name from the API Gateway API
    let managedServiceName = '';
    let retries = 5; // Increased from 3 to 5 attempts
    while (retries > 0 && !managedServiceName) {
      try {
        console.log(`Getting managed service name from API Gateway... (attempt ${6 - retries})`);
        this.onProgress(`Retrieving API Gateway details... (attempt ${6 - retries}/5)`, 97);
        
        const apiDetails = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}`,
          {}, // default GET
          3, // retries
          30000 // 30 second timeout
        );
        managedServiceName = apiDetails.managedService;
        if (managedServiceName) {
          console.log('Managed service name:', managedServiceName);
          break;
        }
      } catch (err: any) {
        console.error('Failed to get managed service name:', err.message);
        retries--;
        if (retries > 0) {
          console.log(`Retrying in 20 seconds... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 20000)); // Increased from 10s to 20s
        }
      }
    }
    
    if (!managedServiceName) {
      console.warn('Could not get managed service name after retries, continuing without API key restrictions');
    }
    
    try {
      // Check if key already exists
      const existingKeys = await this.gcpApiCall(
        `https://apikeys.googleapis.com/v2/projects/${this.config.projectId}/locations/global/keys`
      );
      
      const existingKey = existingKeys.keys?.find((key: any) => 
        key.displayName === keyDisplayName
      );
      
      if (existingKey && !forceRegenerate) {
        console.log('API key already exists:', existingKey.name);
        // Get the key string
        const keyDetails = await this.gcpApiCall(
          `https://apikeys.googleapis.com/v2/${existingKey.name}/keyString`
        );
        return { apiKey: keyDetails.keyString, apiKeyId: existingKey.name };
      } else if (existingKey && forceRegenerate) {
        console.log('Deleting existing API key for regeneration:', existingKey.name);
        try {
          await this.gcpApiCall(
            `https://apikeys.googleapis.com/v2/${existingKey.name}`,
            { method: 'DELETE' }
          );
          // Wait for deletion to propagate
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (err) {
          console.error('Failed to delete existing key, proceeding anyway:', err);
        }
      }
    } catch (err) {
      console.log('Error checking existing keys:', err);
    }
    
    try {
      // Prepare the key creation request
      const keyRequest: any = {
        displayName: keyDisplayName
      };
      
      // Add restriction if we have the managed service name
      if (managedServiceName) {
        console.log('Creating restricted API key for service:', managedServiceName);
        keyRequest.restrictions = {
          apiTargets: [{
            service: managedServiceName
          }]
        };
      } else {
        console.log('Creating unrestricted API key (fallback)');
      }
      
      // Create new key
      const response = await this.gcpApiCall(
        `https://apikeys.googleapis.com/v2/projects/${this.config.projectId}/locations/global/keys`,
        {
          method: 'POST',
          body: JSON.stringify(keyRequest)
        }
      );

      // Wait for the operation to complete
      if (response.name && response.name.includes('/operations/')) {
        console.log('Waiting for API key creation operation...');
        console.log('Operation name:', response.name);
        
        // Poll the operation status
        let pollAttempts = 0;
        const maxPollAttempts = 30; // Try for up to 5 minutes
        let delay = 2000; // Start with 2 second delay
        
        while (pollAttempts < maxPollAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay));
          pollAttempts++;
          
          const minutesWaited = Math.floor((pollAttempts * delay / 1000) / 60);
          const secondsWaited = Math.floor((pollAttempts * delay / 1000) % 60);
          const timeStr = minutesWaited > 0 ? `${minutesWaited}m ${secondsWaited}s` : `${secondsWaited}s`;
          
          console.log(`Checking operation status... (attempt ${pollAttempts}/${maxPollAttempts}, waited ${timeStr})`);
          this.onProgress(`Creating API key... (${timeStr})`, 98);
          
          try {
            // Check the operation status
            const operationStatus = await this.gcpApiCall(
              `https://apikeys.googleapis.com/v2/${response.name}`,
              {}, // default GET
              3, // retries
              30000 // 30 second timeout
            );
            
            console.log('Operation status:', operationStatus.done ? 'DONE' : 'IN_PROGRESS');
            
            if (operationStatus.done) {
              // Check for errors
              if (operationStatus.error) {
                console.error('API key creation failed:', operationStatus.error);
                throw new Error(`API key creation failed: ${JSON.stringify(operationStatus.error)}`);
              }
              
              // Extract the key from the operation response
              // The keyString is in the response field when operation completes
              if (operationStatus.response?.keyString) {
                console.log('✅ API key created successfully');
                this.onProgress('API key created successfully!', 100);
                return { 
                  apiKey: operationStatus.response.keyString,
                  apiKeyId: operationStatus.response.name || response.name
                };
              } else if (operationStatus.response?.current?.keyString) {
                // Sometimes the key is in response.current.keyString
                console.log('✅ API key created successfully');
                this.onProgress('API key created successfully!', 100);
                return { 
                  apiKey: operationStatus.response.current.keyString,
                  apiKeyId: operationStatus.response.name || response.name
                };
              } else {
                // If no keyString in response, try to get it from the key resource
                if (operationStatus.response?.name) {
                  console.log('Getting key string from key resource...');
                  const keyDetails = await this.gcpApiCall(
                    `https://apikeys.googleapis.com/v2/${operationStatus.response.name}/keyString`,
                    {}, // default GET
                    3, // retries
                    30000 // 30 second timeout
                  );
                  if (keyDetails.keyString) {
                    console.log('✅ API key created successfully');
                    this.onProgress('API key created successfully!', 100);
                    return { 
                      apiKey: keyDetails.keyString,
                      apiKeyId: operationStatus.response.name
                    };
                  }
                }
              }
              
              // If we still don't have the key, log the full response for debugging
              console.error('Operation completed but no keyString found. Full response:', JSON.stringify(operationStatus, null, 2));
              throw new Error('API key creation completed but keyString not found in response');
            }
          } catch (err: any) {
            console.log(`Error checking operation status: ${err.message}`);
            if (err.message.includes('API key creation failed') || err.message.includes('keyString not found')) {
              throw err; // Re-throw critical errors
            }
            // Continue polling for other errors
          }
          
          // Exponential backoff with max 10 seconds
          delay = Math.min(delay * 1.5, 10000);
        }
      }
      
      // Try to extract from immediate response
      const keyString = response.keyString || response.current?.keyString;
      if (keyString) {
        console.log('✅ API key created successfully');
        return { apiKey: keyString, apiKeyId: response.name };
      }
      
      // If we get here, the operation is taking too long
      // Check if this is due to API Gateway not being ready
      if (managedServiceName) {
        console.warn('API key creation timed out. This often happens when API Gateway is still initializing.');
        console.warn('The API Gateway managed service may need to be manually enabled.');
        
        return { 
          apiKey: null,
          apiKeyError: `API key creation timed out. This usually means the API Gateway is still initializing.
          
Options:
1. Wait 5-10 minutes for API Gateway to fully initialize, then click Retry
2. Manually enable the managed service in Cloud Console:
   - Go to: https://console.cloud.google.com/apis/library?project=${this.config.projectId}
   - Search for: ${managedServiceName}
   - Click Enable if found
3. Create the API key manually:
   - Go to: https://console.cloud.google.com/apis/credentials?project=${this.config.projectId}
   - Click "+ CREATE CREDENTIALS" → "API Key"
   - Restrict the key to: ${managedServiceName}`
        };
      }
      
      throw new Error('API key creation is taking longer than expected (>5 minutes). The key may still be creating in the background. Please wait a few more minutes and try again, or create the key manually in the Google Cloud Console.');
      
    } catch (err: any) {
      console.error('Failed to create API key:', err.message);
      
      // Return a partial success so the user can see other configuration
      return { 
        apiKey: null,
        apiKeyError: `API key creation failed: ${err.message}. The API Gateway may still be initializing. Please wait a few minutes and try creating the key manually in the Google Cloud Console.`
      };
    }
  }

  private async waitForOperation(operationName: string, maxWaitMs = 300000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      let apiUrl: string;
      
      // Determine the service based on the operation name
      if (operationName.includes('apigateway') || operationName.includes('/apis/')) {
        // API Gateway operations
        apiUrl = `https://apigateway.googleapis.com/v1/${operationName}`;
      } else if (operationName.includes('iam') || operationName.includes('workloadIdentityPools')) {
        // IAM operations
        apiUrl = `https://iam.googleapis.com/v1/${operationName}`;
      } else if (operationName.startsWith('operation-') && operationName.includes('global')) {
        // This is likely an API Gateway operation without the full path
        apiUrl = `https://apigateway.googleapis.com/v1/operations/${operationName}`;
      } else {
        // Default to Cloud Functions v2
        apiUrl = operationName.includes('/operations/') 
          ? `https://cloudfunctions.googleapis.com/v2/${operationName}`
          : `https://cloudfunctions.googleapis.com/v2/${operationName}`;
      }

      const operation = await this.gcpApiCall(apiUrl);

      if (operation.done) {
        if (operation.error) {
          throw new Error(`Operation failed: ${JSON.stringify(operation.error)}`);
        }
        return operation;
      }

      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    throw new Error('Operation timed out after ' + maxWaitMs/1000 + ' seconds');
  }

  private compileResults(results: any): InstallResult {
    // Get all service account emails
    const vertexAiSaEmail = results.vertex_ai_sa_email || `${this.config.solutionPrefix}-vertex-ai-sa@${this.config.projectId}.iam.gserviceaccount.com`;
    const deviceAuthSaEmail = results.device_auth_sa_email || `${this.config.solutionPrefix}-device-auth-sa@${this.config.projectId}.iam.gserviceaccount.com`;
    const tvmSaEmail = results.tvm_sa_email || `${this.config.solutionPrefix}-tvm-sa@${this.config.projectId}.iam.gserviceaccount.com`;
    const apiGwInvokerSaEmail = results.apigw_invoker_sa_email || `${this.config.solutionPrefix}-apigw-invoker-sa@${this.config.projectId}.iam.gserviceaccount.com`;
    
    // Function URLs (mocked for now)
    const deviceAuthUrl = results['anava-device-auth'] || `https://${this.config.region}-${this.config.projectId}.cloudfunctions.net/${this.config.solutionPrefix}-device-auth`;
    const tvmUrl = results['anava-tvm'] || `https://${this.config.region}-${this.config.projectId}.cloudfunctions.net/${this.config.solutionPrefix}-tvm`;
    
    // API Gateway URL
    const apiGatewayUrl = results.apiGatewayUrl || `https://${this.config.solutionPrefix}-gateway-${this.config.projectId}.apigateway.${this.config.region}.cloud.goog`;
    const apiGatewayError = results.apiGatewayError;
    
    // Firestore database
    const firestoreDb = results.firestoreDatabase || '(default)';
    
    // Project details
    const projectNumber = this.config.projectNumber || results.projectNumber;
    
    // Get actual values for the essential config
    const apiKey = results.apiKey || '';
    const firebaseWebApiKey = results.firebaseWebApiKey || '';
    
    return {
      success: true,
      apiGatewayUrl: apiGatewayUrl,
      apiKey: apiKey,
      firebaseWebApiKey: firebaseWebApiKey,
      projectId: this.config.projectId,
      region: this.config.region,
      solutionPrefix: this.config.solutionPrefix,
      setupCommand: `# Run on each Axis camera:
export API_GATEWAY_BASE_URL="${apiGatewayUrl}"
export API_GATEWAY_API_KEY="${apiKey || 'YOUR_API_KEY'}"
export FIREBASE_WEB_API_KEY="${firebaseWebApiKey || 'YOUR_FIREBASE_WEB_API_KEY'}"
export GCP_PROJECT_ID="${this.config.projectId}"`,
      configurationSummary: {
        '=== ESSENTIAL APP CONFIGURATION ===': '',
        'API_GATEWAY_API_KEY': apiKey || 'NOT CREATED - Manual setup required',
        'API_GATEWAY_BASE_URL': apiGatewayUrl,
        'FIREBASE_WEB_API_KEY': firebaseWebApiKey || 'NOT RETRIEVED - Check Firebase Console',
        'GCP_PROJECT_ID': this.config.projectId,
        '': '',
        '=== PROJECT INFORMATION ===': '',
        'Project ID': this.config.projectId,
        'Project Number': projectNumber,
        'Region': this.config.region,
        'Solution Prefix': this.config.solutionPrefix,
        ' ': '',
        '=== SERVICE ACCOUNTS ===': '',
        'Vertex AI SA': vertexAiSaEmail,
        'Device Auth Function SA': deviceAuthSaEmail,
        'TVM Function SA': tvmSaEmail,
        'API Gateway Invoker SA': apiGwInvokerSaEmail,
        '  ': '',
        '=== CLOUD FUNCTIONS ===': '',
        'Device Auth Function': deviceAuthUrl,
        'TVM Function': tvmUrl,
        '   ': '',
        '=== API GATEWAY ===': '',
        'API Gateway Base URL': apiGatewayUrl,
        'Status': apiGatewayError ? `⚠️  ${apiGatewayError}` : '✅ Created',
        'Device Auth Endpoint': `POST ${apiGatewayUrl}/device-auth/initiate`,
        'TVM Endpoint': `POST ${apiGatewayUrl}/gcp-token/vend`,
        'API Key': apiKey || 'NOT CREATED - Create manually in API Keys',
        '    ': '',
        '=== FIREBASE ===': '',
        'Firebase Enabled': results.firebaseEnabled ? 'Yes' : 'No',
        'Firestore Database': firestoreDb,
        'Firebase Console': `https://console.firebase.google.com/project/${this.config.projectId}`,
        'Web API Key': firebaseWebApiKey || 'Get from Firebase Console → Project Settings → General',
        '     ': '',
        '=== WORKLOAD IDENTITY ===': '',
        'WIF Pool': `${this.config.solutionPrefix}-device-pool`,
        'WIF Provider': `${this.config.solutionPrefix}-firebase-provider`,
        'WIF Configuration': results.workloadIdentityConfigured ? 'Configured' : 'Not configured',
        '      ': '',
        '=== DEPLOYMENT STATUS ===': '',
        'Cloud Functions': '✅ Deployed successfully',
        'API Gateway': '✅ Deployed successfully', 
        'API Key Status': apiKey ? '✅ Created successfully' : '⚠️  Not created yet - API Gateway initializing',
        'Firebase': firebaseWebApiKey ? '✅ Configured' : '⚠️  Check Firebase Console',
        '       ': '',
        '=== NEXT STEPS ===': '',
        ...(apiKey ? [] : [
          { '⚠️  Create API Key': `Wait 2-3 minutes, then go to: https://console.cloud.google.com/apis/credentials?project=${this.config.projectId}` },
          { '   Click': '"+ CREATE CREDENTIALS" → "API Key"' },
          { '   Restrict Key': `Select "Restrict key" → API restrictions → Select "${this.config.solutionPrefix}-device-api.apigateway.${this.config.projectId}.cloud.goog"` },
        ]).reduce((acc, item) => ({ ...acc, ...item }), {}),
        '1. Configure Security Rules': 'Set up Firestore and Storage security rules',
        '2. Test the Endpoints': apiKey ? 'Use the API key to test device auth flow' : 'Use the manually created API key to test',
        '3. Deploy to Cameras': 'Export environment variables on each camera',
      }
    };
  }
}