import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Initialize Firebase Admin SDK
if (!admin.apps || admin.apps.length === 0) {
  // Essayer de charger le fichier JSON de service account
  const possiblePaths = [
    // Chemin relatif au backend
    join(process.cwd(), 'firebase-service-account.json'),
    // Chemin depuis la racine du projet api
    join(process.cwd(), '..', '..', 'firebase-service-account.json'),
    // Chemin absolu fourni par variable d'environnement
    process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  ];

  let serviceAccount: admin.ServiceAccount | null = null;
  let loadedFrom = '';

  for (const path of possiblePaths) {
    if (path && existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        const jsonData = JSON.parse(content);
        // Convertir project_id en projectId, private_key en privateKey, etc.
        serviceAccount = {
          projectId: jsonData.project_id || jsonData.projectId,
          privateKey: jsonData.private_key || jsonData.privateKey,
          clientEmail: jsonData.client_email || jsonData.clientEmail,
        } as admin.ServiceAccount;
        loadedFrom = path;
        console.log('✅ Firebase: Clé de service chargée depuis', path);
        break;
      } catch (e) {
        console.warn('⚠️ Impossible de lire', path);
      }
    }
  }

  // Fallback sur les variables d'environnement
  if (!serviceAccount && process.env.FIREBASE_PROJECT_ID) {
    console.log('📝 Firebase: Utilisation des variables d\'environnement');
    
    // Corriger le parsing de la clé privée
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
    // Enlever les guillemets si présents
    privateKey = privateKey.replace(/^["']|["']$/g, '');
    // Remplacer les \n littéraux par de vrais sauts de ligne
    privateKey = privateKey.replace(/\\n/g, '\n');

    serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    } as admin.ServiceAccount;
  }

  if (!serviceAccount) {
    console.error('❌ Firebase: Aucune configuration trouvée!');
    console.error('   Placez firebase-service-account.json dans le dossier backend/');
    process.exit(1);
  }

  console.log('🔍 DEBUG - Service Account Info:');
  console.log('   - Project ID:', serviceAccount.projectId);
  console.log('   - Client Email:', serviceAccount.clientEmail);
  console.log('   - Private Key (first 50 chars):', serviceAccount.privateKey?.substring(0, 50));
  console.log('   - Private Key length:', serviceAccount.privateKey?.length);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.projectId,
    databaseURL: `https://${serviceAccount.projectId}.firebaseio.com`,
  });

  console.log('🔥 Firebase Admin SDK initialisé avec succès');
  console.log('📦 Projet Firebase:', serviceAccount.projectId);
  
  // Vérifier la connexion Firestore
  admin.firestore().settings({
    ignoreUndefinedProperties: true,
  });

  // Tester la connexion Firestore
  console.log('🧪 Test de connexion à Firestore...');
  admin.firestore().collection('_test_').doc('_connection_test_').set({ test: true, timestamp: new Date() })
    .then(() => {
      console.log('✅ Connexion Firestore réussie!');
      return admin.firestore().collection('_test_').doc('_connection_test_').delete();
    })
    .catch((error) => {
      console.error('❌ Erreur de connexion Firestore:');
      console.error('   Code:', error.code);
      console.error('   Message:', error.message);
      console.error('   Details:', error.details);
      console.error('   Full error:', JSON.stringify(error, null, 2));
    });
}

export const db = admin.firestore();
export const auth = admin.auth();

export default admin;
