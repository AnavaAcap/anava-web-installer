import React, { useState } from 'react';
import {
  Box,
  Button,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Input,
  FormControl,
  FormLabel,
  Alert,
  AlertIcon,
  Code,
} from '@chakra-ui/react';
import { AnavaGCPInstaller } from '../lib/gcp-installer';
import { InstallStatus, InstallResult } from '../lib/types';

export default function DevPage() {
  const [accessToken, setAccessToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<InstallStatus>('ready');
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState('');

  const handleInstall = async () => {
    if (!accessToken || !projectId) {
      setError('Please provide both access token and project ID');
      return;
    }

    setStatus('installing');
    setError('');

    // Trim whitespace from token
    const trimmedToken = accessToken.trim();
    console.log('Using token:', trimmedToken.substring(0, 20) + '...');
    console.log('Project ID:', projectId);

    const installer = new AnavaGCPInstaller(
      trimmedToken,
      {
        projectId: projectId.trim(),
        region: 'us-central1',
        solutionPrefix: 'anava',
      },
      (step, progress) => {
        console.log(`Progress: ${progress}% - ${step}`);
      }
    );

    try {
      const result = await installer.install();
      setInstallResult(result);
      setStatus('completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
      setStatus('error');
    }
  };

  const getAccessToken = () => {
    // Get token via gcloud
    const cmd = 'gcloud auth print-access-token';
    navigator.clipboard.writeText(cmd);
    alert('Command copied to clipboard. Run in terminal and paste token here.');
  };

  const testToken = async () => {
    if (!accessToken || !projectId) {
      setError('Please provide both access token and project ID');
      return;
    }

    try {
      const response = await fetch(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken.trim()}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        alert(`✅ Token works! Project: ${data.name} (${data.projectId})`);
      } else {
        const error = await response.text();
        alert(`❌ Token test failed: ${response.status}\n${error}`);
      }
    } catch (err) {
      alert(`❌ Token test error: ${err}`);
    }
  };

  return (
    <Container maxW="container.md" py={10}>
      <VStack spacing={6} align="stretch">
        <Heading>Developer Testing Page</Heading>
        
        <Alert status="info">
          <AlertIcon />
          This page bypasses OAuth for testing. Use gcloud to get access token.
        </Alert>

        <FormControl>
          <FormLabel>Access Token</FormLabel>
          <Input
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Paste gcloud access token here"
            type="password"
          />
          <Button size="sm" mt={2} onClick={getAccessToken}>
            Copy gcloud command
          </Button>
        </FormControl>

        <FormControl>
          <FormLabel>Project ID</FormLabel>
          <Input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="your-gcp-project-id"
          />
        </FormControl>

        <HStack>
          <Button
            colorScheme="blue"
            onClick={handleInstall}
            isLoading={status === 'installing'}
            isDisabled={!accessToken || !projectId}
          >
            Test Install
          </Button>
          <Button
            variant="outline"
            onClick={testToken}
            isDisabled={!accessToken || !projectId}
          >
            Test Token
          </Button>
        </HStack>

        {error && (
          <Alert status="error">
            <AlertIcon />
            {error}
          </Alert>
        )}

        {installResult && (
          <Box p={4} bg="gray.100" borderRadius="md">
            <Heading size="sm" mb={2}>Installation Result</Heading>
            <Code display="block" whiteSpace="pre-wrap">
              {JSON.stringify(installResult, null, 2)}
            </Code>
          </Box>
        )}

        <Box fontSize="sm" color="gray.500">
          <Text fontWeight="bold">How to get access token:</Text>
          <Code>gcloud auth print-access-token</Code>
          <Text mt={2}>Make sure you're logged in with proper permissions.</Text>
        </Box>
      </VStack>
    </Container>
  );
}