import { createRemoteJWKSet, jwtVerify } from 'jose';

type FirebaseUser = {
  id: string;
  email: string | undefined;
};

// Create a JWKS client using Firebase's public keys
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export async function verifyFirebaseToken(token: string, projectId: string): Promise<FirebaseUser> {
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID environment variable is not set');
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
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