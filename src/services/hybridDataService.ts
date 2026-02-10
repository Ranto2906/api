/**
 * Service hybride pour la gestion des données PostgreSQL/Firebase
 * Version simplifiée - délègue la synchronisation au SyncService
 */

import * as admin from 'firebase-admin';
import pool from '../config/database';
import { isFirebaseOnline, getFirebaseStatus } from '../config/firebase';
import { syncService } from './syncService';

// ============================================
// INTERFACES
// ============================================

export interface SignalementData {
    location?: { latitude: number; longitude: number };
    description?: string;
    user_id: number;
    status_id?: number;
}

// ============================================
// SERVICE HYBRIDE
// ============================================

export class HybridDataService {
    private static instance: HybridDataService;

    private constructor() { }

    public static getInstance(): HybridDataService {
        if (!HybridDataService.instance) {
            HybridDataService.instance = new HybridDataService();
        }
        return HybridDataService.instance;
    }

    // ============================================
    // ÉTAT DE LA CONNEXION
    // ============================================

    /**
     * Vérifie si Firebase est disponible (asynchrone)
     */
    public async isFirebaseAvailable(): Promise<boolean> {
        try {
            return await isFirebaseOnline();
        } catch {
            return false;
        }
    }

    /**
     * Vérifie si Firebase est disponible (synchrone, depuis le cache)
     */
    public isFirebaseAvailableSync(): boolean {
        return getFirebaseStatus().available;
    }

    /**
     * Retourne le statut complet de Firebase
     */
    public getStatus(): { initialized: boolean; available: boolean; lastCheck: number } {
        return getFirebaseStatus();
    }

    // ============================================
    // OPÉRATIONS SIGNALEMENTS
    // ============================================

    /**
     * Crée un signalement dans PostgreSQL (et optionnellement Firebase si en ligne)
     */
    public async createSignalement(data: SignalementData): Promise<{ id: string; source: 'firebase' | 'postgres' }> {
        const isOnline = await this.isFirebaseAvailable();

        // Créer dans PostgreSQL
        const query = `
            INSERT INTO Signalement (location, description, id_user, id_status, est_synchronise, derniere_sync)
            VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, $4, $5, $6, NOW())
            RETURNING id_signalement
        `;

        const values = [
            data.location?.longitude || null,
            data.location?.latitude || null,
            data.description || null,
            data.user_id,
            data.status_id || 1,
            isOnline
        ];

        const result = await pool.query(query, values);
        const postgresId = result.rows[0].id_signalement;

        // Si en ligne, créer aussi dans Firebase
        if (isOnline) {
            try {
                const db = admin.firestore();
                const docRef = await db.collection('signalements').add({
                    location: data.location
                        ? new admin.firestore.GeoPoint(data.location.latitude, data.location.longitude)
                        : null,
                    description: data.description,
                    id_user: data.user_id,
                    id_status: data.status_id || 1,
                    date_signalement: admin.firestore.FieldValue.serverTimestamp(),
                    postgres_id: postgresId
                });

                // Mettre à jour PostgreSQL avec le firebase_id
                await pool.query(
                    'UPDATE Signalement SET firebase_id = $1, est_synchronise = TRUE WHERE id_signalement = $2',
                    [docRef.id, postgresId]
                );

                console.log(`✅ Signalement créé: PostgreSQL(${postgresId}) + Firebase(${docRef.id})`);
            } catch (error) {
                console.warn('⚠️ Erreur Firebase (PostgreSQL OK):', (error as Error).message);
            }
        } else {
            console.log(`💾 Signalement créé en mode offline: PostgreSQL(${postgresId})`);
        }

        return { id: postgresId.toString(), source: 'postgres' };
    }

    /**
     * Récupère les signalements depuis PostgreSQL
     */
    public async getSignalements(): Promise<{ data: any[]; source: 'postgres' }> {
        const query = `
            SELECT 
                s.id_signalement as id,
                ST_X(s.location) as longitude,
                ST_Y(s.location) as latitude,
                s.description,
                s.date_signalement,
                s.firebase_id,
                s.est_synchronise,
                u.email,
                u.display_name,
                st.libelle as status
            FROM Signalement s
            JOIN User_ u ON s.id_user = u.id_user
            JOIN Status st ON s.id_status = st.id_status
            ORDER BY s.date_signalement DESC
        `;

        const result = await pool.query(query);
        const signalements = result.rows.map((row: any) => ({
            id: row.id,
            location: row.longitude && row.latitude ? {
                latitude: parseFloat(row.latitude),
                longitude: parseFloat(row.longitude)
            } : null,
            description: row.description,
            date_signalement: row.date_signalement,
            firebase_id: row.firebase_id,
            est_synchronise: row.est_synchronise,
            user: {
                email: row.email,
                display_name: row.display_name
            },
            status: row.status
        }));

        return { data: signalements, source: 'postgres' };
    }

    // ============================================
    // SYNCHRONISATION (DÉLÉGATION)
    // ============================================

    /**
     * Déclenche une synchronisation bidirectionnelle complète
     */
    public async syncAll() {
        return await syncService.syncBidirectional();
    }

    /**
     * Retourne les statistiques de synchronisation
     */
    public async getSyncStatistics() {
        return await syncService.getSyncStats();
    }

    /**
     * Active/désactive la synchronisation automatique
     */
    public setAutoSync(enabled: boolean): void {
        syncService.setAutoSync(enabled);
    }

    /**
     * Vérifie si la synchronisation automatique est activée
     */
    public isAutoSyncEnabled(): boolean {
        return syncService.isAutoSyncEnabled();
    }

    // ============================================
    // UTILITAIRES
    // ============================================

    /**
     * Compte les éléments en attente de synchronisation
     */
    public async getSyncStatus(): Promise<{
        pending_signalements: number;
        pending_reparations: number;
        needs_sync: boolean;
    }> {
        try {
            const [signalementResult, reparationResult] = await Promise.all([
                pool.query('SELECT COUNT(*) as count FROM Signalement WHERE est_synchronise = FALSE'),
                pool.query('SELECT COUNT(*) as count FROM Reparation WHERE est_synchronise = FALSE')
            ]);

            const pendingSignalements = parseInt(signalementResult.rows[0].count);
            const pendingReparations = parseInt(reparationResult.rows[0].count);

            return {
                pending_signalements: pendingSignalements,
                pending_reparations: pendingReparations,
                needs_sync: pendingSignalements > 0 || pendingReparations > 0
            };
        } catch (error) {
            console.error('Erreur lors de la vérification du statut de sync:', error);
            return {
                pending_signalements: 0,
                pending_reparations: 0,
                needs_sync: false
            };
        }
    }

    /**
     * Exécute une requête PostgreSQL directement
     */
    public async query(queryText: string, params?: any[]): Promise<any> {
        return await pool.query(queryText, params || []);
    }
}

export const hybridDataService = HybridDataService.getInstance();
