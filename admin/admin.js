const express = require('express');
const multer = require('multer');
const path = require('path');
const { Client } = require('pg');
const fs = require('fs');

const router = express.Router();

// Config multer pour upload images
//const uploadDir = path.join(__dirname, 'uploads');
const uploadDir = path.join(__dirname, '..', 'uploads');

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
// Exemple route admin simple
router.get('/dashboard', async (req, res) => {
  const client = new Client({ connectionString });

  try {
    await client.connect();

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    const previousMonth = `${now.getFullYear()}-${(now.getMonth()).toString().padStart(2, '0')}`;
    const currentYear = `${now.getFullYear()}`;

    // 📌 1. Statistiques générales
    const stats = await client.query(`
      SELECT
        SUM(CASE WHEN status = 'livrée' THEN credit_sur_commande ELSE 0 END) AS total_credit,
        COUNT(*) FILTER (WHERE status = 'livrée') AS nombre_commandes,
        SUM(CASE WHEN status = 'livrée' THEN total ELSE 0 END) AS chiffre
      FROM orders
    `);

    // 📌 2. Chiffre d'affaires par vendeur
    const vendorsStats = await client.query(`
      SELECT
        u.id,
        u.name,
        COALESCE(SUM(CASE WHEN TO_CHAR(o.date_order, 'YYYY-MM') = $1 THEN o.total ELSE 0 END), 0) AS chiffre_mois_courant,
        COALESCE(SUM(CASE WHEN TO_CHAR(o.date_order, 'YYYY-MM') = $2 THEN o.total ELSE 0 END), 0) AS chiffre_mois_precedent,
        COALESCE(SUM(CASE WHEN TO_CHAR(o.date_order, 'YYYY') = $3 THEN o.total ELSE 0 END), 0) AS chiffre_annuel,
        COALESCE(SUM(o.credit_sur_commande), 0) AS total_credits
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id AND o.status = 'livrée'
      WHERE u.user_level = 'vendeur' and u.actif=true
      GROUP BY u.id, u.name
      ORDER BY chiffre_annuel DESC;
    `, [currentMonth, previousMonth, currentYear]);



    // 📌 3. Liste des crédits clients
    const credits = await client.query(`
      SELECT
        o.total,
        o.credit_sur_commande,
        c.name AS nom_client,
        c.adresse AS adresse_client,
        (SELECT name FROM users WHERE users.id = o.user_id) AS vendeur,
        (SELECT name FROM users WHERE users.id = o.delivery_user_id) AS livreur,
        o.date_order,
        o.cloture_date
      FROM orders o
      JOIN clients c ON c.id = o.client_id
      WHERE o.credit_sur_commande > 0;
    `);

    res.json({
      stats: stats.rows[0],
      credits: credits.rows,
      vendeurs: vendorsStats.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur');
  } finally {
    await client.end();
  }
});



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


// Récupérer un produit par son ID
router.get('/get_product/:id', async (req, res) => {
  const client = new Client({ connectionString });
  const { id } = req.params;


  try {
    await client.connect();
    const result = await client.query('SELECT * FROM products WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Produit non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur de base de données');
  } finally {
    await client.end();
  }
});





// Route pour ajouter un produit avec image
// Route pour ajouter un produit avec image
router.post('/add-product', upload.single('image'), async (req, res) => {
  const { name, price, price2, available, qtt_stock } = req.body;
  const image = req.file ? req.file.filename : null;

  if (!name || !price || !price2 || !available || !qtt_stock || !image) {
    return res.status(400).json({ error: 'Tous les champs sont requis (nom, prix, prix2, disponible, stock, image)' });
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    const insertQuery = `
      INSERT INTO products (name, price, price2, imageurl, avalaible, qtt_stock)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`;
    const values = [name, price, price2, image, available, qtt_stock];
    const result = await client.query(insertQuery, values);

    res.status(201).json({ message: 'Produit ajouté avec succès', product: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de l\'ajout du produit');
  } finally {
    await client.end();
  }
});



router.put('/update-product/:id', upload.single('image'), async (req, res) => {
  const { name, price, price2, available, qtt_stock } = req.body;
  const availableBool = available === 'true' || available === true;
  const image = req.file ? req.file.filename : null;
  const productId = req.params.id;
  console.log(req.body);

  if (!name || !price || !price2 || typeof available === 'undefined' || available === null || !qtt_stock) {
    return res.status(400).json({ error: 'Tous les champs sauf l\'image sont requis' });
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();

    let updateQuery;
    let values;

    if (image) {
      updateQuery = `
        UPDATE products
        SET name = $1, price = $2, price2 = $3, imageurl = $4, avalaible = $5, qtt_stock = $6
        WHERE id = $7
        RETURNING *`;
      values = [name, price, price2, image, availableBool, qtt_stock, productId];
    } else {
      updateQuery = `
        UPDATE products
        SET name = $1, price = $2, price2 = $3, avalaible = $4, qtt_stock = $5
        WHERE id = $6
        RETURNING *`;
      values = [name, price, price2, availableBool, qtt_stock, productId];
    }

    const result = await client.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit non trouvé' });
    }

    res.status(200).json({ message: 'Produit mis à jour avec succès', product: result.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de la mise à jour du produit');
  } finally {
    await client.end();
  }
});


router.get('/users', async (req, res) => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM users ');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  } finally {
    await client.end();
  }
});

router.put('/cancel-order/:id', async (req, res) => {
  const orderId = req.params.id;
  const client = new Client({ connectionString });

  try {
    await client.connect(); // OBLIGATOIRE avant toute requête

    const result = await client.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      ['annulée', orderId]
    );


    await client.end();

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.json({ message: `Commande #${orderId} annulée avec succès.` });
  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'annulation de la commande.' });
  }
});




router.put('/cancel-order/:id', async (req, res) => {
  const orderId = req.params.id;
  const client = new Client({ connectionString });

  try {



    const [result] = await client.execute(
      'UPDATE orders SET status = ? WHERE id = ?',
      ['Annulée', orderId]
    );

    await client.end();

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Commande non trouvée.' });
    }

    res.json({ message: `Commande #${orderId} annulée avec succès.` });

  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur lors de l\'annulation de la commande.' });
  }
});




// Récupérer toutes les commandes avec items et paiements
router.get('/orders', async (req, res) => {
  const client = new Client({ connectionString });
  const query = `
   SELECT
      o.id,
      c.name as client_name ,
      c.mobile client_mobile,
      c.adresse client_adresse,
      c.gps client_gps,
      o.total,
      o.status,
      o.created_at,
      o.cloture_date,
      o.credit_sur_commande,
      u_creator.name AS creator_name,
      u_delivery.name AS delivery_name
    FROM orders o  JOIN clients c ON o.client_id = c.id
    JOIN users u_creator ON o.user_id = u_creator.id
    LEFT JOIN users u_delivery ON o.delivery_user_id = u_delivery.id
    ORDER BY o.id desc
  `;

  try {
    await client.connect();

    // 1. Récupérer toutes les commandes
    const ordersResult = await client.query(query);
    const orders = ordersResult.rows;

    // 2. Pour chaque commande, récupérer les items et paiements
    for (const order of orders) {

      // Items de la commande
      const itemsResult = await client.query(`
        SELECT
          oi.id AS item_id, oi.quantity, oi.price, oi.discount AS remise,
          oi.line_total AS total_ligne, p.id AS product_id, p.name AS product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `, [order.id]);

      // Paiements de la commande
      const paiementsResult = await client.query(`
        SELECT
          pa.id AS paiement_id, pa.montant, pa.date_paiement,
          mp.mode AS mode_paiement
        FROM paiement pa
        JOIN modes_paiement mp ON pa.mode_paiement_id = mp.id
        WHERE pa.order_id = $1
      `, [order.id]);

      order.items = itemsResult.rows;
      order.paiements = paiementsResult.rows;
    }

    // Résultat final
    res.json({ orders });

  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de la récupération des commandes');
  } finally {
    await client.end();
  }
});






router.get('/order-details/:id', async (req, res) => {
  const orderId = req.params.id;

  try {
    const connection = await mysql.createConnection(dbConfig);

    // Récupérer les items
    const [items] = await connection.execute(
      `SELECT
         p.name AS product_name,
         oi.quantity,
         oi.price,
         oi.discount AS remise,
         oi.line_total AS total_ligne
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    // Récupérer les paiements
    const [paiements] = await connection.execute(
      `SELECT
         pay.montant,
      pay.date_paiement,
      mp.mode
       FROM paiement pay
       JOIN modes_paiement mp ON pay.mode_paiement_id = mp.id
       WHERE pay.order_id = ? `,
      [orderId]
    );

    await connection.end();

    res.json({
      items,
      paiements
    });

  } catch (error) {
    console.error('Erreur serveur :', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des données' });
  }
});


// Assigner une livraison à une commande
router.post('/assign-delivery', async (req, res) => {
  const { order_id, delivery_id } = req.body;

  if (!order_id || !delivery_id) {
    return res.status(400).json({ message: 'Missing order_id or delivery_id' });
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();

    const sql = `
      UPDATE orders
      SET delivery_user_id = $1, status = 'en cours'
      WHERE id = $2
    `;

    const result = await client.query(sql, [delivery_id, order_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({ message: 'Order updated successfully' });

  } catch (err) {
    console.error('Error updating order:', err);
    res.status(500).json({ message: 'Database error' });
  } finally {
    await client.end();
  }
});



router.post('/add-user', async (req, res) => {
  const { nom, email, password, user_level } = req.body;

  if (!nom || !email || !password || !user_level) {
    return res.status(400).json({ error: 'Tous les champs sont requis (nom, email, mot de passe, niveau utilisateur)' });
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();

    const insertQuery = `
      INSERT INTO users (name, email, password, user_level)
      VALUES ($1, $2, $3, $4)
      RETURNING *`;

    const values = [nom, email, password, user_level];
    const result = await client.query(insertQuery, values);

    res.status(201).json({ message: 'Utilisateur ajouté avec succès', user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur lors de l\'ajout de l\'utilisateur');
  } finally {
    await client.end();
  }
});


// Exemple POST simple qui renvoie "hello"
router.post('/hello', (req, res) => {
  res.json({ message: 'hello' });
});

// Récupérer les modes de paiement
router.get('/mode_paiments', async (req, res) => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query('SELECT * FROM modes_paiement');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  } finally {
    await client.end();
  }
});

// Récupérer tous les clients avec leur nombre de commandes livrées et chiffre d'affaires
router.get('/clients', async (req, res) => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT
        client_id,
        c.name,
        c.adresse,
        c.mobile,
        COUNT(*) AS nombre_commandes,
        SUM(o.total) AS chiffre
      FROM orders o
      JOIN clients c ON o.client_id = c.id
      WHERE o.status = 'livrée'
      GROUP BY client_id, c.name, c.adresse, c.mobile
      ORDER BY chiffre DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  } finally {
    await client.end();
  }
});

router.post('/add-bulk-orders', async (req, res) => {
  const client = new Client({ connectionString });

  try {
    await client.connect();

    // 🔁 Générer 100 commandes
    for (let i = 0; i < 100; i++) {
      const userId = 2; // À adapter à tes IDs utilisateurs
      const clientId = 12; // À adapter à tes IDs clients
      const total = 102.2;
      const creditSurCommande = 0;
      const status = ['livrée', 'en attente', 'annulée'][Math.floor(Math.random() * 3)];
      const dateOrder = new Date(Date.now() - Math.random() * 10000000000); // Date aléatoire récente


      await client.query(`
        INSERT INTO orders (user_id, client_id, total, credit_sur_commande, status, date_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, clientId, total, creditSurCommande, status, dateOrder]);
    }

    res.status(201).json({ message: '100 commandes ajoutées avec succès' });
  } catch (error) {
    console.error('Erreur lors de l\'ajout des commandes :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    await client.end();
  }
});


// Ajoute tes routes admin ici

module.exports = router;
