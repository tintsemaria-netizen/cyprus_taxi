import type { MetadataRoute } from 'next';

// Public marketing/booking pages may be indexed; private, per-ride and staff surfaces must not be.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/track', '/share', '/rides', '/account', '/driver', '/dispatch', '/admin', '/staff'],
    },
  };
}
