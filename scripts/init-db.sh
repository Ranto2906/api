#!/bin/bash
# ============================================
# Script d'initialisation de la base de données
# Exécuté automatiquement au premier démarrage du conteneur PostgreSQL
# ============================================

set -e

echo "🚀 Initialisation de la base de données Travaux Routiers..."

# Activer l'extension PostGIS si nécessaire
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Vérifier que PostGIS est bien installé
    CREATE EXTENSION IF NOT EXISTS postgis;
    
    -- Log de confirmation
    SELECT 'PostGIS version: ' || PostGIS_Version();
EOSQL

echo "✅ Base de données initialisée avec succès!"
echo "📊 PostGIS activé"
echo "📁 Le schéma sera chargé depuis schema.sql"
