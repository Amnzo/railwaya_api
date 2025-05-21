const express = require('express');
const path = require('path');
const app = express();
const cors = require('cors');
// ✅ Pour parser les requêtes avec un corps JSON plus volumineux
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // utile pour les formulaires
// Autoriser toutes les origines (tu peux limiter à un seul domaine plus tard)
app.use(cors());

// 🔥 Rendre le dossier uploads accessible publiquement
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 📱 Routes mobile
const mobileRoute = require('./mobile/mobileRoutes');
app.use('/mobile', mobileRoute);

// 🛠️ Routes admin
const adminRoutes = require('./admin/admin');
app.use('/admin', adminRoutes);

// 🚀 Démarrer le serveur
app.listen(3000, () => {
  console.log('Serveur démarré sur le port 3000');
});
