import { query } from '../config/database';
// Service utilisateur pour Firebase Auth + PostgreSQL (cache local avec mot de passe)

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
  password: string;  // Mot de passe en clair pour mode hors ligne
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
export class UserService {

  /**
   * Crée un utilisateur localement (mode hors ligne ou inscription)
   */
  static async create(userData: CreateUserDTO): Promise<User> {
    const result = await query(
      `INSERT INTO user_ (email, password, display_name, id_type_user, date_creation, derniere_sync, est_bloque)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), FALSE)
       RETURNING id_user, firebase_uid, email, password, display_name, date_creation, derniere_sync, est_bloque, id_type_user`,
      [
        userData.email,
        userData.password,
        userData.display_name || null,
        userData.type_user || 2
      ]
    );

    console.log(`✅ Utilisateur créé localement: ${userData.email}`);
    return result.rows[0];
  }

  /**
   * Synchronise un utilisateur depuis Firebase vers PostgreSQL (cache local)
   * Inclut le mot de passe pour permettre la connexion hors ligne
   */
  static async syncFromFirebase(userData: SyncUserDTO): Promise<User> {
    const result = await query(
      `INSERT INTO user_ (firebase_uid, email, password, display_name, id_type_user, date_creation, derniere_sync, est_bloque)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), FALSE)
       ON CONFLICT (email) 
       DO UPDATE SET 
         firebase_uid = COALESCE(EXCLUDED.firebase_uid, user_.firebase_uid),
         password = EXCLUDED.password,
         display_name = EXCLUDED.display_name,
         derniere_sync = NOW()
       RETURNING id_user, firebase_uid, email, password, display_name, date_creation, derniere_sync, est_bloque, id_type_user`,
      [
        userData.firebase_uid || null,
        userData.email,
        userData.password,
        userData.display_name || null,
        userData.type_user || 2
      ]
    );

    console.log(`✅ Utilisateur synchronisé: ${userData.email}`);
    return result.rows[0];
  }

  /**
   * Trouve un utilisateur par Firebase UID
   */
  static async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    const result = await query(
      `SELECT id_user, firebase_uid, email, password, display_name, date_creation, derniere_sync, est_bloque, id_type_user
       FROM user_ WHERE firebase_uid = $1`,
      [firebaseUid]
    );
    return result.rows[0] || null;
  }

  /**
   * Trouve un utilisateur par email (avec mot de passe pour vérification)
   */
  static async findByEmail(email: string): Promise<User | null> {
    const result = await query(
      `SELECT id_user, firebase_uid, email, password, display_name, date_creation, derniere_sync, est_bloque, id_type_user
       FROM user_ WHERE email = $1`,
      [email]
    );
    return result.rows[0] || null;
  }

  /**
   * Trouve un utilisateur par ID
   */
  static async findById(id: number): Promise<User | null> {
    const result = await query(
      `SELECT id_user, firebase_uid, email, password, display_name, date_creation, derniere_sync, est_bloque, id_type_user
       FROM user_ WHERE id_user = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Vérifie le mot de passe d'un utilisateur (comparaison en clair)
   */
  static async verifyPassword(email: string, password: string): Promise<User | null> {
    const user = await this.findByEmail(email);
    if (!user || !user.password) return null;

    // Comparaison directe (pas de hashage)
    if (user.password === password) {
      return user;
    }
    return null;
  }

  /**
   * Met à jour un utilisateur
   */
  static async update(id: number, userData: UpdateUserDTO): Promise<User | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (userData.display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(userData.display_name);
    }
    if (userData.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(userData.email);
    }
    if (userData.password !== undefined) {
      updates.push(`password = $${paramIndex++}`);
      values.push(userData.password);
    }
    if (userData.type_user !== undefined) {
      updates.push(`id_type_user = $${paramIndex++}`);
      values.push(userData.type_user);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push(`derniere_sync = NOW()`);

    values.push(id);
    const result = await query(
      `UPDATE user_ SET ${updates.join(', ')}
       WHERE id_user = $${paramIndex}
       RETURNING id_user, firebase_uid, email, password, display_name, date_creation, derniere_sync, est_bloque, id_type_user`,
      values
    );

    return result.rows[0] || null;
  }

  /**
   * Met à jour le Firebase UID d'un utilisateur (après première connexion en ligne)
   */
  static async updateFirebaseUid(email: string, firebaseUid: string): Promise<void> {
    await query(
      `UPDATE user_ SET firebase_uid = $1, derniere_sync = NOW() WHERE email = $2`,
      [firebaseUid, email]
    );
  }

  /**
   * Bloque un utilisateur
   * Note: Les managers (type 3) ne peuvent pas être bloqués
   */
  static async blockUser(id: number): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new Error('Utilisateur introuvable');
    }

    if (user.id_type_user === 3) {
      throw new Error('Les managers ne peuvent pas être bloqués');
    }

    await query(
      `UPDATE user_ SET est_bloque = TRUE, derniere_sync = NOW() WHERE id_user = $1 AND id_type_user != 3`,
      [id]
    );
  }

  /**
   * Bloque un utilisateur par Firebase UID
   */
  static async blockUserByFirebaseUid(firebaseUid: string): Promise<void> {
    const user = await this.findByFirebaseUid(firebaseUid);
    if (!user) {
      throw new Error('Utilisateur introuvable');
    }

    if (user.id_type_user === 3) {
      throw new Error('Les managers ne peuvent pas être bloqués');
    }

    await query(
      `UPDATE user_ SET est_bloque = TRUE, derniere_sync = NOW() WHERE firebase_uid = $1 AND id_type_user != 3`,
      [firebaseUid]
    );
  }

  /**
   * Débloque un utilisateur
   */
  static async unblockUser(id: number): Promise<void> {
    await query(
      `UPDATE user_ SET est_bloque = FALSE, derniere_sync = NOW() WHERE id_user = $1`,
      [id]
    );
  }

  /**
   * Débloque un utilisateur par Firebase UID
   */
  static async unblockUserByFirebaseUid(firebaseUid: string): Promise<void> {
    await query(
      `UPDATE user_ SET est_bloque = FALSE, derniere_sync = NOW() WHERE firebase_uid = $1`,
      [firebaseUid]
    );
  }

  /**
   * Liste tous les utilisateurs bloqués
   */
  static async getBlockedUsers(): Promise<User[]> {
    const result = await query(
      `SELECT id_user, firebase_uid, email, display_name, date_creation, derniere_sync, est_bloque, id_type_user
       FROM user_ WHERE est_bloque = TRUE`
    );
    return result.rows;
  }

  /**
   * Liste tous les utilisateurs
   */
  static async findAll(): Promise<User[]> {
    const result = await query(
      `SELECT u.id_user, u.firebase_uid, u.email, u.display_name, u.date_creation, u.derniere_sync, u.est_bloque, u.id_type_user, t.libelle as type_libelle
       FROM user_ u
       JOIN TypeUser t ON u.id_type_user = t.id_type_user
       ORDER BY u.date_creation DESC`
    );
    return result.rows;
  }

  /**
   * Supprime un utilisateur du cache local
   */
  static async deleteFromCache(firebaseUid: string): Promise<void> {
    await query(
      `DELETE FROM user_ WHERE firebase_uid = $1`,
      [firebaseUid]
    );
  }

  /**
   * Obtient les utilisateurs non synchronisés depuis un certain temps
   */
  static async getStaleUsers(hours: number = 24): Promise<User[]> {
    const result = await query(
      `SELECT id_user, firebase_uid, email, display_name, date_creation, derniere_sync, est_bloque, id_type_user
       FROM user_ 
       WHERE derniere_sync < NOW() - INTERVAL '${hours} hours'`
    );
    return result.rows;
  }
}

export default UserService;
