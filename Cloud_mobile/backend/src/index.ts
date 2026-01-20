import 'dotenv/config';
import express from 'express';
import cors from 'cors';
// Initialiser Firebase AVANT les routes
import './config/firebase.js';
import signalementRoutes from './routes/signalements.js';
import authRoutes from './routes/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(',') || 'http://localhost:5173';

// Middleware
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
}));

app.use(express.json());

// Routes
app.use('/api/signalements', signalementRoutes);
app.use('/api/auth', authRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Erreur non gérée:', err);
  res.status(500).json({
    success: false,
    error: 'Erreur serveur interne',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API serveur en écoute sur le port ${PORT}`);
  console.log(`📍 Environnement: ${process.env.NODE_ENV || 'development'}`);
});
