import { createPostgresDb } from '../server/postgresDb.js';
import { db } from '../server/db.js';
import { initializeApp as initializeFirebaseAdminApp, getApps as getFirebaseAdminApps, cert } from 'firebase-admin/app';
import { getAuth as getFirebaseAdminAuth } from 'firebase-admin/auth';

async function main() {
  console.log('Initializing Firebase Admin...');
  const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'smart-landlord-1e526';
  
  if (getFirebaseAdminApps().length === 0) {
    // If a service account is provided via env var, we can use it, otherwise use application default credentials or project id.
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountStr) {
      try {
        const serviceAccount = JSON.parse(serviceAccountStr);
        initializeFirebaseAdminApp({ credential: cert(serviceAccount) });
      } catch (e) {
        console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT. Falling back to project ID.', e.message);
        initializeFirebaseAdminApp({ projectId: FIREBASE_PROJECT_ID });
      }
    } else {
      initializeFirebaseAdminApp({ projectId: FIREBASE_PROJECT_ID });
    }
  }

  const auth = getFirebaseAdminAuth();
  
  console.log('Connecting to database...');
  let activeDb = db;
  let isPg = false;
  if (process.env.DATABASE_URL) {
    try {
      activeDb = await createPostgresDb();
      isPg = true;
    } catch (e) {
      console.warn('Failed to connect to PostgreSQL, falling back to JSON db.', e.message);
    }
  } else {
    console.log('DATABASE_URL not set, using JSON db.');
  }
  
  try {
    const users = isPg ? await activeDb.find('users', {}) : activeDb.get('users');
    console.log(`Found ${users.length} users in database.`);
    
    let updatedCount = 0;
    
    for (const user of users) {
      if (user.firebase_uid) {
        console.log(`User ${user.email} already has firebase_uid: ${user.firebase_uid}. Skipping.`);
        continue;
      }
      
      try {
        const firebaseUser = await auth.getUserByEmail(user.email);
        if (firebaseUser) {
          console.log(`Matched user ${user.email} to Firebase UID: ${firebaseUser.uid}. Updating database...`);
          if (isPg) {
            await activeDb.query('UPDATE users SET firebase_uid = $1 WHERE id = $2', [firebaseUser.uid, user.id]);
          } else {
            activeDb.update('users', user.id, { firebase_uid: firebaseUser.uid });
          }
          updatedCount++;
        }
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          console.log(`No Firebase user found for email: ${user.email}`);
        } else {
          console.error(`Error processing user ${user.email}:`, error.message);
        }
      }
    }
    
    console.log(`Sync complete. Updated ${updatedCount} users.`);
  } finally {
    // Ensure we close connection to allow process to exit cleanly
    if (isPg && activeDb.client) await activeDb.client.end();
    if (isPg && activeDb.pool) await activeDb.pool.end();
  }
}

main().catch(console.error);
