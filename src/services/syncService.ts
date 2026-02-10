/**
 * Service de synchronisation bidirectionnelle PostgreSQL ⟷ Firebase
 * Version unifiée et simplifiée
 * 
 * Collections Firebase supportées:
 * - users: Utilisateurs (synchro avec User_)
 * - signalements: Signalements de dégradations
 * - reparations: Réparations planifiées
 * - entreprises: Entreprises de travaux
 * - status: Statuts de référence
 */

import * as admin from 'firebase-admin';
import pool from '../config/database';
import { isFirebaseOnline } from '../config/firebase';

// ============================================
// INTERFACES
// ============================================

export interface SyncResult {
    synced: number;
    errors: number;
    skipped: number;
}

export interface SyncStats {
    firebaseToPostgres: {
        users: SyncResult;
        signalements: SyncResult;
        reparations: SyncResult;
        entreprises: SyncResult;
        status: SyncResult;
    };
    postgresToFirebase: {
        users: SyncResult;
        signalements: SyncResult;
        reparations: SyncResult;
        entreprises: SyncResult;
        status: SyncResult;
    };
    totals: {
        synced: number;
        skipped: number;
        errors: number;
    };
}

// ============================================
// SERVICE DE SYNCHRONISATION UNIFIÉ
// ============================================

export class SyncService {
    private static instance: SyncService;
    private syncInProgress: boolean = false;
    private lastSyncTimestamp: Date | null = null;
    private autoSyncEnabled: boolean = true;
    private firestoreListeners: Array<() => void> = [];

    private constructor() { }

    public static getInstance(): SyncService {
        if (!SyncService.instance) {
            SyncService.instance = new SyncService();
        }
        return SyncService.instance;
    }

    // ============================================
    // API PUBLIQUE
    // ============================================

    /**
     * Synchronisation bidirectionnelle complète
     */
    public async syncBidirectional(): Promise<SyncStats> {
        if (this.syncInProgress) {
            throw new Error('Synchronisation déjà en cours');
        }

        const isOnline = await isFirebaseOnline();
        if (!isOnline) {
            throw new Error('Firebase non disponible');
        }

        this.syncInProgress = true;
        console.log('🔄 SYNCHRONISATION BIDIRECTIONNELLE');
        console.log('====================================\n');

        const stats: SyncStats = {
            firebaseToPostgres: {
                users: { synced: 0, errors: 0, skipped: 0 },
                signalements: { synced: 0, errors: 0, skipped: 0 },
                reparations: { synced: 0, errors: 0, skipped: 0 },
                entreprises: { synced: 0, errors: 0, skipped: 0 },
                status: { synced: 0, errors: 0, skipped: 0 }
            },
            postgresToFirebase: {
                users: { synced: 0, errors: 0, skipped: 0 },
                signalements: { synced: 0, errors: 0, skipped: 0 },
                reparations: { synced: 0, errors: 0, skipped: 0 },
                entreprises: { synced: 0, errors: 0, skipped: 0 },
                status: { synced: 0, errors: 0, skipped: 0 }
            },
            totals: { synced: 0, skipped: 0, errors: 0 }
        };

        try {
            const db = admin.firestore();

            // Phase 1: Firebase → PostgreSQL
            console.log('═══════════════════════════════════════');
            console.log('📥 PHASE 1: Firebase → PostgreSQL');
            console.log('═══════════════════════════════════════');

            stats.firebaseToPostgres.users = await this.syncUsersFromFirebase(db);
            stats.firebaseToPostgres.status = await this.syncStatusFromFirebase(db);
            stats.firebaseToPostgres.entreprises = await this.syncEntreprisesFromFirebase(db);
            stats.firebaseToPostgres.signalements = await this.syncSignalementsFromFirebase(db);
            stats.firebaseToPostgres.reparations = await this.syncReparationsFromFirebase(db);

            // Phase 2: PostgreSQL → Firebase
            console.log('\n═══════════════════════════════════════');
            console.log('📤 PHASE 2: PostgreSQL → Firebase');
            console.log('═══════════════════════════════════════');

            stats.postgresToFirebase.users = await this.syncUsersToFirebase(db);
            stats.postgresToFirebase.status = await this.syncStatusToFirebase(db);
            stats.postgresToFirebase.entreprises = await this.syncEntreprisesToFirebase(db);
            stats.postgresToFirebase.signalements = await this.syncSignalementsToFirebase(db);
            stats.postgresToFirebase.reparations = await this.syncReparationsToFirebase(db);

            // Calcul des totaux
            const fbToPg = Object.values(stats.firebaseToPostgres).reduce((acc, r) => ({
                synced: acc.synced + r.synced,
                errors: acc.errors + r.errors,
                skipped: acc.skipped + r.skipped
            }), { synced: 0, errors: 0, skipped: 0 });

            const pgToFb = Object.values(stats.postgresToFirebase).reduce((acc, r) => ({
                synced: acc.synced + r.synced,
                errors: acc.errors + r.errors,
                skipped: acc.skipped + r.skipped
            }), { synced: 0, errors: 0, skipped: 0 });

            stats.totals = {
                synced: fbToPg.synced + pgToFb.synced,
                skipped: fbToPg.skipped + pgToFb.skipped,
                errors: fbToPg.errors + pgToFb.errors
            };

            this.lastSyncTimestamp = new Date();

            console.log('\n═══════════════════════════════════════');
            console.log('📊 RÉSUMÉ DE LA SYNCHRONISATION');
            console.log('═══════════════════════════════════════');
            console.log(`📥 Firebase → PostgreSQL: ${fbToPg.synced} sync, ${fbToPg.skipped} skip, ${fbToPg.errors} err`);
            console.log(`📤 PostgreSQL → Firebase: ${pgToFb.synced} sync, ${pgToFb.skipped} skip, ${pgToFb.errors} err`);
            console.log(`📈 TOTAL: ${stats.totals.synced} synchronisations effectuées`);
            console.log('\n✅ Synchronisation bidirectionnelle terminée !');

        } finally {
            this.syncInProgress = false;
        }

        return stats;
    }

    /**
     * Synchronisation PostgreSQL → Firebase uniquement
     */
    public async syncToFirebase(): Promise<SyncResult> {
        const isOnline = await isFirebaseOnline();
        if (!isOnline) throw new Error('Firebase non disponible');

        const db = admin.firestore();
        let total: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        const results = await Promise.all([
            this.syncUsersToFirebase(db),
            this.syncStatusToFirebase(db),
            this.syncEntreprisesToFirebase(db),
            this.syncSignalementsToFirebase(db),
            this.syncReparationsToFirebase(db)
        ]);

        results.forEach(r => {
            total.synced += r.synced;
            total.errors += r.errors;
            total.skipped += r.skipped;
        });

        return total;
    }

    /**
     * Synchronisation Firebase → PostgreSQL uniquement
     */
    public async syncFromFirebase(): Promise<SyncResult> {
        const isOnline = await isFirebaseOnline();
        if (!isOnline) throw new Error('Firebase non disponible');

        const db = admin.firestore();
        let total: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        const results = await Promise.all([
            this.syncUsersFromFirebase(db),
            this.syncStatusFromFirebase(db),
            this.syncEntreprisesFromFirebase(db),
            this.syncSignalementsFromFirebase(db),
            this.syncReparationsFromFirebase(db)
        ]);

        results.forEach(r => {
            total.synced += r.synced;
            total.errors += r.errors;
            total.skipped += r.skipped;
        });

        return total;
    }

    // ============================================
    // FIREBASE → POSTGRESQL
    // ============================================

    private async syncUsersFromFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n👤 Synchronisation Users: Firebase → PostgreSQL...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const snapshot = await db.collection('users').get();
            console.log(`  📥 ${snapshot.size} utilisateurs trouvés dans Firebase`);

            for (const doc of snapshot.docs) {
                try {
                    const data = doc.data();
                    const firebaseUid = doc.id;

                    const checkResult = await pool.query(
                        'SELECT id_user, derniere_sync FROM User_ WHERE firebase_uid = $1 OR email = $2',
                        [firebaseUid, data.email]
                    );

                    const firebaseTimestamp = data.derniere_sync?.toDate?.() || data.date_creation?.toDate?.() || new Date();

                    if (checkResult.rows.length > 0) {
                        const existing = checkResult.rows[0];
                        const postgresTimestamp = existing.derniere_sync ? new Date(existing.derniere_sync) : new Date(0);

                        if (firebaseTimestamp > postgresTimestamp) {
                            await pool.query(`
                                UPDATE User_ SET 
                                    firebase_uid = $1, email = $2, password = $3, display_name = $4,
                                    id_type_user = $5, est_bloque = $6, derniere_sync = NOW()
                                WHERE id_user = $7
                            `, [
                                firebaseUid, data.email, data.password || '',
                                data.display_name || '', data.id_type_user || 2,
                                data.est_bloque || false, existing.id_user
                            ]);
                            result.synced++;
                        } else {
                            result.skipped++;
                        }
                    } else {
                        await pool.query(`
                            INSERT INTO User_ (firebase_uid, email, password, display_name, id_type_user, est_bloque, date_creation, derniere_sync)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                        `, [
                            firebaseUid, data.email, data.password || '',
                            data.display_name || '', data.id_type_user || 2,
                            data.est_bloque || false,
                            data.date_creation?.toDate?.() || new Date()
                        ]);
                        result.synced++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync user ${doc.id}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération users Firebase:', error.message);
        }

        console.log(`  📊 Users Firebase→PG: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    private async syncSignalementsFromFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n📍 Synchronisation Signalements: Firebase → PostgreSQL...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const snapshot = await db.collection('signalements').get();
            console.log(`  📥 ${snapshot.size} signalements trouvés dans Firebase`);

            for (const doc of snapshot.docs) {
                try {
                    const data = doc.data();
                    const firebaseId = doc.id;

                    // Extraire les coordonnées depuis GeoPoint
                    // GeoPoint a les propriétés latitude et longitude (ou _latitude/_longitude)
                    let lat = 0, lng = 0;
                    if (data.location) {
                        // Format GeoPoint: { latitude, longitude } ou { _latitude, _longitude }
                        lat = data.location.latitude ?? data.location._latitude ?? 0;
                        lng = data.location.longitude ?? data.location._longitude ?? 0;
                    }

                    // Extraire l'ID utilisateur - supporte user.id et user.id_user
                    const userId = data.user?.id || data.user?.id_user || data.id_user || 1;

                    // Extraire l'ID status - supporte status.id et status.id_status
                    const statusId = data.status?.id || data.status?.id_status || data.id_status || 1;

                    const checkResult = await pool.query(
                        'SELECT id_signalement, derniere_sync FROM Signalement WHERE firebase_id = $1',
                        [firebaseId]
                    );

                    const firebaseTimestamp = data.updated_at?.toDate?.() || data.date_signalement?.toDate?.() || new Date();

                    if (checkResult.rows.length > 0) {
                        // UPDATE - signalement existe déjà
                        const existing = checkResult.rows[0];
                        const postgresTimestamp = existing.derniere_sync ? new Date(existing.derniere_sync) : new Date(0);

                        if (firebaseTimestamp > postgresTimestamp) {
                            await pool.query(`
                                UPDATE Signalement SET 
                                    location = ST_SetSRID(ST_MakePoint($1, $2), 4326),
                                    description = $3, id_status = $4,
                                    est_synchronise = TRUE, derniere_sync = NOW()
                                WHERE firebase_id = $5
                            `, [lng, lat, data.description, statusId, firebaseId]);

                            console.log(`  ✅ UPDATE signalement ${firebaseId} (PG: ${existing.id_signalement})`);
                            result.synced++;
                        } else {
                            result.skipped++;
                        }
                    } else {
                        // INSERT - nouveau signalement depuis Firebase
                        const insertResult = await pool.query(`
                            INSERT INTO Signalement (firebase_id, location, description, id_user, id_status, date_signalement, est_synchronise, derniere_sync)
                            VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6, $7, TRUE, NOW())
                            RETURNING id_signalement
                        `, [
                            firebaseId, lng, lat, data.description, userId, statusId,
                            data.date_signalement?.toDate?.() || new Date()
                        ]);

                        const newPostgresId = insertResult.rows[0].id_signalement;

                        // Mettre à jour Firebase avec l'id_signalement de PostgreSQL
                        await db.collection('signalements').doc(firebaseId).update({
                            id_signalement: newPostgresId,
                            est_synchronise: true
                        });

                        console.log(`  ✅ INSERT signalement ${firebaseId} → PG(${newPostgresId})`);
                        result.synced++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync signalement ${doc.id}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération signalements Firebase:', error.message);
        }

        console.log(`  📊 Signalements Firebase→PG: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    private async syncReparationsFromFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n🔧 Synchronisation Réparations: Firebase → PostgreSQL...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const snapshot = await db.collection('reparations').get();
            console.log(`  📥 ${snapshot.size} réparations trouvées dans Firebase`);

            for (const doc of snapshot.docs) {
                try {
                    const data = doc.data();
                    const firebaseId = doc.id;

                    const checkResult = await pool.query(
                        'SELECT id_reparation, derniere_sync FROM Reparation WHERE firebase_id = $1',
                        [firebaseId]
                    );

                    const firebaseTimestamp = data.updated_at?.toDate?.() || new Date();

                    if (checkResult.rows.length > 0) {
                        const existing = checkResult.rows[0];
                        const postgresTimestamp = existing.derniere_sync ? new Date(existing.derniere_sync) : new Date(0);

                        if (firebaseTimestamp > postgresTimestamp) {
                            await pool.query(`
                                UPDATE Reparation SET 
                                    surface_m2 = $1, budget = $2, date_debut = $3, date_fin_prevue = $4,
                                    date_fin_reelle = $5, commentaire = $6, id_status = $7, id_entreprise = $8,
                                    est_synchronise = TRUE, derniere_sync = NOW()
                                WHERE firebase_id = $9
                            `, [
                                data.surface_m2, data.budget,
                                data.date_debut?.toDate?.() || null,
                                data.date_fin_prevue?.toDate?.() || null,
                                data.date_fin_reelle?.toDate?.() || null,
                                data.commentaire, data.status?.id || data.id_status || 1,
                                data.id_entreprise, firebaseId
                            ]);
                            result.synced++;
                        } else {
                            result.skipped++;
                        }
                    } else if (data.id_signalement) {
                        await pool.query(`
                            INSERT INTO Reparation (firebase_id, surface_m2, budget, date_debut, date_fin_prevue,
                                date_fin_reelle, commentaire, id_signalement, id_entreprise, id_status, id_user,
                                date_creation, est_synchronise, derniere_sync)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, NOW())
                        `, [
                            firebaseId, data.surface_m2, data.budget,
                            data.date_debut?.toDate?.() || null,
                            data.date_fin_prevue?.toDate?.() || null,
                            data.date_fin_reelle?.toDate?.() || null,
                            data.commentaire, data.id_signalement, data.id_entreprise,
                            data.status?.id || data.id_status || 1, data.id_user || 1,
                            data.date_creation?.toDate?.() || new Date()
                        ]);
                        result.synced++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync réparation ${doc.id}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération réparations Firebase:', error.message);
        }

        console.log(`  📊 Réparations Firebase→PG: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    private async syncEntreprisesFromFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n🏢 Synchronisation Entreprises: Firebase → PostgreSQL...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const snapshot = await db.collection('entreprises').get();
            console.log(`  📥 ${snapshot.size} entreprises trouvées dans Firebase`);

            for (const doc of snapshot.docs) {
                try {
                    const data = doc.data();
                    const firebaseId = doc.id;

                    const checkResult = await pool.query(
                        'SELECT id_entreprise, derniere_sync FROM Entreprise WHERE firebase_id = $1',
                        [firebaseId]
                    );

                    const firebaseTimestamp = data.updated_at?.toDate?.() || new Date();

                    if (checkResult.rows.length > 0) {
                        const existing = checkResult.rows[0];
                        const postgresTimestamp = existing.derniere_sync ? new Date(existing.derniere_sync) : new Date(0);

                        if (firebaseTimestamp > postgresTimestamp) {
                            await pool.query(`
                                UPDATE Entreprise SET 
                                    nom = $1, telephone = $2, email = $3, adresse = $4,
                                    est_synchronise = TRUE, derniere_sync = NOW()
                                WHERE firebase_id = $5
                            `, [data.nom, data.telephone, data.email, data.adresse, firebaseId]);
                            result.synced++;
                        } else {
                            result.skipped++;
                        }
                    } else {
                        await pool.query(`
                            INSERT INTO Entreprise (firebase_id, nom, telephone, email, adresse, est_synchronise, derniere_sync)
                            VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
                        `, [firebaseId, data.nom, data.telephone, data.email, data.adresse]);
                        result.synced++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync entreprise ${doc.id}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération entreprises Firebase:', error.message);
        }

        console.log(`  📊 Entreprises Firebase→PG: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    private async syncStatusFromFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n📊 Synchronisation Status: Firebase → PostgreSQL...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const snapshot = await db.collection('status').get();
            console.log(`  📥 ${snapshot.size} status trouvés dans Firebase`);

            for (const doc of snapshot.docs) {
                try {
                    const data = doc.data();
                    const firebaseId = doc.id;

                    const checkResult = await pool.query(
                        'SELECT id_status, derniere_sync FROM Status WHERE firebase_id = $1 OR id_status = $2',
                        [firebaseId, data.id_status || parseInt(firebaseId) || 0]
                    );

                    const firebaseTimestamp = data.updated_at?.toDate?.() || new Date();

                    if (checkResult.rows.length > 0) {
                        const existing = checkResult.rows[0];
                        const postgresTimestamp = existing.derniere_sync ? new Date(existing.derniere_sync) : new Date(0);

                        if (firebaseTimestamp > postgresTimestamp) {
                            await pool.query(`
                                UPDATE Status SET 
                                    libelle = $1, couleur = $2, firebase_id = $3,
                                    est_synchronise = TRUE, derniere_sync = NOW()
                                WHERE id_status = $4
                            `, [data.libelle, data.couleur, firebaseId, existing.id_status]);
                            result.synced++;
                        } else {
                            result.skipped++;
                        }
                    } else {
                        await pool.query(`
                            INSERT INTO Status (firebase_id, libelle, couleur, est_synchronise, derniere_sync)
                            VALUES ($1, $2, $3, TRUE, NOW())
                        `, [firebaseId, data.libelle, data.couleur]);
                        result.synced++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync status ${doc.id}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération status Firebase:', error.message);
        }

        console.log(`  📊 Status Firebase→PG: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    // ============================================
    // POSTGRESQL → FIREBASE
    // ============================================

    private async syncUsersToFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n👤 Synchronisation Users: PostgreSQL → Firebase...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const pgResult = await pool.query(`
                SELECT id_user, firebase_uid, email, password, display_name, id_type_user, 
                       est_bloque, date_creation, derniere_sync
                FROM User_
                WHERE firebase_uid IS NOT NULL
            `);

            console.log(`  📤 ${pgResult.rows.length} utilisateurs à vérifier`);

            for (const row of pgResult.rows) {
                try {
                    const docRef = db.collection('users').doc(row.firebase_uid);
                    const docSnap = await docRef.get();

                    const postgresTimestamp = row.derniere_sync ? new Date(row.derniere_sync) : new Date(row.date_creation);

                    if (docSnap.exists) {
                        const firebaseData = docSnap.data()!;
                        const firebaseTimestamp = firebaseData.derniere_sync?.toDate?.() || firebaseData.date_creation?.toDate?.() || new Date(0);

                        if (postgresTimestamp > firebaseTimestamp) {
                            await docRef.update({
                                email: row.email,
                                password: row.password || '',
                                display_name: row.display_name || '',
                                id_type_user: row.id_type_user,
                                id_user: row.id_user,
                                est_bloque: row.est_bloque,
                                derniere_sync: new Date()
                            });
                            result.synced++;
                        } else {
                            result.skipped++;
                        }
                    } else {
                        await docRef.set({
                            firebase_uid: row.firebase_uid,
                            email: row.email,
                            password: row.password || '',
                            display_name: row.display_name || '',
                            id_type_user: row.id_type_user,
                            id_user: row.id_user,
                            est_bloque: row.est_bloque,
                            date_creation: row.date_creation,
                            derniere_sync: new Date()
                        });
                        result.synced++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync user ${row.email}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération users PostgreSQL:', error.message);
        }

        console.log(`  📊 Users PG→Firebase: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    private async syncSignalementsToFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n📍 Synchronisation Signalements: PostgreSQL → Firebase...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const pgResult = await pool.query(`
                SELECT 
                    s.id_signalement, s.firebase_id,
                    ST_X(s.location) as longitude, ST_Y(s.location) as latitude,
                    s.description, s.date_signalement, s.derniere_sync, s.est_synchronise,
                    u.id_user, u.display_name, u.email, u.firebase_uid,
                    st.id_status, st.libelle as status_libelle, st.couleur as status_couleur
                FROM Signalement s
                JOIN User_ u ON s.id_user = u.id_user
                JOIN Status st ON s.id_status = st.id_status
            `);

            console.log(`  📤 ${pgResult.rows.length} signalements à vérifier`);

            for (const row of pgResult.rows) {
                try {
                    const firebaseId = row.firebase_id || row.id_signalement.toString();
                    const docRef = db.collection('signalements').doc(firebaseId);
                    const docSnap = await docRef.get();

                    const postgresTimestamp = row.derniere_sync ? new Date(row.derniere_sync) : new Date(row.date_signalement);

                    const shouldSync = !docSnap.exists || (() => {
                        const fbData = docSnap.data()!;
                        const fbTimestamp = fbData.updated_at?.toDate?.() || new Date(0);
                        return postgresTimestamp > fbTimestamp;
                    })();

                    if (shouldSync) {
                        await docRef.set({
                            postgres_id: row.id_signalement,
                            location: new admin.firestore.GeoPoint(row.latitude || 0, row.longitude || 0),
                            description: row.description,
                            date_signalement: row.date_signalement,
                            updated_at: postgresTimestamp,
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
                            sync_version: 1
                        }, { merge: true });

                        if (!row.firebase_id) {
                            await pool.query(
                                'UPDATE Signalement SET firebase_id = $1, est_synchronise = TRUE WHERE id_signalement = $2',
                                [firebaseId, row.id_signalement]
                            );
                        }
                        result.synced++;
                    } else {
                        result.skipped++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync signalement ${row.id_signalement}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération signalements PostgreSQL:', error.message);
        }

        console.log(`  📊 Signalements PG→Firebase: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    private async syncReparationsToFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n🔧 Synchronisation Réparations: PostgreSQL → Firebase...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const pgResult = await pool.query(`
                SELECT 
                    r.id_reparation, r.firebase_id, r.surface_m2, r.budget,
                    r.date_debut, r.date_fin_prevue, r.date_fin_reelle, r.commentaire,
                    r.id_signalement, r.id_entreprise, r.id_user,
                    r.date_creation, r.derniere_sync,
                    e.nom as entreprise_nom, u.display_name as manager_name,
                    st.id_status, st.libelle as status_libelle
                FROM Reparation r
                LEFT JOIN Entreprise e ON r.id_entreprise = e.id_entreprise
                LEFT JOIN User_ u ON r.id_user = u.id_user
                JOIN Status st ON r.id_status = st.id_status
            `);

            console.log(`  📤 ${pgResult.rows.length} réparations à vérifier`);

            for (const row of pgResult.rows) {
                try {
                    const firebaseId = row.firebase_id || row.id_reparation.toString();
                    const docRef = db.collection('reparations').doc(firebaseId);
                    const docSnap = await docRef.get();

                    const postgresTimestamp = row.derniere_sync ? new Date(row.derniere_sync) : new Date(row.date_creation);

                    const shouldSync = !docSnap.exists || (() => {
                        const fbData = docSnap.data()!;
                        const fbTimestamp = fbData.updated_at?.toDate?.() || new Date(0);
                        return postgresTimestamp > fbTimestamp;
                    })();

                    if (shouldSync) {
                        await docRef.set({
                            id_reparation: row.id_reparation,
                            surface_m2: row.surface_m2,
                            budget: row.budget,
                            date_debut: row.date_debut,
                            date_fin_prevue: row.date_fin_prevue,
                            date_fin_reelle: row.date_fin_reelle,
                            commentaire: row.commentaire,
                            id_signalement: row.id_signalement,
                            id_entreprise: row.id_entreprise,
                            updated_at: postgresTimestamp,
                            sync_version: 1,
                            entreprise: row.entreprise_nom ? { nom: row.entreprise_nom } : null,
                            manager: row.manager_name ? { display_name: row.manager_name } : null,
                            status: { id: row.id_status, libelle: row.status_libelle }
                        }, { merge: true });

                        if (!row.firebase_id) {
                            await pool.query(
                                'UPDATE Reparation SET firebase_id = $1, est_synchronise = TRUE WHERE id_reparation = $2',
                                [firebaseId, row.id_reparation]
                            );
                        }
                        result.synced++;
                    } else {
                        result.skipped++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync réparation ${row.id_reparation}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération réparations PostgreSQL:', error.message);
        }

        console.log(`  📊 Réparations PG→Firebase: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    private async syncEntreprisesToFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n🏢 Synchronisation Entreprises: PostgreSQL → Firebase...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const pgResult = await pool.query(`
                SELECT id_entreprise, firebase_id, nom, telephone, email, adresse, derniere_sync
                FROM Entreprise
            `);

            console.log(`  📤 ${pgResult.rows.length} entreprises à vérifier`);

            for (const row of pgResult.rows) {
                try {
                    const firebaseId = row.firebase_id || row.id_entreprise.toString();
                    const docRef = db.collection('entreprises').doc(firebaseId);
                    const docSnap = await docRef.get();

                    const postgresTimestamp = row.derniere_sync ? new Date(row.derniere_sync) : new Date();

                    const shouldSync = !docSnap.exists || (() => {
                        const fbData = docSnap.data()!;
                        const fbTimestamp = fbData.updated_at?.toDate?.() || new Date(0);
                        return postgresTimestamp > fbTimestamp;
                    })();

                    if (shouldSync) {
                        await docRef.set({
                            id_entreprise: row.id_entreprise,
                            nom: row.nom,
                            telephone: row.telephone,
                            email: row.email,
                            adresse: row.adresse,
                            updated_at: postgresTimestamp,
                            sync_version: 1
                        }, { merge: true });

                        if (!row.firebase_id) {
                            await pool.query(
                                'UPDATE Entreprise SET firebase_id = $1, est_synchronise = TRUE WHERE id_entreprise = $2',
                                [firebaseId, row.id_entreprise]
                            );
                        }
                        result.synced++;
                    } else {
                        result.skipped++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync entreprise ${row.id_entreprise}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération entreprises PostgreSQL:', error.message);
        }

        console.log(`  📊 Entreprises PG→Firebase: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    private async syncStatusToFirebase(db: admin.firestore.Firestore): Promise<SyncResult> {
        console.log('\n📊 Synchronisation Status: PostgreSQL → Firebase...');
        const result: SyncResult = { synced: 0, errors: 0, skipped: 0 };

        try {
            const pgResult = await pool.query(`
                SELECT id_status, firebase_id, libelle, couleur, derniere_sync
                FROM Status
            `);

            console.log(`  📤 ${pgResult.rows.length} status à vérifier`);

            for (const row of pgResult.rows) {
                try {
                    const firebaseId = row.firebase_id || row.id_status.toString();
                    const docRef = db.collection('status').doc(firebaseId);
                    const docSnap = await docRef.get();

                    const postgresTimestamp = row.derniere_sync ? new Date(row.derniere_sync) : new Date();

                    const shouldSync = !docSnap.exists || (() => {
                        const fbData = docSnap.data()!;
                        const fbTimestamp = fbData.updated_at?.toDate?.() || new Date(0);
                        return postgresTimestamp > fbTimestamp;
                    })();

                    if (shouldSync) {
                        await docRef.set({
                            id_status: row.id_status,
                            libelle: row.libelle,
                            couleur: row.couleur,
                            updated_at: postgresTimestamp,
                            sync_version: 1
                        }, { merge: true });

                        if (!row.firebase_id) {
                            await pool.query(
                                'UPDATE Status SET firebase_id = $1, est_synchronise = TRUE WHERE id_status = $2',
                                [firebaseId, row.id_status]
                            );
                        }
                        result.synced++;
                    } else {
                        result.skipped++;
                    }
                } catch (error: any) {
                    result.errors++;
                    console.error(`  ❌ Erreur sync status ${row.id_status}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error('  ❌ Erreur récupération status PostgreSQL:', error.message);
        }

        console.log(`  📊 Status PG→Firebase: ${result.synced} sync, ${result.skipped} skip, ${result.errors} err`);
        return result;
    }

    // ============================================
    // UTILITAIRES
    // ============================================

    public setAutoSync(enabled: boolean): void {
        this.autoSyncEnabled = enabled;
        console.log(`🔄 Synchronisation automatique: ${enabled ? 'activée' : 'désactivée'}`);
    }

    public isAutoSyncEnabled(): boolean {
        return this.autoSyncEnabled;
    }

    public isSyncInProgress(): boolean {
        return this.syncInProgress;
    }

    public getLastSyncTimestamp(): Date | null {
        return this.lastSyncTimestamp;
    }

    public async getSyncStats(): Promise<{
        last_sync: Date | null;
        sync_in_progress: boolean;
        auto_sync_enabled: boolean;
        pending: {
            signalements: number;
            reparations: number;
            entreprises: number;
            status: number;
        };
    }> {
        try {
            const queries = await Promise.all([
                pool.query('SELECT COUNT(*) as count FROM Signalement WHERE est_synchronise = FALSE'),
                pool.query('SELECT COUNT(*) as count FROM Reparation WHERE est_synchronise = FALSE'),
                pool.query('SELECT COUNT(*) as count FROM Entreprise WHERE est_synchronise = FALSE'),
                pool.query('SELECT COUNT(*) as count FROM Status WHERE est_synchronise = FALSE')
            ]);

            return {
                last_sync: this.lastSyncTimestamp,
                sync_in_progress: this.syncInProgress,
                auto_sync_enabled: this.autoSyncEnabled,
                pending: {
                    signalements: parseInt(queries[0].rows[0].count),
                    reparations: parseInt(queries[1].rows[0].count),
                    entreprises: parseInt(queries[2].rows[0].count),
                    status: parseInt(queries[3].rows[0].count)
                }
            };
        } catch (error: any) {
            console.error('Erreur récupération stats sync:', error);
            return {
                last_sync: this.lastSyncTimestamp,
                sync_in_progress: this.syncInProgress,
                auto_sync_enabled: this.autoSyncEnabled,
                pending: { signalements: 0, reparations: 0, entreprises: 0, status: 0 }
            };
        }
    }
}

export const syncService = SyncService.getInstance();
