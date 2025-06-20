import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
  Box,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Button,
  VStack,
  Text,
  Code,
} from '@chakra-ui/react';
import { sanitizeErrorMessage } from '../lib/input-sanitizer';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }
    
    // In production, you would send this to a logging service
    // logger.error('React Error Boundary', { error, errorInfo });
    
    this.setState({
      hasError: true,
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Box p={6} maxW="container.md" mx="auto">
          <VStack spacing={4} align="stretch">
            <Alert status="error">
              <AlertIcon />
              <Box>
                <AlertTitle>Something went wrong!</AlertTitle>
                <AlertDescription>
                  The application encountered an unexpected error.
                </AlertDescription>
              </Box>
            </Alert>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <Box borderWidth={1} borderRadius="md" p={4} bg="red.50">
                <Text fontWeight="bold" mb={2}>Error Details (Development Mode)</Text>
                <Code display="block" whiteSpace="pre-wrap" fontSize="sm">
                  {sanitizeErrorMessage(this.state.error.stack || this.state.error.message)}
                </Code>
              </Box>
            )}

            <Button onClick={this.handleReset} colorScheme="blue">
              Try Again
            </Button>

            <Text fontSize="sm" color="gray.600">
              If this problem persists, please refresh the page or contact support.
            </Text>
          </VStack>
        </Box>
      );
    }

    return this.props.children;
  }
}