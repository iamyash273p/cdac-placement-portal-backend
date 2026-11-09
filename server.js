const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());

const PORT = process.env.PORT || 7500;
const JWT_SECRET = process.env.JWT_SECRET || 'cdac_placement_secure_jwt_key_2026';

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD =
  process.env.DB_PASSWORD && process.env.DB_PASSWORD !== 'password'
    ? process.env.DB_PASSWORD
    : 'root';
const DB_NAME = process.env.DB_NAME || 'cdac_placement';

let db;

function runQuery(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

async function startServer() {
  const initConnection = mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD
  });

  try {
    await runQuery(initConnection, `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await runQuery(initConnection, `USE \`${DB_NAME}\``);

    // 1. Students Table
    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        prn VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(120) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20) DEFAULT '',
        address VARCHAR(255) DEFAULT '',
        passout_year INT DEFAULT 2026,
        tenth_marks VARCHAR(20) DEFAULT '',
        twelfth_marks VARCHAR(20) DEFAULT '',
        degree_marks VARCHAR(20) DEFAULT '',
        cmce_marks VARCHAR(20) DEFAULT '',
        ccee_marks VARCHAR(20) DEFAULT '',
        status VARCHAR(30) DEFAULT 'Unplaced',
        company VARCHAR(100) DEFAULT '-',
        photo LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    // 2. Admins Table
    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(120) NOT NULL UNIQUE,
        phone VARCHAR(20) DEFAULT '',
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    // 3. Drives Table
    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS drives (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company VARCHAR(100) NOT NULL,
        role VARCHAR(100) NOT NULL,
        package VARCHAR(50) NOT NULL,
        location VARCHAR(100) NOT NULL,
        drive_date VARCHAR(50) NOT NULL,
        passout_year INT DEFAULT 2026,
        criteria VARCHAR(255) DEFAULT '',
        status VARCHAR(30) DEFAULT 'Active',
        rounds_completed INT DEFAULT 2,
        total_rounds INT DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    // 4. Drive Shortlists Table (Maps which students are shortlisted for which drive)
    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS drive_shortlists (
        id INT AUTO_INCREMENT PRIMARY KEY,
        drive_id INT NOT NULL,
        student_id INT NOT NULL,
        rounds_completed INT DEFAULT 1,
        total_rounds INT DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_drive_student (drive_id, student_id)
      )`
    );

    // 5. Student Queries / Chat Messages Table
    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS student_queries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT DEFAULT NULL,
        student_name VARCHAR(100) NOT NULL,
        student_email VARCHAR(120) NOT NULL,
        prn VARCHAR(50) DEFAULT '',
        subject VARCHAR(200) DEFAULT 'General Placement Query',
        sender_role VARCHAR(20) DEFAULT 'student',
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    // Seed Default Admin if empty
    const adminRows = await runQuery(initConnection, 'SELECT COUNT(*) AS count FROM admins');
    if (adminRows[0].count === 0) {
      const hashedAdminPass = await bcrypt.hash('admin123', 10);
      await runQuery(
        initConnection,
        'INSERT INTO admins (name, email, phone, password) VALUES (?, ?, ?, ?)',
        ['Placement Officer', 'admin@cdac.in', '9822011223', hashedAdminPass]
      );
      console.log('Default Admin seeded -> Email: admin@cdac.in | Password: admin123');
    }

    // Seed Sample Students if empty
    const studentRows = await runQuery(initConnection, 'SELECT COUNT(*) AS count FROM students');
    if (studentRows[0].count === 0) {
      const stuHash = await bcrypt.hash('student123', 10);
      const sampleStudents = [
        ['Aarav Deshmukh', 'CDAC2026001', 'aarav@cdac.in', stuHash, '9876543210', 'Kothrud, Pune', 2026, '84%', '79%', '74%', '82', '86', 'Placed', 'TCS (7.0 LPA)'],
        ['Sneha Kulkarni', 'CDAC2026002', 'sneha@cdac.in', stuHash, '9823012345', 'Wakad, Pune', 2026, '88%', '83%', '81%', '89', '91', 'Placed', 'Infosys (9.5 LPA)'],
        ['Rohan Patil', 'CDAC2026003', 'rohan@cdac.in', stuHash, '9765432109', 'Andheri, Mumbai', 2026, '72%', '70%', '68%', '74', '71', 'Unplaced', '-'],
        ['Priya Nair', 'CDAC2026004', 'priya@cdac.in', stuHash, '9890123456', 'Baner, Pune', 2026, '85%', '80%', '77%', '84', '80', 'Placed', 'Accenture (6.5 LPA)']
      ];
      await runQuery(
        initConnection,
        'INSERT INTO students (name, prn, email, password, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, status, company) VALUES ?',
        [sampleStudents]
      );
      console.log('Default Students seeded -> Email: aarav@cdac.in | Password: student123');
    }

    // Seed Sample Drives if empty
    const driveRows = await runQuery(initConnection, 'SELECT COUNT(*) AS count FROM drives');
    if (driveRows[0].count === 0) {
      const sampleDrives = [
        ['TCS', 'Java Full Stack Developer', '7.0 LPA', 'Pune', '15 Nov 2026', 2026, '60% throughout academics', 'Shortlisted', 3, 3],
        ['Infosys', 'Specialist Programmer', '9.5 LPA', 'Pune / Hyderabad', '18 Nov 2026', 2026, 'No active backlogs', 'Shortlisted', 2, 4],
        ['Accenture', 'Advanced App Engineering Analyst', '6.5 LPA', 'Mumbai', '20 Nov 2026', 2026, '60% in Graduation', 'Shortlisted', 2, 3],
        ['Siemens', 'R&D Software Engineer', '11.0 LPA', 'Bengaluru / Pune', '28 Nov 2026', 2026, '70% in Graduation', 'Shortlisted', 3, 4]
      ];
      await runQuery(
        initConnection,
        'INSERT INTO drives (company, role, package, location, drive_date, passout_year, criteria, status, rounds_completed, total_rounds) VALUES ?',
        [sampleDrives]
      );

      // Seed initial shortlists so Student 1 (aarav@cdac.in) has 2 shortlisted drives right away
      const allStus = await runQuery(initConnection, 'SELECT id FROM students ORDER BY id ASC');
      const allDrvs = await runQuery(initConnection, 'SELECT id FROM drives ORDER BY id ASC');
      if (allStus.length > 0 && allDrvs.length >= 2) {
        await runQuery(
          initConnection,
          'INSERT IGNORE INTO drive_shortlists (drive_id, student_id, rounds_completed, total_rounds) VALUES (?, ?, 2, 3), (?, ?, 3, 3)',
          [allDrvs[0].id, allStus[0].id, allDrvs[1].id, allStus[0].id]
        );
      }
    }

    // Seed a sample student query if empty
    const queryRows = await runQuery(initConnection, 'SELECT COUNT(*) AS count FROM student_queries');
    if (queryRows[0].count === 0) {
      await runQuery(
        initConnection,
        'INSERT INTO student_queries (student_name, student_email, prn, subject, sender_role, message) VALUES (?, ?, ?, ?, ?, ?)',
        ['Aarav Deshmukh', 'aarav@cdac.in', 'CDAC2026001', 'TCS Technical Round Schedule', 'student', 'Hello Sir, when will the TCS final interview round timings be announced?']
      );
    }

    initConnection.end();
    console.log(`Database "${DB_NAME}" and all 5 tables are ready.`);

    db = mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('MySQL Startup Error:', err.message);
    initConnection.end();
  }
}

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

    const query = 'INSERT INTO students (name, prn, email, password, passout_year) VALUES (?, ?, ?, ?, ?)';

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
        user: { id: result.insertId, name, email, prn, passout_year: batchYear }
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// --- 2. LOGIN ENDPOINT (Email + Password for both Student and Admin) ---
app.post('/api/auth/login', (req, res) => {
  const { email, prn, password } = req.body;
  const identifier = (email || prn || '').trim();

  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const studentQuery = 'SELECT * FROM students WHERE email = ? OR prn = ?';
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

    const adminQuery = 'SELECT * FROM admins WHERE email = ? OR name = ?';
    db.query(adminQuery, [identifier, identifier], async (adminErr, adminResults) => {
      if (adminErr) {
        return res.status(500).json({ success: false, message: 'Database error.' });
      }

      if (adminResults.length === 0) {
        return res.status(400).json({ success: false, message: 'Account with this email not found.' });
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
        user: { id: admin.id, name: admin.name, email: admin.email, phone: admin.phone }
      });
    });
  });
});

// --- 3. GET ALL STUDENTS ENDPOINT ---
app.get('/api/students', (req, res) => {
  const query = 'SELECT id, name, prn, email, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, status, company, photo, created_at FROM students ORDER BY id DESC';
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

// --- 4. GET ALL DRIVES (With Shortlisted Student Count) ---
app.get('/api/drives', (req, res) => {
  const query = `
    SELECT d.*,
      (SELECT COUNT(*) FROM drive_shortlists ds WHERE ds.drive_id = d.id) AS shortlisted_count
    FROM drives d
    ORDER BY d.id DESC
  `;
  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error fetching drives.' });
    }
    res.status(200).json({ success: true, drives: results });
  });
});

// --- 5. SHORTLISTING ENDPOINTS (Admin Checkboxes -> Student Dashboard Visibility) ---

// Get shortlisted student IDs for a specific drive
app.get('/api/drives/:driveId/shortlist', (req, res) => {
  const driveId = req.params.driveId;
  db.query(
    'SELECT student_id, rounds_completed, total_rounds FROM drive_shortlists WHERE drive_id = ?',
    [driveId],
    (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.status(200).json({
        success: true,
        shortlistedStudentIds: results.map((r) => r.student_id),
        records: results
      });
    }
  );
});

// Save/Update shortlisted student IDs (checked checkboxes) for a specific drive
app.post('/api/admin/drives/:driveId/shortlist', (req, res) => {
  const driveId = Number(req.params.driveId);
  const { studentIds } = req.body; // Array of checked student IDs

  if (!Array.isArray(studentIds)) {
    return res.status(400).json({ success: false, message: 'studentIds array is required.' });
  }

  db.query('DELETE FROM drive_shortlists WHERE drive_id = ?', [driveId], (delErr) => {
    if (delErr) {
      return res.status(500).json({ success: false, message: delErr.message });
    }

    if (studentIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Shortlist updated (0 students selected).'
      });
    }

    const values = studentIds.map((stuId) => [driveId, Number(stuId), 2, 3]);
    db.query(
      'INSERT INTO drive_shortlists (drive_id, student_id, rounds_completed, total_rounds) VALUES ?',
      [values],
      (insErr) => {
        if (insErr) {
          return res.status(500).json({ success: false, message: insErr.message });
        }
        res.status(200).json({
          success: true,
          message: `Shortlisted ${studentIds.length} student(s) for this drive.`
        });
      }
    );
  });
});

// Get ONLY the drives where a specific student is shortlisted by admin
app.get('/api/student/shortlisted-drives', (req, res) => {
  const { studentId, email, prn } = req.query;

  let sql = `
    SELECT d.*, ds.rounds_completed AS student_rounds_completed, ds.total_rounds AS student_total_rounds
    FROM drives d
    INNER JOIN drive_shortlists ds ON d.id = ds.drive_id
    INNER JOIN students s ON s.id = ds.student_id
  `;
  const params = [];

  if (studentId) {
    sql += ' WHERE s.id = ?';
    params.push(Number(studentId));
  } else if (email) {
    sql += ' WHERE s.email = ?';
    params.push(email);
  } else if (prn) {
    sql += ' WHERE s.prn = ?';
    params.push(prn);
  } else {
    // If no filter provided, return drives that have at least one shortlist entry
    sql = `
      SELECT DISTINCT d.*
      FROM drives d
      INNER JOIN drive_shortlists ds ON d.id = ds.drive_id
    `;
  }

  sql += ' ORDER BY d.id DESC';

  db.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({
      success: true,
      drives: results.map((d) => ({
        ...d,
        status: 'Shortlisted',
        rounds_completed: d.student_rounds_completed ?? d.rounds_completed ?? 2,
        total_rounds: d.student_total_rounds ?? d.total_rounds ?? 3
      }))
    });
  });
});

// --- 6. STUDENT QUERIES / CHAT SYSTEM ENDPOINTS ---

// Get chat messages (filtered by studentEmail if student, or all messages if admin)
app.get('/api/queries', (req, res) => {
  const { email } = req.query;
  let sql = 'SELECT * FROM student_queries';
  const params = [];

  if (email) {
    sql += ' WHERE student_email = ?';
    params.push(email);
  }

  sql += ' ORDER BY created_at ASC, id ASC';

  db.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, queries: results });
  });
});

// Post a new query or chat reply (works for both Student and Admin)
app.post('/api/queries', (req, res) => {
  const { student_id, student_name, student_email, prn, subject, sender_role, message } = req.body;

  if (!student_email || !message) {
    return res.status(400).json({ success: false, message: 'Student email and message are required.' });
  }

  const sql = `
    INSERT INTO student_queries (student_id, student_name, student_email, prn, subject, sender_role, message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      student_id || null,
      student_name || 'Student',
      student_email,
      prn || '',
      subject || 'Placement Query',
      sender_role || 'student',
      message
    ],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.status(201).json({
        success: true,
        message: 'Message sent successfully.',
        id: result.insertId
      });
    }
  );
});

// --- 7. ADMIN: ADD NEW STUDENT ENDPOINT ---
app.post('/api/admin/students', async (req, res) => {
  const { name, prn, email, password, phone, address, passout_year, tenthMarks, twelfthMarks, degreeMarks, cmceMarks, cceeMarks, status, company, photo } = req.body;

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || 'student123', salt);
    const studentEmail = email || `${prn.toLowerCase()}@cdac.in`;

    const query = 'INSERT INTO students (name, prn, email, password, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, status, company, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

    db.query(query, [
      name, prn, studentEmail, hashedPassword, phone || '', address || '', passout_year || 2026,
      tenthMarks || '', twelfthMarks || '', degreeMarks || '', cmceMarks || '', cceeMarks || '',
      status || 'Unplaced', company || '-', photo || null
    ], (err) => {
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

// --- 8. ADMIN: CREATE DRIVE ENDPOINT ---
app.post('/api/admin/drives', (req, res) => {
  const { company, role, package: pkg, location, drive_date, date, passout_year, criteria, status, rounds_completed, total_rounds } = req.body;

  const query = 'INSERT INTO drives (company, role, package, location, drive_date, passout_year, criteria, status, rounds_completed, total_rounds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

  db.query(query, [
    company,
    role,
    pkg,
    location,
    drive_date || date || '',
    passout_year || 2026,
    criteria || '',
    status || 'Active',
    rounds_completed || 1,
    total_rounds || 3
  ], (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(201).json({ success: true, message: 'Drive created successfully.' });
  });
});

// --- 9. ADMIN: CREATE NEW ADMIN ENDPOINT ---
app.post('/api/admin/create', async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || !password) {
    return res.status(400).json({ success: false, message: 'Admin name and password are required.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const adminEmail = email || `${name.toLowerCase().replace(/\s+/g, '.')}@cdac.in`;

    const query = 'INSERT INTO admins (name, email, phone, password) VALUES (?, ?, ?, ?)';

    db.query(query, [name, adminEmail, phone || '', hashedPassword], (err) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ success: false, message: 'Admin already exists.' });
        }
        return res.status(500).json({ success: false, message: err.message });
      }

      res.status(201).json({ success: true, message: 'Admin created successfully.' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error creating admin.' });
  }
});

// --- 10. ADMIN: UPDATE STUDENT ENDPOINT ---
app.put('/api/admin/students/:id', (req, res) => {
  const studentId = req.params.id;
  const { name, prn, email, phone, address, status, company, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks } = req.body;

  const query = 'UPDATE students SET name = ?, prn = ?, email = ?, phone = ?, address = ?, status = ?, company = ?, tenth_marks = ?, twelfth_marks = ?, degree_marks = ?, cmce_marks = ?, ccee_marks = ? WHERE id = ?';

  db.query(query, [
    name, prn, email, phone, address, status, company || '-',
    tenth_marks || '', twelfth_marks || '', degree_marks || '', cmce_marks || '', ccee_marks || '', studentId
  ], (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Student updated successfully.' });
  });
});

// --- 11. ADMIN: DELETE STUDENT ENDPOINT ---
app.delete('/api/admin/students/:id', (req, res) => {
  const studentId = req.params.id;
  db.query('DELETE FROM students WHERE id = ?', [studentId], (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Student deleted successfully.' });
  });
});

// --- 12. ADMIN: DELETE DRIVE ENDPOINT ---
app.delete('/api/admin/drives/:id', (req, res) => {
  const driveId = req.params.id;
  db.query('DELETE FROM drive_shortlists WHERE drive_id = ?', [driveId], () => {
    db.query('DELETE FROM drives WHERE id = ?', [driveId], (err) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.status(200).json({ success: true, message: 'Drive deleted successfully.' });
    });
  });
});

startServer();
