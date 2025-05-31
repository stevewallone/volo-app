import { createRemoteJWKSet, jwtVerify } from 'jose';

type FirebaseUser = {
  id: string;
  email: string | undefined;
};

// Detect if we're in development mode (emulator)
const isEmulatorMode = (env: any): boolean => {
  return env.NODE_ENV === 'development' || 
         env.FIREBASE_AUTH_EMULATOR_HOST !== undefined;
};

// Create appropriate JWKS client based on environment
const getJWKS = (env: any) => {
  if (isEmulatorMode(env)) {
    // Use emulator JWKS endpoint
    return createRemoteJWKSet(
      new URL('http://localhost:9099/www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
    );
  } else {
    // Use production Firebase JWKS
    return createRemoteJWKSet(
      new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
    );
  }
};

export async function verifyFirebaseToken(token: string, projectId: string, env: any): Promise<FirebaseUser> {
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID environment variable is not set');
  }

  // In emulator mode, use simplified token verification
  if (isEmulatorMode(env)) {
    try {
      // Decode the token without verification for emulator
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid token format');
      }
      
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      
      // Basic validation for emulator tokens
      if (!payload.sub || !payload.aud || payload.aud !== projectId) {
        throw new Error('Invalid token payload');
      }
      
      return {
        id: payload.sub as string,
        email: payload.email as string | undefined,
      };
    } catch (error) {
      throw new Error('Invalid emulator token');
    }
  }

  // Production token verification
  try {
    const JWKS = getJWKS(env);
    const issuer = `https://securetoken.google.com/${projectId}`;

    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience: projectId,
    });

    return {
      id: payload.sub as string,
      email: payload.email as string | undefined,
    };
  } catch (error) {
    throw new Error('Invalid token');
  }
} 