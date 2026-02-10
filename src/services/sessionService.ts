import { query } from '../config/database';
import { getFirestore } from '../config/firebase';
import { hybridDataService } from './hybridDataService';
import crypto from 'crypto';
import { LoginAttemptService } from './loginAttemptService';
import * as admin from 'firebase-admin';

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
export class SessionService {

  /**
   * Génère un token de session unique
   */
  static generateToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Génère un refresh token
   */
  static generateRefreshToken(): string {
    return crypto.randomBytes(96).toString('hex');
  }

  /**
   * Crée une nouvelle session pour un utilisateur (PostgreSQL + Firebase)
   */
  static async createSession(
    userId: number,
    token: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<Session> {
    // Récupérer la durée de session depuis les paramètres
    const durationHours = await LoginAttemptService.getParameterValue('session_expiration_heures', 24);
    const refreshToken = this.generateRefreshToken();

    // 1. Créer dans PostgreSQL
    const result = await query(
      `INSERT INTO Session (id_user, token, refresh_token, date_expiration, ip_address, user_agent)
       VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL, $5, $6)
       RETURNING id_session, id_user, token, refresh_token, date_creation, date_expiration, est_active, ip_address, user_agent`,
      [userId, token, refreshToken, durationHours, ipAddress || null, userAgent || null]
    );

    const session = result.rows[0];

    // 2. Synchroniser vers Firebase si disponible
    await this.syncSessionToFirebase(session);

    return session;
  }

  /**
   * Synchronise une session vers Firebase
   */
  private static async syncSessionToFirebase(session: Session): Promise<void> {
    const isOnline = await hybridDataService.isFirebaseAvailable();
    if (!isOnline) return;

    try {
      const db = getFirestore();
      await db.collection('Session').doc(session.id_session.toString()).set({
        id: session.id_session,
        id_user: session.id_user,
        token: session.token,
        refresh_token: session.refresh_token || null,
        date_creation: admin.firestore.Timestamp.fromDate(session.date_creation),
        date_expiration: admin.firestore.Timestamp.fromDate(session.date_expiration),
        est_active: session.est_active,
        ip_address: session.ip_address || null,
        user_agent: session.user_agent || null
      });
      console.log(`✅ Session ${session.id_session} synchronisée vers Firebase`);
    } catch (error: any) {
      console.warn('⚠️ Échec sync session vers Firebase:', error.message);
    }
  }

  /**
   * Vérifie et récupère une session par son token
   */
  static async getSessionByToken(token: string): Promise<Session | null> {
    const result = await query(
      `SELECT id_session, id_user, token, refresh_token, date_creation, date_expiration, est_active, ip_address, user_agent
       FROM Session
       WHERE token = $1 AND est_active = TRUE AND date_expiration > NOW()`,
      [token]
    );
    return result.rows[0] || null;
  }

  /**
   * Vérifie si une session est valide
   */
  static async isSessionValid(token: string): Promise<boolean> {
    const session = await this.getSessionByToken(token);
    return session !== null;
  }

  /**
   * Invalide/désactive une session (PostgreSQL + Firebase)
   */
  static async invalidateSession(token: string): Promise<void> {
    // 1. Récupérer l'ID de la session avant de l'invalider
    const sessionResult = await query(
      `SELECT id_session FROM Session WHERE token = $1`,
      [token]
    );

    // 2. Invalider dans PostgreSQL
    await query(
      `UPDATE Session SET est_active = FALSE WHERE token = $1`,
      [token]
    );

    // 3. Synchroniser vers Firebase
    if (sessionResult.rows[0]) {
      const isOnline = await hybridDataService.isFirebaseAvailable();
      if (isOnline) {
        try {
          const db = getFirestore();
          await db.collection('Session').doc(sessionResult.rows[0].id_session.toString()).update({
            est_active: false
          });
          console.log(`✅ Session ${sessionResult.rows[0].id_session} invalidée dans Firebase`);
        } catch (error: any) {
          console.warn('⚠️ Échec sync invalidation session:', error.message);
        }
      }
    }
  }

  /**
   * Désactive toutes les sessions d'un utilisateur (PostgreSQL + Firebase)
   */
  static async deactivateUserSessions(userId: number): Promise<void> {
    // 1. Récupérer les IDs des sessions à désactiver
    const sessionsResult = await query(
      `SELECT id_session FROM Session WHERE id_user = $1 AND est_active = TRUE`,
      [userId]
    );

    // 2. Désactiver dans PostgreSQL
    await query(
      `UPDATE Session SET est_active = FALSE WHERE id_user = $1`,
      [userId]
    );

    // 3. Synchroniser vers Firebase
    const isOnline = await hybridDataService.isFirebaseAvailable();
    if (isOnline && sessionsResult.rows.length > 0) {
      try {
        const db = getFirestore();
        const batch = db.batch();

        for (const session of sessionsResult.rows) {
          const ref = db.collection('Session').doc(session.id_session.toString());
          batch.update(ref, { est_active: false });
        }

        await batch.commit();
        console.log(`✅ ${sessionsResult.rows.length} sessions désactivées dans Firebase`);
      } catch (error: any) {
        console.warn('⚠️ Échec sync désactivation sessions:', error.message);
      }
    }
  }

  /**
   * Prolonge une session existante
   */
  static async extendSession(token: string): Promise<Session | null> {
    const durationHours = await LoginAttemptService.getParameterValue('session_expiration_heures', 24);

    const result = await query(
      `UPDATE Session 
       SET date_expiration = NOW() + ($1 || ' hours')::INTERVAL
       WHERE token = $2 AND est_active = TRUE
       RETURNING id_session, id_user, token, refresh_token, date_creation, date_expiration, est_active, ip_address, user_agent`,
      [durationHours, token]
    );
    return result.rows[0] || null;
  }

  /**
   * Rafraîchit une session avec le refresh token (PostgreSQL + Firebase)
   */
  static async refreshSession(refreshToken: string): Promise<Session | null> {
    const durationHours = await LoginAttemptService.getParameterValue('session_expiration_heures', 24);
    const newToken = this.generateToken();
    const newRefreshToken = this.generateRefreshToken();

    const result = await query(
      `UPDATE Session 
       SET token = $1, refresh_token = $2, date_expiration = NOW() + ($3 || ' hours')::INTERVAL
       WHERE refresh_token = $4 AND est_active = TRUE
       RETURNING id_session, id_user, token, refresh_token, date_creation, date_expiration, est_active, ip_address, user_agent`,
      [newToken, newRefreshToken, durationHours, refreshToken]
    );

    const session = result.rows[0] || null;

    // Synchroniser vers Firebase
    if (session) {
      await this.syncSessionToFirebase(session);
    }

    return session;
  }

  /**
   * Obtient les sessions actives d'un utilisateur
   */
  static async getUserActiveSessions(userId: number): Promise<Session[]> {
    const result = await query(
      `SELECT id_session, id_user, token, refresh_token, date_creation, date_expiration, est_active, ip_address, user_agent
       FROM Session
       WHERE id_user = $1 AND est_active = TRUE AND date_expiration > NOW()
       ORDER BY date_creation DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Nettoie les sessions expirées (PostgreSQL + Firebase)
   */
  static async cleanExpiredSessions(): Promise<number> {
    // 1. Récupérer les IDs des sessions à supprimer
    const toDelete = await query(
      `SELECT id_session FROM Session WHERE date_expiration < NOW() OR est_active = FALSE`
    );

    // 2. Supprimer dans PostgreSQL
    const result = await query(
      `DELETE FROM Session 
       WHERE date_expiration < NOW() OR est_active = FALSE`
    );

    // 3. Supprimer dans Firebase
    const isOnline = await hybridDataService.isFirebaseAvailable();
    if (isOnline && toDelete.rows.length > 0) {
      try {
        const db = getFirestore();
        const batch = db.batch();

        for (const session of toDelete.rows) {
          const ref = db.collection('Session').doc(session.id_session.toString());
          batch.delete(ref);
        }

        await batch.commit();
        console.log(`✅ ${toDelete.rows.length} sessions expirées supprimées de Firebase`);
      } catch (error: any) {
        console.warn('⚠️ Échec nettoyage sessions Firebase:', error.message);
      }
    }

    return result.rowCount || 0;
  }

  /**
   * Compte les sessions actives totales
   */
  static async countActiveSessions(): Promise<number> {
    const result = await query(
      `SELECT COUNT(*) as count FROM Session WHERE est_active = TRUE AND date_expiration > NOW()`
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Trouve une session par son token ou firebase_uid
   */
  static async findByTokenOrUid(tokenOrUid: string): Promise<Session | null> {
    // D'abord chercher par token exact
    let session = await this.getSessionByToken(tokenOrUid);

    if (!session) {
      // Chercher une session où le token contient le firebase_uid
      const result = await query(
        `SELECT id_session, id_user, token, refresh_token, date_creation, date_expiration, est_active, ip_address, user_agent
         FROM Session
         WHERE token = $1 AND est_active = TRUE AND date_expiration > NOW()`,
        [tokenOrUid]
      );
      session = result.rows[0] || null;
    }

    return session;
  }

  /**
   * Synchronise toutes les sessions actives vers Firebase
   */
  static async syncAllActiveSessionsToFirebase(): Promise<void> {
    const isOnline = await hybridDataService.isFirebaseAvailable();
    if (!isOnline) {
      console.log('⚠️ Firebase non disponible, synchronisation ignorée');
      return;
    }

    try {
      const db = getFirestore();
      const result = await query(
        `SELECT id_session, id_user, token, refresh_token, date_creation, date_expiration, est_active, ip_address, user_agent
         FROM Session
         WHERE est_active = TRUE AND date_expiration > NOW()`
      );

      const batch = db.batch();

      for (const session of result.rows) {
        const ref = db.collection('Session').doc(session.id_session.toString());
        batch.set(ref, {
          id: session.id_session,
          id_user: session.id_user,
          token: session.token,
          refresh_token: session.refresh_token || null,
          date_creation: admin.firestore.Timestamp.fromDate(session.date_creation),
          date_expiration: admin.firestore.Timestamp.fromDate(session.date_expiration),
          est_active: session.est_active,
          ip_address: session.ip_address || null,
          user_agent: session.user_agent || null
        });
      }

      await batch.commit();
      console.log(`✅ ${result.rows.length} sessions actives synchronisées vers Firebase`);
    } catch (error: any) {
      console.error('❌ Erreur sync sessions:', error.message);
    }
  }

  /**
   * Synchronise les sessions depuis Firebase vers PostgreSQL
   */
  static async syncSessionsFromFirebase(): Promise<void> {
    const isOnline = await hybridDataService.isFirebaseAvailable();
    if (!isOnline) return;

    try {
      const db = getFirestore();
      const snapshot = await db.collection('Session').get();

      for (const doc of snapshot.docs) {
        if (doc.id.startsWith('_')) continue; // Ignorer les placeholders

        const data = doc.data();
        await query(
          `INSERT INTO Session (id_session, id_user, token, refresh_token, date_creation, date_expiration, est_active, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id_session) DO UPDATE SET 
             token = EXCLUDED.token,
             refresh_token = EXCLUDED.refresh_token,
             date_expiration = EXCLUDED.date_expiration,
             est_active = EXCLUDED.est_active`,
          [
            data.id,
            data.id_user,
            data.token,
            data.refresh_token || null,
            data.date_creation?.toDate() || new Date(),
            data.date_expiration?.toDate() || new Date(),
            data.est_active,
            data.ip_address || null,
            data.user_agent || null
          ]
        );
      }
      console.log(`✅ ${snapshot.size} sessions synchronisées depuis Firebase`);
    } catch (error: any) {
      console.error('❌ Erreur sync sessions depuis Firebase:', error.message);
    }
  }
}

export default SessionService;
