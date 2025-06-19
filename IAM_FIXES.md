# IAM Permission Fixes Required

## Current Issues
The Token Vending Machine (TVM) endpoint needs additional IAM permissions to function correctly.

## Required IAM Role Additions

### For TVM Service Account (`anava-tvm-sa`)
- `roles/iam.serviceAccountTokenCreator` - To impersonate the target service account
- `roles/cloudfunctions.invoker` - Already assigned

### For Vertex AI Service Account (`anava-vertex-ai-sa`)
- `roles/aiplatform.user` - Already assigned
- `roles/storage.objectAdmin` - Already assigned  
- `roles/datastore.user` - Already assigned
- `roles/iam.workloadIdentityUser` - NEW: Required for workload identity federation

### For Device Auth Service Account (`anava-device-auth-sa`)
- `roles/cloudfunctions.invoker` - Already assigned
- `roles/firebaseauth.admin` - NEW: To create custom tokens

### Additional Bindings Required
- The TVM SA needs the `serviceAccountTokenCreator` role on the Vertex AI SA specifically
- This allows the TVM to impersonate the Vertex AI SA and generate tokens for it

## Implementation
These fixes will be implemented in the `grantIAMRoles` function in `src/lib/gcp-installer.ts`.