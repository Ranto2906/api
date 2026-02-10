"use strict";
/**
 * Utilitaires pour la gestion des collections Firebase
 * Fonctions réutilisables pour créer, vider et gérer les collections
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirebaseCollectionManager = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../config/firebase");
class FirebaseCollectionManager {
    constructor() {
        this.db = (0, firebase_1.getFirestore)();
    }
    /**
     * Crée une collection avec des données initiales
     */
    async createCollection(collectionName, documents) {
        console.log(`📁 Création de la collection ${collectionName}...`);
        const batch = this.db.batch();
        documents.forEach(({ id, data }) => {
            const ref = this.db.collection(collectionName).doc(id);
            batch.set(ref, data);
        });
        await batch.commit();
        console.log(`✅ Collection ${collectionName} créée avec ${documents.length} document(s)`);
    }
    /**
     * Vide complètement une collection
     */
    async clearCollection(collectionName) {
        console.log(`🗑️ Vidage de la collection ${collectionName}...`);
        const snapshot = await this.db.collection(collectionName).get();
        const batch = this.db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        if (snapshot.size > 0) {
            await batch.commit();
            console.log(`✅ ${snapshot.size} document(s) supprimé(s) de ${collectionName}`);
        }
        else {
            console.log(`ℹ️ Collection ${collectionName} déjà vide`);
        }
    }
    /**
     * Vérifie si une collection existe et compte ses documents
     */
    async getCollectionInfo(collectionName) {
        try {
            const snapshot = await this.db.collection(collectionName).get();
            return {
                exists: true,
                documentCount: snapshot.size,
                documents: snapshot.docs.map(doc => doc.id)
            };
        }
        catch (error) {
            return {
                exists: false,
                documentCount: 0,
                documents: []
            };
        }
    }
    /**
     * Crée toutes les collections de base avec leurs données initiales
     * IDENTIQUE à PostgreSQL avec des IDs numériques
     */
    async createAllBaseCollections() {
        console.log('🚀 Création de toutes les collections de base...');
        // Types d'utilisateurs (IDs numériques comme PostgreSQL)
        await this.createCollection('TypeUser', [
            { id: '1', data: { id: 1, libelle: 'Visiteur' } },
            { id: '2', data: { id: 2, libelle: 'Utilisateur' } },
            { id: '3', data: { id: 3, libelle: 'Manager' } }
        ]);
        // Statuts (IDs numériques comme PostgreSQL)
        await this.createCollection('Status', [
            { id: '1', data: { id: 1, libelle: 'Nouveau', couleur: '#FF0000' } },
            { id: '2', data: { id: 2, libelle: 'En cours', couleur: '#FFA500' } },
            { id: '3', data: { id: 3, libelle: 'Terminé', couleur: '#00FF00' } }
        ]);
        // Paramètres globaux (structure nom/valeur/type)
        await this.createCollection('Parametre', [
            {
                id: '1',
                data: {
                    id: 1,
                    nom: 'max_tentatives_connexion',
                    valeur: '5',
                    type: 'number',
                    description: 'Nombre maximum de tentatives de connexion avant blocage',
                    date_modification: admin.firestore.Timestamp.now()
                }
            },
            {
                id: '2',
                data: {
                    id: 2,
                    nom: 'duree_blocage_minutes',
                    valeur: '15',
                    type: 'number',
                    description: 'Durée du blocage après trop de tentatives (en minutes)',
                    date_modification: admin.firestore.Timestamp.now()
                }
            },
            {
                id: '3',
                data: {
                    id: 3,
                    nom: 'session_expiration_heures',
                    valeur: '24',
                    type: 'number',
                    description: 'Durée de validité des sessions (en heures)',
                    date_modification: admin.firestore.Timestamp.now()
                }
            },
            {
                id: '4',
                data: {
                    id: 4,
                    nom: 'refresh_token_expiration_jours',
                    valeur: '30',
                    type: 'number',
                    description: 'Durée de validité des refresh tokens (en jours)',
                    date_modification: admin.firestore.Timestamp.now()
                }
            },
            {
                id: '5',
                data: {
                    id: 5,
                    nom: 'maintenance_mode',
                    valeur: 'false',
                    type: 'boolean',
                    description: 'Mode maintenance activé',
                    date_modification: admin.firestore.Timestamp.now()
                }
            },
            {
                id: '6',
                data: {
                    id: 6,
                    nom: 'app_version',
                    valeur: '1.0.0',
                    type: 'string',
                    description: 'Version actuelle de l\'application',
                    date_modification: admin.firestore.Timestamp.now()
                }
            }
        ]);
        // Entreprises (IDs numériques comme PostgreSQL)
        await this.createCollection('Entreprise', [
            {
                id: '1',
                data: {
                    id: 1,
                    nom: 'Entreprise Municipal',
                    telephone: '+261 20 22 123 45',
                    email: 'municipal@antananarivo.mg',
                    adresse: 'Antananarivo, Madagascar'
                }
            }
        ]);
        // Utilisateurs par défaut (IDs numériques comme PostgreSQL)
        await this.createCollection('User_', [
            {
                id: '1',
                data: {
                    id: 1,
                    nom: 'Admin',
                    prenom: 'Manager',
                    email: 'manager@manager.mg',
                    password: 'admin', // Mot de passe en clair
                    date_creation: admin.firestore.Timestamp.now(),
                    est_bloque: false,
                    id_type_user: 3
                }
            }
        ]);
        console.log('✅ Toutes les collections de base ont été créées!');
    }
    /**
     * Crée les collections dynamiques (vides au départ)
     */
    async createDynamicCollections() {
        console.log('📁 Création des collections dynamiques...');
        const dynamicCollections = [
            'Signalement',
            'Reparation',
            'HistoriqueStatus',
            'TentativeConnexion',
            'Session'
        ];
        for (const collectionName of dynamicCollections) {
            // Créer un document placeholder pour initialiser la collection
            const ref = this.db.collection(collectionName).doc('_init');
            await ref.set({
                _placeholder: true,
                _created: admin.firestore.Timestamp.now(),
                _description: `Collection ${collectionName} initialisée`
            });
            // Supprimer immédiatement le placeholder
            await ref.delete();
            console.log(`✅ Collection ${collectionName} initialisée`);
        }
    }
    /**
     * Affiche un résumé de toutes les collections
     */
    async showCollectionsSummary() {
        console.log('\n📊 RÉSUMÉ DES COLLECTIONS FIREBASE\n');
        const collections = [
            'TypeUser', 'Status', 'Parametre', 'Entreprise',
            'User_', 'Signalement', 'Reparation', 'HistoriqueStatus',
            'TentativeConnexion', 'Session'
        ];
        for (const collectionName of collections) {
            const info = await this.getCollectionInfo(collectionName);
            console.log(`📁 ${collectionName.padEnd(20)} : ${info.documentCount} document(s)`);
            if (info.documentCount > 0 && info.documentCount <= 10) {
                info.documents.forEach(docId => {
                    if (!docId.startsWith('_')) {
                        console.log(`   └─ ${docId}`);
                    }
                });
            }
        }
        console.log('\n✅ Résumé terminé\n');
    }
    /**
     * Réinitialise complètement toutes les collections
     */
    async resetAllCollections() {
        console.log('⚠️ RÉINITIALISATION COMPLÈTE DES COLLECTIONS...');
        const collections = [
            'TypeUser', 'Status', 'Parametre', 'Entreprise',
            'User_', 'Signalement', 'Reparation', 'HistoriqueStatus',
            'TentativeConnexion', 'Session'
        ];
        // Vider toutes les collections
        for (const collectionName of collections) {
            await this.clearCollection(collectionName);
        }
        // Recréer les collections de base
        await this.createAllBaseCollections();
        await this.createDynamicCollections();
        console.log('✅ Réinitialisation complète terminée!');
    }
    /**
     * Ajoute des données d'exemple pour les tests
     * IDENTIQUE à PostgreSQL avec des IDs numériques
     */
    async addSampleData() {
        console.log('📝 Ajout de données d\'exemple...');
        // Ajouter des signalements d'exemple (IDs numériques)
        await this.createCollection('Signalement', [
            {
                id: '1',
                data: {
                    id: 1,
                    description: 'Nid de poule sur la route principale',
                    location: new admin.firestore.GeoPoint(-18.8792, 47.5079),
                    date_signalement: admin.firestore.Timestamp.now(),
                    est_synchronise: true,
                    id_user: 1,
                    id_status: 1
                }
            },
            {
                id: '2',
                data: {
                    id: 2,
                    description: 'Affaissement de chaussée',
                    location: new admin.firestore.GeoPoint(-18.8800, 47.5090),
                    date_signalement: admin.firestore.Timestamp.now(),
                    est_synchronise: true,
                    id_user: 1,
                    id_status: 2
                }
            }
        ]);
        // Ajouter une réparation d'exemple (IDs numériques)
        await this.createCollection('Reparation', [
            {
                id: '1',
                data: {
                    id: 1,
                    surface_m2: 15.5,
                    budget: 2500000,
                    date_debut: admin.firestore.Timestamp.fromDate(new Date()),
                    date_fin_prevue: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
                    commentaire: 'Réparation urgente nécessaire',
                    date_creation: admin.firestore.Timestamp.now(),
                    id_signalement: 1,
                    id_entreprise: 1,
                    id_status: 2,
                    id_user: 1
                }
            }
        ]);
        console.log('✅ Données d\'exemple ajoutées!');
    }
}
exports.FirebaseCollectionManager = FirebaseCollectionManager;
exports.default = FirebaseCollectionManager;
//# sourceMappingURL=firebaseCollectionManager.js.map