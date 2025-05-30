import { createRemoteJWKSet, jwtVerify } from 'jose';

type FirebaseUser = {
  id: string;
  email: string | undefined;
};

// Detect if we're in development mode (emulator)
const isEmulatorMode = (): boolean => {
  return process.env.NODE_ENV === 'development' || 
         process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined;
};

// Create appropriate JWKS client based on environment
const getJWKS = () => {
  if (isEmulatorMode()) {
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

export async function verifyFirebaseToken(token: string, projectId: string): Promise<FirebaseUser> {
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID environment variable is not set');
  }

  try {
    const JWKS = getJWKS();
    const issuer = isEmulatorMode() 
      ? projectId  // Emulator uses just the project ID as issuer
      : `https://securetoken.google.com/${projectId}`;

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