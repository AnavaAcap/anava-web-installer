import { describe, expect, test } from '@jest/globals';

describe('Prerequisites Base64 Encoding', () => {
  test('should encode and decode prerequisites with URLs correctly', () => {
    const missingSteps = [
      {
        name: 'Enable Firebase',
        description: 'Firebase needs to be enabled for this project',
        action: 'Open Firebase Console: https://console.firebase.google.com/project/test-project/overview and click "Continue to the console"'
      },
      {
        name: 'Create Firestore Database',
        description: 'Firestore database needs to be created',
        action: 'Open Firestore Console: https://console.firebase.google.com/project/test-project/firestore and click "Create database"'
      }
    ];

    // Simulate what happens in gcp-installer.ts
    const encodedSteps = Buffer.from(JSON.stringify(missingSteps)).toString('base64');
    const errorMessage = `PREREQUISITES_MISSING:${encodedSteps}`;

    // Simulate what happens in index.tsx
    const encodedData = errorMessage.split('PREREQUISITES_MISSING:')[1];
    const decodedJson = Buffer.from(encodedData, 'base64').toString('utf-8');
    const decodedSteps = JSON.parse(decodedJson);

    // Verify the data is preserved correctly
    expect(decodedSteps).toEqual(missingSteps);
    expect(decodedSteps[0].action).toContain('https://console.firebase.google.com');
    expect(decodedSteps[1].action).toContain('https://console.firebase.google.com');
  });

  test('should handle empty prerequisites list', () => {
    const missingSteps: any[] = [];
    
    const encodedSteps = Buffer.from(JSON.stringify(missingSteps)).toString('base64');
    const errorMessage = `PREREQUISITES_MISSING:${encodedSteps}`;

    const encodedData = errorMessage.split('PREREQUISITES_MISSING:')[1];
    const decodedJson = Buffer.from(encodedData, 'base64').toString('utf-8');
    const decodedSteps = JSON.parse(decodedJson);

    expect(decodedSteps).toEqual([]);
  });

  test('should handle malformed base64 by returning unparseable data', () => {
    const errorMessage = 'PREREQUISITES_MISSING:invalid-base64-data!!!';
    
    const encodedData = errorMessage.split('PREREQUISITES_MISSING:')[1];
    const decodedData = Buffer.from(encodedData, 'base64').toString('utf-8');
    
    // The decoded data won't be valid JSON
    expect(() => {
      JSON.parse(decodedData);
    }).toThrow();
  });
});