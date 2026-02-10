"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.managerMiddleware = managerMiddleware;
exports.userMiddleware = userMiddleware;
exports.optionalAuthMiddleware = optionalAuthMiddleware;
const userService_1 = __importDefault(require("../services/userService"));
const hybridDataService_1 = require("../services/hybridDataService");
const firebase_1 = require("../config/firebase");
// Firebase Auth REST API pour vérification de token
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
/**
 * Middleware d'authentification hybride
 * Supporte 3 types de tokens:
 * 1. Firebase ID Token (JWT) - vérifié avec Firebase Admin SDK
 * 2. Firebase UID - recherché directement dans le cache PostgreSQL
 * 3. Token local (local_{id}_{timestamp}) - pour mode hors ligne
 */
async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({
                success: false,
                error: 'Token d\'authentification requis',
                code: 'MISSING_TOKEN'
            });
            return;
        }
        const token = authHeader.replace('Bearer ', '');
        const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
        let user = null;
        // Détecter le type de token
        const isLocalToken = token.startsWith('local_');
        const isFirebaseIdToken = token.length > 100 && token.includes('.'); // JWT format
        if (isOnline && isFirebaseIdToken) {
            // ===== TOKEN JWT FIREBASE: Vérifier avec Firebase Admin SDK =====
            try {
                const auth = (0, firebase_1.getAuth)();
                const decodedToken = await auth.verifyIdToken(token);
                req.firebaseUser = {
                    uid: decodedToken.uid,
                    email: decodedToken.email || '',
                    name: decodedToken.name
                };
                console.log(`🔐 Token Firebase JWT vérifié pour: ${decodedToken.email}`);
                // Chercher l'utilisateur dans le cache local
                user = await userService_1.default.findByFirebaseUid(decodedToken.uid);
                if (!user) {
                    // Synchroniser depuis Firestore si pas en cache
                    const db = (0, firebase_1.getFirestore)();
                    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        user = await userService_1.default.syncFromFirebase({
                            firebase_uid: decodedToken.uid,
                            email: decodedToken.email || '',
                            password: userData.password || '',
                            display_name: userData.display_name || decodedToken.name || '',
                            type_user: userData.type_user || 2
                        });
                    }
                }
            }
            catch (firebaseError) {
                console.warn('⚠️ Token Firebase JWT invalide:', firebaseError.message);
                res.status(401).json({
                    success: false,
                    error: 'Token Firebase invalide ou expiré',
                    code: 'INVALID_TOKEN'
                });
                return;
            }
        }
        else if (isLocalToken) {
            // ===== TOKEN LOCAL: Format local_{id_user}_{timestamp} =====
            console.log('📴 Token local détecté - Vérification dans PostgreSQL...');
            const parts = token.split('_');
            if (parts.length >= 2) {
                const userId = parseInt(parts[1]);
                user = await userService_1.default.findById(userId);
            }
            if (!user) {
                res.status(401).json({
                    success: false,
                    error: 'Session locale expirée. Veuillez vous reconnecter.',
                    code: 'LOCAL_SESSION_EXPIRED'
                });
                return;
            }
        }
        else {
            // ===== FIREBASE UID: Rechercher dans le cache PostgreSQL =====
            console.log('🔑 Firebase UID détecté - Vérification dans PostgreSQL...');
            user = await userService_1.default.findByFirebaseUid(token);
            if (!user) {
                res.status(401).json({
                    success: false,
                    error: 'Session non trouvée. Veuillez vous reconnecter.',
                    code: 'SESSION_NOT_FOUND'
                });
                return;
            }
        }
        if (!user) {
            res.status(401).json({
                success: false,
                error: 'Utilisateur non trouvé',
                code: 'USER_NOT_FOUND'
            });
            return;
        }
        // Vérifier si l'utilisateur est bloqué
        if (user.est_bloque) {
            res.status(403).json({
                success: false,
                error: 'Votre compte est bloqué',
                code: 'ACCOUNT_BLOCKED'
            });
            return;
        }
        // Ajouter l'utilisateur à la requête
        req.user = {
            id: user.id_user,
            firebase_uid: user.firebase_uid,
            email: user.email,
            display_name: user.display_name || '',
            type_user: user.id_type_user,
            est_bloque: user.est_bloque
        };
        req.isOnline = isOnline;
        req.dataMode = isOnline ? 'firebase' : 'postgres';
        next();
    }
    catch (error) {
        console.error('Erreur middleware auth:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur d\'authentification',
            code: 'AUTH_ERROR'
        });
    }
}
/**
 * Middleware pour vérifier si l'utilisateur est un Manager (type 3)
 */
async function managerMiddleware(req, res, next) {
    try {
        if (!req.user) {
            res.status(401).json({
                success: false,
                error: 'Non authentifié',
                code: 'NOT_AUTHENTICATED'
            });
            return;
        }
        // Type 3 = Manager
        if (req.user.type_user !== 3) {
            res.status(403).json({
                success: false,
                error: 'Accès réservé aux managers',
                code: 'MANAGER_ONLY'
            });
            return;
        }
        next();
    }
    catch (error) {
        console.error('Erreur middleware manager:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur de vérification des droits'
        });
    }
}
/**
 * Middleware pour vérifier si l'utilisateur est au moins un Utilisateur (type 2 ou 3)
 */
async function userMiddleware(req, res, next) {
    try {
        if (!req.user) {
            res.status(401).json({
                success: false,
                error: 'Non authentifié',
                code: 'NOT_AUTHENTICATED'
            });
            return;
        }
        // Type 2 = Utilisateur, Type 3 = Manager
        if (req.user.type_user < 2) {
            res.status(403).json({
                success: false,
                error: 'Accès réservé aux utilisateurs enregistrés',
                code: 'USER_ONLY'
            });
            return;
        }
        next();
    }
    catch (error) {
        console.error('Erreur middleware user:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur de vérification des droits'
        });
    }
}
/**
 * Middleware optionnel - ajoute l'utilisateur si un token est présent mais ne bloque pas
 * Supporte les mêmes types de tokens que authMiddleware
 */
async function optionalAuthMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '');
            const isOnline = await hybridDataService_1.hybridDataService.isFirebaseAvailable();
            // Détecter le type de token
            const isLocalToken = token.startsWith('local_');
            const isFirebaseIdToken = token.length > 100 && token.includes('.');
            let user = null;
            if (isOnline && isFirebaseIdToken) {
                // Token JWT Firebase
                try {
                    const auth = (0, firebase_1.getAuth)();
                    const decodedToken = await auth.verifyIdToken(token);
                    user = await userService_1.default.findByFirebaseUid(decodedToken.uid);
                    if (user) {
                        req.firebaseUser = {
                            uid: decodedToken.uid,
                            email: decodedToken.email || '',
                            name: decodedToken.name
                        };
                    }
                }
                catch (error) {
                    // Token invalide, continuer sans authentification
                }
            }
            else if (isLocalToken) {
                // Token local
                const parts = token.split('_');
                if (parts.length >= 2) {
                    const userId = parseInt(parts[1]);
                    user = await userService_1.default.findById(userId);
                }
            }
            else {
                // Firebase UID
                user = await userService_1.default.findByFirebaseUid(token);
            }
            if (user && !user.est_bloque) {
                req.user = {
                    id: user.id_user,
                    firebase_uid: user.firebase_uid,
                    email: user.email,
                    display_name: user.display_name || '',
                    type_user: user.id_type_user,
                    est_bloque: user.est_bloque
                };
                req.isOnline = isOnline;
                req.dataMode = isOnline ? 'firebase' : 'postgres';
            }
        }
        next();
    }
    catch (error) {
        // En cas d'erreur, continuer sans authentification
        console.warn('Erreur middleware optionalAuth:', error.message);
        next();
    }
}
exports.default = {
    authMiddleware,
    managerMiddleware,
    userMiddleware,
    optionalAuthMiddleware
};
//# sourceMappingURL=auth.js.map