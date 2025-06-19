#!/bin/bash

# ===================================================================================
# Anava AI - Google Cloud Project Setup for Vertex Integration
# Version: ULTIMATE_FS_RULES (Firestore "anava" DB, Rules Deployment, Summary Update)
# ===================================================================================
# This script automates the deployment of Anava's secure backend for Axis cameras
# using Google Cloud Vertex AI, API Gateway, and other GCP services.
# It asks for all configurations upfront after initial authentication.
#
# Key Features:
# - Robust error handling and diagnostic messages.
# - Programmatic checks for gcloud/Python compatibility, Billing, and Firebase linkage.
# - Uses Firebase Management REST API (curl + jq) for Firebase Web App/API Key automation.
# - Uses 'gcloud services api-keys create' with correct LRO JSON parsing.
# - Deploys private Cloud Functions with retry logic for 409 errors.
# - Creates unique API Config IDs for API Gateway.
# - Portable temporary file cleanup.
# - Enhanced user interface with welcome message and structured summary.
# - Creates a named Firestore database "anava" and deploys security rules.
# ===================================================================================

# ===================================================================================
# Root/Sudo Detection and Prevention
# ===================================================================================
echo "🔐 Checking execution permissions..."

# Check if running as root (UID 0)
if [ "$(id -u)" -eq 0 ]; then
    echo ""
    echo "❌ ERROR: This script is being run as root (UID 0)."
    echo ""
    echo "🚫 SECURITY WARNING: Running this script as root is NOT recommended and NOT supported."
    echo ""
    echo "Reasons why this script should NOT be run as root:"
    echo "  • gcloud and Firebase CLI tools should be run as a regular user"
    echo "  • Configuration files created as root can cause permission issues later"
    echo "  • It's a security risk to run deployment scripts with root privileges"
    echo "  • Google Cloud SDK may not work properly when run as root"
    echo "  • Firebase CLI may create config files with incorrect ownership"
    echo ""
    echo "✅ SOLUTION: Please run this script as a regular user (not root, not with sudo)."
    echo ""
    echo "If you need to install system packages (like jq, npm, etc.), the script will"
    echo "prompt you and use sudo only for those specific installation commands when needed."
    echo ""
    exit 1
fi

# Check if running via sudo (SUDO_USER will be set)
if [ -n "${SUDO_USER:-}" ]; then
    echo ""
    echo "❌ ERROR: This script is being run with sudo."
    echo ""
    echo "🚫 SECURITY WARNING: Running this script with sudo is NOT recommended and NOT supported."
    echo ""
    echo "Current user: $(whoami)"
    echo "Original user (before sudo): ${SUDO_USER}"
    echo ""
    echo "Reasons why this script should NOT be run with sudo:"
    echo "  • gcloud and Firebase CLI authentication works best as a regular user"
    echo "  • Configuration files may be created with root ownership, causing issues"
    echo "  • Google Cloud SDK and Firebase CLI expect to run in user context"
    echo "  • It's a security risk to run deployment scripts with elevated privileges"
    echo ""
    echo "✅ SOLUTION: Please run this script as a regular user without sudo:"
    echo "   ./vertexSetup_gcp.sh"
    echo ""
    echo "If you need to install system packages (like jq, npm, etc.), the script will"
    echo "prompt you and use sudo only for those specific installation commands when needed."
    echo ""
    exit 1
fi

# Additional check for other elevation methods (though less common)
if [ -n "${SUDO_UID:-}" ] || [ -n "${SUDO_GID:-}" ]; then
    echo ""
    echo "❌ ERROR: This script appears to be running with elevated privileges."
    echo ""
    echo "Environment variables detected:"
    [ -n "${SUDO_UID:-}" ] && echo "  SUDO_UID: ${SUDO_UID}"
    [ -n "${SUDO_GID:-}" ] && echo "  SUDO_GID: ${SUDO_GID}"
    echo ""
    echo "Please run this script as a regular user without any privilege elevation."
    echo ""
    exit 1
fi

echo "✅ Permission check passed. Running as regular user: $(whoami)"
echo ""

# ===================================================================================
# Prerequisite Installation for Ubuntu-like Systems (including WSL)
# ===================================================================================
IS_UBUNTU_LIKE=false
IS_WSL=false # Keep IS_WSL for specific auth flow if still needed, though --no-browser is good generally

# Check if running on an Ubuntu-like system or WSL
if (command -v lsb_release &> /dev/null && lsb_release -is 2>/dev/null | grep -qiE 'ubuntu|debian') || \
   ( [ -f /etc/os-release ] && grep -qiE 'ubuntu|debian' /etc/os-release ) || \
   grep -qi microsoft /proc/version; then
  IS_UBUNTU_LIKE=true
  if grep -qi microsoft /proc/version; then
    IS_WSL=true
    echo "⚠️  Running under WSL."
  fi

  echo "🚀  Detected Ubuntu-like environment. Checking and installing prerequisites..."

  SUDO_CMD=""
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo &> /dev/null; then
      SUDO_CMD="sudo"
      echo "INFO: Not running as root. Will use 'sudo' for installations."
    else
      echo "ERROR: Running as non-root and 'sudo' command not found. Please install sudo or run as root."
      exit 1
    fi
  else
    echo "INFO: Running as root. 'sudo' will not be prepended."
  fi

  # Update package lists
  echo "INFO: Updating package lists ($SUDO_CMD apt update)..."
  $SUDO_CMD apt update -y

  # Install essential tools
  echo "INFO: Installing/updating jq, openssl, curl, npm ($SUDO_CMD apt install)..."
  $SUDO_CMD apt install -y jq openssl curl npm

  if ! command -v npm &> /dev/null; then
    echo "ERROR: npm installation failed. Please install npm manually and re-run."
    exit 1
  fi
  echo "✔️ npm version: $(npm -v)"

  # Install/Update Node.js to v20 using 'n'
  echo "INFO: Installing 'n' (Node.js version manager) globally ($SUDO_CMD npm install -g n)..."
  $SUDO_CMD npm install -g n
  echo "INFO: Using 'n' to install/switch to Node.js v20 ($SUDO_CMD n 20)..."
  $SUDO_CMD n 20

  # Attempt to make the new Node version available in the current script execution
  NODE_BIN_DIR=$($SUDO_CMD n bin 20 2>/dev/null) # Get bin dir for node 20 from n
  if [ -n "$NODE_BIN_DIR" ] && [ -d "$NODE_BIN_DIR" ] && [[ ":$PATH:" != *":${NODE_BIN_DIR}:"* ]]; then
      echo "INFO: Adding Node.js v20 bin directory to PATH for this session: ${NODE_BIN_DIR}"
      export PATH="${NODE_BIN_DIR}:$PATH"
  elif $IS_WSL && [ "$SHELL" != "" ] && [ -x "$SHELL" ]; then # Only exec if SHELL is valid
      echo "INFO: WSL detected. Reloading shell to apply Node.js changes. The script will restart."
      exec "$SHELL" -l # Use -l to ensure a login shell, which might source profiles
  else
      echo "WARNING: Could not automatically set PATH for Node v20 from 'n'."
      echo "         If subsequent commands fail due to incorrect Node/npm versions,"
      echo "         please open a new terminal or source your ~/.bashrc (or equivalent) and re-run."
  fi

  # Verify Node.js version after attempting PATH update
  if command -v node &> /dev/null; then
    echo "✔️ Node version: $(node -v)"
  else
    echo "⚠️ Node command not found after 'n' installation and PATH update attempt."
    echo "   Please ensure Node.js v20 is correctly installed and in your PATH."
    echo "   You might need to open a new terminal session or source your shell profile."
  fi

  echo "INFO: Installing/updating Firebase CLI (firebase-tools) globally ($SUDO_CMD npm install -g firebase-tools)..."
  $SUDO_CMD npm install -g firebase-tools

  # Verify Firebase CLI version
  if command -v firebase &> /dev/null; then
    echo "✔️ Firebase CLI version: $(firebase --version)"
  else
    echo "⚠️ Firebase CLI command not found after installation attempt."
    echo "   Please ensure Firebase CLI is correctly installed and in your PATH."
    echo "   You might need to open a new terminal session or source your shell profile."
  fi
  echo ""
fi

# --- Global Variables for Script State ---
# Variables to hold user choices from Phase 2, to be used in Phase 3
PROJECT_ID=""
SOLUTION_PREFIX=""
GCP_REGION=""
FIREBASE_API_KEY_PROVIDED_MANUALLY=false
FIREBASE_WEB_API_KEY_INPUT=""
# USER_AUTHORIZES_FIREBASE_APP_CREATION=false
FIREBASE_NEW_WEBAPP_DISPLAY_NAME_INPUT=""

# Variables to be populated during Phase 3 execution
FETCHED_PROJECT_NUMBER=""
FIREBASE_WEB_API_KEY="" # Final key used by the script
DEVICE_AUTH_SA_EMAIL=""
TVM_SA_EMAIL=""
APIGW_INVOKER_SA_EMAIL=""
VERTEX_AI_SA_EMAIL=""
WIF_POOL_ID=""
WIF_PROVIDER_ID=""
ISSUER_URI=""
DEVICE_AUTH_FUNCTION_NAME=""
DEVICE_AUTH_FUNCTION_URL=""
TVM_FUNCTION_NAME=""
TVM_FUNCTION_URL=""
API_ID=""
API_GATEWAY_ID=""
API_GATEWAY_URL=""
GENERATED_GATEWAY_API_KEY_STRING=""
ACTUAL_BUILD_SA=""
# FIRESTORE_DATABASE_ID="anava" # Named database
STORAGE_RULES_FILE="storage.rules" # <-- ADD THIS
CORS_GCS_CONFIG_FILE="cors-gcs-config.json" # <-- ADD THIS
WEB_APP_ORIGINS_INPUT="" # <-- ADD THIS (even if we default its use later)
DEFAULT_FIREBASE_STORAGE_BUCKET_GS_URL=""          # <-- ADD (to store fetched default bucket)
FIREBASE_STORAGE_BUCKET=""

# --- Cleanup Function for Temp Files ---
CLEANUP_FILES=()
TEMP_ERROR_LOG="gcloud_command_error.log"
OPENAPI_SPEC_FILE="openapi_spec.yaml"
API_KEY_TMP_FILE="generated_api_key_output.tmp"
API_KEY_COMMAND_FULL_OUTPUT_LOG="api_key_command_full_output.log"
FIRESTORE_RULES_FILE="firestore.rules" # Added for Firestore rules

cleanup() {
  echo ""
  echo "--- Cleaning up temporary files ---"
  local unique_cleanup_items_map_keys=""
  local unique_cleanup_items_array=()
  # Consolidate known temp files and any dynamically added ones
  local consistently_named_temps=("$TEMP_ERROR_LOG" "$OPENAPI_SPEC_FILE" "$API_KEY_TMP_FILE" "$API_KEY_COMMAND_FULL_OUTPUT_LOG" "$FIRESTORE_RULES_FILE" "$STORAGE_RULES_FILE" "$CORS_GCS_CONFIG_FILE")
  for item_in_cleanup_array in "${CLEANUP_FILES[@]}"; do
    local found_in_consistent=0
    for const_item in "${consistently_named_temps[@]}"; do if [[ "$const_item" == "$item_in_cleanup_array" ]]; then found_in_consistent=1; break; fi; done
    if [[ "$found_in_consistent" -eq 0 ]]; then consistently_named_temps+=("$item_in_cleanup_array"); fi
  done

  if [ ${#consistently_named_temps[@]} -gt 0 ]; then
    for item in "${consistently_named_temps[@]}"; do if [[ "$unique_cleanup_items_map_keys" != *":$item:"* ]]; then unique_cleanup_items_array+=("$item"); unique_cleanup_items_map_keys+=":$item:"; fi; done
    if [ ${#unique_cleanup_items_array[@]} -gt 0 ]; then
      # echo "DEBUG: Cleaning up items: ${unique_cleanup_items_array[*]}" # Optional debug
      for file_or_dir in "${unique_cleanup_items_array[@]}"; do
        if [ -f "$file_or_dir" ]; then rm -f "$file_or_dir";
        elif [ -d "$file_or_dir" ]; then rm -rf "$file_or_dir"; fi
      done;
    fi;
  fi
  # echo "Temporary files cleanup process finished."
}
trap cleanup EXIT INT TERM

ensure_firebase_cli_authenticated() {
    local project_id="$1"
    local temp_error_log="${TEMP_ERROR_LOG:-firebase_cli_auth_error.log}"

    echo ""
    echo "--- Ensuring Firebase CLI Authentication ---"

    if ! command -v firebase &>/dev/null; then
        echo "ERROR: Firebase CLI (firebase-tools) is not installed."
        echo "Please install it using: npm install -g firebase-tools"
        exit 1
    fi

    echo "INFO: Using Firebase CLI version: $(firebase --version)"

    # Try a harmless command to check for auth
    if firebase projects:list --project "$project_id" &>/dev/null; then
        echo "✅ Firebase CLI is authenticated and can access project '$project_id'."
        return 0
    fi

    echo "❌ Firebase CLI is NOT authenticated or cannot access project '$project_id'."
    echo ""
    echo "Attempting Firebase login using a URL/code flow:"
    echo "1. A URL will be printed below. Copy/paste it into a browser on any machine."
    echo "2. Authenticate with your Firebase account."
    echo "3. Copy the authorization code displayed in the browser."
    echo "4. Paste the authorization code back into this terminal when prompted."
    echo "5. IMPORTANT: Do NOT just hit Enter without entering the auth code!"

    # Always use --no-localhost for VM/scripted environments
    local fb_login_args="--reauth --no-localhost"

    # Retry loop for Firebase authentication
    local firebase_auth_success=false
    local max_firebase_auth_attempts=3
    local firebase_auth_attempt=0

    while [ $firebase_auth_attempt -lt $max_firebase_auth_attempts ] && [ "$firebase_auth_success" = false ]; do
        firebase_auth_attempt=$((firebase_auth_attempt + 1))
        echo ""
        echo "=== Firebase Login Attempt ${firebase_auth_attempt}/${max_firebase_auth_attempts} ==="
        echo "REMINDER: When prompted for an authorization code, DO NOT just hit Enter!"
        echo "          You must copy the code from your browser and paste it here."
        echo ""
        
        set +e
        firebase login $fb_login_args 2>"$temp_error_log"
        firebase_login_exit_code=$?
        set -e
        
        if [ $firebase_login_exit_code -eq 0 ]; then
            # Verify access to the project after login
            if firebase projects:list --project "$project_id" &>/dev/null; then
                echo "✅ Firebase CLI authenticated and access verified!"
                firebase_auth_success=true
            else
                echo "⚠️  Firebase login succeeded, but cannot access project '$project_id'."
                echo "   This might be a permissions issue."
                firebase_login_exit_code=1  # Treat as failure for retry logic
            fi
        fi
        
        if [ $firebase_login_exit_code -ne 0 ]; then
            echo ""
            echo "❌ Firebase authentication failed."
            if [ -s "$temp_error_log" ]; then
                echo "Error details:"
                cat "$temp_error_log"
            fi
            
            if [ $firebase_auth_attempt -lt $max_firebase_auth_attempts ]; then
                echo ""
                echo "Common reasons for failure:"
                echo "  • You hit Enter without pasting the authorization code"
                echo "  • You pasted an incorrect or expired code"
                echo "  • Account doesn't have access to project '$project_id'"
                echo "  • Network connectivity issues"
                echo ""
                if confirm_action "Would you like to try logging in to Firebase again?" "yes"; then
                    echo "Retrying Firebase authentication..."
                    continue
                else
                    echo "User chose not to retry Firebase authentication."
                    break
                fi
            fi
        fi
    done

    if [ "$firebase_auth_success" = false ]; then
        echo ""
        echo "❌ ERROR: Firebase CLI authentication failed after ${max_firebase_auth_attempts} attempts."
        echo "Please ensure you:"
        echo "  1. Have access to a web browser"
        echo "  2. Can copy/paste the authorization code correctly" 
        echo "  3. Have access to project '$project_id' in Firebase"
        echo "  4. Have linked your GCP project to Firebase"
        echo ""
        echo "You can also try running 'firebase login' manually first, then re-run this script."
        exit 1
    fi
    
    return 0
}

ensure_firestore_database() {
    local project_id_local="$1"
    local gcp_region_local="$2" # The region chosen for functions, can be a hint for Firestore location
    local db_id_local="$3"
    local firestore_db_exists=false

    echo "--- Checking Firestore Database '${db_id_local}' status for project '${project_id_local}' ---"

   # ────── Ensure Firestore API is enabled ──────
    echo "INFO: Checking whether Firestore API is enabled for project '${project_id_local}'..."
    SERVICE_NAME="firestore.googleapis.com"
    if ! gcloud services list --enabled --project "${project_id_local}" \
         | grep -q "${SERVICE_NAME}"; then

      echo "INFO: Firestore API not enabled—enabling now (${SERVICE_NAME})…"
      set +e
      gcloud services enable "${SERVICE_NAME}" --project "${project_id_local}" \
          2>"$TEMP_ERROR_LOG"
      enable_exit=$?
      set -e

      if [ $enable_exit -eq 0 ]; then
        echo "SUCCESS: Firestore API enabled."
      else
        echo "WARNING: Failed to enable Firestore API (exit code: $enable_exit)"
        echo "         See details:"
        cat "$TEMP_ERROR_LOG"
        # you can choose to exit here, or let it fall through and fail later
      fi
    else
      echo "INFO: Firestore API already enabled."
    fi

    # Attempt to describe the named database
    set +e
    gcloud firestore databases describe --database="${db_id_local}" --project="${project_id_local}" > /dev/null 2>"$TEMP_ERROR_LOG"
    local describe_exit_code=$?
    set -e

    if [ $describe_exit_code -eq 0 ]; then
        echo "Firestore database '${db_id_local}' already exists in project '${project_id_local}'."
        firestore_db_exists=true
    else
        echo "Firestore database '${db_id_local}' does not exist or is not accessible (Describe Exit Code: $describe_exit_code)."
        if [ -s "$TEMP_ERROR_LOG" ]; then echo "Details:"; cat "$TEMP_ERROR_LOG"; fi
    fi

    if ! $firestore_db_exists; then
        echo ""
        echo "A Cloud Firestore database named '${db_id_local}' in Native mode needs to be created for this project."

        DEFAULT_FIRESTORE_LOCATION=""
        if [[ "$gcp_region_local" == "us-central1" ]] || [[ "$gcp_region_local" == "us-east1" ]] || [[ "$gcp_region_local" == "us-west1" ]] || [[ "$gcp_region_local" == "us-west1" ]] || [[ "$gcp_region_local" == "northamerica-northeast1" ]]; then
            DEFAULT_FIRESTORE_LOCATION="nam5" # Multi-region for North America
        elif [[ "$gcp_region_local" == "europe-west1" ]] || [[ "$gcp_region_local" == "europe-west2" ]] || [[ "$gcp_region_local" == "europe-central2" ]]; then
            DEFAULT_FIRESTORE_LOCATION="eur3" # Multi-region for Europe
        else
            DEFAULT_FIRESTORE_LOCATION="$gcp_region_local"
            echo "Warning: Using '${gcp_region_local}' as Firestore location. Ensure this is a valid Firestore regional location."
            echo "         Common multi-regions are 'nam5' (US) or 'eur3' (Europe)."
        fi

        echo ""
        echo "You need to select a location for your Firestore database '${db_id_local}'. This choice is permanent for this database."
        echo "Consider choosing a location close to your users and other GCP resources (like your Cloud Functions in '${gcp_region_local}')."
        echo "For options, see: https://cloud.google.com/firestore/docs/locations"
        read -p "Enter Firestore database location (e.g., '${DEFAULT_FIRESTORE_LOCATION}', 'us-east1', 'europe-west1'): " CHOSEN_FIRESTORE_LOCATION
        CHOSEN_FIRESTORE_LOCATION="${CHOSEN_FIRESTORE_LOCATION:-${DEFAULT_FIRESTORE_LOCATION}}"

        while [ -z "$CHOSEN_FIRESTORE_LOCATION" ]; do
            read -p "Firestore location cannot be empty. Please enter a valid location: " CHOSEN_FIRESTORE_LOCATION
        done

        echo "Attempting to create Firestore database '${db_id_local}' in Native Mode at location '${CHOSEN_FIRESTORE_LOCATION}'..."
        echo "This operation can take a few minutes."
        if ! confirm_action "Proceed with Firestore database '${db_id_local}' creation at '${CHOSEN_FIRESTORE_LOCATION}'?" "yes"; then
            echo "User aborted Firestore database creation. The script cannot proceed without it."
            return 1
        fi

        set +e
        gcloud firestore databases create --database="${db_id_local}" --location="${CHOSEN_FIRESTORE_LOCATION}" --type=firestore-native --project="${project_id_local}" --quiet 2>"$TEMP_ERROR_LOG"
        local create_db_exit_code=$?
        set -e

        if [ $create_db_exit_code -eq 0 ]; then
            echo "Firestore database '${db_id_local}' creation command initiated successfully at location '${CHOSEN_FIRESTORE_LOCATION}'."
            echo "Waiting for database to become active (can take a few minutes)..."
            sleep 90

            set +e
            gcloud firestore databases describe --database="${db_id_local}" --project="${project_id_local}" > /dev/null 2>"$TEMP_ERROR_LOG"
            local verify_exit_code=$?
            set -e
            if [ $verify_exit_code -eq 0 ]; then
                echo "Firestore database '${db_id_local}' is now active."
                return 0
            else
                echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
                echo "ERROR: Firestore database '${db_id_local}' creation command seemed to succeed, but verification failed (Exit code: $verify_exit_code)."
                echo "Gcloud error output from verification:"
                cat "$TEMP_ERROR_LOG"
                echo "Please check the Firestore section in the GCP console for project '${project_id_local}' and database '${db_id_local}'."
                echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
                return 1
            fi
        else
            echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
            echo "ERROR: Failed to create Firestore database '${db_id_local}' (Exit Code: $create_db_exit_code)."
            echo "Gcloud error output:"
            cat "$TEMP_ERROR_LOG"
            echo "Possible reasons: Invalid location ID, permissions (e.g., 'Cloud Datastore Owner' - roles/datastore.owner), or project state."
            echo "Please manually create a Firestore database named '${db_id_local}' in Native Mode in the GCP console for project '${project_id_local}'."
            echo "Visit: https://console.cloud.google.com/firestore/data?project=${project_id_local}"
            echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
            return 1
        fi
    fi
    return 0
}

deploy_firebase_rules() { # Renamed from deploy_firestore_rules
    local project_id_local="$1"
    local firestore_db_id_local="$2" # e.g., "anava"
    local firestore_rules_file_local="$3" # e.g., "firestore.rules"
    # STORAGE_RULES_FILE is a global variable now ("storage.rules")
    local firebase_json_file_temp="firebase.deploy.json"

    echo ""
    echo "--- Deploying Firestore and Firebase Storage Rules (using Firebase CLI) ---"

    # if ! ensure_firebase_cli_authenticated "${project_id_local}"; then
    #     echo "CRITICAL ERROR: Firebase CLI authentication failed. Cannot deploy rules."
    #     return 1
    # fi

    add_to_cleanup "$firebase_json_file_temp" # Already there, ensure it's correct

    cat << 'EOF_RULES' > "${firestore_rules_file_local}"
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Common function to check if the request has valid authentication
    function isAuthenticated() {
      return request.auth != null;
    }

    // Function to check if the timestamp is valid (not too far in the future)
    function isValidTimestamp(ts) {
      return ts is timestamp &&
             ts <= request.time + duration.value(5, 'm');
    }

    // Rule for the top-level 'devices' collection
    match /devices {
      // For now, keep 'if true' for debugging the session/event reads.
      // IMPORTANT: Change this back to 'if isAuthenticated();' later for security.
      allow list: if true;
    }

    // Match individual device documents
    match /devices/{deviceId} {
      allow read: if isAuthenticated();
      allow write: if isAuthenticated() &&
                          request.resource.data.deviceId == deviceId &&
                          isValidTimestamp(request.resource.data.updatedAt);

      // Match sessions subcollection
      match /sessions/{sessionId} { // Path: /devices/{deviceId}/sessions/{sessionId}
        allow read: if isAuthenticated(); // Allows LISTING sessions and GETTING individual session docs
        allow write: if isAuthenticated() &&
                            request.resource.data.deviceId == deviceId &&
                            request.resource.data.status is string && // Ensure 'status' exists if used in writes
                            isValidTimestamp(request.resource.data.updatedAt); // Ensure 'updatedAt' exists

        // This 'events' subcollection is UNDER 'sessions/{sessionId}'
        match /events/{eventId} { // Path: /devices/{deviceId}/sessions/{sessionId}/events/{eventId}
          allow read: if isAuthenticated(); // Allows LISTING events in this session and GETTING individual event docs
          allow write: if isAuthenticated() &&
                               request.resource.data.deviceId == deviceId && // Good check
                               request.resource.data.sessionId == sessionId && // Also a good check
                               isValidTimestamp(request.resource.data.updatedAt); // Or your relevant event timestamp
        }
      }
    }

    // Add this rule for collectionGroup queries on 'events'
    match /{path=**}/events/{eventId} {
      allow read: if isAuthenticated();
    }

    // Allow read access to prompts collection for authenticated users
    match /prompts/{document=**} {
      allow read: if isAuthenticated();
    }

    // Deny access to all other paths by default
    match /{path=**} {
      allow read, write: if false;
    }
  }
}
EOF_RULES
    if [ ! -s "${firestore_rules_file_local}" ]; then
         echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
         echo "CRITICAL ERROR: Failed to create or populate the Firestore rules file '${firestore_rules_file_local}'."
         echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
         return 1
    fi

    # # Create Firebase Storage rules file
    # echo "INFO: Creating Firebase Storage rules file: <span class="math-inline">\{STORAGE\_RULES\_FILE\}\.\.\."
cat << 'EOF_STORAGE_RULES' > "${STORAGE_RULES_FILE}"

rules_version = '2';

service firebase.storage {
  // This rule applies to any bucket linked to Firebase Storage for this project.
  // {bucket} will be the actual GCS bucket name being accessed.
  match /b/{bucket}/o {
    match /{allPaths=**} {
      // Allow client-side read/write access if the user is authenticated via Firebase Auth.
      // This means your React app can manage files if users are signed in.
      allow read: if request.auth != null;
      allow write: if request.auth != null;
      // For production, refine write access, e.g.:
      // allow write: if request.auth != null && request.resource.size < 10 * 1024 * 1024; // Max 10MB
      // allow write: if request.auth != null && request.resource.contentType.matches('image/.*'); // Only images
    }
  }
}
EOF_STORAGE_RULES

if [ ! -s "${STORAGE_RULES_FILE}" ]; then
echo "CRITICAL ERROR: Failed to create Storage rules file '${STORAGE_RULES_FILE}'."
return 1
fi

    # Create/Update temporary firebase.json to include both Firestore and Storage rules
echo "INFO: Creating temporary firebase config for Firestore and Storage rules: ${firebase_json_file_temp}"
cat << EOF_FIREBASE_JSON > "${firebase_json_file_temp}"
{
  "firestore": [
    {
      "database": "${firestore_db_id_local}",
      "rules": "${firestore_rules_file_local}"
    }
  ],
  "storage": {
    "rules": "${STORAGE_RULES_FILE}"
  }
}
EOF_FIREBASE_JSON

if [ ! -s "${firebase_json_file_temp}" ]; then
echo "ERROR: Failed to create temporary firebase config '${firebase_json_file_temp}'"
return 1
fi

    echo "INFO: Proceeding with Firebase deployment for Firestore and Storage rules..."
    > "$TEMP_ERROR_LOG"
    set +e
    firebase deploy --project "${project_id_local}" \
                    --config "${firebase_json_file_temp}" \
                    --only firestore,storage \
                    --non-interactive --debug 2>"$TEMP_ERROR_LOG"
    local deploy_exit_code=$?
    set -e

    if [ $deploy_exit_code -eq 0 ]; then
        echo ""
        echo "Firestore and Firebase Storage rules deployment using Firebase CLI completed successfully."
        echo "IMPORTANT: Please VERIFY rules in the Firebase/GCP console."
        return 0
    else
        echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        echo "ERROR: Firebase CLI deployment for Firestore/Storage rules failed (Exit Code: $deploy_exit_code)."
        # ... (existing detailed error reporting) ...
        cat "$TEMP_ERROR_LOG"
        echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        return 1
    fi
}

add_to_cleanup() {
  local item_to_add="$1"; local found=0
  for item in "${CLEANUP_FILES[@]}"; do if [[ "$item" == "$item_to_add" ]]; then found=1; break; fi; done
  if [[ "$found" -eq 0 ]]; then CLEANUP_FILES+=("$item_to_add"); fi
}
# Register temp files that are consistently named
add_to_cleanup "$TEMP_ERROR_LOG"
add_to_cleanup "$OPENAPI_SPEC_FILE"
add_to_cleanup "$API_KEY_TMP_FILE"
add_to_cleanup "$API_KEY_COMMAND_FULL_OUTPUT_LOG"
add_to_cleanup "$FIRESTORE_RULES_FILE" # Added
add_to_cleanup "$STORAGE_RULES_FILE" # <-- ADD THIS
add_to_cleanup "$CORS_GCS_CONFIG_FILE" # <-- ADD THIS
# --- Helper Functions ---
confirm_action() {
  local prompt_msg="$1"; local default_answer="${2:-yes}"; local yn; local prompt_suffix="(yes/no, default: ${default_answer}): "
  while true; do read -p "${prompt_msg} ${prompt_suffix}" yn; yn=${yn:-${default_answer}}; case $yn in [Yy]* ) return 0;; [Nn]* ) return 1;; * ) echo "Please answer yes or no.";; esac; done
}

attempt_jq_install() { # Returns 0 if jq available/installed, 1 otherwise
  if command -v jq &> /dev/null; then echo "jq is already installed."; return 0; fi
  echo "INFO: 'jq' (JSON processor) is not found."
  if confirm_action "Automated Firebase operations require 'jq'. Attempt to install jq now (may require sudo)?" "yes"; then
    JQ_INSTALLED_NOW=false
    if [[ "$(uname -s)" == "Linux" ]]; then
      if command -v apt-get &>/dev/null; then sudo apt-get update && sudo apt-get install -y jq && JQ_INSTALLED_NOW=true;
      elif command -v yum &>/dev/null; then sudo yum install -y jq && JQ_INSTALLED_NOW=true;
      elif command -v dnf &>/dev/null; then sudo dnf install -y jq && JQ_INSTALLED_NOW=true;
      else echo "Could not determine Linux package manager for jq. Please install manually."; fi
    elif [[ "$(uname -s)" == "Darwin" ]]; then
      if command -v brew &>/dev/null; then brew install jq && JQ_INSTALLED_NOW=true;
      else echo "Homebrew not found. Please install jq manually: https://stedolan.github.io/jq/download/"; fi
    else echo "Unsupported OS for automatic jq installation. Please install jq manually: https://stedolan.github.io/jq/download/"; fi

    if $JQ_INSTALLED_NOW; then echo "jq installed successfully."; return 0;
    else echo "jq installation attempt failed."; return 1; fi
  else echo "User chose not to install jq."; return 1; fi
}

create_or_verify_sa() {
  local sa_name_local="$1"; local sa_email_local="$2"; local display_name_local="$3"; local project_id_local="$4"
  echo "Creating/Verifying Service Account: ${sa_email_local}"
  if gcloud iam service-accounts describe "${sa_email_local}" --project="${project_id_local}" > /dev/null 2>&1; then
    echo "Service Account ${sa_email_local} already exists."
  else
    echo "Service Account ${sa_email_local} does not exist or is not accessible. Attempting to create..."
    gcloud iam service-accounts create "${sa_name_local}" --display-name="${display_name_local}" --project="${project_id_local}" 2> "$TEMP_ERROR_LOG"
    local cr_code=$?
    if [ ${cr_code} -ne 0 ]; then
      echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
      echo "ERROR: Failed to create Service Account '${sa_name_local}' (Exit Code: ${cr_code})."
      echo "gcloud error output:"
      cat "$TEMP_ERROR_LOG"
      echo "Please check your IAM permissions to create service accounts in project '${project_id_local}'."
      echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
      exit 1
    fi
    echo "Service Account ${sa_name_local} creation initiated. Waiting for propagation..."
    sleep 20 # Increased sleep after creation
  fi

  echo "Verifying Service Account ${sa_email_local} is fully available..."
  local max_att=12; local sa_ok=false; # Increased attempts
  for (( i=1; i<=max_att; i++ )); do
    if gcloud iam service-accounts describe "${sa_email_local}" --project="${project_id_local}" > /dev/null 2>&1; then
      sa_ok=true; echo "Service Account ${sa_email_local} successfully verified."
      break
    else
      echo "Service Account ${sa_email_local} not yet fully propagated (attempt $i/$max_att). Waiting 10 seconds..."
      sleep 10
    fi
  done
  if [ "$sa_ok" = false ]; then echo "ERROR: Service Account ${sa_email_local} could NOT be verified after ${max_att} attempts. This is critical."; exit 1; fi; echo ""
}

ensure_firebase_linked() {
    local project_id="$1"
    if ! command -v firebase &> /dev/null; then
        echo "ERROR: Firebase CLI is not installed. Install it with: npm install -g firebase-tools"
        exit 1
    fi

    echo "Checking if project '${project_id}' is linked to Firebase..."
    # Use the correct 'result' key in jq:
    if firebase projects:list --json | jq -e --arg pid "$project_id" '.result[] | select(.projectId == $pid)' > /dev/null; then
        echo "✅ Firebase project '${project_id}' is linked and accessible via the CLI."
    else
        echo ""
        echo "‼️  Your project '${project_id}' is NOT linked to Firebase, or you lack permission via the CLI."
        echo "Please link your project in the Firebase Console (Add project, select existing GCP project):"
        echo "    https://console.firebase.google.com/"
        echo "Enable billing if not already enabled:"
        echo "    https://console.cloud.google.com/billing/"
        echo "Then, in Firebase → Build → Storage, click 'Get Started' to create your bucket."
        echo "Set your budget, choose best region and when asked choose Start in Production Mode"
        echo ""
        read -p "After you complete these steps, press Enter to retry this check..."
        # Optionally: re-try the check here, and loop until it’s found
    fi
}


ensure_billing_enabled() { local p_id_local="$1"; local billing_ok=false; while ! $billing_ok; do echo "--- Checking Billing Status for project '${p_id_local}' ---"; ACC_NAME=$(gcloud billing projects describe "${p_id_local}" --format="value(billingAccountName)" 2>/dev/null); EN_STATUS=$(gcloud billing projects describe "${p_id_local}" --format="value(billingEnabled)" 2>/dev/null); if [ -n "$ACC_NAME" ] && [ "$EN_STATUS" == "True" ]; then echo "Billing IS ENABLED for project '${p_id_local}' (Account: ${ACC_NAME})."; billing_ok=true; return 0; else echo "ERROR: Billing does NOT appear to be enabled or linked for project '${p_id_local}'. (Account: '${ACC_NAME:-Not found}', Enabled: '${EN_STATUS:-Not found}')"; echo "Go to: https://console.cloud.google.com/billing/linkedaccount?project=${p_id_local} to link/enable billing."; echo "This script CANNOT proceed without active billing on the project."; if confirm_action "Have you now enabled/verified billing and want to re-check?" "yes"; then echo "Re-checking billing status..."; else echo "User chose not to enable billing or re-check. Exiting script."; return 1; fi; fi; done; }
check_gcloud_python_compatibility() { echo "--- Checking gcloud SDK Python Compatibility (for MutableMapping issue) ---"; local gcloud_test_output; set +e; gcloud_test_output=$(gcloud version --quiet 2>&1); local gcloud_test_exit_code=$?; set -e; if [ $gcloud_test_exit_code -ne 0 ]; then PYTHON_BEING_USED_BY_GCLOUD=$(gcloud info --format='value(basic.python_location)' 2>/dev/null || echo "Could not determine"); if echo "$gcloud_test_output" | grep -q "collections" && echo "$gcloud_test_output" | grep -q "MutableMapping"; then echo ""; echo "!!!!!!!!!!!!!!!! CRITICAL GCLOUD SDK PYTHON COMPATIBILITY ERROR DETECTED !!!!!!!!!!!!!!!"; echo "  'module 'collections' has no attribute 'MutableMapping'"; echo "This often occurs with Python 3.10+ and older gcloud components."; echo "Python used by gcloud: ${PYTHON_BEING_USED_BY_GCLOUD}"; echo "RECOMMENDED ACTIONS (try in order):"; echo "  1. Update gcloud SDK: gcloud components update"; echo "  2. If error persists, Reinstall gcloud SDK: https://cloud.google.com/sdk/docs/install"; echo "  3. (Workaround) Set CLOUDSDK_PYTHON to a Python 3.7-3.9 path."; echo "Full error: $gcloud_test_output"; echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"; exit 1; else echo "ERROR: 'gcloud version' failed (Code: $gcloud_test_exit_code). Output: $gcloud_test_output"; exit 1; fi; else echo "gcloud SDK basic command test successful."; fi; echo ""; }
check_gcloud_sdk_python_version_for_gsutil() { echo "--- Checking Python Version Environment for gsutil ---"; local python_path; local python_version_full; local python_major; local python_minor; local gsutil_path; if ! gsutil_path=$(command -v gsutil); then echo "ERROR: 'gsutil' not found. Ensure Cloud SDK bin directory is in PATH."; return 1; fi; echo "Found gsutil at: $gsutil_path"; python_path=$(gcloud info --format='value(basic.python_location)' 2>/dev/null); if [ -z "$python_path" ]; then echo "Warning: Could not get gcloud's Python path. Using system 'python3'."; if command -v python3 &> /dev/null; then python_path=$(command -v python3); else echo "ERROR: 'python3' not found."; if confirm_action "Cannot verify Python for gsutil. Continue (may fail)?" "no"; then return 1; fi; return 0; fi; fi; echo "gcloud/gsutil using Python at: $python_path"; set +e; python_version_full=$("$python_path" --version 2>&1); local py_ver_ec=$?; set -e; if [ $py_ver_ec -ne 0 ]; then echo "ERROR: Failed to get version from '$python_path --version'. Output: $python_version_full"; return 1; fi; echo "Detected Python for gcloud/gsutil: $python_version_full"; if echo "$python_version_full" | grep -q "Python "; then python_major=$(echo "$python_version_full" | awk '{print $2}' | cut -d. -f1); python_minor=$(echo "$python_version_full" | awk '{print $2}' | cut -d. -f2); elif echo "$python_version_full" | grep -q -E "^[0-9]+\.[0-9]+"; then python_major=$(echo "$python_version_full" | cut -d. -f1); python_minor=$(echo "$python_version_full" | cut -d. -f2); else echo "WARN: Could not parse Python version. Manual check needed (gsutil might prefer 3.8-3.12)."; return 0; fi; if ! [[ "$python_major" =~ ^[0-9]+$ ]] || ! [[ "$python_minor" =~ ^[0-9]+$ ]]; then echo "WARN: Parsed Major/Minor not numbers: M='${python_major}', m='${python_minor}'. Manual check needed."; return 0; fi; echo "Parsed Python for gcloud/gsutil: ${python_major}.${python_minor}"; if [ "$python_major" -eq 3 ] && [ "$python_minor" -ge 13 ]; then echo "!!!!!!!!!!!!!!!! POTENTIAL GSUTIL PYTHON COMPATIBILITY WARNING !!!!!!!!!!!!!!!!"; echo "  gcloud/gsutil using Python ${python_major}.${python_minor}. Older gsutil versions may error with Python 3.13+ (expecting 3.8-3.12)."; echo "  If 'gsutil' commands fail, PRIMARY FIX is: gcloud components update"; echo "  Then, if needed: export CLOUDSDK_PYTHON=/path/to/python3.8-3.12"; echo "  Details: https://cloud.google.com/storage/docs/gsutil_install#specifications"; echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"; if confirm_action "Continue despite potential gsutil Python issue?" "yes"; then echo "Proceeding..."; return 0; else echo "Exiting."; return 1; fi; elif [ "$python_major" -eq 3 ] && { [ "$python_minor" -lt 8 ] || [ "$python_minor" -gt 12 ]; }; then echo "!!!!!!!!!!!!!!!! POTENTIAL GSUTIL PYTHON COMPATIBILITY WARNING !!!!!!!!!!!!!!!!"; echo "  gcloud/gsutil using Python ${python_major}.${python_minor}. gsutil officially supports 3.8-3.12."; echo "  If 'gsutil' commands fail, try: gcloud components update OR export CLOUDSDK_PYTHON=/path/to/python3.8-3.12"; echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"; if confirm_action "Continue?" "yes"; then echo "Proceeding..."; return 0; else echo "Exiting."; return 1; fi; else echo "Python ${python_major}.${python_minor} seems compatible with common gsutil versions."; return 0; fi; }

# --- Script Start & Welcome ---
clear
echo ""
echo "    █████╗ ███╗   ██╗ █████╗ ██╗   ██╗ █████╗ "
echo "   ██╔══██╗████╗  ██║██╔══██╗██║   ██║██╔══██╗"
echo "   ███████║██╔██╗ ██║███████║██║   ██║███████║"
echo "   ██╔══██║██║╚██╗██║██╔══██║╚██╗ ██╔╝██╔══██║"
echo "   ██║  ██║██║ ╚████║██║  ██║ ╚████╔╝ ██║  ██║"
echo "   ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝"
echo ""

echo "‼️  REQUIRED: Project Setup and Prerequisites"
echo ""
echo "======================================"
echo "  1. Create your Google Cloud project"
echo "     👉 https://console.cloud.google.com/projectcreate"
echo ""
echo "  2. Enable billing for your project"
echo "     👉 https://console.cloud.google.com/billing/"
echo ""
echo "  3. Add Firebase to your GCP project"
echo "     👉 https://console.firebase.google.com/"
echo "     - Click 'Add project'"
echo "     - ***IMPORTANT: Click 'Add Firebase to your Google Cloud project' (tiny text at bottom!) and select the project you just created.***"
echo ""
echo "  4. In Firebase → Storage, click 'Get Started' to create your default storage bucket."
echo ""
echo "======================================"
echo ""
echo "🚦 Prerequisites Checklist 🚦"
echo ""
echo "✅ Node.js (https://nodejs.org/en/download/) -- Required for Firebase CLI"
echo "   • Check Node: node --version"

echo "✅ Firebase CLI (npm install -g firebase-tools)"
echo "✅ Google Cloud SDK (gcloud CLI):"
echo "   - macOS:    https://cloud.google.com/sdk/docs/install#mac"
echo "   - Windows:  https://cloud.google.com/sdk/docs/install#installing_the_latest_version"
echo "   • Check gcloud: gcloud --version"
echo "✅ jq: https://stedolan.github.io/jq/download/"
echo "   - macOS:    brew install jq"
echo "   - Windows:  Download jq.exe and add to PATH"
echo "✅ (Recommended) Git"
echo ""
echo "This script will check for these tools and stop if any are missing."
echo ""
echo "Press Enter ONLY after you have:"
echo " - Created your project and enabled billing"
echo " - Added Firebase (by linking to your GCP project, NOT a new one!)"
echo " - Initialized Storage in Firebase"
echo " - Installed all required tools above"
read

# --- Phase 1: Initial Setup & Critical Identifiers ---
# --- Initial System & SDK Checks ---
echo ">>> Phase 1: System Checks & Initial Authentication <<<"; echo ""
check_gcloud_python_compatibility; if [ $? -ne 0 ]; then exit 1; fi
if ! command -v gcloud &> /dev/null; then echo "'gcloud' not found. Install: https://cloud.google.com/sdk/docs/install. Exiting."; exit 1; fi
echo "'gcloud' found. Version: $(gcloud --version | head -n 1)"; echo ""

if ! command -v gsutil &> /dev/null; then echo "ERROR: 'gsutil' not found (required for GCS CORS setup). Ensure Cloud SDK bin directory is in PATH."; exit 1; fi
echo "'gsutil' found."

if ! command -v firebase &> /dev/null; then
  echo "ERROR: Firebase CLI 'firebase' not found even after potential installation attempt."
  echo "       Please install it manually (e.g., 'sudo npm install -g firebase-tools') and ensure it's in your PATH."
  echo "       You might need to open a new terminal or source your shell profile (e.g., source ~/.bashrc)."
  exit 1;
fi
echo "'firebase' CLI found. Version: $(firebase --version)"

if ! command -v jq &> /dev/null; then
  echo "ERROR: 'jq' (JSON processor) not found even after potential installation attempt."
  echo "       Please install it manually (e.g., 'sudo apt install -y jq')."
  exit 1;
fi
echo "'jq' found."

if ! check_gcloud_sdk_python_version_for_gsutil; then exit 1; fi
echo "Initial SDK checks passed."; echo ""
echo "INFO: Verifying gcloud API-Gateway component..."
ensure_api_gateway_component() {
  # test for the api-gateway command
  if ! gcloud api-gateway --help >/dev/null 2>&1; then
    echo "⚙️  gcloud API-Gateway component not found. Installing now…"
    if gcloud components install api-gateway --quiet; then
      echo "✅ gcloud API-Gateway component installed successfully."
    else
      echo "⚠️  Failed to install gcloud API-Gateway component."
      echo "   Please install it manually with:"
      echo "     gcloud components install api-gateway"
      # do not exit; script will warn later if commands fail
    fi
  else
    echo "✅ gcloud API-Gateway component is already installed."
  fi
}
ensure_api_gateway_component
echo ""

# --- Google Cloud Authentication ---
# --- Google Cloud Authentication ---
echo "--- Google Cloud Authentication ---"
# set +e; gcloud auth revoke --all > /dev/null 2>&1; set -e # Optional: force fresh login every time
echo "The script will now initiate Google Cloud login."
echo "A URL and/or code will be displayed."
echo "1. Open the URL in a web browser on any machine."
echo "2. If prompted, enter the code provided in the terminal into the browser."
echo "3. Authenticate with an account that has 'Owner' or equivalent permissions on the target GCP project."
echo "4. If the browser shows an authorization code, copy it."
echo "5. Paste the authorization code back into this terminal if prompted."
echo "6. IMPORTANT: Do NOT just hit Enter without entering the auth code!"
read -p "Press Enter to continue with gcloud login..."

# Always use --no-launch-browser for VM/scripted environments
auth_args="--update-adc --no-launch-browser"

# Retry loop for gcloud authentication
gcloud_auth_success=false
max_gcloud_auth_attempts=3
gcloud_auth_attempt=0

while [ $gcloud_auth_attempt -lt $max_gcloud_auth_attempts ] && [ "$gcloud_auth_success" = false ]; do
  gcloud_auth_attempt=$((gcloud_auth_attempt + 1))
  echo ""
  echo "=== Google Cloud Login Attempt ${gcloud_auth_attempt}/${max_gcloud_auth_attempts} ==="
  echo "REMINDER: When prompted for an authorization code, DO NOT just hit Enter!"
  echo "          You must copy the code from your browser and paste it here."
  echo ""
  
  set +e
  gcloud auth login $auth_args
  gcloud_login_exit_code=$?
  set -e
  
  if [ $gcloud_login_exit_code -eq 0 ]; then
    echo "✅ Google Cloud authentication successful!"
    gcloud_auth_success=true
  else
    echo ""
    echo "❌ Google Cloud authentication failed."
    if [ $gcloud_auth_attempt -lt $max_gcloud_auth_attempts ]; then
      echo ""
      echo "Common reasons for failure:"
      echo "  • You hit Enter without pasting the authorization code"
      echo "  • You pasted an incorrect or expired code"
      echo "  • Network connectivity issues"
      echo ""
      if confirm_action "Would you like to try logging in to Google Cloud again?" "yes"; then
        echo "Retrying Google Cloud authentication..."
        continue
      else
        echo "User chose not to retry Google Cloud authentication."
        break
      fi
    fi
  fi
done

if [ "$gcloud_auth_success" = false ]; then
  echo ""
  echo "❌ ERROR: Google Cloud authentication failed after ${max_gcloud_auth_attempts} attempts."
  echo "Please ensure you:"
  echo "  1. Have access to a web browser"
  echo "  2. Can copy/paste the authorization code correctly"
  echo "  3. Have the necessary permissions on the target GCP project"
  echo ""
  echo "You can also try running 'gcloud auth login' manually first, then re-run this script."
  exit 1
fi

CURRENT_GCLOUD_USER=$(gcloud auth list --filter=status:ACTIVE --format="value(account)")
echo "Authenticated as: ${CURRENT_GCLOUD_USER}"
echo ""

echo "--- GCP Project Selection ---"
PROJECT_LIST_OUTPUT=$(gcloud projects list --format="value(projectId,name)" --sort-by=projectId 2>"$TEMP_ERROR_LOG" || { cat "$TEMP_ERROR_LOG"; echo "ERROR listing projects."; exit 1; }); PROJECT_ID=""
if [ -z "${PROJECT_LIST_OUTPUT}" ]; then echo "No projects listed."; read -p "Manually enter target Project ID: " PROJECT_ID; else
    echo "Choose Project ID:"; INDEX=0; declare -a PID_ARR; declare -a PNAME_ARR; OLD_IFS=$IFS; IFS=$'\n'
    for line in ${PROJECT_LIST_OUTPUT}; do INDEX=$((INDEX+1)); PID_ARR[$INDEX]=$(echo "$line"|awk '{print $1}'); PNAME_ARR[$INDEX]=$(echo "$line"|awk '{$1=""; print $0}'|sed 's/^ *//'); echo "  ${INDEX}. ${PID_ARR[$INDEX]} (${PNAME_ARR[$INDEX]})"; done; IFS=$OLD_IFS
    CURR_PROJ=$(gcloud config get-value project 2>/dev/null || echo ""); DEF_SEL=""
    if [ -n "${CURR_PROJ}" ]; then for i in "${!PID_ARR[@]}"; do if [ "${PID_ARR[$i]}" == "${CURR_PROJ}" ]; then DEF_SEL=$i; break; fi; done; fi
    while true; do if [ -n "${DEF_SEL}" ]; then read -p "Enter number (default: ${DEF_SEL} - ${PID_ARR[$DEF_SEL]}): " SEL; SEL="${SEL:-${DEF_SEL}}"; else read -p "Enter number: " SEL; fi; if [[ "${SEL}" =~ ^[0-9]+$ ]] && [ -n "${PID_ARR[${SEL}]}" ]; then PROJECT_ID="${PID_ARR[${SEL}]}"; break; else echo "Invalid."; fi; done; fi
while [ -z "${PROJECT_ID}" ]; do read -p "Project ID cannot be empty. Enter Project ID: " PROJECT_ID; done
echo "Using Project ID: '${PROJECT_ID}'."; gcloud config set project "${PROJECT_ID}"; echo "Active gcloud project set."; echo ""
if ! ensure_billing_enabled "${PROJECT_ID}"; then exit 1; fi; echo "Billing status confirmed for project '${PROJECT_ID}'."; echo ""

ensure_firebase_cli_authenticated "${PROJECT_ID}"

# --- Phase 2: Gather All Remaining User Configuration Choices ---
# --- >>> Phase 2: Gather All Configuration Inputs <<< ---
echo ">>> Phase 2: Configuration Settings & Prerequisite Confirmations <<<"; echo ""

# --- Resource Naming ---
echo "--- Resource Naming ---"
DEFAULT_SOLUTION_PREFIX="anava-iot"
read -p "Enter a unique prefix for resources (e.g., 'anava-prod', 'axis-cam-test', default: ${DEFAULT_SOLUTION_PREFIX}): " INPUT_SOLUTION_PREFIX
SOLUTION_PREFIX="${INPUT_SOLUTION_PREFIX:-${DEFAULT_SOLUTION_PREFIX}}"
echo "Using resource prefix: '${SOLUTION_PREFIX}'"; echo ""

# --- GCP Region ---
echo "--- GCP Region ---"
REGIONS_LIST=( "us-central1 (Iowa)" "us-east1 (South Carolina)" "europe-west1 (Belgium)" "asia-northeast1 (Tokyo)" "Other" )
echo "Select GCP region for Cloud Functions, API Gateway, and default Firestore location (if creating new DB):"
PS3="Enter number for region: "
select region_choice in "${REGIONS_LIST[@]}"; do
    if [[ "$REPLY" -ge 1 && "$REPLY" -le ${#REGIONS_LIST[@]} ]]; then
        if [[ "$region_choice" == "Other" ]]; then
            read -p "Enter custom GCP region ID (e.g., us-west1): " CUSTOM_REGION
            GCP_REGION="${CUSTOM_REGION}"
        else
            GCP_REGION=$(echo "$region_choice" | awk '{print $1}')
        fi
        if [ -n "$GCP_REGION" ]; then break; else echo "Region cannot be empty."; fi
    else
        echo "Invalid selection. Please try again."
    fi
done
echo "Resources will be deployed to region: ${GCP_REGION}"; echo ""

# --- Firebase Web API Key Configuration ---
echo "--- Firebase Web API Key Configuration (for client-side Firebase SDK) ---"
FIREBASE_API_KEY_PROVIDED_MANUALLY=false
# USER_AUTHORIZES_FIREBASE_APP_CREATION=false # Reset from global, will be set by confirm_action
DEFAULT_FIREBASE_WEBAPP_NAME="${SOLUTION_PREFIX}-webapp-$(date +%s%N | tail -c 4)" # Keep default name dynamic

if confirm_action "Do you want to provide an existing Firebase Web API Key manually?" "no"; then
    FIREBASE_API_KEY_PROVIDED_MANUALLY=true
    read -p "Enter your existing Firebase Web API Key: " FIREBASE_WEB_API_KEY_INPUT_TEMP
    while $FIREBASE_API_KEY_PROVIDED_MANUALLY && [ -z "${FIREBASE_WEB_API_KEY_INPUT_TEMP}" ]; do
        read -p "Firebase Web API Key cannot be empty. Enter Key (or type 'auto' to switch to automated retrieval): " FIREBASE_WEB_API_KEY_INPUT_RETRY
        FIREBASE_WEB_API_KEY_INPUT_LOWER=$(echo "$FIREBASE_WEB_API_KEY_INPUT_RETRY"|tr '[:upper:]' '[:lower:]')
        if [[ "${FIREBASE_WEB_API_KEY_INPUT_LOWER}" == "auto" ]]; then
            FIREBASE_API_KEY_PROVIDED_MANUALLY=false
            FIREBASE_WEB_API_KEY_INPUT_TEMP="" # Clear temp
            echo "Switched to automated Firebase Web API Key retrieval/creation."
            break
        elif [ -n "$FIREBASE_WEB_API_KEY_INPUT_RETRY" ]; then
            FIREBASE_WEB_API_KEY_INPUT_TEMP="$FIREBASE_WEB_API_KEY_INPUT_RETRY"
        fi
    done
    if $FIREBASE_API_KEY_PROVIDED_MANUALLY && [ -n "$FIREBASE_WEB_API_KEY_INPUT_TEMP" ]; then
        FIREBASE_WEB_API_KEY_INPUT="$FIREBASE_WEB_API_KEY_INPUT_TEMP" # Set the global input
        echo "Using manually provided Firebase Web API Key."
    fi
fi

if ! $FIREBASE_API_KEY_PROVIDED_MANUALLY; then
    echo "The script will attempt to automatically retrieve an API key from an existing Firebase Web App"
    echo "or create a new Firebase Web App to get a key (requires 'jq')."
    USER_AUTHORIZES_FIREBASE_APP_CREATION=true
fi
echo "Firebase Web API Key configuration choices recorded."; echo ""

echo "--- Firebase Web API Key Configuration (for client-side Firebase SDK) ---"
# FIREBASE_API_KEY_PROVIDED_MANUALLY=false
# # USER_AUTHORIZES_FIREBASE_APP_CREATION=false # Reset from global, will be set by confirm_action
DEFAULT_FIREBASE_WEBAPP_NAME="${SOLUTION_PREFIX}-webapp-$(date +%s%N | tail -c 4)" # Keep default name dynamic

# --- GCS CORS Configuration (for the Default Firebase Storage Bucket) ---
echo "--- GCS CORS Configuration (for Client-Side React Web App access to Firebase Storage) ---"
echo "Your client-side React app will fetch images from the default Firebase Storage bucket."
echo "Enter the origin URL(s) of your web app (e.g., http://localhost:3000 for development,"
echo "https://your-app-domain.com for production). Separate multiple origins with a comma."
DEFAULT_WEB_APP_ORIGINS="http://localhost:3000,https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com"
read -p "Web App Origins for CORS (default: \"${DEFAULT_WEB_APP_ORIGINS}\"): " WEB_APP_ORIGINS_INPUT_TEMP
WEB_APP_ORIGINS_INPUT="${WEB_APP_ORIGINS_INPUT_TEMP:-${DEFAULT_WEB_APP_ORIGINS}}"
echo "INFO: GCS CORS for the default Firebase Storage bucket will be configured for these origins: '${WEB_APP_ORIGINS_INPUT}'"; echo ""

# --- Final Prerequisite Confirmations ---
echo "--- Final Prerequisite Confirmations for Project '${PROJECT_ID}' ---"
if ! ensure_billing_enabled "${PROJECT_ID}"; then echo "CRITICAL: Billing setup failed. Exiting."; exit 1; fi
echo "Billing status confirmed for project '${PROJECT_ID}'."

echo "This script will make significant changes to your GCP project '${PROJECT_ID}' including enabling APIs,"
echo "creating service accounts, deploying functions, an API Gateway, and configuring Firebase services."
if ! confirm_action "Are you sure you want to proceed with the automated setup using the configurations above?" "yes"; then
    echo "User aborted setup. Exiting."
    exit 0
fi

echo "---------------------------------------------------------------------"
echo "All configurations gathered and prerequisites confirmed."
echo "The script will now proceed with automated resource deployment."
echo "This may take 10-20 minutes or more. Please do not interrupt."
echo "---------------------------------------------------------------------"
read -p "Press Enter to begin automated setup..."; echo ""

# --- Phase 3: Automated Execution ---
main_setup_execution() {
    set -euo pipefail # Ensure this is the first command in the function

    echo ">>> Phase 3: Automated Resource Setup <<<"; echo ""
    # Define derived variables
    if [ -z "${PROJECT_ID}" ]; then
        echo "CRITICAL ERROR: PROJECT_ID is empty at the start of main_setup_execution. Exiting."
        exit 1
    fi
    if [ -z "${SOLUTION_PREFIX}" ]; then
        echo "CRITICAL ERROR: SOLUTION_PREFIX is empty at the start of main_setup_execution. Exiting."
        exit 1
    fi

    # Standard SA Name/Email Definitions (these should be correct)
    WIF_POOL_ID="${SOLUTION_PREFIX}-pool"
    WIF_PROVIDER_ID="${SOLUTION_PREFIX}-firebase-provider"
    ISSUER_URI="https://securetoken.google.com/${PROJECT_ID}"

    DEVICE_AUTH_FUNCTION_NAME="${SOLUTION_PREFIX}-device-auth-fn"
    DEVICE_AUTH_SA_NAME="${SOLUTION_PREFIX}-da-fn-sa"
    DEVICE_AUTH_SA_EMAIL="${DEVICE_AUTH_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

    TVM_FUNCTION_NAME="${SOLUTION_PREFIX}-tvm-fn"
    TVM_SA_NAME="${SOLUTION_PREFIX}-tvm-fn-sa"
    TVM_SA_EMAIL="${TVM_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

    API_ID="${SOLUTION_PREFIX}-api"
    API_CONFIG_ID_BASE="${SOLUTION_PREFIX}-api-cfg"
    API_GATEWAY_ID="${SOLUTION_PREFIX}-gw"
    API_GATEWAY_KEY_DISPLAY_NAME="${SOLUTION_PREFIX}-device-key"

    APIGW_INVOKER_SA_NAME="${SOLUTION_PREFIX}-apigw-invoker-sa"
    APIGW_INVOKER_SA_EMAIL="${APIGW_INVOKER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

    VERTEX_AI_SA_NAME_FIXED="${SOLUTION_PREFIX}-vertex-main-sa"
    VERTEX_AI_SA_EMAIL="${VERTEX_AI_SA_NAME_FIXED}@${PROJECT_ID}.iam.gserviceaccount.com"

    # --- Step 1b (Execution): Enable APIs ---
    echo "--- Enabling Required Google Cloud APIs for project ${PROJECT_ID} ---"
    APIS_TO_ENABLE=(
        "iam.googleapis.com" "iamcredentials.googleapis.com" "cloudresourcemanager.googleapis.com"
        "firebase.googleapis.com" "identitytoolkit.googleapis.com" "storage.googleapis.com"
        "firebasestorage.googleapis.com" "sts.googleapis.com" "aiplatform.googleapis.com"
        "cloudfunctions.googleapis.com" "run.googleapis.com" "cloudbuild.googleapis.com"
        "artifactregistry.googleapis.com" "logging.googleapis.com" "pubsub.googleapis.com"
        "apigateway.googleapis.com" "servicecontrol.googleapis.com" "apikeys.googleapis.com"
        "firestore.googleapis.com" "compute.googleapis.com"
    )
    echo "Enabling APIs..."; for API_SERVICE in "${APIS_TO_ENABLE[@]}"; do echo -n "Ensuring API ${API_SERVICE}... "; ENABLED_SERVICE_CHECK=$(gcloud services list --enabled --project="${PROJECT_ID}" --filter="config.name=${API_SERVICE}" --format="value(config.name)" 2>/dev/null); if [ -z "$ENABLED_SERVICE_CHECK" ]; then echo -n "enabling... "; gcloud services enable "${API_SERVICE}" --project="${PROJECT_ID}" --quiet 2>"$TEMP_ERROR_LOG" || { cat "$TEMP_ERROR_LOG"; echo "ERROR enabling ${API_SERVICE}"; exit 1; }; echo "ENABLED."; else echo "already enabled."; fi; done
    echo "APIs checked. Waiting 30s for propagation..."; sleep 30; echo ""

    # --- Ensure Firebase is linked to the GCP project ---
    # (Your existing ensure_firebase_linked function call is here)
    if ! ensure_firebase_linked "${PROJECT_ID}"; then
        echo "CRITICAL ERROR: Firebase linkage to project '${PROJECT_ID}' is required and could not be completed/confirmed. Exiting."
        exit 1
    fi
    echo "Firebase linkage to project confirmed."
    echo ""

    echo "--- Checking if Firebase Storage bucket exists ---"
    BUCKETS_TO_CHECK=("gs://${PROJECT_ID}.appspot.com" "gs://${PROJECT_ID}.firebasestorage.app")
    BUCKET_FOUND=false

    for BUCKET in "${BUCKETS_TO_CHECK[@]}"; do
        if gsutil ls -b "$BUCKET" &>/dev/null; then
            echo "Firebase Storage bucket found: $BUCKET"
            BUCKET_FOUND=true
            FIREBASE_STORAGE_BUCKET="$BUCKET"
            break
        fi
    done

    if ! $BUCKET_FOUND; then
        echo ""
        echo "WARNING: No Firebase Storage bucket was found for this project."
        echo "To continue, please:"
        echo "  1. Visit https://console.firebase.google.com/project/${PROJECT_ID}/storage"
        echo "  2. Click 'Get Started' to provision the default Storage bucket, OR link your custom bucket."
        echo ""
        echo "When finished, press Enter to continue."
        read -p ""
    fi

    if [ -n "$FIREBASE_STORAGE_BUCKET" ]; then
        echo "INFO: Preparing to set CORS policy on $FIREBASE_STORAGE_BUCKET..."

        # Generate origins array as before, or just use defaults:
        origins_json_array="\"http://localhost:3000\",\"https://${PROJECT_ID}.web.app\",\"https://${PROJECT_ID}.firebaseapp.com\""
        cat << EOF_CORS > cors.json
    [
    {
        "origin": [${origins_json_array}],
        "method": ["GET", "HEAD"],
        "responseHeader": ["Content-Type", "Access-Control-Allow-Origin"],
        "maxAgeSeconds": 3600
    }
    ]
EOF_CORS

        gsutil cors set cors.json "$FIREBASE_STORAGE_BUCKET"
        echo "INFO: CORS set. Done."
    else
        echo "WARNING: No Firebase Storage bucket found. CORS not set."
    fi

    # (3) Write Firestore rules
    echo "INFO: Writing Firestore rules to ${FIRESTORE_RULES_FILE}..."
    cat > "${FIRESTORE_RULES_FILE}" <<'EOF'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() { return request.auth != null; }
    function isValidTimestamp(ts) {
      return ts is timestamp && ts <= request.time + duration.value(5, 'm');
    }
    match /devices {
      allow list: if true;  // DEBUG: switch to isAuthenticated() for prod
    }
    match /devices/{deviceId} {
      allow read: if isAuthenticated();
      allow write: if isAuthenticated()
                   && request.resource.data.deviceId == deviceId
                   && isValidTimestamp(request.resource.data.updatedAt);
      match /sessions/{sessionId} {
        allow read: if isAuthenticated();
        allow write: if isAuthenticated()
                     && request.resource.data.deviceId == deviceId
                     && request.resource.data.status is string
                     && isValidTimestamp(request.resource.data.updatedAt);
        match /events/{eventId} {
          allow read: if isAuthenticated();
          allow write: if isAuthenticated()
                       && request.resource.data.deviceId == deviceId
                       && request.resource.data.sessionId == sessionId
                       && isValidTimestamp(request.resource.data.updatedAt);
        }
      }
    }
    match /prompts/{document=**} { allow read: if isAuthenticated(); }
    match /{document=**} { allow read, write: if false; }
  }
}
EOF

    # (4) Write Storage rules
    echo "INFO: Writing Firebase Storage rules to ${STORAGE_RULES_FILE}..."
    cat > "${STORAGE_RULES_FILE}" <<'EOF'
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
EOF

cat > firebase.json <<EOF
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "storage": {
    "rules": "storage.rules"
  }
}
EOF


    # (5) Deploy both rules non-interactively
    echo "🚀 Deploying Firestore & Storage rules (non-interactive)…"
    firebase --project "${PROJECT_ID}" deploy --only firestore,storage --non-interactive

    echo "✅ Rules deployed. Proceeding with the rest of setup…"

    DEFAULT_FIRESTORE_DB_ID="(default)"
    read -p "Enter Firestore database ID (hit Enter for default \"${DEFAULT_FIRESTORE_DB_ID}\"): " DB_ID_INPUT
    FIRESTORE_DATABASE_ID="${DB_ID_INPUT:-${DEFAULT_FIRESTORE_DB_ID}}"
    echo "Using Firestore database ID: ${FIRESTORE_DATABASE_ID}"
    echo ""

    # --- Ensure Firestore Database exists and deploy rules ---
    if ! ensure_firestore_database "${PROJECT_ID}" "${GCP_REGION}" "${FIRESTORE_DATABASE_ID}"; then
        echo "CRITICAL ERROR: Firestore database '${FIRESTORE_DATABASE_ID}' setup failed or was skipped by user. Exiting."
        exit 1
    fi
    echo "Firestore database '${FIRESTORE_DATABASE_ID}' is available."
    echo ""

    # --- Ensure Firebase is linked to the GCP project ---
    if ! ensure_firebase_linked "${PROJECT_ID}"; then
        echo "CRITICAL ERROR: Firebase linkage to project '${PROJECT_ID}' is required and could not be completed/confirmed. Exiting."
        exit 1
    fi
    echo "Firebase linkage to project confirmed."
    echo ""

    if ! deploy_firebase_rules "${PROJECT_ID}" "${FIRESTORE_DATABASE_ID}" "${FIRESTORE_RULES_FILE}"; then # Pass same args
        echo "CRITICAL ERROR: Failed to deploy Firebase (Firestore/Storage) rules. Exiting."
        exit 1
    fi
    echo "Firebase Firestore and Storage rules deployed."
    echo ""

    FB_MGMT_ACCESS_TOKEN=$(gcloud auth print-access-token 2>"$TEMP_ERROR_LOG")

    # --- Step 2b: Bootstrap default Firebase Auth configuration ---
    echo "Initializing Firebase Auth (Identity Platform) for project ${PROJECT_ID}…"
    ACCESS_TOKEN_AUTH_INIT=$(gcloud auth print-access-token) # Renamed to avoid conflict
    curl -sf -X POST \
      "https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/identityPlatform:initializeAuth" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_AUTH_INIT}" \
      -H "Content-Type: application/json" \
      -H "X-Goog-User-Project: ${PROJECT_ID}" \
    && echo "✅ Identity Platform initialized." \
    || echo "⚠️ Identity Platform may already be initialized, or there was an error."
    echo ""

# --- Step 2a (Execution): Firebase Web App Configuration Retrieval/Creation ---
    echo ""
    echo "--- Retrieving/Creating Firebase Web App Configuration ---"
    # Ensure global Firebase config variables are initially empty or reset
    FIREBASE_WEB_API_KEY=""
    FIREBASE_AUTH_DOMAIN=""
    FIREBASE_PROJECT_ID_FROM_CONFIG=""
    FIREBASE_STORAGE_BUCKET_FROM_CONFIG=""
    FIREBASE_MESSAGING_SENDER_ID=""
    FIREBASE_APP_ID=""
    FIREBASE_MEASUREMENT_ID=""
    FIREBASE_CONFIG_JSON_OUTPUT=""

    local firebase_config_found_or_created=false

    if $FIREBASE_API_KEY_PROVIDED_MANUALLY && [ -n "$FIREBASE_WEB_API_KEY_INPUT" ]; then
        # User provided the API key manually. We won't have other config details from this path.
        FIREBASE_WEB_API_KEY="$FIREBASE_WEB_API_KEY_INPUT"
        echo "INFO: Using manually provided Firebase Web API Key: ${FIREBASE_WEB_API_KEY}"
        echo "WARNING: Other Firebase config details (authDomain, appId, etc.) were not retrieved as API key was manual."
        echo "         These will need to be sourced from your Firebase project settings for client-side setup."
        # We can try to derive some:
        FIREBASE_AUTH_DOMAIN="${PROJECT_ID}.firebaseapp.com"
        FIREBASE_PROJECT_ID_FROM_CONFIG="${PROJECT_ID}"
        # App ID and Messaging Sender ID are harder to derive without an API call.
        firebase_config_found_or_created=true # Mark as true because API key is set.
    else
        echo "INFO: Attempting automated Firebase Web App configuration retrieval/creation..."
        if ! command -v jq &> /dev/null; then
            echo "CRITICAL ERROR: 'jq' (JSON processor) is required for automated Firebase Web App config retrieval but is not installed."
            echo "                Please install 'jq' or provide the Firebase Web API Key manually. Exiting."
            exit 1
        fi
        echo "INFO: 'jq' is available."

        # Fetch gcloud auth token for Firebase Management API calls
        # This ACCESS_TOKEN will be used throughout this block for Firebase API calls.
        echo "INFO: Fetching gcloud auth token for Firebase Management API calls..."
        local ACCESS_TOKEN_FIREBASE_MGMT # Localize to this block
        ACCESS_TOKEN_FIREBASE_MGMT=$(gcloud auth print-access-token 2>"$TEMP_ERROR_LOG")
        if [ -z "$ACCESS_TOKEN_FIREBASE_MGMT" ]; then
            echo "CRITICAL ERROR: Could not obtain gcloud auth token for Firebase Management API calls."
            cat "$TEMP_ERROR_LOG" 2>/dev/null
            exit 1
        fi
        echo "INFO: Auth token obtained for Firebase Management API."

        # Try to find an existing Firebase Web App and get its config
        echo "INFO: Looking for existing Firebase Web Apps in project '${PROJECT_ID}'..."
        local existing_app_config_json=""
        set +e
        local CURL_RESPONSE_LIST_APPS=$(curl --fail -s -w "\nHTTP_STATUS_CODE:%{http_code}" \
            -X GET "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps" \
            -H "Authorization: Bearer ${ACCESS_TOKEN_FIREBASE_MGMT}" \
            -H "Content-Type: application/json" \
            -H "X-Goog-User-Project: ${PROJECT_ID}" 2>"$TEMP_ERROR_LOG")
        local curl_list_apps_exit_code=$?
        set -e

        local http_status_list_apps=$(echo "$CURL_RESPONSE_LIST_APPS" | tail -n1 | cut -d':' -f2 || echo "HTTP_STATUS_UNKNOWN")
        local web_app_list_json_body=$(echo "$CURL_RESPONSE_LIST_APPS" | sed '$d')

        echo "DEBUG: List Web Apps - Curl Exit: $curl_list_apps_exit_code, HTTP Status: $http_status_list_apps"

        if [ $curl_list_apps_exit_code -eq 0 ] && [ "$http_status_list_apps" -eq 200 ]; then
            if [ -n "$web_app_list_json_body" ] && [[ "$web_app_list_json_body" != "null" ]] && [[ "$web_app_list_json_body" != "{}" ]]; then
                local first_web_app_id=$(echo "$web_app_list_json_body" | jq -r '.apps[0].appId // empty')
                if [ -n "$first_web_app_id" ]; then
                    echo "INFO: Found existing Firebase Web App ID: ${first_web_app_id}. Fetching its configuration..."
                    set +e
                    local CURL_RESPONSE_GET_CONFIG=$(curl --fail -s -w "\nHTTP_STATUS_CODE:%{http_code}" \
                        -X GET "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps/${first_web_app_id}/config" \
                        -H "Authorization: Bearer ${ACCESS_TOKEN_FIREBASE_MGMT}" \
                        -H "Content-Type: application/json" \
                        -H "X-Goog-User-Project: ${PROJECT_ID}" 2>"$TEMP_ERROR_LOG")
                    local curl_get_config_exit_code=$?
                    set -e

                    local http_status_get_config=$(echo "$CURL_RESPONSE_GET_CONFIG" | tail -n1 | cut -d':' -f2 || echo "HTTP_STATUS_UNKNOWN")
                    existing_app_config_json=$(echo "$CURL_RESPONSE_GET_CONFIG" | sed '$d')
                    echo "DEBUG: Get Existing Web App Config - Curl Exit: $curl_get_config_exit_code, HTTP Status: $http_status_get_config"

                    if [ $curl_get_config_exit_code -eq 0 ] && [ "$http_status_get_config" -eq 200 ] && [ -n "$existing_app_config_json" ]; then
                        echo "INFO: Successfully fetched configuration for existing Firebase Web App."
                        FIREBASE_CONFIG_JSON_OUTPUT="$existing_app_config_json" # Save the JSON
                    else
                        echo "WARNING: Failed to get config for existing app '${first_web_app_id}'. Curl Exit: $curl_get_config_exit_code, HTTP Status: $http_status_get_config"
                        if [ -n "$existing_app_config_json" ]; then echo "         Body (may be error): $existing_app_config_json"; fi
                        if [ -s "$TEMP_ERROR_LOG" ]; then echo "         Stderr:"; cat "$TEMP_ERROR_LOG"; fi
                    fi
                else
                    echo "INFO: No existing Firebase web apps found in API response."
                fi
            else
                echo "INFO: List web apps API call returned HTTP 200, but no apps were listed or body was empty."
            fi
        else
            echo "ERROR: Failed to list Firebase web apps. Curl Exit: $curl_list_apps_exit_code, HTTP Status: $http_status_list_apps"
            if [ -n "$web_app_list_json_body" ]; then echo "       Body (first 300 chars): $(echo "$web_app_list_json_body" | head -c 300)"; fi
            if [ -s "$TEMP_ERROR_LOG" ]; then echo "       Stderr:"; cat "$TEMP_ERROR_LOG"; fi
        fi

        # If no config found from existing apps, and user authorized creation, create a new one
        if [ -z "$FIREBASE_CONFIG_JSON_OUTPUT" ] && $USER_AUTHORIZES_FIREBASE_APP_CREATION; then
            echo "INFO: No existing usable Firebase Web App config found. User authorized creation."
            echo "      Attempting to create new Firebase Web App named '${FIREBASE_NEW_WEBAPP_DISPLAY_NAME_INPUT}'..."
            local new_app_config_json=""
            set +e
            local CURL_RESPONSE_CREATE_APP=$(curl --fail -s -w "\nHTTP_STATUS_CODE:%{http_code}" \
                -X POST "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps" \
                -H "Authorization: Bearer ${ACCESS_TOKEN_FIREBASE_MGMT}" \
                -H "Content-Type: application/json" \
                -H "X-Goog-User-Project: ${PROJECT_ID}" \
                -d "{\"displayName\": \"${FIREBASE_NEW_WEBAPP_DISPLAY_NAME_INPUT}\"}" 2>"$TEMP_ERROR_LOG")
            local curl_create_app_exit_code=$?
            set -e

            local http_status_create_app=$(echo "$CURL_RESPONSE_CREATE_APP" | tail -n1 | cut -d':' -f2 || echo "HTTP_STATUS_UNKNOWN")
            local create_app_lro_json_body=$(echo "$CURL_RESPONSE_CREATE_APP" | sed '$d')
            echo "DEBUG: Create Web App - Curl Exit: $curl_create_app_exit_code, HTTP Status: $http_status_create_app"

            if [ $curl_create_app_exit_code -eq 0 ] && ([ "$http_status_create_app" -eq 200 ] || [ "$http_status_create_app" -eq 201 ]) && [ -n "$create_app_lro_json_body" ]; then
                local operation_name=$(echo "$create_app_lro_json_body" | jq -r '.name // empty')
                local created_app_id_from_lro_response=""

                if [ -n "$operation_name" ]; then
                    echo "INFO: Web App creation LRO started: ${operation_name}. Polling (up to ~90s)..."
                    local POLL_ATTEMPTS_CREATE_APP=0
                    local MAX_POLL_ATTEMPTS_CREATE_APP=9 # 9 attempts * 10s sleep = 90s
                    local LRO_CREATE_APP_DONE=false
                    while [ $POLL_ATTEMPTS_CREATE_APP -lt $MAX_POLL_ATTEMPTS_CREATE_APP ]; do
                        sleep 10
                        POLL_ATTEMPTS_CREATE_APP=$((POLL_ATTEMPTS_CREATE_APP + 1))
                        echo "DEBUG: Firebase WebApp Create LRO Poll Attempt ${POLL_ATTEMPTS_CREATE_APP}/${MAX_POLL_ATTEMPTS_CREATE_APP}"
                        # Re-fetch token for LRO poll if needed, though current ACCESS_TOKEN_FIREBASE_MGMT should be fine
                        set +e
                        local LRO_STATUS_JSON_CREATE_APP=$(curl --fail -s \
                            -X GET "https://firebase.googleapis.com/v1beta1/${operation_name}" \
                            -H "Authorization: Bearer ${ACCESS_TOKEN_FIREBASE_MGMT}" \
                            -H "Content-Type: application/json" \
                            -H "X-Goog-User-Project: ${PROJECT_ID}" 2>"$TEMP_ERROR_LOG")
                        local lro_curl_exit_code_create_app=$?
                        set -e
                        if [ $lro_curl_exit_code_create_app -ne 0 ]; then
                            echo "ERROR: Error polling LRO ${operation_name} (Curl Exit: $lro_curl_exit_code_create_app)."
                            if [ -s "$TEMP_ERROR_LOG" ]; then cat "$TEMP_ERROR_LOG"; fi
                            continue # Try polling again if not max attempts
                        fi
                        echo "DEBUG: LRO Create App Status JSON: $LRO_STATUS_JSON_CREATE_APP"
                        if echo "$LRO_STATUS_JSON_CREATE_APP" | jq -e '.done == true' > /dev/null; then
                            LRO_CREATE_APP_DONE=true
                            if echo "$LRO_STATUS_JSON_CREATE_APP" | jq -e '.error != null and .error != {}' > /dev/null; then
                                echo "ERROR: Firebase Web App creation LRO completed with error:"
                                echo "$LRO_STATUS_JSON_CREATE_APP" | jq '.'
                            else
                                created_app_id_from_lro_response=$(echo "$LRO_STATUS_JSON_CREATE_APP" | jq -r '.response.appId // empty')
                                echo "INFO: LRO completed successfully. New App ID from LRO response: ${created_app_id_from_lro_response}"
                            fi
                            break # Exit LRO poll loop
                        else
                            echo "INFO: LRO for app creation not done yet (attempt ${POLL_ATTEMPTS_CREATE_APP}/${MAX_POLL_ATTEMPTS_CREATE_APP})..."
                        fi
                    done # End LRO poll loop
                    if ! $LRO_CREATE_APP_DONE; then echo "ERROR: Firebase Web App creation LRO did not complete in time."; fi
                else
                    # Fallback if LRO 'name' wasn't in the initial response, try to get appId directly
                    created_app_id_from_lro_response=$(echo "$create_app_lro_json_body" | jq -r '.appId // empty')
                    if [ -n "$created_app_id_from_lro_response" ]; then
                        echo "WARNING: LRO name not found in create response, but direct 'appId' found: ${created_app_id_from_lro_response}"
                    else
                        echo "ERROR: Create Web App response did not contain LRO 'name' or direct 'appId'. Cannot proceed."
                        echo "       Body: $create_app_lro_json_body"
                    fi
                fi

                if [ -n "$created_app_id_from_lro_response" ]; then
                    echo "INFO: Fetching configuration for newly created Web App ID: ${created_app_id_from_lro_response}..."
                    sleep 5 # Allow a brief moment for config to be available
                    set +e
                    local CURL_RESPONSE_GET_NEW_APP_CONFIG=$(curl --fail -s -w "\nHTTP_STATUS_CODE:%{http_code}" \
                        -X GET "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps/${created_app_id_from_lro_response}/config" \
                        -H "Authorization: Bearer ${ACCESS_TOKEN_FIREBASE_MGMT}" \
                        -H "Content-Type: application/json" \
                        -H "X-Goog-User-Project: ${PROJECT_ID}" 2>"$TEMP_ERROR_LOG")
                    local curl_get_new_app_config_exit_code=$?
                    set -e

                    local http_status_get_new_app_config=$(echo "$CURL_RESPONSE_GET_NEW_APP_CONFIG" | tail -n1 | cut -d':' -f2 || echo "HTTP_STATUS_UNKNOWN")
                    new_app_config_json=$(echo "$CURL_RESPONSE_GET_NEW_APP_CONFIG" | sed '$d')
                    echo "DEBUG: Get New Web App Config - Curl Exit: $curl_get_new_app_config_exit_code, HTTP: $http_status_get_new_app_config"

                    if [ $curl_get_new_app_config_exit_code -eq 0 ] && [ "$http_status_get_new_app_config" -eq 200 ] && [ -n "$new_app_config_json" ]; then
                        echo "INFO: Successfully fetched configuration for newly created Firebase Web App."
                        FIREBASE_CONFIG_JSON_OUTPUT="$new_app_config_json" # Save the JSON
                    else
                        echo "ERROR: Failed to get config for new app ID '${created_app_id_from_lro_response}'. Curl Exit: $curl_get_new_app_config_exit_code, HTTP: $http_status_get_new_app_config"
                        if [ -n "$new_app_config_json" ]; then echo "       Body (may be error): $new_app_config_json"; fi
                        if [ -s "$TEMP_ERROR_LOG" ]; then echo "       Stderr:"; cat "$TEMP_ERROR_LOG"; fi
                    fi
                else
                    echo "ERROR: Could not determine App ID for the newly created web app. Cannot fetch its API key or config."
                fi
            else
                echo "ERROR: Failed to initiate Firebase Web App creation. Curl Exit: $curl_create_app_exit_code, HTTP Status: $http_status_create_app"
                echo "       Body: $create_app_lro_json_body"
                if [ -s "$TEMP_ERROR_LOG" ]; then echo "       Stderr:"; cat "$TEMP_ERROR_LOG"; fi
            fi
        elif [ -z "$FIREBASE_CONFIG_JSON_OUTPUT" ]; then # If still no config and new app creation wasn't authorized or failed
            echo "INFO: No Firebase Web App config obtained (either no existing apps, or creation not authorized/failed)."
        fi # End of new app creation block
    fi # End of automated retrieval block (if not FIREBASE_API_KEY_PROVIDED_MANUALLY)

    # Now, parse from FIREBASE_CONFIG_JSON_OUTPUT if it was populated by either path
    if [ -n "$FIREBASE_CONFIG_JSON_OUTPUT" ]; then
        echo "INFO: Parsing final Firebase Web App configuration..."
        FIREBASE_WEB_API_KEY=$(echo "$FIREBASE_CONFIG_JSON_OUTPUT" | jq -r '.apiKey // empty')
        FIREBASE_AUTH_DOMAIN=$(echo "$FIREBASE_CONFIG_JSON_OUTPUT" | jq -r '.authDomain // empty')
        FIREBASE_PROJECT_ID_FROM_CONFIG=$(echo "$FIREBASE_CONFIG_JSON_OUTPUT" | jq -r '.projectId // empty')
        FIREBASE_STORAGE_BUCKET_FROM_CONFIG=$(echo "$FIREBASE_CONFIG_JSON_OUTPUT" | jq -r '.storageBucket // empty')
        FIREBASE_MESSAGING_SENDER_ID=$(echo "$FIREBASE_CONFIG_JSON_OUTPUT" | jq -r '.messagingSenderId // empty')
        FIREBASE_APP_ID=$(echo "$FIREBASE_CONFIG_JSON_OUTPUT" | jq -r '.appId // empty')
        FIREBASE_MEASUREMENT_ID=$(echo "$FIREBASE_CONFIG_JSON_OUTPUT" | jq -r '.measurementId // empty') # Often present

        if [ -n "$FIREBASE_WEB_API_KEY" ] && [ -n "$FIREBASE_APP_ID" ]; then
            echo "INFO: Successfully parsed all key Firebase Web App configuration details."
            firebase_config_found_or_created=true
        else
            echo "ERROR: Failed to parse essential Firebase config values (API Key or App ID) from the fetched configuration."
            echo "       Stored JSON was: $FIREBASE_CONFIG_JSON_OUTPUT"
            # Clear potentially partial values
            FIREBASE_WEB_API_KEY=""; FIREBASE_APP_ID=""; # etc. for others
        fi
    fi

    # Final check on critical config values
    if ! $firebase_config_found_or_created || [ -z "${FIREBASE_WEB_API_KEY}" ] || [ -z "${FIREBASE_APP_ID}" ]; then
        echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        echo "CRITICAL ERROR: Essential Firebase Web App configuration (API Key or App ID) could NOT be obtained."
        echo "                Cannot provide full Firebase configuration for your client-side application."
        echo "                Please review the logs above for errors from Firebase Management API calls or JSON parsing."
        echo "                Ensure 'jq' is installed and the authenticated user has permissions to"
        echo "                list/create Firebase web apps and get their configurations."
        echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        exit 1
    fi
    echo "Firebase Web App configuration obtained successfully."
    echo ""


    # --- Step 3 & 4a (Execution): Service Accounts ---
    echo "--- Service Account Creation & Verification ---"

    # 1) Identify your Build Service Account
    FETCHED_PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
    ACTUAL_BUILD_SA="${FETCHED_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

    # 2) Grant core IAM roles to Build SA
    echo "Granting core roles to Build SA (${ACTUAL_BUILD_SA})..."
    ROLES_TO_GRANT_BUILD_SA=(
    "roles/logging.logWriter"
    "roles/cloudfunctions.developer"
    "roles/artifactregistry.writer"
    "roles/storage.objectAdmin"
    )
    for role in "${ROLES_TO_GRANT_BUILD_SA[@]}"; do
    echo "  • ${role}"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${ACTUAL_BUILD_SA}" \
        --role="${role}" \
        --condition=None --quiet \
        2>"${TEMP_ERROR_LOG}" \
        || echo "WARNING: Failed to grant ${role} to Build SA. See ${TEMP_ERROR_LOG}"
    done
    echo "Core Build SA permissions granted."
    echo ""

    # 3) Create or verify all runtime Service Accounts
    echo "Creating/Verifying runtime Service Accounts..."
    create_or_verify_sa "${VERTEX_AI_SA_NAME_FIXED}"   "${VERTEX_AI_SA_EMAIL}"       "Vertex AI Main SA"           "${PROJECT_ID}"
    create_or_verify_sa "${DEVICE_AUTH_SA_NAME}"       "${DEVICE_AUTH_SA_EMAIL}"     "Device Auth Fn Runtime SA"   "${PROJECT_ID}"
    create_or_verify_sa "${TVM_SA_NAME}"               "${TVM_SA_EMAIL}"             "TVM Fn Runtime SA"           "${PROJECT_ID}"
    create_or_verify_sa "${APIGW_INVOKER_SA_NAME}"     "${APIGW_INVOKER_SA_EMAIL}"   "API Gateway Invoker SA"      "${PROJECT_ID}"
    echo "All runtime Service Accounts created/verified."
    echo ""

    # 4) Grant Build SA impersonation rights on the two function SAs
    echo "Granting Build SA (${ACTUAL_BUILD_SA}) ServiceAccountUser on runtime SAs..."
    RUNTIME_SAS=("${DEVICE_AUTH_SA_EMAIL}" "${TVM_SA_EMAIL}")
    for sa in "${RUNTIME_SAS[@]}"; do
    echo "  • ${sa}"
    gcloud iam service-accounts add-iam-policy-binding "${sa}" \
        --project="${PROJECT_ID}" \
        --member="serviceAccount:${ACTUAL_BUILD_SA}" \
        --role="roles/iam.serviceAccountUser" \
        --condition=None --quiet \
        2>"${TEMP_ERROR_LOG}" \
        || echo "WARNING: Couldn't bind ServiceAccountUser on ${sa}. See ${TEMP_ERROR_LOG}"
    done
    echo "Build SA impersonation rights granted."
    echo ""

    # 5) Grant project-level roles to Vertex AI SA
    echo "Granting project-level roles to Vertex AI SA (${VERTEX_AI_SA_EMAIL})..."
    ROLES_TO_GRANT_VERTEX_SA=(
    "roles/aiplatform.user"
    "roles/storage.objectAdmin"
    "roles/logging.logWriter"
    "roles/datastore.user"
    )
    for role in "${ROLES_TO_GRANT_VERTEX_SA[@]}"; do
    echo "  • ${role}"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${VERTEX_AI_SA_EMAIL}" \
        --role="${role}" \
        --condition=None --quiet \
        2>"${TEMP_ERROR_LOG}" \
        || echo "WARNING: Failed to grant ${role} to Vertex AI SA. See ${TEMP_ERROR_LOG}"
    done
    echo "Vertex AI SA roles granted."
    echo ""

    # 6) Grant roles to Device Auth SA
    echo "Granting roles to Device Auth SA (${DEVICE_AUTH_SA_EMAIL})..."
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEVICE_AUTH_SA_EMAIL}" \
    --role="roles/firebaseauth.admin" \
    --condition=None --quiet \
    2>"${TEMP_ERROR_LOG}" \
    || echo "WARNING: Failed to grant firebaseauth.admin. See ${TEMP_ERROR_LOG}"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEVICE_AUTH_SA_EMAIL}" \
    --role="roles/logging.logWriter" \
    --condition=None --quiet \
    2>"${TEMP_ERROR_LOG}" \
    || echo "WARNING: Failed to grant logging.logWriter. See ${TEMP_ERROR_LOG}"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEVICE_AUTH_SA_EMAIL}" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --condition=None --quiet \
    2>"${TEMP_ERROR_LOG}" \
    || echo "ERROR: Failed to grant serviceAccountTokenCreator. See ${TEMP_ERROR_LOG}"
    echo "Device Auth SA roles granted."
    echo ""

    # 7) Grant roles to TVM SA
    echo "Granting roles to TVM SA (${TVM_SA_EMAIL})..."
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${TVM_SA_EMAIL}" \
    --role="roles/logging.logWriter" \
    --condition=None --quiet \
    2>"${TEMP_ERROR_LOG}" \
    || echo "WARNING: Failed to grant logging.logWriter to TVM SA. See ${TEMP_ERROR_LOG}"
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${TVM_SA_EMAIL}" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --condition=None --quiet \
    2>"${TEMP_ERROR_LOG}" \
    || echo "WARNING: Failed to grant serviceAccountTokenCreator to TVM SA. See ${TEMP_ERROR_LOG}"
    echo "TVM SA roles granted."
    echo ""

    # 8) Grant roles to API Gateway Invoker SA
    echo "Granting roles to API Gateway Invoker SA (${APIGW_INVOKER_SA_EMAIL})..."
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${APIGW_INVOKER_SA_EMAIL}" \
    --role="roles/logging.logWriter" \
    --condition=None --quiet \
    2>"${TEMP_ERROR_LOG}" \
    || echo "WARNING: Failed to grant logging.logWriter to API GW Invoker SA. See ${TEMP_ERROR_LOG}"
    echo "API Gateway Invoker SA roles granted."
    echo ""

    # --- Step 7 (Execution): Workload Identity Federation ---
    echo "--- Workload Identity Federation Setup ---"
    set +e; gcloud iam workload-identity-pools describe ${WIF_POOL_ID} --project=${PROJECT_ID} --location="global" >/dev/null 2>&1; POOL_EXISTS=$?; set -e
    if [ $POOL_EXISTS -ne 0 ]; then echo "Creating WIF Pool ${WIF_POOL_ID}..."; gcloud iam workload-identity-pools create ${WIF_POOL_ID} --project=${PROJECT_ID} --location="global" --display-name="${SOLUTION_PREFIX} Device Pool" 2>"$TEMP_ERROR_LOG" || { cat "$TEMP_ERROR_LOG"; exit 1; }; else echo "WIF Pool ${WIF_POOL_ID} exists."; fi
    REQUIRED_ATTR_MAP="google.subject=assertion.sub,attribute.aud=assertion.aud"; ALLOWED_AUD="${PROJECT_ID}"
    set +e; gcloud iam workload-identity-pools providers describe ${WIF_PROVIDER_ID} --project=${PROJECT_ID} --workload-identity-pool=${WIF_POOL_ID} --location="global" >/dev/null 2>&1; PROV_EXISTS=$?; set -e
    if [ $PROV_EXISTS -ne 0 ]; then echo "Creating OIDC Provider ${WIF_PROVIDER_ID}..."; gcloud iam workload-identity-pools providers create-oidc ${WIF_PROVIDER_ID} --project=${PROJECT_ID} --workload-identity-pool=${WIF_POOL_ID} --issuer-uri="${ISSUER_URI}" --location="global" --allowed-audiences="${ALLOWED_AUD}" --attribute-mapping="${REQUIRED_ATTR_MAP}" 2>"$TEMP_ERROR_LOG" || { cat "$TEMP_ERROR_LOG"; exit 1; }; echo "OIDC Provider created. Waiting 15s..."; sleep 15;
    else echo "OIDC Provider ${WIF_PROVIDER_ID} exists. Updating..."; gcloud iam workload-identity-pools providers update-oidc ${WIF_PROVIDER_ID} --project=${PROJECT_ID} --workload-identity-pool=${WIF_POOL_ID} --location="global" --allowed-audiences="${ALLOWED_AUD}" --attribute-mapping="${REQUIRED_ATTR_MAP}" 2>"$TEMP_ERROR_LOG" || { cat "$TEMP_ERROR_LOG"; exit 1; }; fi
    echo "Granting WIF users permission to impersonate SA ${VERTEX_AI_SA_EMAIL}..."; gcloud iam service-accounts add-iam-policy-binding "${VERTEX_AI_SA_EMAIL}" --role="roles/iam.workloadIdentityUser" --member="principalSet://iam.googleapis.com/projects/${FETCHED_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/attribute.aud/${PROJECT_ID}" --project=${PROJECT_ID} --quiet 2>"$TEMP_ERROR_LOG" || { cat "$TEMP_ERROR_LOG"; exit 1; }; echo "WIF setup completed."; echo ""

    # --- Step 8a & 8b (Execution): Cloud Function Deployments with Retry Logic ---
    echo "--- Device Authenticator Cloud Function (Private) ---"; DEVICE_AUTH_SOURCE_DIR_NAME="${SOLUTION_PREFIX}-device-auth-source"; ABSOLUTE_DEVICE_AUTH_SOURCE_DIR="$(pwd)/${DEVICE_AUTH_SOURCE_DIR_NAME}"; add_to_cleanup "$ABSOLUTE_DEVICE_AUTH_SOURCE_DIR"; mkdir -p "$ABSOLUTE_DEVICE_AUTH_SOURCE_DIR"
    cat << EOF > "${ABSOLUTE_DEVICE_AUTH_SOURCE_DIR}/main.py"
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
        # The service account used by this function (DEVICE_AUTH_SA_EMAIL) needs
        # "Service Account Token Creator" role on ITSELF or the project's default SA
        # if no explicit SA is passed to initialize_app().
        # Since initialize_app() is called without args, it uses Application Default Credentials.
        # The DEVICE_AUTH_SA_EMAIL must have roles/iam.serviceAccountTokenCreator on itself.
        # Or, if you target a *different* SA for signing, then on that SA.
        # For Firebase custom tokens, it needs to sign with its *own* identity.
        custom_token = auth.create_custom_token(uid=str(device_id)).decode('utf-8')
        print(f"DeviceAuthFn: Firebase Custom Token created for {device_id}")
        return ({"firebase_custom_token": custom_token}, 200)
    except Exception as e: print(f"DeviceAuthFn ERROR for {device_id if 'device_id' in locals() else 'unknown'}: {e}"); return ("Token gen error", 500)
EOF
    echo "functions-framework>=3.1.0" > "${ABSOLUTE_DEVICE_AUTH_SOURCE_DIR}/requirements.txt"; echo "firebase-admin>=6.1.0" >> "${ABSOLUTE_DEVICE_AUTH_SOURCE_DIR}/requirements.txt"
    if [ ! -f "${ABSOLUTE_DEVICE_AUTH_SOURCE_DIR}/requirements.txt" ]; then echo "CRITICAL ERROR: requirements.txt NOT created for Device Auth Fn at ${ABSOLUTE_DEVICE_AUTH_SOURCE_DIR}/requirements.txt"; exit 1; else echo "DEBUG: requirements.txt for Device Auth Fn created."; fi
    echo "Deploying PRIVATE Function '${DEVICE_AUTH_FUNCTION_NAME}' (runs as ${DEVICE_AUTH_SA_EMAIL})..."
    DEPLOY_ATTEMPTS=0; MAX_DEPLOY_ATTEMPTS=3; DEPLOY_SUCCESS=false
    while [ $DEPLOY_ATTEMPTS -lt $MAX_DEPLOY_ATTEMPTS ]; do DEPLOY_ATTEMPTS=$((DEPLOY_ATTEMPTS + 1)); echo "Attempt ${DEPLOY_ATTEMPTS}/${MAX_DEPLOY_ATTEMPTS} to deploy ${DEVICE_AUTH_FUNCTION_NAME}..."; set +e; gcloud functions deploy "${DEVICE_AUTH_FUNCTION_NAME}" --project="${PROJECT_ID}" --region="${GCP_REGION}" --gen2 --runtime=python311 --source="${ABSOLUTE_DEVICE_AUTH_SOURCE_DIR}" --entry-point=device_authenticator --trigger-http --no-allow-unauthenticated --service-account="${DEVICE_AUTH_SA_EMAIL}" --max-instances=5 --quiet 2>"$TEMP_ERROR_LOG"; GCLOUD_EXIT_CODE=$?; set -e
        echo "DEBUG: 'gcloud functions deploy ${DEVICE_AUTH_FUNCTION_NAME}' attempt ${DEPLOY_ATTEMPTS} finished. Exit Code: $GCLOUD_EXIT_CODE"
        if [ $GCLOUD_EXIT_CODE -eq 0 ]; then DEPLOY_SUCCESS=true; echo "Deployed ${DEVICE_AUTH_FUNCTION_NAME} on attempt ${DEPLOY_ATTEMPTS}."; if [ -s "$TEMP_ERROR_LOG" ]; then echo "DEBUG: TEMP_ERROR_LOG not empty on success:"; cat "$TEMP_ERROR_LOG"; fi; rm -f "$TEMP_ERROR_LOG" 2>/dev/null || true; break; else echo "ERROR: Deploy attempt ${DEPLOY_ATTEMPTS} for ${DEVICE_AUTH_FUNCTION_NAME} failed (Code: $GCLOUD_EXIT_CODE)."; if [ -s "$TEMP_ERROR_LOG" ]; then echo "Details:"; cat "$TEMP_ERROR_LOG"; if grep -q "status=\[409\]" "$TEMP_ERROR_LOG" && grep -q "unable to queue the operation" "$TEMP_ERROR_LOG"; then if [ $DEPLOY_ATTEMPTS -lt $MAX_DEPLOY_ATTEMPTS ]; then echo "Conflict (409) detected. Waiting 60s before retry..."; sleep 60; continue; else echo "Max retries for 409 error."; fi; else echo "Non-409 error. Not retrying."; fi; else echo "No specific error message in $TEMP_ERROR_LOG, but command failed."; fi; if ! (grep -q "status=\[409\]" "$TEMP_ERROR_LOG" && grep -q "unable to queue the operation" "$TEMP_ERROR_LOG" && [ $DEPLOY_ATTEMPTS -lt $MAX_DEPLOY_ATTEMPTS ]); then break; fi; fi; done
    if ! $DEPLOY_SUCCESS; then echo "CRITICAL ERROR: Failed to deploy ${DEVICE_AUTH_FUNCTION_NAME}. Exiting."; exit 1; fi
    
    DEVICE_AUTH_FUNCTION_URL=$(gcloud functions describe "${DEVICE_AUTH_FUNCTION_NAME}" --project="${PROJECT_ID}" --region="${GCP_REGION}" --gen2 --format="value(serviceConfig.uri)")
    if [ -z "${DEVICE_AUTH_FUNCTION_URL}" ]; then
        echo "CRITICAL ERROR: Failed to retrieve URL for Device Authenticator Function (${DEVICE_AUTH_FUNCTION_NAME})."
        echo "Please check the function's status in GCP Console for project ${PROJECT_ID}, region ${GCP_REGION}."
        exit 1
    fi
    echo "PRIVATE Device Authenticator Function URL: ${DEVICE_AUTH_FUNCTION_URL}"; echo ""

    echo "--- Token Vendor Machine (TVM) Cloud Function (Private) ---"; TVM_SOURCE_DIR_NAME="${SOLUTION_PREFIX}-tvm-source"; ABSOLUTE_TVM_SOURCE_DIR="$(pwd)/${TVM_SOURCE_DIR_NAME}"; add_to_cleanup "$ABSOLUTE_TVM_SOURCE_DIR"; mkdir -p "$ABSOLUTE_TVM_SOURCE_DIR"
    cat << EOF > "${ABSOLUTE_TVM_SOURCE_DIR}/main.py"
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
        # The TVM function's own SA (TVM_SA_EMAIL) makes this call to STS. It needs roles/iam.serviceAccountTokenCreator on ITSELF
        # for the sts:GenerateAccessToken call.
        sts_r = requests.post(STS_ENDPOINT, json=sts_p); sts_r.raise_for_status(); sts_j = sts_r.json(); fed_at = sts_j.get("access_token")
        if not fed_at: print(f"TVMFn ERR: No fed token: {sts_r.text}"); return ("STS Err (No fed_at)", 500)
        # The federated access token (fed_at) is then used to impersonate the TARGET_SERVICE_ACCOUNT_EMAIL.
        # The WIF principal (derived from fb_id_token) must have roles/iam.workloadIdentityUser on TARGET_SERVICE_ACCOUNT_EMAIL.
        iam_ep = IAM_ENDPOINT_TEMPLATE.format(sa_email=target_sa); iam_p = {"scope":["https://www.googleapis.com/auth/cloud-platform"]}; iam_h = {"Authorization":f"Bearer {fed_at}","Content-Type":"application/json"}
        sa_r = requests.post(iam_ep, json=iam_p, headers=iam_h); sa_r.raise_for_status(); sa_j = sa_r.json(); gcp_at = sa_j.get("accessToken")
        exp_in = int(sts_j.get("expires_in", 3599))
        if not gcp_at: print(f"TVMFn ERR: No GCP token: {sa_j}"); return ("IAM Err (No gcp_at)", 500)
        print(f"TVMFn: GCP SA token for {target_sa} OK."); return ({"gcp_access_token":gcp_at, "expires_in":exp_in}, 200)
    except requests.exceptions.HTTPError as e: print(f"TVMFn HTTPError: {e} - Resp: {e.response.text if e.response else 'N/A'}"); return (f"TVM HTTP Err {e.response.status_code if e.response else ''}", 500)
    except Exception as e: print(f"TVMFn Unexpected: {e}"); return ("TVM Internal Err", 500)
EOF
    echo "functions-framework>=3.1.0" > "${ABSOLUTE_TVM_SOURCE_DIR}/requirements.txt"; echo "requests>=2.28.0" >> "${ABSOLUTE_TVM_SOURCE_DIR}/requirements.txt"
    if [ ! -f "${ABSOLUTE_TVM_SOURCE_DIR}/requirements.txt" ]; then echo "CRITICAL ERROR: requirements.txt NOT created for TVM Fn at ${ABSOLUTE_TVM_SOURCE_DIR}/requirements.txt"; exit 1; else echo "DEBUG: requirements.txt for TVM Fn created."; fi
    TVM_ENV_FILE="${SOLUTION_PREFIX}-tvm-env.yaml"; add_to_cleanup "$TVM_ENV_FILE"; cat << EOF > ${TVM_ENV_FILE}
WIF_PROJECT_NUMBER: "${FETCHED_PROJECT_NUMBER}"
WIF_POOL_ID: "${WIF_POOL_ID}"
WIF_PROVIDER_ID: "${WIF_PROVIDER_ID}"
TARGET_SERVICE_ACCOUNT_EMAIL: "${VERTEX_AI_SA_EMAIL}"
EOF
    echo "Deploying PRIVATE Function '${TVM_FUNCTION_NAME}' (runs as ${TVM_SA_EMAIL})..."; DEPLOY_ATTEMPTS=0; DEPLOY_SUCCESS=false
    while [ $DEPLOY_ATTEMPTS -lt $MAX_DEPLOY_ATTEMPTS ]; do DEPLOY_ATTEMPTS=$((DEPLOY_ATTEMPTS + 1)); echo "Attempt ${DEPLOY_ATTEMPTS}/${MAX_DEPLOY_ATTEMPTS} to deploy ${TVM_FUNCTION_NAME}..."; set +e; gcloud functions deploy "${TVM_FUNCTION_NAME}" --project="${PROJECT_ID}" --region="${GCP_REGION}" --gen2 --runtime=python311 --source="${ABSOLUTE_TVM_SOURCE_DIR}" --entry-point=token_vendor_machine --trigger-http --no-allow-unauthenticated --service-account="${TVM_SA_EMAIL}" --env-vars-file="${TVM_ENV_FILE}" --max-instances=5 --quiet 2>"$TEMP_ERROR_LOG"; GCLOUD_EXIT_CODE=$?; set -e
        echo "DEBUG: 'gcloud functions deploy ${TVM_FUNCTION_NAME}' attempt ${DEPLOY_ATTEMPTS} finished. Exit Code: $GCLOUD_EXIT_CODE"
        if [ $GCLOUD_EXIT_CODE -eq 0 ]; then DEPLOY_SUCCESS=true; echo "Deployed ${TVM_FUNCTION_NAME} on attempt ${DEPLOY_ATTEMPTS}."; if [ -s "$TEMP_ERROR_LOG" ]; then echo "DEBUG: TEMP_ERROR_LOG not empty on success:"; cat "$TEMP_ERROR_LOG"; fi; rm -f "$TEMP_ERROR_LOG" 2>/dev/null || true; break; else echo "ERROR: Deploy attempt ${DEPLOY_ATTEMPTS} for ${TVM_FUNCTION_NAME} failed (Code: $GCLOUD_EXIT_CODE)."; if [ -s "$TEMP_ERROR_LOG" ]; then echo "Details:"; cat "$TEMP_ERROR_LOG"; if grep -q "status=\[409\]" "$TEMP_ERROR_LOG" && grep -q "unable to queue the operation" "$TEMP_ERROR_LOG"; then if [ $DEPLOY_ATTEMPTS -lt $MAX_DEPLOY_ATTEMPTS ]; then echo "Conflict (409) detected. Waiting 60s before retry..."; sleep 60; continue; else echo "Max retries for 409 error."; fi; else echo "Non-409 error. Not retrying."; fi; else echo "No specific error message in $TEMP_ERROR_LOG, but command failed."; fi; if ! (grep -q "status=\[409\]" "$TEMP_ERROR_LOG" && grep -q "unable to queue the operation" "$TEMP_ERROR_LOG" && [ $DEPLOY_ATTEMPTS -lt $MAX_DEPLOY_ATTEMPTS ]); then break; fi; fi; done
    if ! $DEPLOY_SUCCESS; then echo "CRITICAL ERROR: Failed to deploy ${TVM_FUNCTION_NAME}. Exiting."; exit 1; fi

    TVM_FUNCTION_URL=$(gcloud functions describe "${TVM_FUNCTION_NAME}" --project="${PROJECT_ID}" --region="${GCP_REGION}" --gen2 --format="value(serviceConfig.uri)")
    if [ -z "${TVM_FUNCTION_URL}" ]; then
        echo "CRITICAL ERROR: Failed to retrieve URL for TVM Function (${TVM_FUNCTION_NAME})."
        echo "Please check the function's status in GCP Console for project ${PROJECT_ID}, region ${GCP_REGION}."
        exit 1
    fi
    echo "PRIVATE TVM Function URL: ${TVM_FUNCTION_URL}"; echo ""

    echo "Granting API Gateway Invoker SA (${APIGW_INVOKER_SA_EMAIL}) invoker permission on both functions..."
    for FUNCTION_TO_GRANT in "${DEVICE_AUTH_FUNCTION_NAME}" "${TVM_FUNCTION_NAME}"; do echo "  Granting invoker for ${FUNCTION_TO_GRANT}..."; gcloud functions add-invoker-policy-binding "${FUNCTION_TO_GRANT}" --project="${PROJECT_ID}" --region="${GCP_REGION}" --member="serviceAccount:${APIGW_INVOKER_SA_EMAIL}" --quiet 2>"$TEMP_ERROR_LOG" || { echo "WARNING: Failed to grant invoker role to APIGW SA for ${FUNCTION_TO_GRANT}. Error: $(cat $TEMP_ERROR_LOG)"; }; done
    echo "API Gateway invoker permissions grant attempt finished."; echo ""

    echo "Granting roles to API Gateway Invoker SA (${APIGW_INVOKER_SA_EMAIL})..."
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${APIGW_INVOKER_SA_EMAIL}" \
        --role="roles/logging.logWriter" \
        --condition=None --quiet 2>"$TEMP_ERROR_LOG" \
        || { echo "Warning granting roles/logging.logWriter to ${APIGW_INVOKER_SA_EMAIL}: $(cat "$TEMP_ERROR_LOG")"; }
    # Note: Its primary role (run.invoker for functions) is granted via functions add-invoker-policy-binding
    echo "API Gateway Invoker SA logging role grant attempt completed."

# --- Step 9 (Execution): API Gateway Setup ---
    echo "--- API Gateway Setup (${API_ID}) ---"
    echo "Creating/Verifying API Definition: ${API_ID}..."
    API_MANAGED_SERVICE_NAME="" # Initialize
    set +e # Allow describe to fail if API doesn't exist
    API_EXISTS_OUTPUT=$(gcloud api-gateway apis describe "${API_ID}" --project="${PROJECT_ID}" --format="value(managedService)" 2>"$TEMP_ERROR_LOG")
    API_EXISTS_EC=$?
    set -e

   if [ $API_EXISTS_EC -eq 0 ] && [ -n "$API_EXISTS_OUTPUT" ]; then
        echo "API ${API_ID} already exists."
        API_MANAGED_SERVICE_NAME="$API_EXISTS_OUTPUT"
    else
        echo "API ${API_ID} does not exist or describe failed. Attempting to create..."
        > "$TEMP_ERROR_LOG" # Clear previous error log
        gcloud api-gateway apis create "${API_ID}" --project="${PROJECT_ID}" --display-name="${SOLUTION_PREFIX} Device API" 2>"$TEMP_ERROR_LOG"
        CREATE_API_EC=$?
        if [ $CREATE_API_EC -ne 0 ]; then
            echo "!!!!!!!!!!!!!!!! ERROR: Failed to create API '${API_ID}' (Exit Code: $CREATE_API_EC). !!!!!!!!!!!!!!!!"
            cat "$TEMP_ERROR_LOG"
            exit 1
        fi
        echo "API ${API_ID} created successfully. Waiting 30s for propagation before describing..." # MODIFIED LINE
        sleep 30 # ADDED SLEEP

        # Retrieve the managed service name after creation
        API_MANAGED_SERVICE_NAME=$(gcloud api-gateway apis describe "${API_ID}" --project="${PROJECT_ID}" --format="value(managedService)" 2>"$TEMP_ERROR_LOG")
        if [ $? -ne 0 ] || [ -z "$API_MANAGED_SERVICE_NAME" ]; then
            echo "!!!!!!!!!!!!!!!! ERROR: Failed to retrieve managed service name for newly created API '${API_ID}' after waiting. !!!!!!!!!!!!!!!!"
            cat "$TEMP_ERROR_LOG"
            exit 1
        fi
    fi
    
    if [ -z "$API_MANAGED_SERVICE_NAME" ]; then # This check is good to keep
        echo "!!!!!!!!!!!!!!!! CRITICAL ERROR: Could not determine managed service name for API ${API_ID}. !!!!!!!!!!!!!!!!"
        exit 1
    fi
    echo "Managed service for API ${API_ID} is: ${API_MANAGED_SERVICE_NAME}"
    echo "INFO: Waiting 10s for the managed service to be fully registered before attempting to enable it..." # ADDED INFO
    sleep 10 # ADDED SLEEP

    
 echo "Creating OpenAPI specification (${OPENAPI_SPEC_FILE})..."
UNIQUE_SUFFIX_FOR_CONFIG=$(date +%s%N | tail -c 9)
API_CONFIG_ID="${API_ID}-cfg-${UNIQUE_SUFFIX_FOR_CONFIG}"
API_CONFIG_DISPLAY_NAME="Config-${UNIQUE_SUFFIX_FOR_CONFIG}"
cat << EOF > ${OPENAPI_SPEC_FILE}
swagger: '2.0'
info: {title: '${SOLUTION_PREFIX} Device API', version: '1.0.0', description: 'API for device auth & GCP token vending.'}
host: ${API_MANAGED_SERVICE_NAME}
schemes: ['https']
produces: ['application/json']
securityDefinitions: {api_key: {type: 'apiKey', name: 'x-api-key', in: 'header'}}
security: [{api_key: []}]
paths:
  /device-auth/initiate:
    post:
      summary: 'Fetches Firebase Custom Token.'
      operationId: 'fetchFirebaseCustomToken'
      consumes: ['application/json']
      parameters: [{in: 'body', name: 'body', required: true, schema: {type: 'object', required: [device_id], properties: {device_id: {type: 'string'}}}}]
      responses: {'200': {description: 'Firebase Custom Token', schema: {type: 'object', properties: {firebase_custom_token: {type: 'string'}}}}, default: {description: 'Error'}}
      x-google-backend: {address: '${DEVICE_AUTH_FUNCTION_URL}'}
  /gcp-token/vend:
    post:
      summary: 'Exchanges Firebase ID Token for GCP Token.'
      operationId: 'exchangeFirebaseIdTokenForGcpToken'
      consumes: ['application/json']
      parameters: [{in: 'body', name: 'body', required: true, schema: {type: 'object', required: [firebase_id_token], properties: {firebase_id_token: {type: 'string'}}}}]
      responses: {'200': {description: 'GCP Access Token', schema: {type: 'object', properties: {gcp_access_token: {type: 'string'}, expires_in: {type: 'integer'}}}}, default: {description: 'Error'}}
      x-google-backend: {address: '${TVM_FUNCTION_URL}'}
EOF
    echo "OpenAPI spec generated."
    gcloud endpoints services deploy ${OPENAPI_SPEC_FILE} \
        --project="${PROJECT_ID}"

    echo "Ensuring managed service '${API_MANAGED_SERVICE_NAME}' is enabled for project '${PROJECT_ID}'..."

    # see if it’s already on
    ENABLED_SERVICE_CHECK=$(
    gcloud services list \
        --enabled \
        --project="${PROJECT_ID}" \
        --filter="config.name=${API_MANAGED_SERVICE_NAME}" \
        --format="value(config.name)" \
        2>/dev/null
    )

    if [ -z "$ENABLED_SERVICE_CHECK" ]; then
    echo "Managed service '${API_MANAGED_SERVICE_NAME}' is not enabled. Attempting to enable now…"
    > "$TEMP_ERROR_LOG"

    # turn off errexit so we can capture code
    set +e
    gcloud services enable "${API_MANAGED_SERVICE_NAME}" \
        --project="${PROJECT_ID}" \
        --quiet 2>"$TEMP_ERROR_LOG"
    enable_exit=$?
    set -e

    if [ $enable_exit -ne 0 ]; then
        echo ""
        echo "WARNING: 'gcloud services enable' failed with exit code ${enable_exit}."
        echo "Service Usage error log:"
        cat "$TEMP_ERROR_LOG"
        echo ""
        echo "Most likely you need to first register the managed service by deploying your"
        echo "OpenAPI/Endpoints config, e.g.:"
        echo "  gcloud endpoints services deploy path/to/openapi.yaml --project='${PROJECT_ID}'"
        echo "Once the service exists, re-run this script (or manually enable in the console)."
        # do not exit – let the script continue or you can choose to exit here if it's truly blocking
    else
        echo "Managed service enabled successfully."
        echo "Waiting 30s for propagation…"
        sleep 30
    fi
    else
    echo "Managed service '${API_MANAGED_SERVICE_NAME}' is already enabled."
    fi

    echo "INFO: Managed service check/enablement process for API Gateway completed."
    echo "" # Existing blank line for spacing


    echo "Creating API Config: ${API_CONFIG_ID} (Display: ${API_CONFIG_DISPLAY_NAME})..."
    set +e # Temporarily disable exit on error
    gcloud api-gateway api-configs create "${API_CONFIG_ID}" \
        --api="${API_ID}" --project="${PROJECT_ID}" \
        --openapi-spec="${OPENAPI_SPEC_FILE}" \
        --display-name="${API_CONFIG_DISPLAY_NAME}" \
        --backend-auth-service-account="${APIGW_INVOKER_SA_EMAIL}" 2>"$TEMP_ERROR_LOG"
    CREATE_CONFIG_EC=$?
    set -e # Re-enable exit on error

    if [ $CREATE_CONFIG_EC -ne 0 ]; then
        echo "!!!!!!!!!!!!!!!! ERROR: Failed to create API Config '${API_CONFIG_ID}' (Exit Code: $CREATE_CONFIG_EC). !!!!!!!!!!!!!!!!"
        echo "gcloud error output (from $TEMP_ERROR_LOG):"
        cat "$TEMP_ERROR_LOG"
        echo "DEBUG: Contents of ${OPENAPI_SPEC_FILE}:"
        cat "${OPENAPI_SPEC_FILE}"
        echo "DEBUG: DEVICE_AUTH_FUNCTION_URL = '${DEVICE_AUTH_FUNCTION_URL}'"
        echo "DEBUG: TVM_FUNCTION_URL = '${TVM_FUNCTION_URL}'"
        exit 1
    fi
    echo "API Config ${API_CONFIG_ID} creation submitted. Waiting for it to become active..."; MAX_CONFIG_CHECKS=12; CONFIG_READY=false
    for ((cfg_chk=1; cfg_chk<=MAX_CONFIG_CHECKS; cfg_chk++)); do CONFIG_STATE=$(gcloud api-gateway api-configs describe "${API_CONFIG_ID}" --api="${API_ID}" --project="${PROJECT_ID}" --format="value(state)" 2>/dev/null); if [ "$CONFIG_STATE" == "ACTIVE" ]; then CONFIG_READY=true; echo "API Config ${API_CONFIG_ID} is ACTIVE."; break; fi; echo "API Config not active yet (State: ${CONFIG_STATE:-Unknown}). Waiting 10s... ($cfg_chk/$MAX_CONFIG_CHECKS)"; sleep 10; done
    if [ "$CONFIG_READY" = false ]; then echo "ERROR: API Config ${API_CONFIG_ID} did not become active."; exit 1; fi

    echo "Creating/Updating API Gateway: ${API_GATEWAY_ID} in ${GCP_REGION}...";
    set +e; gcloud api-gateway gateways describe "${API_GATEWAY_ID}" --location="${GCP_REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; GATEWAY_EXISTS_EC=$?; set -e
    if [ $GATEWAY_EXISTS_EC -ne 0 ]; then
        echo "API Gateway ${API_GATEWAY_ID} does not exist. Creating..."
        gcloud api-gateway gateways create "${API_GATEWAY_ID}" --api="${API_ID}" --api-config="${API_CONFIG_ID}" --location="${GCP_REGION}" --project="${PROJECT_ID}" --display-name="${SOLUTION_PREFIX} Gateway" 2>"$TEMP_ERROR_LOG"
        CREATE_GW_EC=$?; if [ $CREATE_GW_EC -ne 0 ]; then echo "ERROR: Failed to create API Gateway ${API_GATEWAY_ID}."; cat "$TEMP_ERROR_LOG"; exit 1; fi
        echo "API Gateway ${API_GATEWAY_ID} created."
    else
        echo "API Gateway ${API_GATEWAY_ID} exists. Updating with API Config ${API_CONFIG_ID}..."
        gcloud api-gateway gateways update "${API_GATEWAY_ID}" --api="${API_ID}" --api-config="${API_CONFIG_ID}" --location="${GCP_REGION}" --project="${PROJECT_ID}" 2>"$TEMP_ERROR_LOG"
        UPDATE_GW_EC=$?; if [ $UPDATE_GW_EC -ne 0 ]; then echo "ERROR: Failed to update API Gateway ${API_GATEWAY_ID}."; cat "$TEMP_ERROR_LOG"; exit 1; fi
        echo "API Gateway ${API_GATEWAY_ID} updated."
    fi
    echo "Waiting for Gateway (can take a few minutes)..."; sleep 90
    API_GATEWAY_URL=$(gcloud api-gateway gateways describe "${API_GATEWAY_ID}" --location="${GCP_REGION}" --project="${PROJECT_ID}" --format="value(defaultHostname)"); if [ -z "${API_GATEWAY_URL}" ]; then echo "ERROR: Could not retrieve API Gateway URL."; API_GATEWAY_URL="<Problem: Could not retrieve>"; fi; echo "API Gateway URL (base): https://${API_GATEWAY_URL}"; echo ""

    # --- Step 10 (Execution): API Key Creation & Restriction ---
    echo "--- API Key Creation & Restriction ---"; API_MANAGED_SERVICE_NAME=$(gcloud api-gateway apis describe "${API_ID}" --project="${PROJECT_ID}" --format="value(managedService)" 2>/dev/null); echo "Creating API Key: ${API_GATEWAY_KEY_DISPLAY_NAME}..."; GENERATED_GATEWAY_API_KEY_STRING=""; API_KEY_COMMAND_SUCCEEDED=false
    if [ -n "$API_MANAGED_SERVICE_NAME" ]; then echo "Attempting to create API Key restricted to service: ${API_MANAGED_SERVICE_NAME}"; echo "DEBUG: Executing: gcloud services api-keys create --project=\"${PROJECT_ID}\" --display-name=\"${API_GATEWAY_KEY_DISPLAY_NAME}\" --api-target=service=\"${API_MANAGED_SERVICE_NAME}\" --format=\"json\""; set +e
        gcloud services api-keys create --project="${PROJECT_ID}" --display-name="${API_GATEWAY_KEY_DISPLAY_NAME}" --api-target=service="${API_MANAGED_SERVICE_NAME}" --format="json" > "$API_KEY_TMP_FILE" 2>"$API_KEY_COMMAND_FULL_OUTPUT_LOG"; GCLOUD_EXIT_CODE=$?; set -e
        echo "DEBUG: 'gcloud services api-keys create' (restricted) finished. Exit Code: $GCLOUD_EXIT_CODE"
        if [ -s "$API_KEY_COMMAND_FULL_OUTPUT_LOG" ] && [ $GCLOUD_EXIT_CODE -ne 0 ]; then echo "DEBUG: Full output/stderr from restricted key attempt:"; cat "$API_KEY_COMMAND_FULL_OUTPUT_LOG"; elif [ $GCLOUD_EXIT_CODE -eq 0 ] && [ -s "$API_KEY_TMP_FILE" ] ; then echo "DEBUG: Raw JSON LRO from restricted key creation (in $API_KEY_TMP_FILE):"; cat "$API_KEY_TMP_FILE"; else echo "DEBUG: No output to API_KEY_TMP_FILE or API_KEY_COMMAND_FULL_OUTPUT_LOG from restricted key attempt."; fi
        if [ $GCLOUD_EXIT_CODE -eq 0 ] && [ -s "$API_KEY_TMP_FILE" ]; then
            if command -v jq &> /dev/null; then GENERATED_GATEWAY_API_KEY_STRING=$(jq -r '.response.keyString // .keyString // empty' < "$API_KEY_TMP_FILE"); else echo "CRITICAL WARNING: jq not found. Cannot parse API Key from LRO."; GENERATED_GATEWAY_API_KEY_STRING=""; fi
            GENERATED_GATEWAY_API_KEY_STRING=$(echo "${GENERATED_GATEWAY_API_KEY_STRING}" | xargs)
            echo "DEBUG: Parsed Key String (length ${#GENERATED_GATEWAY_API_KEY_STRING}): '${GENERATED_GATEWAY_API_KEY_STRING}'"
            if [ -n "${GENERATED_GATEWAY_API_KEY_STRING}" ] && [ ${#GENERATED_GATEWAY_API_KEY_STRING} -gt 30 ]; then echo "API Key with service restriction created successfully."; API_KEY_COMMAND_SUCCEEDED=true;
            else echo "ERROR: Restricted key command OK, but failed to parse 'response.keyString' or key invalid."; if [ $GCLOUD_EXIT_CODE -eq 0 ]; then GCLOUD_EXIT_CODE=1; fi; fi
        else echo "ERROR: 'gcloud services api-keys create' (restricted) command failed or produced no output to parse for key."; fi
        if ! $API_KEY_COMMAND_SUCCEEDED; then echo "WARNING: Failed to create API key WITH service restriction (Initial Exit: $GCLOUD_EXIT_CODE). Attempting UNRESTRICTED fallback...";
            > "$API_KEY_TMP_FILE"; > "$API_KEY_COMMAND_FULL_OUTPUT_LOG"; set +e
            gcloud services api-keys create --project="${PROJECT_ID}" --display-name="${API_GATEWAY_KEY_DISPLAY_NAME}" --format="json" > "$API_KEY_TMP_FILE" 2>"$API_KEY_COMMAND_FULL_OUTPUT_LOG"; GCLOUD_EXIT_CODE=$?; set -e
            echo "DEBUG: 'gcloud services api-keys create' (unrestricted fallback) finished. Exit Code: $GCLOUD_EXIT_CODE"
            if [ -s "$API_KEY_COMMAND_FULL_OUTPUT_LOG" ] && [ $GCLOUD_EXIT_CODE -ne 0 ]; then
                echo "DEBUG: Full output/stderr from unrestricted fallback:"
                cat "$API_KEY_COMMAND_FULL_OUTPUT_LOG"
            elif [ $GCLOUD_EXIT_CODE -eq 0 ] && [ -s "$API_KEY_TMP_FILE" ]; then
                echo "DEBUG: Raw JSON LRO from unrestricted key creation:"
                cat "$API_KEY_TMP_FILE"
            else
                echo "DEBUG: No output to API_KEY_TMP_FILE or API_KEY_COMMAND_FULL_OUTPUT_LOG from unrestricted fallback."
            fi

            if [ $GCLOUD_EXIT_CODE -eq 0 ] && [ -s "$API_KEY_TMP_FILE" ]; then
                if command -v jq &> /dev/null; then GENERATED_GATEWAY_API_KEY_STRING=$(jq -r '.response.keyString // .keyString // empty' < "$API_KEY_TMP_FILE"); else echo "CRITICAL WARNING: jq not found for fallback. Cannot parse API Key from LRO."; GENERATED_GATEWAY_API_KEY_STRING=""; fi
                GENERATED_GATEWAY_API_KEY_STRING=$(echo "${GENERATED_GATEWAY_API_KEY_STRING}" | xargs)
                echo "DEBUG: Parsed Key String (length ${#GENERATED_GATEWAY_API_KEY_STRING}): '${GENERATED_GATEWAY_API_KEY_STRING}'"
                if [ -n "${GENERATED_GATEWAY_API_KEY_STRING}" ] && [ ${#GENERATED_GATEWAY_API_KEY_STRING} -gt 30 ]; then echo "Unrestricted API Key created as fallback. IMPORTANT: Manually restrict later."; API_KEY_COMMAND_SUCCEEDED=true;
                else echo "ERROR: Unrestricted create OK, but failed to parse 'response.keyString' or key invalid."; fi
            else echo "ERROR: Failed to create unrestricted API key (Exit Code: $GCLOUD_EXIT_CODE)."; fi
            if ! $API_KEY_COMMAND_SUCCEEDED; then echo "CRITICAL ERROR: Failed to create API key after all attempts. Check permissions/quotas."; exit 1; fi; fi
    else echo "CRITICAL ERROR: Could not determine managed service name for API ${API_ID}. Cannot create restricted API key."; exit 1; fi
    if ! $API_KEY_COMMAND_SUCCEEDED || [ -z "${GENERATED_GATEWAY_API_KEY_STRING}" ] || [ ${#GENERATED_GATEWAY_API_KEY_STRING} -lt 30 ]; then echo "FINAL ERROR: API Key string is empty or invalid (Length: ${#GENERATED_GATEWAY_API_KEY_STRING})! Check jq install and parsing. Raw JSON:"; if [ -f "$API_KEY_TMP_FILE" ]; then cat "$API_KEY_TMP_FILE"; else echo "(No API key temp file)"; fi; exit 1; fi
    echo "API Key successfully processed. Waiting 30s for propagation..."; sleep 30; echo ""

    SUMMARY_FILENAME="${SOLUTION_PREFIX}_gcp_setup_summary_${PROJECT_ID}_$(date +%Y%m%d_%H%M%S).txt"
    add_to_cleanup "${SUMMARY_FILENAME}"
    echo "All automated setup tasks completed."
}


generate_final_summary() {
    # Construct Firebase Config JSON for the React App
    # Ensure all variables are populated or have defaults.
    local firebase_json_api_key="${FIREBASE_WEB_API_KEY:-}"
    local firebase_json_auth_domain="${FIREBASE_AUTH_DOMAIN:-${PROJECT_ID}.firebaseapp.com}"
    local firebase_json_project_id="${PROJECT_ID:-}"
    # For storageBucket, try the one from Firebase config first, then the detected GCS bucket (stripping gs://)
    local firebase_json_storage_bucket_raw="${FIREBASE_STORAGE_BUCKET_FROM_CONFIG:-${FIREBASE_STORAGE_BUCKET:-}}"
    local firebase_json_storage_bucket=""
    if [[ -n "$firebase_json_storage_bucket_raw" ]]; then
        firebase_json_storage_bucket="${firebase_json_storage_bucket_raw#gs://}" # Remove gs:// prefix
    fi
    local firebase_json_messaging_sender_id="${FIREBASE_MESSAGING_SENDER_ID:-}"
    local firebase_json_app_id="${FIREBASE_APP_ID:-}"
    local firebase_json_database_id="${FIRESTORE_DATABASE_ID:- (default)}" # Use (default) if it was the choice

    # Create the JSON string
    # Using printf for safer string construction, especially with variables that might be empty
    local firebase_config_for_react_app_json
    firebase_config_for_react_app_json=$(printf '{
  "apiKey": "%s",
  "authDomain": "%s",
  "projectId": "%s",
  "storageBucket": "%s",
  "messagingSenderId": "%s",
  "appId": "%s",
  "databaseId": "%s"
}' \
        "$firebase_json_api_key" \
        "$firebase_json_auth_domain" \
        "$firebase_json_project_id" \
        "$firebase_json_storage_bucket" \
        "$firebase_json_messaging_sender_id" \
        "$firebase_json_app_id" \
        "$firebase_json_database_id"
    )

    # Pretty-print with jq if available
    if command -v jq &> /dev/null; then
        firebase_config_for_react_app_json=$(echo "$firebase_config_for_react_app_json" | jq '.')
    fi

    echo ""
    echo ".---------------------------------------------------------------------------------------------."
    echo "|    A N A V A   A I   V E R T E X   I N T E G R A T I O N   S E T U P   C O M P L E T E     |"
    echo "'---------------------------------------------------------------------------------------------'"
    echo "  Project: ${PROJECT_ID}  |  Region: ${GCP_REGION} (Date: $(date '+%Y-%m-%d %H:%M:%S %Z'))"
    echo ".---------------------------------------------------------------------------------------------."
    echo ""
    echo "  --- General Project Information ---"
    echo "  GCP Project ID:                     ${PROJECT_ID}"
    echo "  GCP Project Number:                 ${FETCHED_PROJECT_NUMBER:-Not Fetched}"
    echo "  Solution Prefix Used:               ${SOLUTION_PREFIX}"
    echo "  GCP Region Used for Resources:      ${GCP_REGION}"
    echo ""
    echo "  --- Firebase Core Setup ---"
    echo "  Firebase Web App API Key:           ${FIREBASE_WEB_API_KEY:-Not Set/Retrieved}"
    echo "    (Used for initializing Firebase SDK in your client-side React app)"
    echo ""
    echo "  --- Firestore Database ('${FIRESTORE_DATABASE_ID}') ---"
    echo "  Firestore Database ID:              ${FIRESTORE_DATABASE_ID}"
    echo "  Firestore Rules Deployed:           Yes (from file: ${FIRESTORE_RULES_FILE})"
    echo "    ACTION: Review these rules in GCP Console: Firestore -> Databases -> Select '${FIRESTORE_DATABASE_ID}' -> Rules tab."
    echo "            URL: https://console.cloud.google.com/firestore/databases/${FIRESTORE_DATABASE_ID}/rules?project=${PROJECT_ID}"
    echo "    IMPORTANT (Legal Disclaimer): The deployed Firestore rules are a default configuration."
    echo "                 It is YOUR SOLE RESPONSIBILITY to review, understand, and customize these rules"
    echo "                 to meet your specific security, operational, and compliance requirements."
    echo "                 Anava AI and its affiliates shall not be liable for any issues, damages, losses,"
    echo "                 or security vulnerabilities arising from the use or misconfiguration of these rules."
    echo "                 You acknowledge using these rules AT YOUR OWN RISK AND DISCRETION."
    echo ""
    echo "  --- Firebase Storage (Using Default Project Bucket) ---"
    local display_gcs_bucket_name="${FIREBASE_STORAGE_BUCKET#gs://}" # Strip gs:// for display
    if [ -n "${display_gcs_bucket_name}" ]; then
        echo "  Default Firebase Storage Bucket:  ${display_gcs_bucket_name} (Full GCS URL: ${FIREBASE_STORAGE_BUCKET})"
        echo "    ACTION REQUIRED (C++ Uploader): Ensure your C++ application (Gemini::uploadImageBufferToGCS)"
        echo "                                    is configured to upload images to THIS EXACT BUCKET: '${display_gcs_bucket_name}'."
        echo "    Client-Side React App Access:   Your React app's StorageImage component should use full GCS HTTPS URLs"
        echo "                                      (e.g., 'https://storage.googleapis.com/${display_gcs_bucket_name}/your-object-path')"
        echo "                                      or Firebase SDK refs like 'gs://${display_gcs_bucket_name}/your-object-path'."
        echo "    Firebase Storage Rules:         Basic authenticated read/write rules deployed (from file: ${STORAGE_RULES_FILE:-storage.rules})."
        echo "                                      These rules apply to this default bucket."
        echo "                                      ACTION: Review and customize these rules for production security via"
        echo "                                              Firebase Console (Storage -> Rules tab)."
        echo "    GCS CORS Policy for Web App:"
        echo "        Origins Configured:           [${WEB_APP_ORIGINS_INPUT:-Defaults were applied - please check script log or GCS Console}]"
        echo "        ACTION: Ensure these origins precisely match your React app's deployment domains (dev & prod)."
        echo "                   Update manually if needed (GCP Console -> Cloud Storage -> Bucket details for '${display_gcs_bucket_name}' -> Permissions -> Edit CORS)."
    else
        echo "  Default Firebase Storage Bucket:    Could NOT be automatically determined by this script."
        echo "    ACTION REQUIRED: Manually identify your project's default Firebase Storage bucket in the Firebase Console (Storage section)."
        echo "                     Ensure your C++ uploads target this bucket. You will also need to manually configure"
        echo "                     its GCS CORS policy and deploy Firebase Storage rules for it."
    fi
    echo "    Storage Cost Note:              Using Firebase Storage utilizes a GCS bucket. Data is stored once in GCS, so there's no"
    echo "                                      duplication of storage costs. Operations performed via Firebase SDKs are billed as"
    echo "                                      Firebase Storage operations."
    echo ""
    echo "  --- Key Service Accounts & Logging ---"
    echo "  (The following Service Accounts have been granted 'roles/logging.logWriter' for improved diagnostics)"
    echo "  Vertex AI Impersonation SA:         ${VERTEX_AI_SA_EMAIL:-Not Configured}"
    echo "  Device Auth Fn Runtime SA:          ${DEVICE_AUTH_SA_EMAIL:-Not Configured}"
    echo "  TVM Fn Runtime SA:                  ${TVM_SA_EMAIL:-Not Configured}"
    echo "  API Gateway Invoker SA:             ${APIGW_INVOKER_SA_EMAIL:-Not Configured}"
    echo "  Cloud Build SA for Functions:       ${ACTUAL_BUILD_SA:-Not Configured (Project Compute SA)}"
    echo ""
    echo "  --- API Gateway & Cloud Functions (Backend for Devices/Services) ---"
    echo "  API Gateway ID:                     ${API_GATEWAY_ID:-Not Created}"
    echo "  API Gateway Invoke URL (Base):      https://${API_GATEWAY_URL:-Not Available}"
    echo "    Device Auth Endpoint:             POST https://${API_GATEWAY_URL:-N/A}/device-auth/initiate"
    echo "    TVM Endpoint:                     POST https://${API_GATEWAY_URL:-N/A}/gcp-token/vend"
    echo "  Generated API Gateway API Key:      ${GENERATED_GATEWAY_API_KEY_STRING:-Not Created}"
    echo "    (Include this as 'x-api-key' header in requests to the Gateway URLs)"
    echo ""
    echo "  Device Auth Cloud Function Name:    ${DEVICE_AUTH_FUNCTION_NAME:-Not Deployed}"
    echo "    (Private URL: ${DEVICE_AUTH_FUNCTION_URL:-Not Retrieved}, Runtime SA: ${DEVICE_AUTH_SA_EMAIL:-Not Configured})"
    echo "  TVM Cloud Function Name:            ${TVM_FUNCTION_NAME:-Not Deployed}"
    echo "    (Private URL: ${TVM_FUNCTION_URL:-Not Retrieved}, Runtime SA: ${TVM_SA_EMAIL:-Not Configured})"
    echo ""
    echo "  --- Workload Identity Federation (for Secure Device -> GCP Token Exchange) ---"
    echo "  WIF Pool ID:                        ${WIF_POOL_ID:-Not Configured}"
    echo "  WIF OIDC Provider ID:               ${WIF_PROVIDER_ID:-Not Configured}"
    echo "    (Issuer URI: ${ISSUER_URI:-Not Configured}, Expected Audience for Firebase ID Tokens: ${PROJECT_ID})"
    echo ""
    echo ".---------------------------------------------------------------------------------------------."
    echo "| C R I T I C A L   C O N F I G U R A T I O N   F O R   Y O U R   A P P L I C A T I O N S     |"
    echo "'---------------------------------------------------------------------------------------------'"
    echo "  These are the values you will likely need for your client applications (e.g., Axis camera, React Web App):"
    echo ""
    echo "  API_GATEWAY_API_KEY:              ${GENERATED_GATEWAY_API_KEY_STRING:-ERROR_CHECK_KEY}"
    echo "  API_GATEWAY_BASE_URL:             https://${API_GATEWAY_URL:-ERROR_CHECK_URL}"
    echo "  FIREBASE_WEB_API_KEY:             ${FIREBASE_WEB_API_KEY:-ERROR_CHECK_KEY}"
    echo "  GCP_PROJECT_ID:                   ${PROJECT_ID:-ERROR_CHECK_PROJECT_ID}"
    echo "  GCP_REGION:                       ${GCP_REGION:-ERROR_CHECK_REGION}"
    echo "  GCS_BUCKET_NAME:                  ${display_gcs_bucket_name:-ERROR_CHECK_BUCKET_NAME}"
    echo ""
    echo ".---------------------------------------------------------------------------------------------."
    echo "| F I R E B A S E   W E B   A P P   C O N F I G U R A T I O N   (JSON)                        |"
    echo "'---------------------------------------------------------------------------------------------'"
    echo "  Copy and paste the following JSON into your React application's Firebase initialization"
    echo "  (e.g., for the 'Import Firebase Config (JSON)' feature in SystemFirebase.tsx):"
    echo ""
    echo "${firebase_config_for_react_app_json}"
    echo ""
    echo ".---------------------------------------------------------------------------------------------."
    echo ""
    echo "Script setup process finished!"
    echo "This summary has also been saved to the local file: ${SUMMARY_FILENAME}"
    echo "It contains critical information for configuring your devices, client applications, and for your records."
    echo "Please review all ACTION items and IMPORTANT notes above."
    echo "==============================================================================================="
    echo ""
}

# --- Main Execution Flow ---
main_setup_execution
generate_final_summary | tee "${SUMMARY_FILENAME}"
echo "Summary output also saved to ${SUMMARY_FILENAME}"
echo ""

exit 0