const bcrypt = require('bcryptjs');
const { db } = require('../config/db');

// Create New Admin Account (POST /api/admin/create)
exports.createAdmin = async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || !email || !phone || !password) {
    return res.status(400).json({
      success: false,
      message: 'All admin fields are required.'
    });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const query = `INSERT INTO admins (name, email, phone, password) VALUES (?, ?, ?, ?)`;

    db.query(query, [name, email, phone, hashedPassword], (err) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({
            success: false,
            message: 'Admin with this email already exists.'
          });
        }
        return res.status(500).json({ success: false, message: err.message });
      }

      res.status(201).json({
        success: true,
        message: 'Admin created successfully.'
      });
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error creating admin.'
    });
  }
};
