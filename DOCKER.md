# 🐳 Déploiement Docker - Travaux Routiers API

## Prérequis

- Docker 20.10+
- Docker Compose 2.0+

## 🚀 Démarrage rapide

### Option 1: Script automatique (recommandé)

```bash
./scripts/docker-start.sh
```

### Option 2: Commandes manuelles

```bash
# Créer le fichier .env
cp .env.example .env
# Modifier les valeurs si nécessaire

# Construire et démarrer
docker compose up -d --build

# Voir les logs
docker compose logs -f
```

## 📍 Endpoints

| Service | URL |
|---------|-----|
| API | http://localhost:3001 |
| Documentation Swagger | http://localhost:3001/api/docs |
| Health Check | http://localhost:3001/health |

## 🗄️ Base de données

La base de données PostgreSQL avec PostGIS est automatiquement initialisée au premier démarrage avec le schéma complet.

**Connexion:**
- Host: `localhost`
- Port: `5432`
- Database: `travaux_routiers`
- User: `postgres`
- Password: (défini dans `.env`)

## 🔥 Firebase (Optionnel)

Pour activer la synchronisation Firebase:

1. Téléchargez votre fichier de service account depuis la console Firebase
2. Renommez-le en `firebase-service-account.json`
3. Placez-le à la racine du projet

L'application fonctionne en mode hors ligne si Firebase n'est pas configuré.

## 📋 Commandes utiles

```bash
# Voir les logs en temps réel
docker compose logs -f

# Voir les logs d'un service spécifique
docker compose logs -f api
docker compose logs -f postgres

# Redémarrer l'API
docker compose restart api

# Arrêter les conteneurs
docker compose down
# ou
./scripts/docker-stop.sh

# Arrêter et supprimer les données
docker compose down -v

# Reconstruire l'image
docker compose build --no-cache

# Accéder au shell PostgreSQL
docker compose exec postgres psql -U postgres -d travaux_routiers

# Accéder au shell de l'API
docker compose exec api sh
```

## 🔧 Configuration

Modifiez le fichier `.env` pour personnaliser:

```env
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=votre_mot_de_passe
POSTGRES_DB=travaux_routiers
POSTGRES_PORT=5432

# API
NODE_ENV=production
API_PORT=3001
```

## 🏗️ Structure Docker

```
├── Dockerfile              # Image API (multi-stage build)
├── docker-compose.yml      # Orchestration des services
├── .dockerignore           # Fichiers exclus du build
├── .env                    # Variables d'environnement
├── database/
│   └── schema.sql          # Schéma BDD (auto-chargé)
└── scripts/
    ├── init-db.sh          # Initialisation PostgreSQL
    ├── docker-start.sh     # Script de démarrage
    └── docker-stop.sh      # Script d'arrêt
```

## 🔍 Dépannage

### L'API ne démarre pas
```bash
# Vérifier les logs
docker compose logs api

# Vérifier que PostgreSQL est prêt
docker compose exec postgres pg_isready
```

### Erreur de connexion à la base
```bash
# Vérifier que le conteneur PostgreSQL fonctionne
docker compose ps

# Tester la connexion
docker compose exec postgres psql -U postgres -d travaux_routiers -c "SELECT 1"
```

### Réinitialiser complètement
```bash
docker compose down -v
docker compose up -d --build
```
