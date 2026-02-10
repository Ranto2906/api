export interface User {
    id_user: number;
    firebase_uid?: string;
    email: string;
    password?: string;
    display_name?: string;
    date_creation: Date;
    derniere_sync?: Date;
    est_bloque: boolean;
    id_type_user: number;
}
export interface SyncUserDTO {
    firebase_uid?: string;
    email: string;
    password: string;
    display_name?: string;
    type_user?: number;
}
export interface CreateUserDTO {
    email: string;
    password: string;
    display_name?: string;
    type_user?: number;
}
export interface UpdateUserDTO {
    display_name?: string;
    email?: string;
    password?: string;
    type_user?: number;
}
/**
 * Service de gestion des utilisateurs
 * Utilise Firebase Auth pour l'authentification en ligne
 * PostgreSQL sert de cache local pour le mode hors ligne (avec mot de passe)
 */
export declare class UserService {
    /**
     * Crée un utilisateur localement (mode hors ligne ou inscription)
     */
    static create(userData: CreateUserDTO): Promise<User>;
    /**
     * Synchronise un utilisateur depuis Firebase vers PostgreSQL (cache local)
     * Inclut le mot de passe pour permettre la connexion hors ligne
     */
    static syncFromFirebase(userData: SyncUserDTO): Promise<User>;
    /**
     * Trouve un utilisateur par Firebase UID
     */
    static findByFirebaseUid(firebaseUid: string): Promise<User | null>;
    /**
     * Trouve un utilisateur par email (avec mot de passe pour vérification)
     */
    static findByEmail(email: string): Promise<User | null>;
    /**
     * Trouve un utilisateur par ID
     */
    static findById(id: number): Promise<User | null>;
    /**
     * Vérifie le mot de passe d'un utilisateur (comparaison en clair)
     */
    static verifyPassword(email: string, password: string): Promise<User | null>;
    /**
     * Met à jour un utilisateur
     */
    static update(id: number, userData: UpdateUserDTO): Promise<User | null>;
    /**
     * Met à jour le Firebase UID d'un utilisateur (après première connexion en ligne)
     */
    static updateFirebaseUid(email: string, firebaseUid: string): Promise<void>;
    /**
     * Bloque un utilisateur
     * Note: Les managers (type 3) ne peuvent pas être bloqués
     */
    static blockUser(id: number): Promise<void>;
    /**
     * Bloque un utilisateur par Firebase UID
     */
    static blockUserByFirebaseUid(firebaseUid: string): Promise<void>;
    /**
     * Débloque un utilisateur
     */
    static unblockUser(id: number): Promise<void>;
    /**
     * Débloque un utilisateur par Firebase UID
     */
    static unblockUserByFirebaseUid(firebaseUid: string): Promise<void>;
    /**
     * Liste tous les utilisateurs bloqués
     */
    static getBlockedUsers(): Promise<User[]>;
    /**
     * Liste tous les utilisateurs
     */
    static findAll(): Promise<User[]>;
    /**
     * Supprime un utilisateur du cache local
     */
    static deleteFromCache(firebaseUid: string): Promise<void>;
    /**
     * Obtient les utilisateurs non synchronisés depuis un certain temps
     */
    static getStaleUsers(hours?: number): Promise<User[]>;
}
export default UserService;
//# sourceMappingURL=userService.d.ts.map