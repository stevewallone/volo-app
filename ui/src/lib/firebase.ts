import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import firebaseConfig from './firebase-config.json';

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Connect to Firebase Auth emulator in development
if (import.meta.env.DEV) {
  try {
    const firebaseAuthPort = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || '9099';
    const emulatorUrl = `http://localhost:${firebaseAuthPort}`;
    connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
    console.log(`Connected to Firebase Auth emulator at ${emulatorUrl}`);
  } catch (error) {
    // Emulator already connected or not available
    console.debug('Firebase Auth emulator connection skipped');
  }
} 