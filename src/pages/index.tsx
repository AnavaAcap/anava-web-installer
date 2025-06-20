import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Progress,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Select,
  Input,
  FormControl,
  FormLabel,
  useToast,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Code,
  useColorMode,
  IconButton,
  Divider,
  Badge,
  Link,
  List,
  ListItem,
  ListIcon,
} from '@chakra-ui/react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import { FiSun, FiMoon, FiCheck, FiCopy, FiExternalLink } from 'react-icons/fi';
import { AnavaGCPInstaller } from '../lib/gcp-installer';
import { InstallStatus, InstallResult, GoogleProject } from '../lib/types';
import { InstallationStateManager } from '../lib/installation-state';
import { SecureTokenManager, SecureApiClient } from '../lib/secure-token-manager';
import { sanitizeProjectId, sanitizeRegion, sanitizeErrorMessage, validators } from '../lib/input-sanitizer';
import { ErrorBoundary } from '../components/ErrorBoundary';

const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/firebase',
];

// Environment check (no sensitive data logging)
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  console.log('Environment:', process.env.NODE_ENV);
  console.log('OAuth configured:', !!GOOGLE_CLIENT_ID);
}

function InstallerApp() {
  const [status, setStatus] = useState<InstallStatus>('ready');
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [projects, setProjects] = useState<GoogleProject[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [region, setRegion] = useState('us-central1');
  const solutionPrefix = 'anava'; // Always use 'anava' as the prefix
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState('');
  const [isRetryingApiKey, setIsRetryingApiKey] = useState(false);
  const [hasIncompleteInstall, setHasIncompleteInstall] = useState(false);
  const [resumeProjectId, setResumeProjectId] = useState('');
  
  const { colorMode, toggleColorMode } = useColorMode();
  const toast = useToast();

  // Check for incomplete installation
  const checkForIncompleteInstall = (projectId: string) => {
    const savedState = InstallationStateManager.load(projectId);
    if (savedState && savedState.completedSteps.length > 0 && savedState.completedSteps.length < 9) {
      setHasIncompleteInstall(true);
      setResumeProjectId(projectId);
      
      // Auto-populate settings from saved state
      if (savedState.resources.apiGateway?.url) {
        const match = savedState.resources.apiGateway.url.match(/gateway-(.+?)\./);
        if (match) setRegion(match[1]);
      }
      
      // Check if we can skip directly to completion
      if (savedState.installResult && savedState.completedSteps.length === 9) {
        setInstallResult(savedState.installResult);
        setStatus('completed');
        toast({
          title: 'Previous installation found',
          description: 'Showing results from your previous installation.',
          status: 'info',
          duration: 5000,
          isClosable: true,
        });
      }
    } else {
      setHasIncompleteInstall(false);
      setResumeProjectId('');
    }
  };

  // Define fetchProjects before useEffect
  const fetchProjects = async (tokenId: string) => {
    try {
      const apiClient = new SecureApiClient(tokenId);
      const data = await apiClient.fetchProjects();
      
      if (process.env.NODE_ENV === 'development') {
        console.log('Found projects:', data.projects?.length || 0);
      }
      
      setProjects(data.projects || []);
      
      if (data.projects?.length === 1) {
        const projectId = sanitizeProjectId(data.projects[0].projectId);
        setSelectedProject(projectId);
        checkForIncompleteInstall(projectId);
      }
    } catch (err) {
      const sanitizedError = sanitizeErrorMessage(err);
      setError(`Failed to fetch Google Cloud projects: ${sanitizedError}`);
      setStatus('error');
    }
  };

  // Check for OAuth token in URL hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');
      if (token) {
        // Store token securely and get token ID
        const secureTokenId = SecureTokenManager.storeToken(token);
        setTokenId(secureTokenId);
        setStatus('selecting');
        fetchProjects(secureTokenId);
        // Clean up URL immediately to prevent token exposure
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
    
    // Cleanup tokens on unmount
    return () => {
      SecureTokenManager.clearAllTokens();
    };
  }, []);

  // Manual OAuth URL construction (secure, no logging)
  const getOAuthUrl = () => {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: window.location.origin,
      response_type: 'token',
      scope: GOOGLE_SCOPES.join(' '),
      include_granted_scopes: 'true',
      state: 'pass-through value',
    });
    
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  };

  const googleLogin = useGoogleLogin({
    onSuccess: async (response) => {
      try {
        // Store token securely and get token ID
        const secureTokenId = SecureTokenManager.storeToken(response.access_token);
        setTokenId(secureTokenId);
        setStatus('selecting');
        await fetchProjects(secureTokenId);
      } catch (err) {
        const sanitizedError = sanitizeErrorMessage(err);
        setError(`Authentication failed: ${sanitizedError}`);
        setStatus('error');
      }
    },
    onError: (error) => {
      if (process.env.NODE_ENV === 'development') {
        console.error('OAuth error:', error);
      }
      setError('Failed to authenticate with Google');
      setStatus('error');
    },
    scope: GOOGLE_SCOPES.join(' '),
    flow: 'implicit',
  });

  const handleInstall = async () => {
    // Validate inputs
    if (!selectedProject || !tokenId) {
      setError('Please select a project and ensure you are authenticated.');
      return;
    }
    
    // Sanitize inputs
    const sanitizedProjectId = sanitizeProjectId(selectedProject);
    const sanitizedRegion = sanitizeRegion(region);
    
    if (!validators.projectId(sanitizedProjectId)) {
      setError('Invalid project ID format.');
      return;
    }
    
    if (!validators.region(sanitizedRegion)) {
      setError('Invalid region format.');
      return;
    }

    setStatus('installing');
    setProgress(0);
    setError('');

    const projectName = projects.find(p => p.projectId === sanitizedProjectId)?.name || '';
    
    try {
      // Get token securely
      const token = SecureTokenManager.getToken(tokenId);
      if (!token) {
        throw new Error('Authentication token expired. Please login again.');
      }
      
      const installer = new AnavaGCPInstaller(
        token,
        {
          projectId: sanitizedProjectId,
          projectName,
          region: sanitizedRegion,
          solutionPrefix,
        },
        (step, prog) => {
          setCurrentStep(sanitizeErrorMessage(step));
          setProgress(prog);
        }
      );

      const result = await installer.install();
      setInstallResult(result);
      setStatus('completed');
      
      toast({
        title: 'Installation completed!',
        description: 'Your Anava IoT Security Platform is ready.',
        status: 'success',
        duration: 5000,
        isClosable: true,
      });
    } catch (err: any) {
      const sanitizedError = sanitizeErrorMessage(err);
      setError(sanitizedError);
      setStatus('error');
      
      // Don't show error toast for prerequisites check
      if (!sanitizedError.includes('PREREQUISITES_MISSING:')) {
        toast({
          title: 'Installation failed',
          description: sanitizedError,
          status: 'error',
          duration: 10000,
          isClosable: true,
        });
      }
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: `${label} copied to clipboard`,
      status: 'success',
      duration: 2000,
    });
  };

  const retryApiKeyGeneration = async () => {
    if (!installResult || !tokenId) return;
    
    setIsRetryingApiKey(true);
    
    try {
      // Get token securely
      const token = SecureTokenManager.getToken(tokenId);
      if (!token) {
        throw new Error('Authentication token expired. Please login again.');
      }
      
      const installer = new AnavaGCPInstaller(
        token,
        {
          projectId: installResult.projectId!,
          region: installResult.region!,
          solutionPrefix: installResult.solutionPrefix!,
        },
        () => {} // No progress callback needed
      );
      
      // Call generateAPIKeys with force regenerate flag
      const apiKeyResult = await installer.generateAPIKeys(true);
      
      if (apiKeyResult.apiKey) {
        // Update the install result with the new API key
        setInstallResult({
          ...installResult,
          apiKey: apiKeyResult.apiKey
        });
        
        toast({
          title: 'API Key created successfully!',
          status: 'success',
          duration: 5000,
          isClosable: true,
        });
      } else {
        throw new Error(apiKeyResult.apiKeyError || 'Failed to create API key');
      }
    } catch (err: any) {
      const sanitizedError = sanitizeErrorMessage(err);
      toast({
        title: 'API Key creation failed',
        description: sanitizedError.includes('expired') ? sanitizedError : 'Please wait a bit longer for API Gateway to initialize',
        status: 'warning',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsRetryingApiKey(false);
    }
  };

  const regions = [
    { value: 'us-central1', label: 'US Central (Iowa)' },
    { value: 'us-east1', label: 'US East (South Carolina)' },
    { value: 'us-east4', label: 'US East (Virginia)' },
    { value: 'us-west1', label: 'US West (Oregon)' },
    { value: 'europe-west1', label: 'Europe West (Belgium)' },
    { value: 'europe-west2', label: 'Europe West (London)' },
    { value: 'asia-southeast1', label: 'Asia Southeast (Singapore)' },
  ];

  return (
    <Container maxW="container.lg" py={8}>
      <VStack spacing={8} align="stretch">
        {/* Header */}
        <HStack justify="space-between">
          <VStack align="start" spacing={1}>
            <HStack align="baseline">
              <Heading size="xl">Anava Cloud Installer</Heading>
              <Badge colorScheme="green" ml={2}>v2.2.4-BILLING-ENFORCE</Badge>
            </HStack>
            <Text color="gray.500">
              Guided installation for Anava IoT Security Platform on Google Cloud
            </Text>
            <Text fontSize="xs" color="gray.400">
              NOTE: v2.2.4 - Enforce billing as hard requirement - no bypass allowed</Text>
          </VStack>
          <IconButton
            aria-label="Toggle color mode"
            icon={colorMode === 'light' ? <FiMoon /> : <FiSun />}
            onClick={toggleColorMode}
          />
        </HStack>

        <Divider />

        {/* Main Content */}
        {status === 'ready' && (
          <VStack spacing={6} align="center" py={12}>
            <Heading size="lg">Welcome to Anava Installer</Heading>
            <Text textAlign="center" maxW="600px">
              This installer will set up the complete Anava IoT Security infrastructure in your 
              Google Cloud project. It includes Cloud Functions, API Gateway, Workload Identity 
              Federation, and all necessary service accounts.
            </Text>
            
            <List spacing={3} maxW="500px">
              <ListItem>
                <ListIcon as={FiCheck} color="green.500" />
                No command line required
              </ListItem>
              <ListItem>
                <ListIcon as={FiCheck} color="green.500" />
                Automatic API enablement
              </ListItem>
              <ListItem>
                <ListIcon as={FiCheck} color="green.500" />
                Secure token vending for IoT devices
              </ListItem>
              <ListItem>
                <ListIcon as={FiCheck} color="green.500" />
                Automated setup after manual prerequisites
              </ListItem>
            </List>

            <Button
              size="lg"
              colorScheme="blue"
              onClick={() => googleLogin()}
              px={8}
            >
              Connect Google Cloud Account
            </Button>

            <Text fontSize="sm" color="gray.500">
              You'll be asked to grant permissions to manage resources in your GCP project
            </Text>
          </VStack>
        )}

        {status === 'selecting' && (
          <VStack spacing={6} align="stretch">
            <Heading size="md">Configure Installation</Heading>
            
            <FormControl isRequired>
              <FormLabel>Google Cloud Project</FormLabel>
              <Select
                placeholder="Select a project"
                value={selectedProject}
                onChange={(e) => {
                  const sanitizedValue = sanitizeProjectId(e.target.value);
                  setSelectedProject(sanitizedValue);
                  checkForIncompleteInstall(sanitizedValue);
                }}
              >
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.name} ({project.projectId})
                  </option>
                ))}
              </Select>
            </FormControl>

            <FormControl isRequired>
              <FormLabel>Region</FormLabel>
              <Select value={region} onChange={(e) => setRegion(sanitizeRegion(e.target.value))}>
                {regions.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </FormControl>

            {hasIncompleteInstall && selectedProject === resumeProjectId && (
              <Alert status="info">
                <AlertIcon />
                <Box>
                  <AlertTitle>Incomplete Installation Detected</AlertTitle>
                  <AlertDescription>
                    We found a previous installation attempt for this project. You can resume where you left off or start fresh.
                  </AlertDescription>
                </Box>
              </Alert>
            )}

            <HStack spacing={4}>
              <Button
                colorScheme="blue"
                size="lg"
                onClick={handleInstall}
                isDisabled={!selectedProject}
              >
                {hasIncompleteInstall && selectedProject === resumeProjectId ? 'Resume Installation' : 'Start Installation'}
              </Button>
              
              {hasIncompleteInstall && selectedProject === resumeProjectId && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    InstallationStateManager.clear();
                    setHasIncompleteInstall(false);
                    toast({
                      title: 'Installation state cleared',
                      description: 'You can now start a fresh installation.',
                      status: 'info',
                      duration: 3000,
                    });
                  }}
                >
                  Start Fresh
                </Button>
              )}
            </HStack>
          </VStack>
        )}

        {status === 'installing' && (
          <VStack spacing={6} align="stretch">
            <Heading size="md">Installing...</Heading>
            
            <Box>
              <Text mb={2}>{currentStep}</Text>
              <Progress value={progress} size="lg" colorScheme="blue" />
            </Box>

            <Alert status="info">
              <AlertIcon />
              <Box>
                <AlertTitle>Installation in progress</AlertTitle>
                <AlertDescription>
                  {currentStep.includes('API Gateway') ? (
                    <>API Gateway creation can take 2-5 minutes. Please be patient...</>
                  ) : (
                    <>This process typically takes 5-10 minutes. Please don't close this window.</>
                  )}
                </AlertDescription>
              </Box>
            </Alert>
          </VStack>
        )}

        {status === 'completed' && installResult && (
          <VStack spacing={6} align="stretch">
            <Alert status="success">
              <AlertIcon />
              <Box>
                <AlertTitle>Installation Completed!</AlertTitle>
                <AlertDescription>
                  Your Anava IoT Security Platform is ready to use.
                </AlertDescription>
              </Box>
            </Alert>

            {installResult.apiGatewayWarning && (
              <Alert status="warning">
                <AlertIcon />
                <Box>
                  <AlertTitle>API Gateway Still Activating</AlertTitle>
                  <AlertDescription>
                    {installResult.apiGatewayWarning}
                    <br />
                    You can continue with the setup. The API Gateway will become available shortly.
                  </AlertDescription>
                </Box>
              </Alert>
            )}

            {(installResult as any).resumedInstallation && (
              <Alert status="info">
                <AlertIcon />
                <Box>
                  <AlertTitle>Installation Resumed</AlertTitle>
                  <AlertDescription>
                    Successfully resumed from previous attempt. 
                    {(installResult as any).skippedSteps?.length > 0 && (
                      <><br />Skipped {(installResult as any).skippedSteps.length} already completed steps.</>
                    )}
                  </AlertDescription>
                </Box>
              </Alert>
            )}

            <Tabs>
              <TabList>
                <Tab>Configuration</Tab>
                <Tab>Next Steps</Tab>
                <Tab>Summary</Tab>
              </TabList>

              <TabPanels>
                <TabPanel>
                  <VStack align="stretch" spacing={6}>
                    <Alert status="success">
                      <AlertIcon />
                      <Box>
                        <AlertTitle>Deployment Complete!</AlertTitle>
                        <AlertDescription>
                          All cloud resources have been successfully deployed. Use the credentials below to configure your Axis cameras.
                        </AlertDescription>
                      </Box>
                    </Alert>

                    <FormControl>
                      <FormLabel>API_GATEWAY_API_KEY</FormLabel>
                      <HStack>
                        <Input 
                          value={installResult.apiKey || 'Pending - API Gateway initializing'} 
                          isReadOnly 
                          fontFamily="mono"
                          bg={installResult.apiKey ? 'white' : 'orange.50'}
                        />
                        <IconButton
                          aria-label="Copy"
                          icon={<FiCopy />}
                          onClick={() => copyToClipboard(installResult.apiKey || '', 'API Key')}
                          isDisabled={!installResult.apiKey}
                        />
                        {!installResult.apiKey && (
                          <Button
                            size="sm"
                            colorScheme="blue"
                            onClick={retryApiKeyGeneration}
                            isLoading={isRetryingApiKey}
                            loadingText="Creating..."
                          >
                            Retry
                          </Button>
                        )}
                      </HStack>
                      {!installResult.apiKey && (
                        <Text fontSize="sm" color="orange.600" mt={1}>
                          API Gateway is initializing. Wait 1-2 minutes then click Retry.
                        </Text>
                      )}
                    </FormControl>

                    <FormControl>
                      <FormLabel>API_GATEWAY_BASE_URL</FormLabel>
                      <HStack>
                        <Input 
                          value={installResult.apiGatewayUrl} 
                          isReadOnly 
                          fontFamily="mono"
                          textOverflow="ellipsis"
                          overflow="visible"
                          whiteSpace="nowrap"
                          minW="400px"
                        />
                        <IconButton
                          aria-label="Copy"
                          icon={<FiCopy />}
                          onClick={() => copyToClipboard(installResult.apiGatewayUrl!, 'API URL')}
                        />
                      </HStack>
                    </FormControl>

                    <FormControl>
                      <FormLabel>FIREBASE_WEB_API_KEY</FormLabel>
                      <HStack>
                        <Input 
                          value={installResult.firebaseWebApiKey || 'NOT RETRIEVED - Check Firebase Console'} 
                          isReadOnly 
                          fontFamily="mono"
                          bg={installResult.firebaseWebApiKey ? 'white' : 'orange.50'}
                        />
                        <IconButton
                          aria-label="Copy"
                          icon={<FiCopy />}
                          onClick={() => copyToClipboard(installResult.firebaseWebApiKey || '', 'Firebase Web API Key')}
                          isDisabled={!installResult.firebaseWebApiKey}
                        />
                        {!installResult.firebaseWebApiKey && (
                          <Link
                            href={`https://console.firebase.google.com/project/${installResult.projectId}/settings/general`}
                            isExternal
                          >
                            <IconButton
                              aria-label="Open Firebase Console"
                              icon={<FiExternalLink />}
                            />
                          </Link>
                        )}
                      </HStack>
                    </FormControl>

                    <FormControl>
                      <FormLabel>GCP_PROJECT_ID</FormLabel>
                      <HStack>
                        <Input 
                          value={installResult.projectId} 
                          isReadOnly 
                          fontFamily="mono"
                        />
                        <IconButton
                          aria-label="Copy"
                          icon={<FiCopy />}
                          onClick={() => copyToClipboard(installResult.projectId!, 'Project ID')}
                        />
                      </HStack>
                    </FormControl>

                    <Divider />

                    <Box>
                      <Text fontWeight="bold" mb={2}>Export all at once:</Text>
                      <Code p={4} borderRadius="md" w="full" whiteSpace="pre">
{`export API_GATEWAY_API_KEY="${installResult.apiKey || 'YOUR_API_KEY'}"
export API_GATEWAY_BASE_URL="${installResult.apiGatewayUrl}"
export FIREBASE_WEB_API_KEY="${installResult.firebaseWebApiKey || 'YOUR_FIREBASE_WEB_API_KEY'}"
export GCP_PROJECT_ID="${installResult.projectId}"`}
                      </Code>
                    </Box>
                  </VStack>
                </TabPanel>

                <TabPanel>
                  <VStack align="start" spacing={4}>
                    <Text fontWeight="bold">Configure your Axis camera:</Text>
                    <Code p={4} borderRadius="md" w="full">
                      {`export API_GATEWAY_BASE_URL="${installResult.apiGatewayUrl}"
export API_GATEWAY_API_KEY="${installResult.apiKey}"
export FIREBASE_WEB_API_KEY="${installResult.firebaseWebApiKey}"
export GCP_PROJECT_ID="${installResult.projectId}"`}
                    </Code>

                    <Text fontWeight="bold">Or run on the camera:</Text>
                    <Code p={4} borderRadius="md" w="full">
                      {installResult.setupCommand}
                    </Code>

                    <Divider />

                    <Link
                      href={`https://console.cloud.google.com/home/dashboard?project=${installResult.projectId}`}
                      isExternal
                      color="blue.500"
                    >
                      View in Google Cloud Console <FiExternalLink />
                    </Link>
                  </VStack>
                </TabPanel>

                <TabPanel>
                  <Box maxH="600px" overflowY="auto" w="full">
                    <VStack align="start" spacing={1}>
                      {Object.entries(installResult.configurationSummary || {}).map(([key, value]) => {
                        // Section headers
                        if (key.startsWith('===')) {
                          return (
                            <Box key={key} mt={4} mb={2}>
                              <Text fontWeight="bold" fontSize="lg" color="blue.600">
                                {key.replace(/=/g, '').trim()}
                              </Text>
                              <Divider />
                            </Box>
                          );
                        }
                        // Empty lines for spacing
                        if (value === '') {
                          return <Box key={key} h={2} />;
                        }
                        // Regular items
                        return (
                          <HStack key={key} align="start" spacing={2} pl={4}>
                            <Text fontWeight="medium" minW="250px" fontSize="sm">
                              {key}:
                            </Text>
                            <Text 
                              flex={1} 
                              color={value?.toString().includes('NOT') ? 'orange.600' : 'gray.700'}
                              fontFamily={value?.toString().includes('@') || value?.toString().includes('http') ? 'mono' : 'inherit'}
                              fontSize="sm"
                              wordBreak="break-all"
                            >
                              {String(value)}
                            </Text>
                          </HStack>
                        );
                      })}
                    </VStack>
                  </Box>
                  
                  <Alert status="info" mt={4}>
                    <AlertIcon />
                    <Box>
                      <AlertTitle>Save This Information!</AlertTitle>
                      <AlertDescription>
                        Copy and save all the configuration details above. You'll need them to complete the manual setup steps.
                      </AlertDescription>
                    </Box>
                  </Alert>
                </TabPanel>
              </TabPanels>
            </Tabs>
          </VStack>
        )}

        {status === 'error' && (
          <>
            {/* Check if this is a prerequisites error */}
            {error.includes('PREREQUISITES_MISSING:') ? (
              <VStack spacing={6} align="stretch">
                <Alert status="info">
                  <AlertIcon />
                  <Box>
                    <AlertTitle>Prerequisites Check - Manual Setup Required</AlertTitle>
                    <AlertDescription>
                      The installer has detected some prerequisites that need to be completed manually in the Firebase console before continuing.
                    </AlertDescription>
                  </Box>
                </Alert>

                <Box borderWidth={1} borderRadius="lg" p={6}>
                  <Heading size="md" mb={4}>Complete These Steps First:</Heading>
                  <VStack align="stretch" spacing={4}>
                    {(() => {
                      try {
                        // Decode base64 encoded JSON to prevent sanitization issues
                        const encodedData = error.split('PREREQUISITES_MISSING:')[1];
                        const decodedJson = Buffer.from(encodedData, 'base64').toString('utf-8');
                        const missingSteps = JSON.parse(decodedJson);
                        return missingSteps.map((step: any, index: number) => (
                          <Box key={index} p={4} borderWidth={1} borderRadius="md" borderColor="orange.300" bg="orange.50">
                            <HStack align="start" spacing={3}>
                              <Box color="orange.500" fontSize="2xl">
                                {index + 1}
                              </Box>
                              <VStack align="start" flex={1} spacing={2}>
                                <Text fontWeight="bold" fontSize="lg">{step.name}</Text>
                                <Text color="gray.600">{step.description}</Text>
                                <Link
                                  href={step.action.match(/https?:\/\/[^\s]+/)?.[0] || '#'}
                                  isExternal
                                  color="blue.500"
                                  fontWeight="medium"
                                >
                                  {step.action.includes('Open') ? (
                                    <>
                                      {step.action.split(':')[0]} <FiExternalLink style={{ display: 'inline', marginLeft: '4px' }} />
                                    </>
                                  ) : step.action}
                                </Link>
                                {step.steps && step.steps.length > 0 && (
                                  <VStack align="start" spacing={1} mt={2} pl={4}>
                                    {step.steps.map((substep: string, subIndex: number) => (
                                      <Text key={subIndex} fontSize="sm" color="gray.700">
                                        {substep}
                                      </Text>
                                    ))}
                                  </VStack>
                                )}
                              </VStack>
                            </HStack>
                          </Box>
                        ));
                      } catch (e) {
                        return null;
                      }
                    })()}
                  </VStack>
                </Box>

                <Alert status="info">
                  <AlertIcon />
                  <Box>
                    <AlertTitle>Why are these steps manual?</AlertTitle>
                    <AlertDescription>
                      <List spacing={1} mt={2}>
                        <ListItem>• Firebase initialization requires accepting terms of service</ListItem>
                        <ListItem>• Firestore database creation requires choosing security rules</ListItem>
                        <ListItem>• These steps involve legal agreements that cannot be automated</ListItem>
                      </List>
                    </AlertDescription>
                  </Box>
                </Alert>

                <Button
                  colorScheme="blue"
                  size="lg"
                  onClick={() => {
                    setStatus('selecting');
                    setError('');
                  }}
                >
                  Try Again After Completing Steps
                </Button>
              </VStack>
            ) : error.includes('FIRESTORE SETUP REQUIRED') || error.includes('FIREBASE/FIRESTORE NOT SET UP') ? (
              <VStack spacing={6} align="stretch">
                <Alert status="warning">
                  <AlertIcon />
                  <Box>
                    <AlertTitle>Firestore Setup Required</AlertTitle>
                    <AlertDescription>
                      {error.split('\n\n')[1]}
                    </AlertDescription>
                  </Box>
                </Alert>

                <Box borderWidth={1} borderRadius="lg" p={6}>
                  <VStack align="stretch" spacing={4}>
                    {error.includes('https://') && error.split('\n').filter(line => line.includes('https://')).map((line, index) => {
                      const url = line.match(/https?:\/\/[^\s]+/)?.[0];
                      const stepNumber = line.match(/(\d+)\./)?.[1];
                      const description = line.replace(/^\d+\.\s*/, '').replace(/https?:\/\/[^\s]+/, '').trim();
                      
                      if (!url) return null;
                      
                      return (
                        <HStack key={index} align="start" spacing={3}>
                          <Box color="blue.500" fontSize="xl" fontWeight="bold" minW="30px">
                            {stepNumber || index + 1}
                          </Box>
                          <VStack align="start" flex={1}>
                            <Text>{description || 'Complete this step'}</Text>
                            <Link href={url} isExternal color="blue.500" fontWeight="medium">
                              Open in Console <FiExternalLink style={{ display: 'inline', marginLeft: '4px' }} />
                            </Link>
                          </VStack>
                        </HStack>
                      );
                    }).filter(Boolean)}
                  </VStack>
                </Box>

                <Button
                  colorScheme="blue"
                  size="lg"
                  onClick={() => {
                    setStatus('selecting');
                    setError('');
                  }}
                >
                  Try Again After Setup
                </Button>
              </VStack>
            ) : (
              <Alert status="error">
                <AlertIcon />
                <Box>
                  <AlertTitle>Installation Failed</AlertTitle>
                  <AlertDescription whiteSpace="pre-wrap">{error}</AlertDescription>
                </Box>
              </Alert>
            )}
          </>
        )}
      </VStack>
    </Container>
  );
}

export default function Home() {
  // Check if OAuth is configured
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === 'placeholder-oauth-client-id') {
    return (
      <Container maxW="container.md" py={10}>
        <Alert status="warning">
          <AlertIcon />
          <Box>
            <AlertTitle>OAuth Configuration Required</AlertTitle>
            <AlertDescription>
              The Google OAuth Client ID is not configured. Please follow these steps:
              <List mt={2} spacing={1}>
                <ListItem>1. Go to Google Cloud Console</ListItem>
                <ListItem>2. Create OAuth 2.0 credentials</ListItem>
                <ListItem>3. Update NEXT_PUBLIC_GOOGLE_CLIENT_ID in Vercel</ListItem>
                <ListItem>4. Redeploy the application</ListItem>
              </List>
            </AlertDescription>
          </Box>
        </Alert>
      </Container>
    );
  }

  return (
    <ErrorBoundary>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <InstallerApp />
      </GoogleOAuthProvider>
    </ErrorBoundary>
  );
}