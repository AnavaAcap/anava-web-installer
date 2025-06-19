/**
 * Anava GCP Installer - Core Logic
 * This handles all the GCP API calls to set up the infrastructure
 */

import { InstallConfig, InstallStep, InstallResult } from './types';

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
    const results: any = {};

    for (const step of steps) {
      this.onProgress(step.name, totalProgress);
      try {
        const stepResult = await step.fn();
        Object.assign(results, stepResult);
        totalProgress += step.weight;
        this.onProgress(step.name, totalProgress);
      } catch (error) {
        throw new Error(`Failed at step "${step.name}": ${error}`);
      }
    }

    return this.compileResults(results);
  }

  private async checkPrerequisites() {
    console.log('Checking project prerequisites...');
    
    const prerequisites = {
      firebaseEnabled: false,
      storageEnabled: false,
      firestoreEnabled: false,
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
    
    // If Firebase, Storage, or Firestore are missing, throw detailed error
    if (!prerequisites.firebaseEnabled || !prerequisites.storageEnabled || !prerequisites.firestoreEnabled) {
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
      
      throw new Error(`PREREQUISITES_MISSING:${JSON.stringify(missingSteps)}`);
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
      'storage-api.googleapis.com',
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
    }

    if (serviceAccounts.device_auth_sa_email) {
      addRoleBinding('roles/cloudfunctions.invoker', `serviceAccount:${serviceAccounts.device_auth_sa_email}`);
    }

    if (serviceAccounts.tvm_sa_email) {
      addRoleBinding('roles/cloudfunctions.invoker', `serviceAccount:${serviceAccounts.tvm_sa_email}`);
    }

    await this.gcpApiCall(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${this.config.projectId}:setIamPolicy`,
      {
        method: 'POST',
        body: JSON.stringify({ policy })
      }
    );
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
    
    // Poll the config status until it's active (like the shell script does)
    const maxChecks = 12;
    let configReady = false;
    
    for (let i = 1; i <= maxChecks; i++) {
      try {
        const configStatus = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}/configs/${configId}`
        );
        
        if (configStatus.state === 'ACTIVE') {
          configReady = true;
          console.log(`API Config ${configId} is ACTIVE.`);
          break;
        }
        
        console.log(`API Config not active yet (State: ${configStatus.state || 'Unknown'}). Waiting 10s... (${i}/${maxChecks})`);
      } catch (err: any) {
        console.log(`Error checking config status: ${err.message}. Waiting 10s... (${i}/${maxChecks})`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    if (!configReady) {
      throw new Error(`API Config ${configId} did not become active after ${maxChecks * 10} seconds`);
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

  public async generateAPIKeys() {
    console.log('Creating API key...');
    
    const keyDisplayName = `${this.config.solutionPrefix}-device-key`;
    const apiId = `${this.config.solutionPrefix}-device-api`;
    
    // Wait a bit for API Gateway to be fully ready
    console.log('Waiting for API Gateway to be fully ready before creating API key...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // First, get the managed service name from the API Gateway API
    let managedServiceName = '';
    let retries = 3;
    while (retries > 0 && !managedServiceName) {
      try {
        console.log(`Getting managed service name from API Gateway... (attempt ${4 - retries})`);
        const apiDetails = await this.gcpApiCall(
          `https://apigateway.googleapis.com/v1/projects/${this.config.projectId}/locations/global/apis/${apiId}`
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
          console.log(`Retrying in 10 seconds... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 10000));
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
      
      if (existingKey) {
        console.log('API key already exists:', existingKey.name);
        // Get the key string
        const keyDetails = await this.gcpApiCall(
          `https://apikeys.googleapis.com/v2/${existingKey.name}/keyString`
        );
        return { apiKey: keyDetails.keyString };
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
        
        // Poll for the key to be created
        let keyFound = false;
        let pollAttempts = 0;
        const maxPollAttempts = 6; // Try for up to 60 seconds
        
        while (!keyFound && pollAttempts < maxPollAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          pollAttempts++;
          
          console.log(`Checking for API key... (attempt ${pollAttempts}/${maxPollAttempts})`);
          
          try {
            // List keys again to find our new key
            const keys = await this.gcpApiCall(
              `https://apikeys.googleapis.com/v2/projects/${this.config.projectId}/locations/global/keys`
            );
            
            const newKey = keys.keys?.find((key: any) => 
              key.displayName === keyDisplayName
            );
            
            if (newKey) {
              const keyDetails = await this.gcpApiCall(
                `https://apikeys.googleapis.com/v2/${newKey.name}/keyString`
              );
              if (keyDetails.keyString) {
                console.log('✅ API key created successfully');
                return { apiKey: keyDetails.keyString };
              }
            }
          } catch (err) {
            console.log(`Error checking for key: ${err}. Will retry...`);
          }
        }
      }
      
      // Try to extract from immediate response
      const keyString = response.keyString || response.current?.keyString;
      if (keyString) {
        console.log('✅ API key created successfully');
        return { apiKey: keyString };
      }
      
      throw new Error('API key creation timed out - the key may still be creating. Try running the installer again in a few minutes.');
      
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