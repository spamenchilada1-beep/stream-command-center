import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDOImXoew63ecuSvbJ6LXQwTzCBVYZBooQ',
  authDomain: 'stream-command-center-c5445.firebaseapp.com',
  projectId: 'stream-command-center-c5445',
  storageBucket: 'stream-command-center-c5445.firebasestorage.app',
  messagingSenderId: '1040426316438',
  appId: '1:1040426316438:web:6635d77a34dc1f518d08b7',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
