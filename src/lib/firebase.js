import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCvfmCYFW54HFE1UdDdd5YAT3Lgn-ALGMk",
  authDomain: "smart-landlord-1e526.firebaseapp.com",
  projectId: "smart-landlord-1e526",
  storageBucket: "smart-landlord-1e526.firebasestorage.app",
  messagingSenderId: "755376850600",
  appId: "1:755376850600:web:9a1a873653221e7403a49d",
  measurementId: "G-DLZ72LSQ0F"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Analytics conditionally (only in browser)
let analytics = null;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

// Initialize Auth
const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('Failed to set Firebase auth persistence.', error);
});

export { app, analytics, auth };
