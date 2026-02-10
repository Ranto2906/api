import { Request, Response, NextFunction } from 'express';
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
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Middleware pour vérifier si l'utilisateur est un Manager (type 3)
 */
export declare function managerMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Middleware pour vérifier si l'utilisateur est au moins un Utilisateur (type 2 ou 3)
 */
export declare function userMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Middleware optionnel - ajoute l'utilisateur si un token est présent mais ne bloque pas
 * Supporte les mêmes types de tokens que authMiddleware
 */
export declare function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
declare const _default: {
    authMiddleware: typeof authMiddleware;
    managerMiddleware: typeof managerMiddleware;
    userMiddleware: typeof userMiddleware;
    optionalAuthMiddleware: typeof optionalAuthMiddleware;
};
export default _default;
//# sourceMappingURL=auth.d.ts.map