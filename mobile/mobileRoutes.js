const express = require('express');
const multer = require('multer');
const path = require('path');
const { Client } = require('pg');
const fs = require('fs');

const router = express.Router();

// Config multer pour upload images
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Connexion DB (mieux : mettre dans un fichier config à part)
const connectionString = 'postgresql://postgres:AGUxlTJrdeSrMFzvurAXpKkcjIPKwlMa@hopper.proxy.rlwy.net:15556/railway';

// Rendre les images accessibles publiquement (à faire dans app.js)
// router.use('/uploads', express.static(uploadDir));  // Attention : à placer dans app.js

// Routes mobiles

// Récupérer tous les produits disponibles
router.get('/products', async (req, res) => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  } finally {
    await client.end();
  }
});

// Récupérer tous les produits disponibles
router.get('/clients', async (req, res) => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query('SELECT id,name,mobile,adresse,gps FROM clients');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  } finally {
    await client.end();
  }
});



// Récupérer les modes de paiement
router.get('/mode_paiments', async (req, res) => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query( `SELECT * FROM modes_paiement WHERE mode != 'Régle Credit'`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  } finally {
    await client.end();
  }
});

// Upload d'une image
router.post('/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image reçue' });

  const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.status(200).json({ message: 'Image uploadée avec succès', url: imageUrl });
});

// Ajouter une commande avec ses items
router.post('/add_order', async (req, res) => {
  const {
    user_id,
    client_id,
    client_name,
    client_mobile,
    client_adresse,
    client_gps,
    date_order,
    items,
    total
  } = req.body;

  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query('BEGIN');

    let finalClientId;

    // ✅ Si client_id est bien un nombre valide (différent de null/undefined/0/"")
    if (client_id && !isNaN(client_id)) {
      finalClientId = client_id;
    } else {
      // ✅ Créer un nouveau client dans la table clients
      const createClientQuery = `
        INSERT INTO clients (name, mobile, adresse, gps)
        VALUES ($1, $2, $3, $4)
        RETURNING id;
      `;
      const createClientValues = [client_name, client_mobile, client_adresse, client_gps];
      const newClient = await client.query(createClientQuery, createClientValues);
      finalClientId = newClient.rows[0].id;
    }

    // ✅ Créer la commande
    const orderQuery = `
      INSERT INTO orders (user_id, client_id, date_order, total)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `;
    const orderValues = [user_id, finalClientId, date_order, total];
    const orderResult = await client.query(orderQuery, orderValues);
    const orderId = orderResult.rows[0].id;

    // ✅ Insérer les items + Mettre à jour le stock
    const itemQuery = `
      INSERT INTO order_items (order_id, product_id, quantity, price, discount)
      VALUES ($1, $2, $3, $4, $5)
    `;
    const updateStockQuery = `
      UPDATE products
      SET qtt_stock = qtt_stock - $2
      WHERE id = $1
    `;

    for (const item of items) {
      const { product_id, quantity, price, discount } = item;
      await client.query(itemQuery, [orderId, product_id, quantity, price, discount]);
      await client.query(updateStockQuery, [product_id, quantity]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Commande ajoutée avec succès', order_id: orderId });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Erreur lors de l\'ajout de la commande');
  } finally {
    await client.end();
  }
});


// Récupérer les commandes d'un utilisateur
router.get('/orders/:user_id', async (req, res) => {
  const userId = req.params.user_id;
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const ordersResult = await client.query(`
      SELECT
        orders.*,
        clients.name AS client_name,
        clients.mobile AS client_mobile,
        clients.adresse AS client_adresse,
        clients.gps AS client_gps
      FROM orders
      JOIN clients ON orders.client_id = clients.id
      WHERE orders.user_id = $1
      ORDER BY orders.id DESC
    `, [userId]);
    const orders = ordersResult.rows;

    for (const order of orders) {
      const itemsResult = await client.query(`
        SELECT oi.id AS item_id, oi.quantity, oi.price, oi.discount AS remise, oi.line_total AS total_ligne, p.id AS product_id, p.name AS product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `, [order.id]);

      order.items = itemsResult.rows;
    }

    res.json({ orders });

  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de la récupération des commandes');
  } finally {
    await client.end();
  }
});

// Récupérer les livraisons pour un livreur
router.get('/mes_livraisons/:user_id', async (req, res) => {
  const userId = req.params.user_id;
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const ordersResult = await client.query(`
        SELECT
            o.*,
            c.name AS client_name,
            c.mobile AS client_mobile,
            c.adresse AS client_adresse,
            c.gps AS client_gps
        FROM orders o
        JOIN clients c ON o.client_id = c.id
        WHERE o.delivery_user_id = $1
        ORDER BY o.id DESC;
    `, [userId]);

    const orders = ordersResult.rows;

    for (const order of orders) {
      const itemsResult = await client.query(`
        SELECT oi.id AS item_id, oi.quantity, oi.price, oi.discount AS remise, oi.line_total AS total_ligne, p.id AS product_id, p.name AS product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `, [order.id]);

      order.items = itemsResult.rows;
    }

    res.json({ deliveries: orders });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de la récupération des livraisons');
  } finally {
    await client.end();
  }
});

// Récupérer paiements d'une commande
router.get('/paiements/:order_id', async (req, res) => {
  const orderId = req.params.order_id;
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const result = await client.query(`
      SELECT p.montant, m.mode
      FROM paiement p
      JOIN modes_paiement m ON p.mode_paiement_id = m.id
      WHERE p.order_id = $1
    `, [orderId]);
    res.json({ paiements: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de la récupération des paiements');
  } finally {
    await client.end();
  }
});

// Login utilisateur
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const query = 'SELECT id, email, user_level FROM users WHERE email = $1 AND password = $2 and actif=true';
    const result = await client.query(query, [email, password]);

    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(401).json({ message: 'Identifiants invalides' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur');
  } finally {
    await client.end();
  }
});

// Clôturer une commande avec paiements
router.post('/cloture_commande', async (req, res) => {
  const { order_id, paiements = [], credit_sur_commande } = req.body;

  if (!order_id) return res.status(400).json({ message: 'order_id est requis' });
  if (typeof credit_sur_commande !== 'number') return res.status(400).json({ message: 'credit_sur_commande doit être un nombre' });

  const client = new Client({ connectionString });

  try {
    await client.connect();
    const updateQuery = `
      UPDATE orders
      SET status = 'livrée',
          cloture_date = NOW(),
          credit_sur_commande = $2
      WHERE id = $1
      RETURNING *;
    `;
    const result = await client.query(updateQuery, [order_id, credit_sur_commande]);

    if (result.rowCount === 0) return res.status(404).json({ message: 'Commande non trouvée' });

    for (const paiement of paiements) {
      if (typeof paiement.mode_paiement_id !== 'number' || typeof paiement.montant !== 'number') {
        return res.status(400).json({ message: 'Paiement invalide' });
      }

      await client.query('INSERT INTO paiement (order_id, mode_paiement_id, montant) VALUES ($1, $2, $3)', [order_id, paiement.mode_paiement_id, paiement.montant]);
    }

    res.json({ message: 'Commande clôturée avec paiements enregistrés', order: result.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de la clôture de la commande');
  } finally {
    await client.end();
  }
});

module.exports = router;
