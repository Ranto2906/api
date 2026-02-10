export interface TentativeConnexion {
    id_tentative: number;
    email: string;
    ip_address?: string;
    succes: boolean;
    date_tentative: Date;
    raison_echec?: string;
}
export interface Parametre {
    id_parametre: number;
    nom: string;
    valeur: string;
    type: string;
    description?: string;
    date_modification: Date;
}
/**
 * Service de gestion des tentatives de connexion et des paramètres
 * Synchronisé entre PostgreSQL (local) et Firebase
 */
export declare class LoginAttemptService {
    /**
     * Enregistre une tentative de connexion (PostgreSQL + Firebase)
     */
    static recordAttempt(email: string, success: boolean, ip?: string, raisonEchec?: string): Promise<void>;
    /**
     * Obtient le nombre de tentatives échouées récentes pour un email
     */
    static getRecentFailedAttempts(email: string, minutes?: number): Promise<number>;
    /**
     * Obtient la limite de tentatives depuis les paramètres
     */
    static getAttemptLimit(): Promise<number>;
    /**
     * Vérifie si un email doit être bloqué (trop de tentatives)
     */
    static shouldBlockEmail(email: string): Promise<boolean>;
    /**
     * Vérifie le blocage avec les paramètres
     * Retourne aussi si l'utilisateur est un manager (non bloçable)
     */
    static checkBlocking(email: string): Promise<{
        isBlocked: boolean;
        isManager: boolean;
        isPermanentlyBlocked: boolean;
        attempts: number;
        maxAttempts: number;
        remainingAttempts: number;
    }>;
    /**
     * Bloque automatiquement un utilisateur après trop de tentatives
     * Note: Les managers (type 3) ne peuvent pas être bloqués automatiquement
     * @returns true si l'utilisateur a été bloqué, false sinon (manager ou utilisateur introuvable)
     */
    static autoBlockUserIfNeeded(email: string): Promise<{
        blocked: boolean;
        reason: string;
    }>;
    /**
     * Réinitialise les tentatives de connexion pour un email
     */
    static resetAttempts(email: string): Promise<void>;
    /**
     * Obtient l'historique des tentatives pour un email
     */
    static getAttemptHistory(email: string, limit?: number): Promise<TentativeConnexion[]>;
    /**
     * Obtient toutes les tentatives récentes (pour admin)
     */
    static getAllRecentAttempts(hours?: number): Promise<TentativeConnexion[]>;
    /**
     * Nettoie les anciennes tentatives
     */
    static cleanOldAttempts(days?: number): Promise<number>;
    /**
     * Obtient un paramètre par son nom
     */
    static getParameter(nom: string): Promise<Parametre | null>;
    /**
     * Obtient la valeur d'un paramètre avec valeur par défaut
     */
    static getParameterValue(nom: string, defaultValue: number): Promise<number>;
    /**
     * Obtient la valeur string d'un paramètre
     */
    static getParameterString(nom: string, defaultValue?: string): Promise<string>;
    /**
     * Obtient la valeur boolean d'un paramètre
     */
    static getParameterBoolean(nom: string, defaultValue?: boolean): Promise<boolean>;
    /**
     * Met à jour un paramètre (PostgreSQL + Firebase)
     */
    static setParameter(nom: string, valeur: string): Promise<void>;
    /**
     * Obtient tous les paramètres
     */
    static getAllParameters(): Promise<Parametre[]>;
    /**
     * Crée ou met à jour un paramètre (PostgreSQL + Firebase)
     */
    static upsertParameter(nom: string, valeur: string, type?: string, description?: string): Promise<void>;
    /**
     * Synchronise tous les paramètres de PostgreSQL vers Firebase
     */
    static syncAllParametersToFirebase(): Promise<void>;
    /**
     * Synchronise les paramètres de Firebase vers PostgreSQL (cache local)
     */
    static syncParametersFromFirebase(): Promise<void>;
    /**
     * Synchronise les tentatives de connexion récentes vers Firebase
     */
    static syncRecentAttemptsToFirebase(hours?: number): Promise<void>;
}
export default LoginAttemptService;
//# sourceMappingURL=loginAttemptService.d.ts.map