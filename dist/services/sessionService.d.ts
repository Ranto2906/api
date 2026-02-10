export interface Session {
    id_session: number;
    id_user: number;
    token: string;
    refresh_token?: string;
    date_creation: Date;
    date_expiration: Date;
    est_active: boolean;
    ip_address?: string;
    user_agent?: string;
}
/**
 * Service de gestion des sessions
 * Synchronisé entre PostgreSQL (local) et Firebase
 */
export declare class SessionService {
    /**
     * Génère un token de session unique
     */
    static generateToken(): string;
    /**
     * Génère un refresh token
     */
    static generateRefreshToken(): string;
    /**
     * Crée une nouvelle session pour un utilisateur (PostgreSQL + Firebase)
     */
    static createSession(userId: number, token: string, ipAddress?: string, userAgent?: string): Promise<Session>;
    /**
     * Synchronise une session vers Firebase
     */
    private static syncSessionToFirebase;
    /**
     * Vérifie et récupère une session par son token
     */
    static getSessionByToken(token: string): Promise<Session | null>;
    /**
     * Vérifie si une session est valide
     */
    static isSessionValid(token: string): Promise<boolean>;
    /**
     * Invalide/désactive une session (PostgreSQL + Firebase)
     */
    static invalidateSession(token: string): Promise<void>;
    /**
     * Désactive toutes les sessions d'un utilisateur (PostgreSQL + Firebase)
     */
    static deactivateUserSessions(userId: number): Promise<void>;
    /**
     * Prolonge une session existante
     */
    static extendSession(token: string): Promise<Session | null>;
    /**
     * Rafraîchit une session avec le refresh token (PostgreSQL + Firebase)
     */
    static refreshSession(refreshToken: string): Promise<Session | null>;
    /**
     * Obtient les sessions actives d'un utilisateur
     */
    static getUserActiveSessions(userId: number): Promise<Session[]>;
    /**
     * Nettoie les sessions expirées (PostgreSQL + Firebase)
     */
    static cleanExpiredSessions(): Promise<number>;
    /**
     * Compte les sessions actives totales
     */
    static countActiveSessions(): Promise<number>;
    /**
     * Trouve une session par son token ou firebase_uid
     */
    static findByTokenOrUid(tokenOrUid: string): Promise<Session | null>;
    /**
     * Synchronise toutes les sessions actives vers Firebase
     */
    static syncAllActiveSessionsToFirebase(): Promise<void>;
    /**
     * Synchronise les sessions depuis Firebase vers PostgreSQL
     */
    static syncSessionsFromFirebase(): Promise<void>;
}
export default SessionService;
//# sourceMappingURL=sessionService.d.ts.map