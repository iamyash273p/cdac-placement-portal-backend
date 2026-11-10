const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

// 1. Register Student (POST /api/auth/register)
exports.registerStudent = async (req, res) => {
  const { name, prn, email, password, passout_year } = req.body;

  if (!name || !prn || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'All required fields must be filled.'
    });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const batchYear = passout_year || 2026;

    const query = `INSERT INTO students (name, prn, email, password, passout_year) VALUES (?, ?, ?, ?, ?)`;

    db.query(query, [name, prn, email, hashedPassword, batchYear], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({
            success: false,
            message: 'Student with this email or PRN already exists.'
          });
        }
        return res.status(500).json({ success: false, message: err.message });
      }

      const token = jwt.sign(
        { id: result.insertId, email, prn, role: 'student' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.status(201).json({
        success: true,
        role: 'student',
        token,
        user: { id: result.insertId, name, email, prn, passout_year: batchYear }
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

// 2. Login Student or Admin (POST /api/auth/login)
exports.login = (req, res) => {
  const { email, prn, password } = req.body;
  const identifier = (email || prn || '').trim();

  if (!identifier || !password) {
    return res.status(400).json({
      success: false,
      message: 'PRN/Email and password are required.'
    });
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

      const token = jwt.sign(
        { id: student.id, email: student.email, prn: student.prn, role: 'student' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      return res.status(200).json({
        success: true,
        role: 'student',
        token,
        user: {
          id: student.id,
          name: student.name,
          email: student.email,
          prn: student.prn,
          phone: student.phone,
          photo: student.photo,
          passout_year: student.passout_year
        }
      });
    }

    // Check admins table next
    const adminQuery = `SELECT * FROM admins WHERE email = ?`;
    db.query(adminQuery, [identifier], async (adminErr, adminResults) => {
      if (adminErr) {
        return res.status(500).json({ success: false, message: 'Database error.' });
      }

      if (adminResults.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'User not found in database.'
        });
      }

      const admin = adminResults[0];
      const isAdminMatch = await bcrypt.compare(password, admin.password);
      if (!isAdminMatch) {
        return res.status(400).json({ success: false, message: 'Invalid password.' });
      }

      const token = jwt.sign(
        { id: admin.id, email: admin.email, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      return res.status(200).json({
        success: true,
        role: 'admin',
        token,
        user: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          phone: admin.phone,
          photo: admin.photo
        }
      });
    });
  });
};

// 3. Update Profile (PUT /api/auth/profile)
exports.updateProfile = (req, res) => {
  const { id, role, email, phone, photo } = req.body;
  if (!id || !email) {
    return res.status(400).json({ success: false, message: 'User ID and email are required.' });
  }

  const table = role === 'admin' ? 'admins' : 'students';
  const query = `UPDATE ${table} SET email = ?, phone = ?, photo = ? WHERE id = ?`;

  db.query(query, [email, phone || '', photo || null, id], (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Profile updated successfully.' });
  });
};
