#!/usr/bin/env node

// Test OAuth configuration locally
const { execSync } = require('child_process');
const http = require('http');
const url = require('url');
const open = require('open');

const CLIENT_ID = '392865621461-bf06rb26geqs6c487u0q3k4sbgj9gpoa.apps.googleusercontent.com';
const REDIRECT_PORT = 8080;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

console.log('OAuth Configuration Test\n');
console.log('Client ID:', CLIENT_ID);
console.log('Redirect URI:', REDIRECT_URI);
console.log('\nMake sure this EXACT redirect URI is in your Google Console:');
console.log(`  ${REDIRECT_URI}\n`);

// Create local server to catch OAuth callback
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/') {
    // Check for error
    if (parsedUrl.query.error) {
      console.error('\n❌ OAuth Error:', parsedUrl.query.error);
      console.error('Description:', parsedUrl.query.error_description);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <h1>OAuth Error</h1>
        <p>Error: ${parsedUrl.query.error}</p>
        <p>Description: ${parsedUrl.query.error_description}</p>
        <p>Check console for details</p>
      `);
      process.exit(1);
    }
    
    // Extract token from hash (will be in fragment, not query)
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <h1>OAuth Success!</h1>
      <p>Check the URL hash for your access token</p>
      <script>
        const hash = window.location.hash;
        if (hash) {
          const params = new URLSearchParams(hash.substring(1));
          const token = params.get('access_token');
          if (token) {
            document.body.innerHTML += '<p>✅ Access token received!</p>';
            document.body.innerHTML += '<p>Token: ' + token.substring(0, 20) + '...</p>';
            
            // Test the token
            fetch('https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE', {
              headers: {
                'Authorization': 'Bearer ' + token
              }
            })
            .then(response => response.json())
            .then(data => {
              document.body.innerHTML += '<p>✅ Token works! Found ' + (data.projects?.length || 0) + ' projects</p>';
              if (data.projects) {
                document.body.innerHTML += '<ul>';
                data.projects.forEach(p => {
                  document.body.innerHTML += '<li>' + p.projectId + '</li>';
                });
                document.body.innerHTML += '</ul>';
              }
            })
            .catch(err => {
              document.body.innerHTML += '<p>❌ Token test failed: ' + err + '</p>';
            });
          }
        }
      </script>
    `);
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log(`\n✅ Local server listening on port ${REDIRECT_PORT}`);
  
  // Build OAuth URL
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'token',
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
    include_granted_scopes: 'true',
  });
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  
  console.log('\nOpening OAuth URL in browser...');
  console.log('URL:', authUrl);
  
  // Open in browser
  try {
    execSync(`open "${authUrl}"`);
  } catch (e) {
    console.log('\nCould not open browser automatically. Please visit:');
    console.log(authUrl);
  }
});

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  server.close();
  process.exit(0);
});