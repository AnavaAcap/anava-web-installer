import React from 'react';
import { Container, VStack, Button, Code, Text, Heading } from '@chakra-ui/react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';

const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();

function TestOAuth() {
  const login = useGoogleLogin({
    onSuccess: (response) => {
      console.log('Success:', response);
      alert('OAuth Success! Check console for token.');
    },
    onError: (error) => {
      console.error('Error:', error);
      alert('OAuth Error! Check console.');
    },
    flow: 'implicit',
  });

  return (
    <Container maxW="container.md" py={10}>
      <VStack spacing={4}>
        <Heading>OAuth Test Page</Heading>
        <Text>This page tests the OAuth library configuration</Text>
        
        <Code display="block" p={4}>
          Current URL: {typeof window !== 'undefined' ? window.location.href : 'loading...'}
        </Code>
        
        <Button colorScheme="blue" onClick={() => login()}>
          Test OAuth Flow
        </Button>
        
        <Text fontSize="sm">
          Make sure these URIs are in your OAuth config:
        </Text>
        <Code display="block" whiteSpace="pre" p={4}>
{`https://web-installer-7q0otspje-ryan-wagers-projects.vercel.app
https://web-installer-7q0otspje-ryan-wagers-projects.vercel.app/
https://web-installer-7q0otspje-ryan-wagers-projects.vercel.app/test-oauth
https://web-installer-7q0otspje-ryan-wagers-projects.vercel.app/test-oauth/`}
        </Code>
      </VStack>
    </Container>
  );
}

export default function TestOAuthPage() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <TestOAuth />
    </GoogleOAuthProvider>
  );
}