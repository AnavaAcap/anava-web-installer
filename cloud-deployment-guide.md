# Moving Anava UI to the Cloud (Vercel)

## Why This Changes Everything

### Current Limitations (On-Camera)
- Limited by camera CPU/RAM
- No global CDN
- Slow for remote users
- Updates require camera access
- Single point of failure

### Cloud Benefits
- **Global Performance**: CDN serves UI from nearest location
- **Unlimited Scale**: Handle thousands of concurrent users
- **Instant Updates**: Push changes without touching cameras
- **Better UX**: Fast loading, modern features
- **Cost Effective**: Free tier handles most use cases

## Architecture Transformation

```
Before: Camera → FastCGI → Next.js → User
After:  Camera → API → Firestore → Cloud UI ← User
```

## Quick Deployment Guide

### 1. Prepare Your App for Cloud

Create `next.config.cloud.mjs`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
    // Remove 'export' mode for full Next.js features
    // output: 'export', 
    
    // No asset prefix needed in cloud
    assetPrefix: '',
    
    // Use default out directory
    distDir: '.next',
    
    images: { 
        unoptimized: false,
        domains: ['storage.googleapis.com', 'firebasestorage.googleapis.com']
    },
    
    reactStrictMode: true,
    
    // Environment variables
    env: {
        NEXT_PUBLIC_API_ENDPOINT: process.env.NEXT_PUBLIC_API_ENDPOINT,
        NEXT_PUBLIC_FIREBASE_CONFIG: process.env.NEXT_PUBLIC_FIREBASE_CONFIG,
    }
}
export default nextConfig;
```

### 2. Update API Service for Cloud

Update `src/services/apiService.ts`:
```typescript
// Dynamic base URL based on environment
const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    // Client-side
    return process.env.NEXT_PUBLIC_API_ENDPOINT || '';
  }
  // Server-side
  return process.env.API_ENDPOINT || '';
};

const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: 30000,
});
```

### 3. Deploy to Vercel

```bash
# From axis-nextjs-app directory
cd ../axis-nextjs-app

# Use cloud config
cp next.config.cloud.mjs next.config.mjs

# Install Vercel CLI
npm i -g vercel

# Deploy!
vercel

# Answer prompts:
# - Set up and deploy? Y
# - Scope? (your account)
# - Link to existing project? N
# - Project name? anava-ui
# - Directory? ./
# - Build settings? (accept defaults)
```

### 4. Configure Environment Variables

In Vercel Dashboard:
- Go to Project Settings → Environment Variables
- Add:
  ```
  NEXT_PUBLIC_API_ENDPOINT=https://your-camera-ip/api
  NEXT_PUBLIC_FIREBASE_CONFIG={"apiKey":"...","authDomain":"..."}
  ```

### 5. Connect Custom Domain (Optional)

```bash
vercel domains add app.anava.ai
```

## Advanced Cloud Features

### 1. Edge Functions for Auth
```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  // Verify camera tokens at edge
  const token = request.headers.get('authorization');
  if (!verifyToken(token)) {
    return NextResponse.redirect('/login');
  }
}
```

### 2. Incremental Static Regeneration
```typescript
// pages/events/[id].tsx
export async function getStaticProps({ params }) {
  const event = await getEventFromFirestore(params.id);
  return {
    props: { event },
    revalidate: 60, // Regenerate every 60 seconds
  };
}
```

### 3. API Routes for Camera Communication
```typescript
// pages/api/camera/[deviceId]/snapshot.ts
export default async function handler(req, res) {
  const { deviceId } = req.query;
  
  // Proxy request to camera with auth
  const snapshot = await fetchFromCamera(deviceId, '/snapshot');
  
  res.setHeader('Cache-Control', 's-maxage=10');
  res.json(snapshot);
}
```

## Migration Path

### Phase 1: Dual Deployment (Recommended)
- Keep on-camera UI running
- Deploy cloud version in parallel
- Test with subset of users

### Phase 2: Cloud-First
- Make cloud UI primary
- Camera UI as fallback
- Gradual migration

### Phase 3: Cloud-Only
- Remove UI from camera image
- Cameras only run C++ analytics
- All UI in cloud

## Performance Optimizations

### 1. Static Generation for Events
```typescript
// Generate static pages for common views
export async function getStaticPaths() {
  return {
    paths: [
      { params: { view: 'today' } },
      { params: { view: 'week' } },
      { params: { view: 'month' } },
    ],
    fallback: 'blocking',
  };
}
```

### 2. Image Optimization
```typescript
// Use Next.js Image component
import Image from 'next/image';

<Image
  src={eventImageUrl}
  width={640}
  height={480}
  placeholder="blur"
  loading="lazy"
/>
```

### 3. Bundle Splitting
```typescript
// Dynamic imports for heavy components
const LiveEventsMap = dynamic(
  () => import('../components/LiveEventsMap'),
  { 
    loading: () => <Skeleton />,
    ssr: false 
  }
);
```

## Monitoring & Analytics

### 1. Vercel Analytics (Free)
```bash
npm i @vercel/analytics
```

### 2. Real User Monitoring
```typescript
// _app.tsx
import { Analytics } from '@vercel/analytics/react';

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <Analytics />
    </>
  );
}
```

## Cost Analysis

### Vercel Free Tier Includes:
- 100GB bandwidth/month
- Unlimited deployments
- Automatic HTTPS
- Global CDN
- ~1M page views/month

### When You'll Need Pro ($20/month):
- More than 1M monthly page views
- Team collaboration features
- Advanced analytics
- SLA guarantees

## Security Considerations

### 1. API Authentication
```typescript
// Secure API calls from cloud UI
const secureApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_ENDPOINT,
  headers: {
    'X-API-Key': process.env.NEXT_PUBLIC_API_KEY,
  },
});
```

### 2. CORS Configuration
On camera API:
```cpp
// Add CORS headers for cloud UI
response.setHeader("Access-Control-Allow-Origin", "https://app.anava.ai");
response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
```

### 3. Content Security Policy
```typescript
// next.config.mjs
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline' *.vercel.app;
      img-src 'self' blob: data: *.googleapis.com;
    `.replace(/\n/g, ''),
  },
];
```

## Benefits Summary

1. **Performance**: 10x faster for remote users
2. **Reliability**: 99.99% uptime with Vercel
3. **Scalability**: Handle enterprise deployments
4. **Developer Experience**: Git push = deploy
5. **Cost**: Often cheaper than on-camera hosting
6. **Features**: WebSockets, SSR, API routes, and more

Ready to revolutionize your UI delivery?