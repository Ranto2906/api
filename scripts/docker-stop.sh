#!/bin/bash
# ============================================
# Script d'arrêt Docker - Travaux Routiers
# ============================================

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🛑 Arrêt des conteneurs Travaux Routiers...${NC}"

# Utiliser docker compose ou docker-compose
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

$COMPOSE_CMD down

echo -e "${GREEN}✅ Conteneurs arrêtés${NC}"
echo ""
echo -e "${BLUE}💡 Pour supprimer aussi les données:${NC}"
echo -e "   $COMPOSE_CMD down -v"
