"use strict";
/**
 * Script d'initialisation des collections Firebase
 * Crée toutes les collections et documents initiaux basés sur le schéma PostgreSQL
 * Adapté au projet travaux_routiers avec synchronisation bidirectionnelle
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAllFirebaseCollections = initializeAllFirebaseCollections;
exports.checkFirebaseCollections = checkFirebaseCollections;
const firebase_1 = require("../config/firebase");
const admin = __importStar(require("firebase-admin"));
const database_1 = __importDefault(require("../config/database"));
/**
 * Initialise toutes les collections Firebase avec des données de PostgreSQL
 */
async function initializeAllFirebaseCollections() {
    console.log('🚀 Début de l\'initialisation des collections Firebase...\n');
    try {
        const db = (0, firebase_1.getFirestore)();
        console.log('✅ Firebase connecté');
        console.log('✅ PostgreSQL connecté\n');
        // Collections de référence
        console.log('📁 Synchronisation des collections de référence...');
        await syncTypeUser(db);
        await syncStatus(db);
        await syncParametre(db);
        // Collections métier
        console.log('\n📁 Synchronisation des collections métier...');
        await syncEntreprise(db);
        await syncUsers(db);
        // Collections avec relations
        console.log('\n📁 Synchronisation des collections avec relations...');
        await syncSignalements(db);
        await syncReparations(db);
        await syncHistoriqueStatus(db);
        // Collections de gestion
        console.log('\n📁 Synchronisation des collections de gestion...');
        await syncSession(db);
        await syncTentativeConnexion(db);
        console.log('\n✅ Initialisation terminée avec succès!');
    }
    catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
        throw error;
    }
}
/**
 * Synchronise les TypeUser de PostgreSQL vers Firebase
 */
async function syncTypeUser(db) {
    try {
        const result = await database_1.default.query('SELECT id_type_user as id, libelle FROM TypeUser ORDER BY id_type_user');
        let count = 0;
        for (const row of result.rows) {
            try {
                await db.collection('TypeUser').doc(row.id.toString()).set({
                    id: row.id,
                    libelle: row.libelle
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur TypeUser ${row.id}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} TypeUser synchronisés`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation TypeUser:', error.message);
    }
}
/**
 * Synchronise les Status de PostgreSQL vers Firebase
 */
async function syncStatus(db) {
    try {
        const result = await database_1.default.query('SELECT id_status as id, libelle, couleur FROM Status ORDER BY id_status');
        let count = 0;
        for (const row of result.rows) {
            try {
                await db.collection('status').doc(row.id.toString()).set({
                    id: row.id,
                    libelle: row.libelle,
                    couleur: row.couleur,
                    est_synchronise: true,
                    updated_at: new Date(),
                    sync_version: 1
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur Status ${row.id}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Status synchronisés`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation Status:', error.message);
    }
}
/**
 * Synchronise les Entreprises de PostgreSQL vers Firebase
 */
async function syncEntreprise(db) {
    try {
        const result = await database_1.default.query(`
      SELECT 
        id_entreprise as id, 
        nom, 
        telephone, 
        email, 
        adresse,
        firebase_id,
        est_synchronise,
        updated_at,
        sync_version
      FROM Entreprise 
      ORDER BY id_entreprise
    `);
        let count = 0;
        for (const row of result.rows) {
            try {
                await db.collection('entreprises').doc(row.firebase_id || row.id.toString()).set({
                    id_entreprise: row.id,
                    nom: row.nom,
                    telephone: row.telephone,
                    email: row.email,
                    adresse: row.adresse,
                    firebase_id: row.firebase_id || row.id.toString(),
                    est_synchronise: row.est_synchronise || true,
                    updated_at: new Date(row.updated_at || Date.now()),
                    sync_version: row.sync_version || 1
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur Entreprise ${row.id}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Entreprises synchronisées`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation Entreprise:', error.message);
    }
}
/**
 * Synchronise les Utilisateurs de PostgreSQL vers Firebase
 * Utilise display_name au lieu de nom/prenom
 */
async function syncUsers(db) {
    try {
        const result = await database_1.default.query(`
      SELECT 
        id_user as id,
        firebase_uid,
        email,
        display_name,
        id_type_user,
        password,
        est_bloque,
        date_creation
      FROM User_ 
      ORDER BY id_user
    `);
        let count = 0;
        for (const row of result.rows) {
            try {
                const userId = row.firebase_uid || row.id.toString();
                await db.collection('users').doc(userId).set({
                    id_user: row.id,
                    firebase_uid: row.firebase_uid,
                    email: row.email,
                    display_name: row.display_name,
                    id_type_user: row.id_type_user,
                    password: row.password,
                    est_bloque: row.est_bloque || false,
                    date_creation: new Date(row.date_creation),
                    derniere_sync: new Date()
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur User ${row.id}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Utilisateurs synchronisés`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation User_:', error.message);
    }
}
/**
 * Synchronise les Paramètres de PostgreSQL vers Firebase
 */
async function syncParametre(db) {
    try {
        const result = await database_1.default.query(`
      SELECT 
        id_parametre as id,
        nom,
        valeur,
        type,
        description,
        date_modification
      FROM Parametre 
      ORDER BY id_parametre
    `);
        let count = 0;
        for (const row of result.rows) {
            try {
                await db.collection('parametres').doc(row.id.toString()).set({
                    id_parametre: row.id,
                    nom: row.nom,
                    valeur: row.valeur,
                    type: row.type,
                    description: row.description,
                    date_modification: new Date(row.date_modification)
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur Parametre ${row.id}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Paramètres synchronisés`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation Parametre:', error.message);
    }
}
/**
 * Synchronise l'Historique des Status
 */
async function syncHistoriqueStatus(db) {
    try {
        const result = await database_1.default.query(`
      SELECT 
        h.id_historique as id,
        h.id_reparation,
        h.id_status_ancien,
        h.id_status_nouveau,
        h.id_user,
        h.date_modification,
        h.commentaire,
        s_ancien.libelle as ancien_status,
        s_nouveau.libelle as nouveau_status,
        u.display_name as user_name
      FROM HistoriqueStatus h
      LEFT JOIN Status s_ancien ON h.id_status_ancien = s_ancien.id_status
      JOIN Status s_nouveau ON h.id_status_nouveau = s_nouveau.id_status
      JOIN User_ u ON h.id_user = u.id_user
      ORDER BY h.date_modification DESC
    `);
        let count = 0;
        for (const row of result.rows) {
            try {
                await db.collection('historique_status').doc(row.id.toString()).set({
                    id_historique: row.id,
                    id_reparation: row.id_reparation,
                    status_ancien: row.id_status_ancien ? {
                        id: row.id_status_ancien,
                        libelle: row.ancien_status
                    } : null,
                    status_nouveau: {
                        id: row.id_status_nouveau,
                        libelle: row.nouveau_status
                    },
                    user: {
                        id: row.id_user,
                        display_name: row.user_name
                    },
                    date_modification: new Date(row.date_modification),
                    commentaire: row.commentaire
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur HistoriqueStatus ${row.id}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Historiques synchronisés`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation HistoriqueStatus:', error.message);
    }
}
/**
 * Synchronise les Signalements de PostgreSQL vers Firebase
 */
async function syncSignalements(db) {
    try {
        const result = await database_1.default.query(`
      SELECT 
        s.id_signalement,
        ST_X(s.location) as longitude,
        ST_Y(s.location) as latitude,
        s.description,
        s.date_signalement,
        s.firebase_id,
        s.est_synchronise,
        s.updated_at,
        s.sync_version,
        u.id_user,
        u.display_name,
        u.email,
        st.id_status,
        st.libelle as status_name
      FROM Signalement s
      JOIN User_ u ON s.id_user = u.id_user
      JOIN Status st ON s.id_status = st.id_status
    `);
        let count = 0;
        for (const row of result.rows) {
            try {
                const docRef = db.collection('signalements').doc(row.firebase_id || row.id_signalement.toString());
                await docRef.set({
                    id_signalement: row.id_signalement,
                    location: new admin.firestore.GeoPoint(row.latitude, row.longitude),
                    description: row.description,
                    date_signalement: new Date(row.date_signalement),
                    est_synchronise: row.est_synchronise,
                    updated_at: new Date(row.updated_at),
                    sync_version: row.sync_version,
                    user: {
                        id: row.id_user,
                        display_name: row.display_name,
                        email: row.email
                    },
                    status: {
                        id: row.id_status,
                        libelle: row.status_name
                    }
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur Signalement ${row.id_signalement}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Signalements synchronisés`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation Signalement:', error.message);
    }
}
/**
 * Synchronise les Réparations de PostgreSQL vers Firebase
 */
async function syncReparations(db) {
    try {
        const result = await database_1.default.query(`
      SELECT 
        r.id_reparation,
        r.surface_m2,
        r.budget,
        r.date_debut,
        r.date_fin_prevue,
        r.date_fin_reelle,
        r.commentaire,
        r.firebase_id,
        r.est_synchronise,
        r.updated_at,
        r.sync_version,
        r.id_signalement,
        r.id_entreprise,
        r.id_user,
        r.id_status,
        e.nom as entreprise_nom,
        u.display_name as manager_name,
        st.libelle as status_name
      FROM Reparation r
      LEFT JOIN Entreprise e ON r.id_entreprise = e.id_entreprise
      LEFT JOIN User_ u ON r.id_user = u.id_user
      JOIN Status st ON r.id_status = st.id_status
    `);
        let count = 0;
        for (const row of result.rows) {
            try {
                const docRef = db.collection('reparations').doc(row.firebase_id || row.id_reparation.toString());
                await docRef.set({
                    id_reparation: row.id_reparation,
                    surface_m2: parseFloat(row.surface_m2),
                    budget: parseFloat(row.budget),
                    date_debut: row.date_debut ? new Date(row.date_debut) : null,
                    date_fin_prevue: row.date_fin_prevue ? new Date(row.date_fin_prevue) : null,
                    date_fin_reelle: row.date_fin_reelle ? new Date(row.date_fin_reelle) : null,
                    commentaire: row.commentaire,
                    est_synchronise: row.est_synchronise,
                    updated_at: new Date(row.updated_at),
                    sync_version: row.sync_version,
                    id_signalement: row.id_signalement,
                    id_entreprise: row.id_entreprise,
                    entreprise: row.entreprise_nom ? { nom: row.entreprise_nom } : null,
                    manager: row.manager_name ? { display_name: row.manager_name } : null,
                    status: {
                        id: row.id_status,
                        libelle: row.status_name
                    }
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur Reparation ${row.id_reparation}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Réparations synchronisées`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation Reparation:', error.message);
    }
}
/**
 * Synchronise les Sessions
 */
async function syncSession(db) {
    try {
        const result = await database_1.default.query(`
      SELECT 
        id_session as id,
        id_user,
        token,
        refresh_token,
        date_creation,
        date_expiration,
        est_active,
        ip_address,
        user_agent
      FROM Session 
      ORDER BY id_session DESC
      LIMIT 1000
    `);
        let count = 0;
        for (const row of result.rows) {
            try {
                await db.collection('sessions').doc(row.id.toString()).set({
                    id_session: row.id,
                    id_user: row.id_user,
                    token: row.token,
                    refresh_token: row.refresh_token,
                    date_creation: new Date(row.date_creation),
                    date_expiration: new Date(row.date_expiration),
                    est_active: row.est_active,
                    ip_address: row.ip_address,
                    user_agent: row.user_agent
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur Session ${row.id}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Sessions synchronisées (limité à 1000)`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation Session:', error.message);
    }
}
/**
 * Synchronise les Tentatives de Connexion
 */
async function syncTentativeConnexion(db) {
    try {
        const result = await database_1.default.query(`
      SELECT 
        id_tentative as id,
        email,
        ip_address,
        succes,
        date_tentative,
        raison_echec
      FROM TentativeConnexion 
      ORDER BY id_tentative DESC
      LIMIT 1000
    `);
        let count = 0;
        for (const row of result.rows) {
            try {
                await db.collection('tentatives_connexion').doc(row.id.toString()).set({
                    id_tentative: row.id,
                    email: row.email,
                    ip_address: row.ip_address,
                    succes: row.succes,
                    date_tentative: new Date(row.date_tentative),
                    raison_echec: row.raison_echec
                });
                count++;
            }
            catch (error) {
                console.error(`  ❌ Erreur TentativeConnexion ${row.id}:`, error.message);
            }
        }
        console.log(`  ✅ ${count}/${result.rows.length} Tentatives synchronisées (limité à 1000)`);
    }
    catch (error) {
        console.error('  ❌ Erreur synchronisation TentativeConnexion:', error.message);
    }
}
/**
 * Vérifie l'état des collections Firebase
 */
async function checkFirebaseCollections() {
    console.log('🔍 Vérification des collections Firebase...\n');
    try {
        const db = (0, firebase_1.getFirestore)();
        const collections = [
            'TypeUser',
            'status',
            'parametres',
            'entreprises',
            'users',
            'signalements',
            'reparations',
            'historique_status',
            'sessions',
            'tentatives_connexion'
        ];
        for (const collectionName of collections) {
            try {
                const snapshot = await db.collection(collectionName).limit(5).get();
                if (snapshot.size > 0) {
                    console.log(`  📁 ${collectionName}: ✅ ${snapshot.size} document(s)`);
                    if (snapshot.size <= 3) {
                        snapshot.docs.forEach(doc => {
                            const data = doc.data();
                            const label = data.libelle || data.display_name || data.nom || data.id || doc.id;
                            console.log(`    ✓ ${doc.id}`);
                        });
                    }
                }
                else {
                    console.log(`  📁 ${collectionName}: ⚠️  Vide`);
                }
            }
            catch (error) {
                console.log(`  📁 ${collectionName}: ℹ️  Inexistante`);
            }
        }
        console.log('\n✅ Vérification terminée');
    }
    catch (error) {
        console.error('❌ Erreur lors de la vérification:', error.message);
    }
}
/**
 * Supprime les collections (pour réinitialisation)
 */
async function deleteAllCollections() {
    console.log('🧹 Suppression de toutes les collections...\n');
    try {
        const db = (0, firebase_1.getFirestore)();
        const collections = ['TypeUser', 'status', 'parametres', 'entreprises', 'users', 'signalements', 'reparations', 'historique_status', 'sessions', 'tentatives_connexion'];
        for (const collectionName of collections) {
            try {
                const snapshot = await db.collection(collectionName).get();
                let deleted = 0;
                for (const doc of snapshot.docs) {
                    await doc.ref.delete();
                    deleted++;
                }
                console.log(`  ✅ ${collectionName}: ${deleted} document(s) supprimé(s)`);
            }
            catch (error) {
                console.log(`  ℹ️  ${collectionName}: Aucun document à supprimer`);
            }
        }
        console.log('\n✅ Suppression terminée');
    }
    catch (error) {
        console.error('❌ Erreur lors de la suppression:', error.message);
    }
}
/**
 * Fonction principale pour l'initialisation
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'init';
    try {
        // Initialiser Firebase
        (0, firebase_1.initializeFirebase)();
        switch (command) {
            case 'init':
                await initializeAllFirebaseCollections();
                break;
            case 'check':
                await checkFirebaseCollections();
                break;
            case 'reset':
                await deleteAllCollections();
                await initializeAllFirebaseCollections();
                break;
            case 'delete':
                await deleteAllCollections();
                break;
            default:
                console.log('Usage: npm run firebase-init [init|check|reset|delete]');
                console.log('  init   - Initialise les collections depuis PostgreSQL');
                console.log('  check  - Vérifie l\'état des collections');
                console.log('  reset  - Réinitialise (delete + init)');
                console.log('  delete - Supprime toutes les collections');
                process.exit(1);
        }
        process.exit(0);
    }
    catch (error) {
        console.error('\n❌ Erreur:', error.message);
        process.exit(1);
    }
}
// Exécuter seulement si ce fichier est lancé directement
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=initFirebaseCollections.js.map