const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 7500;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

// Create MySQL Connection Pool
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'cdac_placement',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection on startup
db.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to MySQL database:', err.message);
  } else {
    console.log('Connected to local MySQL database server.');
    connection.release();
  }
});

// --- 1. REGISTER ENDPOINT ---
app.post('/api/auth/register', async (req, res) => {
  const { name, prn, email, password } = req.body;

  if (!name || !prn || !email || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const query = `INSERT INTO students (name, prn, email, password) VALUES (?, ?, ?, ?)`;

    db.query(query, [name, prn, email, hashedPassword], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ success: false, message: 'Student with this email or PRN already exists.' });
        }
        return res.status(500).json({ success: false, message: err.message });
      }

      const token = jwt.sign({ id: result.insertId, email, prn }, JWT_SECRET, { expiresIn: '24h' });

      res.status(201).json({
        success: true,
        token,
        user: { name, email, prn }
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// --- 2. LOGIN ENDPOINT ---
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const query = `SELECT * FROM students WHERE email = ?`;
  db.query(query, [email], async (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
    if (results.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    const student = results[0];

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    // const token = jwt.sign({ id: student.id, email: student.email, prn: student.prn }, JWT_SECRET, { expiresIn: '24h' });

    res.status(200).json({
      success: true,
      token,
      user: { name: student.name, email: student.email, prn: student.prn }
    });
  });
});

// --- 3. GET ALL STUDENTS ENDPOINT ---
app.get('/api/students', (req, res) => {
  const query = `SELECT id, name, prn, email, created_at FROM students`;
  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error fetching students.' });
    }
    res.status(200).json({
      success: true,
      count: results.length,
      students: results
    });
  });
});

// Put it right here at the very bottom:
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  console.log(`Accessible on your network at http://192.168.0.200:${PORT}`);
});