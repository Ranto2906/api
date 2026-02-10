import pool, { query } from '../config/database';
import { hybridDataService } from './hybridDataService';
import { getFirestore } from '../config/firebase';
import UserService from './userService';
import * as admin from 'firebase-admin';

// ============================================
// INTERFACES
// ============================================

export interface SignalementLocation {
    latitude: number;
    longitude: number;
}

export interface Signalement {
    id_signalement: number;
    location: SignalementLocation | null;
    description?: string;
    niveau?: number | null;
    date_signalement: Date;
    firebase_id?: string;
    est_synchronise: boolean;
    id_user: number;
    id_status: number;
}

export interface CreateSignalementDTO {
    latitude: number;
    longitude: number;
    description?: string;
    firebase_uid: string;
}

export interface UpdateSignalementDTO {
    description?: string;
    latitude?: number;
    longitude?: number;
}

export interface SignalementWithDetails extends Signalement {
    status_libelle?: string;
    status_couleur?: string;
    user_display_name?: string;
    user_email?: string;
    reparation?: {
        id_reparation: number;
        surface_m2: number;
        budget: number;
        date_debut?: Date;
        date_fin_prevue?: Date;
        date_fin_reelle?: Date;
        commentaire?: string;
        entreprise_nom?: string;
        entreprise_tel?: string;
    } | null;
}

// ============================================
// SERVICE SIGNALEMENT (SIMPLIFIÉ)
// ============================================

export class SignalementService {

    /**
     * Synchronise un signalement vers Firebase
     */
    static async syncToFirebase(signalementId: number): Promise<boolean> {
        const isOnline = await hybridDataService.isFirebaseAvailable();
        if (!isOnline) {
            console.log('💾 Mode hors ligne : signalement mis à jour localement (à synchroniser)');
            return false;
        }

        try {
            const db = getFirestore();

            // Récupérer les données complètes du signalement
            const result = await query(`
                SELECT 
                    s.id_signalement, s.firebase_id,
                    ST_X(s.location) as longitude, ST_Y(s.location) as latitude,
                    s.description, s.date_signalement,
                    u.id_user, u.display_name, u.email, u.firebase_uid,
                    st.id_status, st.libelle as status_libelle, st.couleur as status_couleur
                FROM Signalement s
                JOIN User_ u ON s.id_user = u.id_user
                JOIN Status st ON s.id_status = st.id_status
                WHERE s.id_signalement = $1
            `, [signalementId]);

            if (result.rows.length === 0) {
                console.warn(`⚠️ Signalement ${signalementId} non trouvé`);
                return false;
            }

            const row = result.rows[0];
            const firebaseId = row.firebase_id || row.id_signalement.toString();
            const docRef = db.collection('signalements').doc(firebaseId);

            const signalementData = {
                postgres_id: row.id_signalement,
                location: new admin.firestore.GeoPoint(row.latitude || 0, row.longitude || 0),
                description: row.description,
                date_signalement: row.date_signalement,
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
                firebase_uid: row.firebase_uid,
                user: {
                    id_user: row.id_user,
                    display_name: row.display_name,
                    email: row.email
                },
                status: {
                    id_status: row.id_status,
                    libelle: row.status_libelle,
                    couleur: row.status_couleur
                },
                sync_version: admin.firestore.FieldValue.increment(1)
            };

            const docSnap = await docRef.get();
            if (docSnap.exists) {
                await docRef.update(signalementData);
                console.log(`✅ Signalement ${signalementId} mis à jour dans Firebase (doc: ${firebaseId})`);
            } else {
                await docRef.set({
                    ...signalementData,
                    created_at: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`✅ Signalement ${signalementId} créé dans Firebase (doc: ${firebaseId})`);
            }

            // Mettre à jour le firebase_id si nécessaire et marquer comme synchronisé
            await query(
                'UPDATE Signalement SET firebase_id = $1, est_synchronise = TRUE, derniere_sync = CURRENT_TIMESTAMP WHERE id_signalement = $2',
                [firebaseId, signalementId]
            );

            return true;
        } catch (error) {
            console.warn('⚠️ Erreur sync signalement Firebase:', (error as Error).message);
            return false;
        }
    }

    /**
     * Crée un nouveau signalement
     */
    static async create(data: CreateSignalementDTO): Promise<Signalement> {
        const isOnline = await hybridDataService.isFirebaseAvailable();

        // Récupérer l'utilisateur
        const user = await UserService.findByFirebaseUid(data.firebase_uid);
        if (!user) {
            throw new Error('Utilisateur non trouvé avec ce firebase_uid');
        }

        // Récupérer le status par défaut
        const statusResult = await query(
            'SELECT id_status, libelle, couleur FROM Status WHERE id_status = 1'
        );
        const status = statusResult.rows[0] || { id_status: 1, libelle: 'Nouveau', couleur: '#2196f3' };

        // Créer dans PostgreSQL
        const result = await query(
            `INSERT INTO Signalement (location, description, id_user, id_status, est_synchronise, derniere_sync)
             VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, $4, 1, $5, NOW())
             RETURNING id_signalement, ST_X(location) as longitude, ST_Y(location) as latitude,
                       description, date_signalement, firebase_id, est_synchronise, id_user, id_status`,
            [data.longitude, data.latitude, data.description || null, user.id_user, isOnline]
        );

        const signalement = this.mapRowToSignalement(result.rows[0]);

        // Si online, créer dans Firebase
        if (isOnline) {
            try {
                const db = getFirestore();
                const docRef = await db.collection('signalements').add({
                    postgres_id: signalement.id_signalement,
                    location: new admin.firestore.GeoPoint(data.latitude, data.longitude),
                    description: data.description || null,
                    date_signalement: admin.firestore.FieldValue.serverTimestamp(),
                    updated_at: admin.firestore.FieldValue.serverTimestamp(),
                    user: {
                        id_user: user.id_user,
                        display_name: user.display_name || null,
                        email: user.email
                    },
                    status: {
                        id_status: status.id_status,
                        libelle: status.libelle,
                        couleur: status.couleur
                    },
                    sync_version: 1
                });

                await query(
                    'UPDATE Signalement SET firebase_id = $1, est_synchronise = TRUE WHERE id_signalement = $2',
                    [docRef.id, signalement.id_signalement]
                );

                signalement.firebase_id = docRef.id;
                signalement.est_synchronise = true;
                console.log(`✅ Signalement créé: PG(${signalement.id_signalement}) + Firebase(${docRef.id})`);
            } catch (error) {
                console.warn('⚠️ Erreur Firebase (PostgreSQL OK):', (error as Error).message);
            }
        } else {
            console.log(`💾 Signalement créé offline: PG(${signalement.id_signalement})`);
        }

        return signalement;
    }

    /**
     * Récupère tous les signalements avec leurs détails
     */
    static async findAll(filters?: {
        status?: number;
        userId?: number;
        dateDebut?: string;
        dateFin?: string;
    }): Promise<SignalementWithDetails[]> {
        let queryText = `
            SELECT 
                s.id_signalement,
                ST_X(s.location) as longitude,
                ST_Y(s.location) as latitude,
                s.description,
                s.niveau,
                s.date_signalement,
                s.firebase_id,
                s.est_synchronise,
                s.id_user,
                s.id_status,
                st.libelle as status_libelle,
                st.couleur as status_couleur,
                u.display_name as user_display_name,
                u.email as user_email,
                r.id_reparation,
                r.surface_m2,
                r.budget,
                r.date_debut,
                r.date_fin_prevue,
                r.date_fin_reelle,
                r.commentaire as reparation_commentaire,
                e.nom as entreprise_nom,
                e.telephone as entreprise_tel
            FROM Signalement s
            JOIN Status st ON s.id_status = st.id_status
            JOIN User_ u ON s.id_user = u.id_user
            LEFT JOIN Reparation r ON s.id_signalement = r.id_signalement
            LEFT JOIN Entreprise e ON r.id_entreprise = e.id_entreprise
            WHERE 1=1
        `;

        const params: any[] = [];
        let paramIndex = 1;

        if (filters?.status) {
            queryText += ` AND s.id_status = $${paramIndex++}`;
            params.push(filters.status);
        }
        if (filters?.userId) {
            queryText += ` AND s.id_user = $${paramIndex++}`;
            params.push(filters.userId);
        }
        if (filters?.dateDebut) {
            queryText += ` AND s.date_signalement >= $${paramIndex++}`;
            params.push(filters.dateDebut);
        }
        if (filters?.dateFin) {
            queryText += ` AND s.date_signalement <= $${paramIndex++}`;
            params.push(filters.dateFin);
        }

        queryText += ' ORDER BY s.date_signalement DESC';

        const result = await query(queryText, params);
        return result.rows.map(row => this.mapRowToSignalementWithDetails(row));
    }

    /**
     * Récupère un signalement par son ID
     */
    static async findById(id: number): Promise<SignalementWithDetails | null> {
        const result = await query(
            `SELECT 
                s.id_signalement,
                ST_X(s.location) as longitude,
                ST_Y(s.location) as latitude,
                s.description,
                s.niveau,
                s.date_signalement,
                s.firebase_id,
                s.est_synchronise,
                s.id_user,
                s.id_status,
                st.libelle as status_libelle,
                st.couleur as status_couleur,
                u.display_name as user_display_name,
                u.email as user_email,
                r.id_reparation,
                r.surface_m2,
                r.budget,
                r.date_debut,
                r.date_fin_prevue,
                r.date_fin_reelle,
                r.commentaire as reparation_commentaire,
                e.nom as entreprise_nom,
                e.telephone as entreprise_tel
            FROM Signalement s
            JOIN Status st ON s.id_status = st.id_status
            JOIN User_ u ON s.id_user = u.id_user
            LEFT JOIN Reparation r ON s.id_signalement = r.id_signalement
            LEFT JOIN Entreprise e ON r.id_entreprise = e.id_entreprise
            WHERE s.id_signalement = $1`,
            [id]
        );

        return result.rows.length > 0 ? this.mapRowToSignalementWithDetails(result.rows[0]) : null;
    }

    /**
     * Récupère les signalements d'un utilisateur
     */
    static async findByUserId(userId: number): Promise<SignalementWithDetails[]> {
        return this.findAll({ userId });
    }

    /**
     * Met à jour un signalement
     */
    static async update(id: number, userId: number, data: UpdateSignalementDTO): Promise<Signalement | null> {
        // Vérifier propriété et modifiabilité
        const checkResult = await query(
            `SELECT s.id_signalement, s.id_user, s.id_status, st.libelle as status_libelle
             FROM Signalement s
             JOIN Status st ON s.id_status = st.id_status
             WHERE s.id_signalement = $1`,
            [id]
        );

        if (checkResult.rows.length === 0) return null;

        const existing = checkResult.rows[0];
        if (existing.id_user !== userId) {
            throw new Error('UNAUTHORIZED: Vous ne pouvez modifier que vos propres signalements');
        }
        if (existing.status_libelle?.toLowerCase() !== 'nouveau') {
            throw new Error('LOCKED: Ce signalement ne peut plus être modifié');
        }

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (data.description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            values.push(data.description);
        }
        if (data.latitude !== undefined && data.longitude !== undefined) {
            updates.push(`location = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
            values.push(data.longitude, data.latitude);
            paramIndex += 2;
        }

        if (updates.length === 0) {
            return this.findById(id);
        }

        updates.push('est_synchronise = FALSE', 'derniere_sync = NOW()');
        values.push(id);

        const result = await query(
            `UPDATE Signalement SET ${updates.join(', ')} 
             WHERE id_signalement = $${paramIndex}
             RETURNING id_signalement, ST_X(location) as longitude, ST_Y(location) as latitude,
                       description, date_signalement, firebase_id, est_synchronise, id_user, id_status`,
            values
        );

        const signalement = this.mapRowToSignalement(result.rows[0]);

        // Synchroniser vers Firebase
        await this.syncToFirebase(id);

        return signalement;
    }

    /**
     * Supprime un signalement
     */
    static async delete(id: number, userId: number): Promise<boolean> {
        const checkResult = await query(
            `SELECT s.id_signalement, s.id_user, s.firebase_id, st.libelle
             FROM Signalement s
             JOIN Status st ON s.id_status = st.id_status
             WHERE s.id_signalement = $1`,
            [id]
        );

        if (checkResult.rows.length === 0) return false;

        const existing = checkResult.rows[0];
        if (existing.id_user !== userId) {
            throw new Error('UNAUTHORIZED: Vous ne pouvez supprimer que vos propres signalements');
        }
        if (existing.libelle?.toLowerCase() !== 'nouveau') {
            throw new Error('LOCKED: Ce signalement ne peut plus être supprimé');
        }

        // Supprimer de Firebase si possible
        if (existing.firebase_id) {
            try {
                const isOnline = await hybridDataService.isFirebaseAvailable();
                if (isOnline) {
                    await getFirestore().collection('signalements').doc(existing.firebase_id).delete();
                }
            } catch (error) {
                console.warn('⚠️ Erreur suppression Firebase:', (error as Error).message);
            }
        }

        await query('DELETE FROM Signalement WHERE id_signalement = $1', [id]);
        return true;
    }

    /**
     * Récupère les statistiques
     */
    static async getStats(): Promise<{
        total: number;
        par_status: { libelle: string; count: number; couleur: string }[];
        surface_totale: number;
        budget_total: number;
        avancement_pct: number;
    }> {
        const statsResult = await query(`
            SELECT 
                (SELECT COUNT(*) FROM Signalement) as total,
                (SELECT COALESCE(SUM(surface_m2), 0) FROM Reparation) as surface_totale,
                (SELECT COALESCE(SUM(budget), 0) FROM Reparation) as budget_total,
                (SELECT 
                    CASE WHEN COUNT(*) = 0 THEN 0
                    ELSE ROUND((COUNT(CASE WHEN date_fin_reelle IS NOT NULL THEN 1 END)::DECIMAL / COUNT(*)) * 100, 2)
                    END
                FROM Reparation) as avancement_pct
        `);

        const statusResult = await query(`
            SELECT st.libelle, st.couleur, COUNT(s.id_signalement) as count
            FROM Status st
            LEFT JOIN Signalement s ON st.id_status = s.id_status
            GROUP BY st.id_status, st.libelle, st.couleur
            ORDER BY st.id_status
        `);

        const stats = statsResult.rows[0];
        return {
            total: parseInt(stats.total),
            par_status: statusResult.rows.map(row => ({
                libelle: row.libelle,
                count: parseInt(row.count),
                couleur: row.couleur
            })),
            surface_totale: parseFloat(stats.surface_totale),
            budget_total: parseFloat(stats.budget_total),
            avancement_pct: parseFloat(stats.avancement_pct)
        };
    }

    /**
     * Récupère les signalements non synchronisés
     */
    static async getPendingSync(): Promise<Signalement[]> {
        const result = await query(
            `SELECT id_signalement, ST_X(location) as longitude, ST_Y(location) as latitude,
                    description, date_signalement, firebase_id, est_synchronise, id_user, id_status
             FROM Signalement WHERE est_synchronise = FALSE
             ORDER BY date_signalement ASC`
        );
        return result.rows.map(row => this.mapRowToSignalement(row));
    }

    // ============================================
    // HELPERS
    // ============================================

    private static mapRowToSignalement(row: any): Signalement {
        return {
            id_signalement: row.id_signalement,
            location: row.longitude && row.latitude ? {
                latitude: parseFloat(row.latitude),
                longitude: parseFloat(row.longitude)
            } : null,
            description: row.description,
            niveau: row.niveau || null,
            date_signalement: row.date_signalement,
            firebase_id: row.firebase_id,
            est_synchronise: row.est_synchronise,
            id_user: row.id_user,
            id_status: row.id_status
        };
    }

    private static mapRowToSignalementWithDetails(row: any): SignalementWithDetails {
        return {
            ...this.mapRowToSignalement(row),
            status_libelle: row.status_libelle,
            status_couleur: row.status_couleur,
            user_display_name: row.user_display_name,
            user_email: row.user_email,
            reparation: row.id_reparation ? {
                id_reparation: row.id_reparation,
                surface_m2: parseFloat(row.surface_m2),
                budget: parseFloat(row.budget),
                date_debut: row.date_debut,
                date_fin_prevue: row.date_fin_prevue,
                date_fin_reelle: row.date_fin_reelle,
                commentaire: row.reparation_commentaire,
                entreprise_nom: row.entreprise_nom,
                entreprise_tel: row.entreprise_tel
            } : null
        };
    }
}

export default SignalementService;
