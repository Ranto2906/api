# ============================================
# Dockerfile - API Travaux Routiers
# Multi-stage build pour optimisation
# ============================================

# ============================================
# Stage 1: Builder
# ============================================
FROM node:18-bookworm-slim AS builder

# Installer les dépendances système pour la compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
COPY tsconfig.json ./

# Installer TOUTES les dépendances (y compris devDependencies pour tsc)
RUN npm ci

# Copier le code source
COPY src/ ./src/

# Compiler TypeScript
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:18-bookworm-slim AS production

# Installer uniquement les dépendances runtime nécessaires
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer uniquement les dépendances de production
RUN npm ci --only=production && npm cache clean --force

# Copier le code compilé depuis le builder
COPY --from=builder /app/dist ./dist

# Créer un utilisateur non-root pour la sécurité
RUN groupadd -g 1001 nodejs && \
    useradd -m -u 1001 -g nodejs apiuser

# Créer le répertoire pour les logs et donner les permissions
RUN mkdir -p /app/logs && \
    chown -R apiuser:nodejs /app

# Passer à l'utilisateur non-root
USER apiuser

# Exposer le port de l'API
EXPOSE 3001

# Définir les variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3001

# Commande de démarrage
CMD ["npm", "start"]

# Labels pour la documentation
LABEL maintainer="Travaux Routiers API"
LABEL version="1.0.0"
LABEL description="API REST pour la gestion des travaux routiers avec Firebase et PostgreSQL"
