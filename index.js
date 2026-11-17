const express = require('express');
const path = require('path');
const { Pool, types } = require('pg');
 
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
 
types.setTypeParser(1082, (v) => v);
 
const pool = new Pool({
  host: process.env.DB_HOST || 'csce-315-db.engr.tamu.edu',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'squad_42_db',
  user: process.env.DB_USER || 'squad_42',
  password: process.env.DB_PASS,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});
 
const app = express();
app.use(express.json());
require('./translation')(app);
require('./assistant')(app, pool);
require('./auth')(app, pool);
app.use(express.static(path.join(__dirname, 'public')));
 
const TABLES = {
  menu_items: { id: 'item_id', cols: ['name', 'category', 'price'] },
  inventory: { id: 'inventory_id', cols: ['name', 'category', 'unit', 'quantity_left'] },
  employees: { id: 'employee_id', cols: ['employee_name', 'employee_role', 'shift_length', 'hire_date'] },
};

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  };
}
 
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
 
app.get('/api/menu', route(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT item_id AS id, name, category, price::float FROM menu_items WHERE active ORDER BY item_id'
  );
  res.json(rows);
}));
 
app.post('/api/orders', route(async (req, res) => {
  const { items, payment } = req.body;
  if (!Array.isArray(items) || items.length === 0) fail(400, 'Your order is empty.');
 
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
 
    const ids = items.map((i) => i.id);
    const prices = await client.query('SELECT item_id, price FROM menu_items WHERE active AND item_id = ANY($1)', [ids]);
    const priceOf = Object.fromEntries(prices.rows.map((r) => [r.item_id, Number(r.price)]));
    if (ids.some((id) => priceOf[id] === undefined)) fail(400, 'A drink in your order is no longer on the menu.');
    const total = items.reduce((sum, i) => sum + priceOf[i.id], 0);
 
    await client.query('LOCK TABLE sales_history IN SHARE ROW EXCLUSIVE MODE');
    const order = await client.query(
      `INSERT INTO sales_history (order_id, order_timestamp, order_total, payment_method)
       VALUES ((SELECT COALESCE(MAX(order_id), 0) + 1 FROM sales_history), NOW(), $1, $2)
       RETURNING order_id`,
      [total.toFixed(2), payment]
    );
    const orderId = order.rows[0].order_id;
 
    for (const i of items) {
      await client.query(
        'INSERT INTO individual_drinks (order_id, item_id, sugar_level, ice_level) VALUES ($1, $2, $3, $4)',
        [orderId, i.id, i.sugar, i.ice]
      );
    }

    app.get('/api/orders', async (req, res) => {
      try {
        // Replace 'orders' and column names with your actual PostgreSQL table schema
        const result = await pool.query('SELECT * FROM sales_history ORDER BY id DESC');
        res.json(result.rows);
      } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).json({ error: err.message });
      }
    });

 app.get('/api/orders', route(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      s.order_id,
      s.order_timestamp,
      s.order_total,
      s.payment_method,
      s.order_status
      COALESCE(
        json_agg(
          json_build_object(
            'item_id', d.item_id,
            'name', m.item_name,
            'price', m.price,
            'sugar', d.sugar_level,
            'ice', d.ice_level
          )
        ) FILTER (WHERE d.item_id IS NOT NULL),
        '[]'
      ) AS items
    FROM sales_history s
    LEFT JOIN individual_drinks d ON s.order_id = d.order_id
    LEFT JOIN menu_items m ON d.item_id = m.item_id
    GROUP BY s.order_id, s.order_timestamp, s.order_total, s.payment_method
    ORDER BY s.order_id DESC
    LIMIT 50
  `);

  res.json(rows);
}));

    await client.query(
      `UPDATE inventory inv SET quantity_left = inv.quantity_left - used.amount
       FROM (SELECT g.inventory_id, SUM(g.quantity_used) AS amount
             FROM unnest($1::int[]) AS drink(item_id)
             JOIN ingredients g ON g.menu_item_id = drink.item_id
             GROUP BY g.inventory_id) used
       WHERE inv.inventory_id = used.inventory_id`,
      [ids]
    );

    await client.query('COMMIT');
    res.json({ orderId, total });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));
 
function tableFor(req) {
  const t = TABLES[req.params.table];
  if (!t) fail(404, 'Unknown table.');
  return t;
}
 
function valuesFrom(t, body) {
  const values = t.cols.map((c) => String(body[c] ?? '').trim());
  if (values.some((v) => v === '')) fail(400, 'Fill in every field.');
  return values;
}

app.get('/api/orders/today', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.order_id AS id,
            to_char(s.order_timestamp, 'HH12:MI AM') AS time,
            s.payment_method AS payment,
            json_agg(json_build_object('name', m.name, 'sugar', d.sugar_level, 'ice', d.ice_level)) AS items
     FROM sales_history s
     JOIN individual_drinks d ON d.order_id = s.order_id
     JOIN menu_items m ON m.item_id = d.item_id
     WHERE s.order_timestamp >= CURRENT_DATE
     GROUP BY s.order_id
     ORDER BY s.order_id`
  );
  res.json(rows);
}));

app.get('/api/manage/:table', route(async (req, res) => {
  const t = tableFor(req);
  const where = req.params.table === 'menu_items' ? 'WHERE active' : '';
  const { rows } = await pool.query(
    `SELECT ${t.id} AS id, ${t.cols.join(', ')} FROM ${req.params.table} ${where} ORDER BY ${t.id}`
  );
  res.json({ cols: t.cols, rows });
}));
 
app.post('/api/manage/:table', route(async (req, res) => {
  const t = tableFor(req);
  const values = valuesFrom(t, req.body);
  const params = values.map((_, n) => `$${n + 1}`).join(', ');
  await pool.query(
    `INSERT INTO ${req.params.table} (${t.id}, ${t.cols.join(', ')})
     VALUES ((SELECT COALESCE(MAX(${t.id}), 0) + 1 FROM ${req.params.table}), ${params})`,
    values
  );
  res.json({ ok: true });
}));
 
app.put('/api/manage/:table/:id', route(async (req, res) => {
  const t = tableFor(req);
  const values = valuesFrom(t, req.body);
  const sets = t.cols.map((c, n) => `${c} = $${n + 1}`).join(', ');
  await pool.query(
    `UPDATE ${req.params.table} SET ${sets} WHERE ${t.id} = $${values.length + 1}`,
    [...values, req.params.id]
  );
  res.json({ ok: true });
}));
 
app.delete('/api/manage/:table/:id', route(async (req, res) => {
  const t = tableFor(req);
  const id = req.params.id;
  if (req.params.table === 'menu_items') {
    await pool.query('UPDATE menu_items SET active = FALSE WHERE item_id = $1', [id]);
  } else {
    if (req.params.table === 'inventory') {
      await pool.query('DELETE FROM ingredients WHERE inventory_id = $1', [id]);
    }
    await pool.query(`DELETE FROM ${req.params.table} WHERE ${t.id} = $1`, [id]);
  }
  res.json({ ok: true });
}));
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Open http://localhost:${PORT}`);
  try {
    await pool.query('ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE');
    console.log('Connected to the database');
  } catch (err) {
    console.log('Could not connect to the database:', err.message);
  }
});
