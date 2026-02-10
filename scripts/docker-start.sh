#!/bin/bash
# ============================================
# Script de démarrage Docker - Travaux Routiers
# ============================================

set -e

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🚀 Travaux Routiers API - Docker Setup   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Vérifier si Docker est installé
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker n'est pas installé. Veuillez l'installer d'abord.${NC}"
    exit 1
fi

# Vérifier si Docker Compose est installé
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose n'est pas installé. Veuillez l'installer d'abord.${NC}"
    exit 1
fi

# Créer le fichier .env s'il n'existe pas
if [ ! -f .env ]; then
    echo -e "${YELLOW}📝 Création du fichier .env...${NC}"
    cat > .env << EOF
# Configuration Docker - Travaux Routiers API
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=travaux_routiers
POSTGRES_PORT=5432
NODE_ENV=production
API_PORT=3001
EOF
    echo -e "${GREEN}✅ Fichier .env créé avec les valeurs par défaut${NC}"
else
    echo -e "${GREEN}✅ Fichier .env existant détecté${NC}"
fi

# Vérifier le fichier Firebase (optionnel)
if [ -f firebase-service-account.json ]; then
    echo -e "${GREEN}✅ Fichier Firebase service account détecté${NC}"
else
    echo -e "${YELLOW}⚠️  Fichier firebase-service-account.json non trouvé${NC}"
    echo -e "${YELLOW}   L'application fonctionnera en mode hors ligne${NC}"
fi

echo ""
echo -e "${BLUE}🔨 Construction des images Docker...${NC}"

# Utiliser docker compose ou docker-compose selon ce qui est disponible
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Construire les images
$COMPOSE_CMD build

echo ""
echo -e "${BLUE}🚀 Démarrage des conteneurs...${NC}"

# Démarrer les conteneurs
$COMPOSE_CMD up -d

echo ""
echo -e "${BLUE}⏳ Attente du démarrage des services...${NC}"

# Attendre que PostgreSQL soit prêt
echo -n "   PostgreSQL: "
until $COMPOSE_CMD exec -T postgres pg_isready -U postgres -d travaux_routiers &> /dev/null; do
    echo -n "."
    sleep 2
done
echo -e " ${GREEN}✅${NC}"

# Attendre que l'API soit prête
echo -n "   API Node.js: "
sleep 5
until curl -s http://localhost:${API_PORT:-3001}/health > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo -e " ${GREEN}✅${NC}"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Déploiement terminé avec succès!       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📍 Endpoints disponibles:${NC}"
echo -e "   • API:          http://localhost:${API_PORT:-3001}"
echo -e "   • Documentation: http://localhost:${API_PORT:-3001}/api/docs"
echo -e "   • Health Check:  http://localhost:${API_PORT:-3001}/health"
echo ""
echo -e "${BLUE}📊 Base de données:${NC}"
echo -e "   • Host: localhost:${POSTGRES_PORT:-5432}"
echo -e "   • Database: ${POSTGRES_DB:-travaux_routiers}"
echo ""
echo -e "${YELLOW}💡 Commandes utiles:${NC}"
echo -e "   • Voir les logs:     $COMPOSE_CMD logs -f"
echo -e "   • Arrêter:           $COMPOSE_CMD down"
echo -e "   • Redémarrer l'API:  $COMPOSE_CMD restart api"
echo -e "   • Réinitialiser DB:  $COMPOSE_CMD down -v && $COMPOSE_CMD up -d"
echo ""
echo -e "${YELLOW}💻 Mode développement (hot-reload):${NC}"
echo -e "   $COMPOSE_CMD -f docker-compose.dev.yml up -d"
echo ""
