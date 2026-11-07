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
  const { name, prn, email, password, passout_year } = req.body;

  if (!name || !prn || !email || !password) {
    return res.status(400).json({ success: false, message: 'All required fields must be filled.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const batchYear = passout_year || 2026;

    const query = `INSERT INTO students (name, prn, email, password, passout_year) VALUES (?, ?, ?, ?, ?)`;

    db.query(query, [name, prn, email, hashedPassword, batchYear], (err, result) => {
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
        user: { name, email, prn, passout_year: batchYear }
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// --- 2. LOGIN ENDPOINT (Supports Students & Admins) ---
app.post('/api/auth/login', (req, res) => {
  const { email, prn, password } = req.body;
  const identifier = email || prn;

  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'PRN/Email and password are required.' });
  }

  // Check students table first
  const studentQuery = `SELECT * FROM students WHERE email = ? OR prn = ?`;
  db.query(studentQuery, [identifier, identifier], async (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }

    if (results.length > 0) {
      const student = results[0];
      const isMatch = await bcrypt.compare(password, student.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Invalid password.' });
      }

      const token = jwt.sign({ id: student.id, email: student.email, prn: student.prn }, JWT_SECRET, { expiresIn: '24h' });
      return res.status(200).json({
        success: true,
        role: 'student',
        token,
        user: { name: student.name, email: student.email, prn: student.prn, passout_year: student.passout_year }
      });
    }

    // Check admins table
    const adminQuery = `SELECT * FROM admins WHERE email = ?`;
    db.query(adminQuery, [identifier], async (adminErr, adminResults) => {
      if (adminErr) {
        return res.status(500).json({ success: false, message: 'Database error.' });
      }

      if (adminResults.length === 0) {
        return res.status(400).json({ success: false, message: 'User not found in database.' });
      }

      const admin = adminResults[0];
      const isAdminMatch = await bcrypt.compare(password, admin.password);
      if (!isAdminMatch) {
        return res.status(400).json({ success: false, message: 'Invalid password.' });
      }

      const token = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
      return res.status(200).json({
        success: true,
        role: 'admin',
        token,
        user: { name: admin.name, email: admin.email }
      });
    });
  });
});

// --- 3. GET ALL STUDENTS ENDPOINT ---
app.get('/api/students', (req, res) => {
  const query = `SELECT id, name, prn, email, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, status, company, photo, created_at FROM students`;
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

// --- 4. GET ALL DRIVES ENDPOINT ---
app.get('/api/drives', (req, res) => {
  const query = `SELECT * FROM drives`;
  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error fetching drives.' });
    }
    res.status(200).json({ success: true, drives: results });
  });
});

// --- 5. ADMIN: ADD NEW STUDENT ENDPOINT ---
app.post('/api/admin/students', async (req, res) => {
  const { name, prn, email, password, phone, address, passout_year, tenthMarks, twelfthMarks, degreeMarks, cmceMarks, cceeMarks, status, company, photo } = req.body;

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || 'cdac123', salt);
    const studentEmail = email || `${prn.toLowerCase()}@cdac.in`;

    const query = `INSERT INTO students (name, prn, email, password, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, status, company, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(query, [
      name, prn, studentEmail, hashedPassword, phone || '', address || '', passout_year || 2026,
      tenthMarks || '', twelfthMarks || '', degreeMarks || '', cmceMarks || '', cceeMarks || '',
      status || 'Unplaced', company || '-', photo || null
    ], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ success: false, message: 'Student with this email or PRN already exists.' });
        }
        return res.status(500).json({ success: false, message: err.message });
      }
      res.status(201).json({ success: true, message: 'Student added successfully.' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error adding student.' });
  }
});

// --- 6. ADMIN: CREATE DRIVE ENDPOINT ---
app.post('/api/admin/drives', (req, res) => {
  const { company, role, package, location, drive_date, passout_year, criteria, status } = req.body;

  const query = `INSERT INTO drives (company, role, package, location, drive_date, passout_year, criteria, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(query, [
    company, 
    role, 
    package, 
    location, 
    drive_date, 
    passout_year || 2026, 
    criteria || '', 
    status || 'Active'
  ], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(201).json({ success: true, message: 'Drive created successfully.' });
  });
});

// --- 7. ADMIN: CREATE NEW ADMIN ENDPOINT ---
app.post('/api/admin/create', async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ success: false, message: 'All admin fields are required.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const query = `INSERT INTO admins (name, email, phone, password) VALUES (?, ?, ?, ?)`;

    db.query(query, [name, email, phone, hashedPassword], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ success: false, message: 'Admin with this email already exists.' });
        }
        return res.status(500).json({ success: false, message: err.message });
      }

      res.status(201).json({ success: true, message: 'Admin created successfully.' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error creating admin.' });
  }
});

// --- 8. ADMIN: UPDATE STUDENT ENDPOINT ---
app.put('/api/admin/students/:id', async (req, res) => {
  const studentId = req.params.id;
  const { name, prn, email, phone, address, status, company, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks } = req.body;

  const query = `UPDATE students SET name = ?, prn = ?, email = ?, phone = ?, address = ?, status = ?, company = ?, tenth_marks = ?, twelfth_marks = ?, degree_marks = ?, cmce_marks = ?, ccee_marks = ? WHERE id = ?`;

  db.query(query, [
    name, prn, email, phone, address, status, company || '-',
    tenth_marks || '', twelfth_marks || '', degree_marks || '', cmce_marks || '', ccee_marks || '', studentId
  ], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Student updated successfully.' });
  });
});

// --- 9. ADMIN: DELETE STUDENT ENDPOINT ---
app.delete('/api/admin/students/:id', (req, res) => {
  const studentId = req.params.id;
  const query = `DELETE FROM students WHERE id = ?`;

  db.query(query, [studentId], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Student deleted successfully.' });
  });
});

// --- 10. ADMIN: DELETE DRIVE ENDPOINT ---
app.delete('/api/admin/drives/:id', (req, res) => {
  const driveId = req.params.id;
  const query = `DELETE FROM drives WHERE id = ?`;

  db.query(query, [driveId], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Drive deleted successfully.' });
  });
});

// Server Listen
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  console.log(`Accessible on your network at http://192.168.0.200:${PORT}`);
});