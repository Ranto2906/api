import { Request, Response, NextFunction } from 'express';
import UserService from '../services/userService';
import { hybridDataService } from '../services/hybridDataService';
import { getAuth, getFirestore } from '../config/firebase';

// Firebase Auth REST API pour vérification de token
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';

// Étend l'interface Request pour inclure l'utilisateur
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        firebase_uid?: string;
        email: string;
        display_name: string;
        type_user: number;
        est_bloque: boolean;
      };
      firebaseUser?: {
        uid: string;
        email: string;
        name?: string;
      };
      dataMode?: 'firebase' | 'postgres';
      isOnline?: boolean;
    }
  }
}

/**
 * Middleware d'authentification hybride
 * Supporte 3 types de tokens:
 * 1. Firebase ID Token (JWT) - vérifié avec Firebase Admin SDK
 * 2. Firebase UID - recherché directement dans le cache PostgreSQL
 * 3. Token local (local_{id}_{timestamp}) - pour mode hors ligne
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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
    const isOnline = await hybridDataService.isFirebaseAvailable();

    let user: any = null;

    // Détecter le type de token
    const isLocalToken = token.startsWith('local_');
    const isFirebaseIdToken = token.length > 100 && token.includes('.'); // JWT format

    if (isOnline && isFirebaseIdToken) {
      // ===== TOKEN JWT FIREBASE: Vérifier avec Firebase Admin SDK =====
      try {
        const auth = getAuth();
        const decodedToken = await auth.verifyIdToken(token);

        req.firebaseUser = {
          uid: decodedToken.uid,
          email: decodedToken.email || '',
          name: decodedToken.name
        };

        console.log(`🔐 Token Firebase JWT vérifié pour: ${decodedToken.email}`);

        // Chercher l'utilisateur dans le cache local
        user = await UserService.findByFirebaseUid(decodedToken.uid);

        if (!user) {
          // Synchroniser depuis Firestore si pas en cache
          const db = getFirestore();
          const userDoc = await db.collection('users').doc(decodedToken.uid).get();

          if (userDoc.exists) {
            const userData = userDoc.data()!;
            user = await UserService.syncFromFirebase({
              firebase_uid: decodedToken.uid,
              email: decodedToken.email || '',
              password: userData.password || '',
              display_name: userData.display_name || decodedToken.name || '',
              type_user: userData.type_user || 2
            });
          }
        }
      } catch (firebaseError: any) {
        console.warn('⚠️ Token Firebase JWT invalide:', firebaseError.message);
        res.status(401).json({
          success: false,
          error: 'Token Firebase invalide ou expiré',
          code: 'INVALID_TOKEN'
        });
        return;
      }
    } else if (isLocalToken) {
      // ===== TOKEN LOCAL: Format local_{id_user}_{timestamp} =====
      console.log('📴 Token local détecté - Vérification dans PostgreSQL...');

      const parts = token.split('_');
      if (parts.length >= 2) {
        const userId = parseInt(parts[1]);
        user = await UserService.findById(userId);
      }

      if (!user) {
        res.status(401).json({
          success: false,
          error: 'Session locale expirée. Veuillez vous reconnecter.',
          code: 'LOCAL_SESSION_EXPIRED'
        });
        return;
      }
    } else {
      // ===== FIREBASE UID: Rechercher dans le cache PostgreSQL =====
      console.log('🔑 Firebase UID détecté - Vérification dans PostgreSQL...');

      user = await UserService.findByFirebaseUid(token);

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
  } catch (error: any) {
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
export async function managerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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
  } catch (error: any) {
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
export async function userMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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
  } catch (error: any) {
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
export async function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const isOnline = await hybridDataService.isFirebaseAvailable();

      // Détecter le type de token
      const isLocalToken = token.startsWith('local_');
      const isFirebaseIdToken = token.length > 100 && token.includes('.');

      let user: any = null;

      if (isOnline && isFirebaseIdToken) {
        // Token JWT Firebase
        try {
          const auth = getAuth();
          const decodedToken = await auth.verifyIdToken(token);
          user = await UserService.findByFirebaseUid(decodedToken.uid);

          if (user) {
            req.firebaseUser = {
              uid: decodedToken.uid,
              email: decodedToken.email || '',
              name: decodedToken.name
            };
          }
        } catch (error: any) {
          // Token invalide, continuer sans authentification
        }
      } else if (isLocalToken) {
        // Token local
        const parts = token.split('_');
        if (parts.length >= 2) {
          const userId = parseInt(parts[1]);
          user = await UserService.findById(userId);
        }
      } else {
        // Firebase UID
        user = await UserService.findByFirebaseUid(token);
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
  } catch (error: any) {
    // En cas d'erreur, continuer sans authentification
    console.warn('Erreur middleware optionalAuth:', error.message);
    next();
  }
}

export default {
  authMiddleware,
  managerMiddleware,
  userMiddleware,
  optionalAuthMiddleware
};
