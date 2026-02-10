import * as admin from 'firebase-admin';
/**
 * Initialise Firebase Admin SDK
 * Requiert un fichier firebase-service-account.json à la racine du projet API
 */
export declare function initializeFirebase(): admin.app.App | null;
/**
 * Vérifie si Firebase est disponible (avec cache de 30 secondes)
 */
export declare function isFirebaseOnline(): Promise<boolean>;
/**
 * Retourne l'état actuel de Firebase (sans nouvelle vérification)
 */
export declare function getFirebaseStatus(): {
    initialized: boolean;
    available: boolean;
    lastCheck: number;
};
/**
 * Obtient l'instance Firebase Admin
 */
export declare function getFirebaseApp(): typeof admin;
/**
 * Obtient la base de données Firestore
 */
export declare function getFirestore(): admin.firestore.Firestore;
/**
 * Obtient le service d'authentification Firebase
 */
export declare function getAuth(): import("firebase-admin/auth").Auth;
/**
 * Obtient le service de réaltime database (si configuré)
 */
export declare function getDatabase(): import("firebase-admin/lib/database/database").Database;
//# sourceMappingURL=firebase.d.ts.map