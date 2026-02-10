-- Active: 1770716084209@@127.0.0.1@5432@travaux_routiers@public
-- ============================================
-- SCHEMA BASE DE DONNEES COMPLET - PostgreSQL
-- Projet: Gestion des Travaux Routiers
-- Date: 2026-02-09
-- ============================================



BEGIN;

-- ============================================
-- EXTENSION POSTGIS
-- ============================================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================
-- SUPPRESSION DES TABLES EXISTANTES
-- ============================================
DROP TABLE IF EXISTS SyncLog CASCADE;

DROP TABLE IF EXISTS HistoriqueStatus CASCADE;

DROP TABLE IF EXISTS Photo CASCADE;

DROP TABLE IF EXISTS Reparation CASCADE;

DROP TABLE IF EXISTS HistoriquePrix CASCADE;

DROP TABLE IF EXISTS PrixConfig CASCADE;

DROP TABLE IF EXISTS Signalement CASCADE;

DROP TABLE IF EXISTS Session CASCADE;

DROP TABLE IF EXISTS TentativeConnexion CASCADE;

DROP TABLE IF EXISTS Parametre CASCADE;

DROP TABLE IF EXISTS User_ CASCADE;

DROP TABLE IF EXISTS Entreprise CASCADE;

DROP TABLE IF EXISTS Status CASCADE;

DROP TABLE IF EXISTS TypeUser CASCADE;

-- ============================================
-- TABLE: TypeUser
-- Types d'utilisateurs (Visiteur, Utilisateur, Manager)
-- ============================================
CREATE TABLE TypeUser (
    Id_type_user SERIAL PRIMARY KEY,
    libelle VARCHAR(50) NOT NULL
);

-- ============================================
-- TABLE: Status
-- Statuts des signalements/réparations
-- ============================================
CREATE TABLE Status (
    Id_status SERIAL PRIMARY KEY,
    libelle VARCHAR(50) NOT NULL,
    couleur VARCHAR(7),
    firebase_id VARCHAR(128),
    est_synchronise BOOLEAN DEFAULT FALSE,
    derniere_sync TIMESTAMP
);

-- ============================================
-- TABLE: User_
-- Utilisateurs synchronisés avec Firebase Auth
-- Le mot de passe est stocké en clair pour mode hors ligne
-- ============================================
CREATE TABLE User_ (
    Id_user SERIAL PRIMARY KEY,
    firebase_uid VARCHAR(128) UNIQUE,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    Id_type_user INT NOT NULL DEFAULT 2,
    est_bloque BOOLEAN DEFAULT FALSE,
    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    derniere_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Id_type_user) REFERENCES TypeUser (Id_type_user)
);

CREATE INDEX idx_user_firebase_uid ON User_ (firebase_uid);

CREATE INDEX idx_user_email ON User_ (email);

CREATE INDEX idx_user_type ON User_ (Id_type_user);

-- ============================================
-- TABLE: Parametre
-- Paramètres globaux de l'application
-- ============================================
CREATE TABLE Parametre (
    Id_parametre SERIAL PRIMARY KEY,
    nom VARCHAR(100) UNIQUE NOT NULL,
    valeur VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'string',
    description VARCHAR(255),
    date_modification TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: TentativeConnexion
-- Sécurité - Tentatives de connexion
-- ============================================
CREATE TABLE TentativeConnexion (
    Id_tentative SERIAL PRIMARY KEY,
    email VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45),
    succes BOOLEAN DEFAULT FALSE,
    date_tentative TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    raison_echec VARCHAR(100)
);

CREATE INDEX idx_tentative_email ON TentativeConnexion (email);

CREATE INDEX idx_tentative_date ON TentativeConnexion (date_tentative);

CREATE INDEX idx_tentative_ip ON TentativeConnexion (ip_address);

-- ============================================
-- TABLE: Session
-- Sessions utilisateurs actives
-- ============================================
CREATE TABLE Session (
    Id_session SERIAL PRIMARY KEY,
    Id_user INT NOT NULL,
    token VARCHAR(500) NOT NULL UNIQUE,
    refresh_token VARCHAR(500),
    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_expiration TIMESTAMP NOT NULL,
    est_active BOOLEAN DEFAULT TRUE,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    FOREIGN KEY (Id_user) REFERENCES User_ (Id_user) ON DELETE CASCADE
);

CREATE INDEX idx_session_token ON Session (token);

CREATE INDEX idx_session_user ON Session (Id_user);

CREATE INDEX idx_session_expiration ON Session (date_expiration);

-- ============================================
-- TABLE: Entreprise
-- Entreprises de travaux routiers
-- ============================================
CREATE TABLE Entreprise (
    Id_entreprise SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL,
    telephone VARCHAR(20),
    email VARCHAR(100),
    adresse TEXT,
    firebase_id VARCHAR(128),
    est_synchronise BOOLEAN DEFAULT FALSE,
    derniere_sync TIMESTAMP
);

CREATE INDEX idx_entreprise_firebase_id ON Entreprise (firebase_id);

-- ============================================
-- TABLE: Signalement
-- Signalements de problèmes routiers
-- ============================================
CREATE TABLE Signalement (
    Id_signalement SERIAL PRIMARY KEY,
    location GEOMETRY (Point, 4326),
    description VARCHAR(500),
    niveau INT DEFAULT NULL CHECK (niveau IS NULL OR (niveau >= 1 AND niveau <= 10)),
    date_signalement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    firebase_id VARCHAR(128),
    est_synchronise BOOLEAN DEFAULT FALSE,
    derniere_sync TIMESTAMP,
    sync_version INT DEFAULT 1,
    Id_user INT NOT NULL,
    Id_status INT NOT NULL DEFAULT 1,
    FOREIGN KEY (Id_user) REFERENCES User_ (Id_user),
    FOREIGN KEY (Id_status) REFERENCES Status (Id_status)
);

CREATE INDEX idx_signalement_firebase_id ON Signalement (firebase_id);

CREATE INDEX idx_signalement_user ON Signalement (Id_user);

CREATE INDEX idx_signalement_status ON Signalement (Id_status);

CREATE INDEX idx_signalement_date ON Signalement (date_signalement);

CREATE INDEX idx_signalement_sync ON Signalement (est_synchronise);

CREATE INDEX idx_signalement_location ON Signalement USING GIST (location);

-- ============================================
-- TABLE: PrixConfig
-- Configuration des prix par m² (valeur actuelle)
-- ============================================
CREATE TABLE PrixConfig (
    Id_prix_config SERIAL PRIMARY KEY,
    prix_par_m2 DECIMAL(15, 2) NOT NULL,
    description VARCHAR(255),
    date_effet TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    est_actif BOOLEAN DEFAULT TRUE,
    cree_par INT,
    FOREIGN KEY (cree_par) REFERENCES User_ (Id_user)
);

CREATE INDEX idx_prixconfig_actif ON PrixConfig (est_actif);
CREATE INDEX idx_prixconfig_date ON PrixConfig (date_effet);

-- ============================================
-- TABLE: HistoriquePrix
-- Historique des prix appliqués aux réparations
-- Pour traçabilité - le prix ne change pas après création
-- ============================================
CREATE TABLE HistoriquePrix (
    Id_historique_prix SERIAL PRIMARY KEY,
    prix_par_m2 DECIMAL(15, 2) NOT NULL,
    niveau INT NOT NULL CHECK (niveau >= 1 AND niveau <= 10),
    surface_m2 DECIMAL(10, 2) NOT NULL,
    budget_calcule DECIMAL(15, 2) NOT NULL,
    date_application TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Id_prix_config INT,
    FOREIGN KEY (Id_prix_config) REFERENCES PrixConfig (Id_prix_config)
);

CREATE INDEX idx_historiqueprix_date ON HistoriquePrix (date_application);

-- ============================================
-- TABLE: Reparation
-- Réparations planifiées par les managers
-- Budget calculé : prix_par_m2 * signalement.niveau * surface_m2
-- Le niveau est sur le signalement, pas sur la réparation
-- Avancement: nouveau=0%, en_cours=50%, termine=100%
-- ============================================
CREATE TABLE Reparation (
    Id_reparation SERIAL PRIMARY KEY,
    surface_m2 DECIMAL(10, 2) NOT NULL,
    budget DECIMAL(15, 2) NOT NULL,
    avancement_pct INT DEFAULT 0 CHECK (avancement_pct >= 0 AND avancement_pct <= 100),
    -- Dates d'étapes d'avancement
    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_debut DATE,
    date_passage_en_cours TIMESTAMP,
    date_fin_prevue DATE,
    date_fin_reelle DATE,
    date_termine TIMESTAMP,
    commentaire TEXT,
    firebase_id VARCHAR(128),
    est_synchronise BOOLEAN DEFAULT FALSE,
    derniere_sync TIMESTAMP,
    Id_signalement INT NOT NULL,
    Id_entreprise INT,
    Id_status INT NOT NULL DEFAULT 1,
    Id_user INT,
    Id_historique_prix INT,
    FOREIGN KEY (Id_signalement) REFERENCES Signalement (Id_signalement) ON DELETE CASCADE,
    FOREIGN KEY (Id_entreprise) REFERENCES Entreprise (Id_entreprise),
    FOREIGN KEY (Id_status) REFERENCES Status (Id_status),
    FOREIGN KEY (Id_user) REFERENCES User_ (Id_user),
    FOREIGN KEY (Id_historique_prix) REFERENCES HistoriquePrix (Id_historique_prix)
);

CREATE INDEX idx_reparation_signalement ON Reparation (Id_signalement);

CREATE INDEX idx_reparation_entreprise ON Reparation (Id_entreprise);

CREATE INDEX idx_reparation_status ON Reparation (Id_status);

CREATE INDEX idx_reparation_firebase_id ON Reparation (firebase_id);

CREATE INDEX idx_reparation_sync ON Reparation (est_synchronise);

-- ============================================
-- TABLE: HistoriqueStatus
-- Historique des changements de statut des réparations
-- ============================================
CREATE TABLE HistoriqueStatus (
    Id_historique SERIAL PRIMARY KEY,
    Id_reparation INT NOT NULL,
    Id_status_ancien INT,
    Id_status_nouveau INT NOT NULL,
    Id_user INT,
    date_modification TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    commentaire TEXT,
    FOREIGN KEY (Id_reparation) REFERENCES Reparation (Id_reparation) ON DELETE CASCADE,
    FOREIGN KEY (Id_status_ancien) REFERENCES Status (Id_status),
    FOREIGN KEY (Id_status_nouveau) REFERENCES Status (Id_status),
    FOREIGN KEY (Id_user) REFERENCES User_ (Id_user)
);

CREATE INDEX idx_historique_reparation ON HistoriqueStatus (Id_reparation);
CREATE INDEX idx_historique_date ON HistoriqueStatus (date_modification);

-- ============================================
-- TABLE: SyncLog
-- Journal de synchronisation Firebase <-> PostgreSQL
-- ============================================
CREATE TABLE SyncLog (
    Id_SyncLog SERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id VARCHAR(128) NOT NULL,
    firebase_id VARCHAR(128),
    operation VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    direction VARCHAR(20) DEFAULT 'PG_TO_FIREBASE',
    CONSTRAINT chk_operation CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'SYNC')),
    CONSTRAINT chk_status CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CONFLICT')),
    CONSTRAINT chk_direction CHECK (direction IN ('PG_TO_FIREBASE', 'FIREBASE_TO_PG', 'BIDIRECTIONAL'))
);

CREATE INDEX idx_synclog_table ON SyncLog (table_name);
CREATE INDEX idx_synclog_status ON SyncLog (status);
CREATE INDEX idx_synclog_date ON SyncLog (sync_date);

-- ============================================
-- TABLE: Photo
-- Photos des signalements stockées sur Cloudinary
-- ============================================
CREATE TABLE Photo (
    Id_photo SERIAL PRIMARY KEY,
    Id_signalement INT NOT NULL,
    url VARCHAR(500) NOT NULL,
    cloudinary_public_id VARCHAR(255),
    file_name VARCHAR(255),
    path VARCHAR(500),
    mime_type VARCHAR(50) DEFAULT 'image/jpeg',
    taille_octets INT,
    largeur INT,
    hauteur INT,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    firebase_id VARCHAR(128),
    est_synchronise BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (Id_signalement) REFERENCES Signalement (Id_signalement) ON DELETE CASCADE
);

CREATE INDEX idx_photo_signalement ON Photo (Id_signalement);
CREATE INDEX idx_photo_cloudinary ON Photo (cloudinary_public_id);

-- ============================================
-- DONNEES PAR DEFAUT
-- ============================================

-- Types d'utilisateurs
INSERT INTO
    TypeUser (Id_type_user, libelle)
VALUES (1, 'Visiteur'),
    (2, 'Utilisateur'),
    (3, 'Manager') ON CONFLICT (Id_type_user) DO NOTHING;

-- Statuts
INSERT INTO
    Status (Id_status, libelle, couleur)
VALUES (1, 'Nouveau', '#2196f3'),
    (2, 'En cours', '#ff9800'),
    (3, 'Terminé', '#4caf50') ON CONFLICT (Id_status) DO NOTHING;

INSERT INTO user_ (firebase_uid, email, password, display_name, Id_type_user, est_bloque, date_creation, derniere_sync) 
    VALUES (
	'w1iEk6R25cWPQPUF8W23giXbu2E3',
	'manager@gmail.com',
	'manager123',
	'Manager',
	3,
    false,
    '2026-01-20 22:00:10.554459',
    '2026-02-04 21:18:22.954008');

-- Paramètres de sécurité
INSERT INTO Parametre (nom, valeur, type, description) VALUES 
    ('max_tentatives_connexion', '5', 'number', 'Nombre maximum de tentatives de connexion avant blocage'),
    ('duree_blocage_minutes', '30', 'number', 'Durée du blocage temporaire en minutes'),
    ('session_expiration_heures', '24', 'number', 'Durée de validité d''une session en heures'),
    ('activer_blocage_auto', 'true', 'boolean', 'Activer le blocage automatique après échecs'),
    ('sync_interval_minutes', '5', 'number', 'Intervalle de synchronisation Firebase en minutes'),
    ('prix_par_m2', '50000', 'number', 'Prix forfaitaire par mètre carré en Ariary')
ON CONFLICT (nom) DO UPDATE SET
    valeur = EXCLUDED.valeur,
    date_modification = CURRENT_TIMESTAMP;

-- Prix par défaut
INSERT INTO PrixConfig (prix_par_m2, description, est_actif, cree_par)
VALUES (50000, 'Prix forfaitaire initial par m²', TRUE, 1)
ON CONFLICT DO NOTHING;

-- ============================================
-- VUES UTILES
-- ============================================

-- Vue des utilisateurs avec leur type
CREATE OR REPLACE VIEW v_users_with_type AS
SELECT u.Id_user, u.firebase_uid, u.email, u.display_name, u.Id_type_user, t.libelle AS type_libelle, u.est_bloque, u.date_creation, u.derniere_sync
FROM User_ u
    JOIN TypeUser t ON u.Id_type_user = t.Id_type_user;

-- Vue des signalements avec détails
CREATE OR REPLACE VIEW v_signalements_details AS
SELECT
    s.Id_signalement,
    ST_X(s.location) AS longitude,
    ST_Y(s.location) AS latitude,
    s.description,
    s.date_signalement,
    s.firebase_id,
    s.est_synchronise,
    u.Id_user,
    u.display_name AS user_name,
    u.email AS user_email,
    tu.libelle AS user_type,
    st.Id_status,
    st.libelle AS status,
    st.couleur AS status_couleur,
    r.Id_reparation,
    r.surface_m2,
    r.budget,
    r.date_debut,
    r.date_fin_prevue,
    r.date_fin_reelle,
    r.commentaire AS reparation_commentaire,
    e.Id_entreprise,
    e.nom AS entreprise_nom,
    e.telephone AS entreprise_tel,
    e.email AS entreprise_email,
    um.display_name AS manager_name,
    um.email AS manager_email
FROM
    Signalement s
    JOIN User_ u ON s.Id_user = u.Id_user
    JOIN TypeUser tu ON u.Id_type_user = tu.Id_type_user
    JOIN Status st ON s.Id_status = st.Id_status
    LEFT JOIN Reparation r ON s.Id_signalement = r.Id_signalement
    LEFT JOIN Entreprise e ON r.Id_entreprise = e.Id_entreprise
    LEFT JOIN User_ um ON r.Id_user = um.Id_user;

-- ============================================
-- FONCTIONS UTILITAIRES
-- ============================================

-- Fonction pour synchroniser un utilisateur depuis Firebase
CREATE OR REPLACE FUNCTION sync_user_from_firebase(
    p_firebase_uid VARCHAR(128),
    p_email VARCHAR(100),
    p_password VARCHAR(255),
    p_display_name VARCHAR(100) DEFAULT NULL,
    p_type_user INT DEFAULT 2
) RETURNS INTEGER AS $$
DECLARE
    v_user_id INTEGER;
BEGIN
    INSERT INTO User_ (firebase_uid, email, password, display_name, Id_type_user, derniere_sync)
    VALUES (p_firebase_uid, p_email, p_password, p_display_name, p_type_user, CURRENT_TIMESTAMP)
    ON CONFLICT (firebase_uid) 
    DO UPDATE SET 
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        display_name = EXCLUDED.display_name,
        derniere_sync = CURRENT_TIMESTAMP
    RETURNING Id_user INTO v_user_id;
    
    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour créer une session
CREATE OR REPLACE FUNCTION create_session(
    p_user_id INT,
    p_token VARCHAR(500),
    p_ip_address VARCHAR(45) DEFAULT NULL,
    p_user_agent VARCHAR(500) DEFAULT NULL
) RETURNS INT AS $$
DECLARE
    v_session_id INT;
    v_expiration_heures INT;
BEGIN
    SELECT valeur::INT INTO v_expiration_heures 
    FROM Parametre WHERE nom = 'session_expiration_heures';
    
    IF v_expiration_heures IS NULL THEN 
        v_expiration_heures := 24; 
    END IF;
    
    INSERT INTO Session (Id_user, token, date_expiration, ip_address, user_agent)
    VALUES (
        p_user_id, 
        p_token, 
        CURRENT_TIMESTAMP + (v_expiration_heures || ' hours')::INTERVAL, 
        p_ip_address, 
        p_user_agent
    )
    RETURNING Id_session INTO v_session_id;
    
    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour valider une session
CREATE OR REPLACE FUNCTION validate_session(p_token VARCHAR(500)) 
RETURNS TABLE (
    user_id INT,
    email VARCHAR(100),
    display_name VARCHAR(100),
    type_user INT,
    est_bloque BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.Id_user,
        u.email,
        u.display_name,
        u.Id_type_user,
        u.est_bloque
    FROM Session s
    JOIN User_ u ON s.Id_user = u.Id_user
    WHERE s.token = p_token 
      AND s.est_active = TRUE 
      AND s.date_expiration > CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour récupérer un paramètre
CREATE OR REPLACE FUNCTION get_parametre(p_nom VARCHAR(100)) 
RETURNS VARCHAR(255) AS $$
DECLARE
    v_valeur VARCHAR(255);
BEGIN
    SELECT valeur INTO v_valeur FROM Parametre WHERE nom = p_nom;
    RETURN v_valeur;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour définir un paramètre
CREATE OR REPLACE FUNCTION set_parametre(
    p_nom VARCHAR(100),
    p_valeur VARCHAR(255)
) RETURNS VOID AS $$
BEGIN
    UPDATE Parametre 
    SET valeur = p_valeur, date_modification = CURRENT_TIMESTAMP 
    WHERE nom = p_nom;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour compter les tentatives échouées récentes
CREATE OR REPLACE FUNCTION count_recent_failed_attempts(
    p_email VARCHAR(100),
    p_minutes INT DEFAULT 30
) RETURNS INT AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM TentativeConnexion
    WHERE email = p_email 
      AND succes = FALSE 
      AND date_tentative > CURRENT_TIMESTAMP - (p_minutes || ' minutes')::INTERVAL;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour nettoyer les sessions expirées
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() 
RETURNS INT AS $$
DECLARE
    v_deleted INT;
BEGIN
    DELETE FROM Session 
    WHERE date_expiration < CURRENT_TIMESTAMP OR est_active = FALSE;
    
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================
-- NOTES D'UTILISATION
-- ============================================
--
-- Structure Firebase Firestore:
--
-- Collection "users":
-- {
--   firebase_uid: string,
--   email: string,
--   password: string,
--   display_name: string,
--   id_type_user: number,
--   id_user: number,
--   est_bloque: boolean,
--   date_creation: timestamp,
--   derniere_sync: timestamp
-- }
--
-- Collection "signalements":
-- {
--   postgres_id: number,
--   location: GeoPoint,
--   description: string,
--   date_signalement: timestamp,
--   user: { id_user, display_name, email },
--   status: { id_status, libelle, couleur },
--   sync_version: number
-- }
--
-- Collection "reparations":
-- {
--   id_reparation: number,
--   surface_m2: number,
--   budget: number,
--   date_debut: timestamp,
--   date_fin_prevue: timestamp,
--   date_fin_reelle: timestamp,
--   commentaire: string,
--   id_signalement: number,
--   id_entreprise: number,
--   status: { id, libelle }
-- }
--
-- Collection "entreprises":
-- {
--   id_entreprise: number,
--   nom: string,
--   telephone: string,
--   email: string,
--   adresse: string
-- }
--
-- MODES D'AUTHENTIFICATION:
--
-- 1. MODE EN LIGNE (Firebase disponible):
--    - Inscription: Firebase Auth + Firestore + PostgreSQL
--    - Connexion: Firebase Auth → API vérifie le token
--    - Le mot de passe est synchronisé vers PostgreSQL
--
-- 2. MODE HORS LIGNE (Firebase non disponible):
--    - Connexion: Vérification mot de passe dans PostgreSQL
--    - Fonctionne si utilisateur s'est connecté au moins une fois en ligne
--