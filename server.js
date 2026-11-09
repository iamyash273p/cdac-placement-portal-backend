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
const DB_PORT = process.env.DB_PORT || 3306;
const JWT_SECRET = process.env.JWT_SECRET || 'cdac_placement_secure_jwt_key_2026';

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
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

function calculateInitialCalls(cmce, ccee) {
  return '20 Calls';
}

async function startServer() {
  const initConnection = mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    port: DB_PORT
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
        calls VARCHAR(50) DEFAULT '',
        calls_used INT DEFAULT 0,
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

    // 3. Drives Table (Clean schema without rounds)
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    // 4. Drive Shortlists Table
    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS drive_shortlists (
        id INT AUTO_INCREMENT PRIMARY KEY,
        drive_id INT NOT NULL,
        student_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_drive_student (drive_id, student_id)
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
        ['Aarav Deshmukh', 'CDAC2026001', 'aarav@cdac.in', stuHash, '9876543210', 'Kothrud, Pune', 2026, '84%', '79%', '74%', '82', '86', calculateInitialCalls('82', '86'), 0, 'Placed', 'TCS (7.0 LPA)'],
        ['Sneha Kulkarni', 'CDAC2026002', 'sneha@cdac.in', stuHash, '9823012345', 'Wakad, Pune', 2026, '88%', '83%', '81%', '89', '91', calculateInitialCalls('89', '91'), 0, 'Placed', 'Infosys (9.5 LPA)'],
        ['Rohan Patil', 'CDAC2026003', 'rohan@cdac.in', stuHash, '9765432109', 'Andheri, Mumbai', 2026, '72%', '70%', '68%', '74', '71', calculateInitialCalls('74', '71'), 0, 'Unplaced', '-'],
        ['Priya Nair', 'CDAC2026004', 'priya@cdac.in', stuHash, '9890123456', 'Baner, Pune', 2026, '85%', '80%', '77%', '84', '80', calculateInitialCalls('84', '80'), 0, 'Placed', 'Accenture (6.5 LPA)']
      ];
      await runQuery(
        initConnection,
        'INSERT INTO students (name, prn, email, password, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, calls, calls_used, status, company) VALUES ?',
        [sampleStudents]
      );
    }

    // Seed Sample Drives if empty
    const driveRows = await runQuery(initConnection, 'SELECT COUNT(*) AS count FROM drives');
    if (driveRows[0].count === 0) {
      const sampleDrives = [
        ['TCS', 'Java Full Stack Developer', '7.0 LPA', 'Pune', '15 Nov 2026', 2026, '60% throughout academics', 'Active'],
        ['Infosys', 'Specialist Programmer', '9.5 LPA', 'Pune / Hyderabad', '18 Nov 2026', 2026, 'No active backlogs', 'Active'],
        ['Accenture', 'Advanced App Engineering Analyst', '6.5 LPA', 'Mumbai', '20 Nov 2026', 2026, '60% in Graduation', 'Active'],
        ['Siemens', 'R&D Software Engineer', '11.0 LPA', 'Bengaluru / Pune', '28 Nov 2026', 2026, '70% in Graduation', 'Active']
      ];
      await runQuery(
        initConnection,
        'INSERT INTO drives (company, role, package, location, drive_date, passout_year, criteria, status) VALUES ?',
        [sampleDrives]
      );
    }

    initConnection.end();
    console.log(`Database "${DB_NAME}" tables are ready.`);

    db = mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      port: DB_PORT,
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
    const initialCalls = calculateInitialCalls('', '');

    const query = 'INSERT INTO students (name, prn, email, password, passout_year, calls) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(query, [name, prn, email, hashedPassword, batchYear, initialCalls], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ success: false, message: 'Student with this email or PRN already exists.' });
        }
        return res.status(500).json({ success: false, message: err.message });
      }

      const token = jwt.sign({ id: result.insertId, email, prn }, JWT_SECRET, { expiresIn: '24h' });
      res.status(201).json({ success: true, token, user: { id: result.insertId, name, email, prn, passout_year: batchYear, calls: initialCalls, calls_used: 0 } });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// --- 2. LOGIN ENDPOINT ---
app.post('/api/auth/login', (req, res) => {
  const { email, prn, password } = req.body;
  const identifier = (email || prn || '').trim();

  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const studentQuery = 'SELECT * FROM students WHERE email = ? OR prn = ?';
  db.query(studentQuery, [identifier, identifier], async (err, results) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });

    if (results.length > 0) {
      const student = results[0];
      const isMatch = await bcrypt.compare(password, student.password);
      if (!isMatch) return res.status(400).json({ success: false, message: 'Invalid password.' });

      const token = jwt.sign({ id: student.id, email: student.email, prn: student.prn }, JWT_SECRET, { expiresIn: '24h' });
      return res.status(200).json({
        success: true, role: 'student', token,
        user: { id: student.id, name: student.name, email: student.email, prn: student.prn, phone: student.phone, photo: student.photo, passout_year: student.passout_year, calls: student.calls || '', calls_used: student.calls_used || 0, status: student.status, company: student.company }
      });
    }

    const adminQuery = 'SELECT * FROM admins WHERE email = ? OR name = ?';
    db.query(adminQuery, [identifier, identifier], async (adminErr, adminResults) => {
      if (adminErr) return res.status(500).json({ success: false, message: 'Database error.' });
      if (adminResults.length === 0) return res.status(400).json({ success: false, message: 'Account not found.' });

      const admin = adminResults[0];
      const isAdminMatch = await bcrypt.compare(password, admin.password);
      if (!isAdminMatch) return res.status(400).json({ success: false, message: 'Invalid password.' });

      const token = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
      return res.status(200).json({
        success: true, role: 'admin', token,
        user: { id: admin.id, name: admin.name, email: admin.email, phone: admin.phone }
      });
    });
  });
});

// --- 3. GET ALL STUDENTS ---
app.get('/api/students', (req, res) => {
  const query = 'SELECT id, name, prn, email, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, calls, calls_used, status, company, photo, created_at FROM students ORDER BY id DESC';
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });
    res.status(200).json({ success: true, count: results.length, students: results });
  });
});

// --- 4. GET ALL ADMINS ---
app.get('/api/admins', (req, res) => {
  db.query('SELECT id, name, email, phone, created_at FROM admins ORDER BY id DESC', (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.status(200).json({ success: true, admins: results });
  });
});

// --- 5. GET ALL DRIVES ---
app.get('/api/drives', (req, res) => {
  const query = `
    SELECT d.*,
      (SELECT COUNT(*) FROM drive_shortlists ds WHERE ds.drive_id = d.id) AS shortlisted_count
    FROM drives d
    ORDER BY d.id DESC
  `;
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });
    res.status(200).json({ success: true, drives: results });
  });
});

// --- 6. SHORTLISTING ENDPOINTS ---
app.get('/api/drives/:driveId/shortlist', (req, res) => {
  const driveId = req.params.driveId;
  db.query('SELECT student_id FROM drive_shortlists WHERE drive_id = ?', [driveId], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.status(200).json({ success: true, shortlistedStudentIds: results.map((r) => r.student_id), records: results });
  });
});

app.post('/api/admin/drives/:driveId/shortlist', async (req, res) => {
  const driveId = Number(req.params.driveId);
  const { studentIds } = req.body;

  if (!Array.isArray(studentIds)) return res.status(400).json({ success: false, message: 'studentIds array is required.' });

  try {
    await runQuery(db, 'DELETE FROM drive_shortlists WHERE drive_id = ?', [driveId]);
    if (studentIds.length > 0) {
      const values = studentIds.map((stuId) => [driveId, Number(stuId)]);
      await runQuery(db, 'INSERT IGNORE INTO drive_shortlists (drive_id, student_id) VALUES ?', [values]);
    }

    // Automatically update calls_used for all students to match their total shortlists count
    await runQuery(db, `
      UPDATE students s
      SET s.calls_used = (SELECT COUNT(*) FROM drive_shortlists ds WHERE ds.student_id = s.id)
    `);

    res.status(200).json({ success: true, message: 'Shortlist updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/student/shortlisted-drives', (req, res) => {
  const { studentId, email, prn } = req.query;
  let sql = `
    SELECT d.*
    FROM drives d
    INNER JOIN drive_shortlists ds ON d.id = ds.drive_id
    INNER JOIN students s ON s.id = ds.student_id
  `;
  const params = [];

  if (studentId) {
    sql += ' WHERE s.id = ?'; params.push(Number(studentId));
  } else if (email) {
    sql += ' WHERE s.email = ?'; params.push(email);
  } else if (prn) {
    sql += ' WHERE s.prn = ?'; params.push(prn);
  } else {
    sql = 'SELECT DISTINCT d.* FROM drives d INNER JOIN drive_shortlists ds ON d.id = ds.drive_id';
  }

  sql += ' ORDER BY d.id DESC';
  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.status(200).json({
      success: true,
      drives: results.map((d) => ({ ...d, status: 'Shortlisted' }))
    });
  });
});

// --- 7. ADMIN: ADD STUDENT ---
app.post('/api/admin/students', async (req, res) => {
  const { name, prn, email, password, phone, address, passout_year, tenthMarks, twelfthMarks, degreeMarks, cmceMarks, cceeMarks, status, company, photo } = req.body;
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || 'student123', salt);
    const studentEmail = email || `${prn.toLowerCase()}@cdac.in`;
    const assignedCalls = calculateInitialCalls(cmceMarks, cceeMarks);

    const query = 'INSERT INTO students (name, prn, email, password, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, calls, status, company, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    db.query(query, [
      name, prn, studentEmail, hashedPassword, phone || '', address || '', passout_year || 2026,
      tenthMarks || '', twelfthMarks || '', degreeMarks || '', cmceMarks || '', cceeMarks || '',
      assignedCalls, status || 'Unplaced', company || '-', photo || null
    ], (err) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'Student already exists.' });
        return res.status(500).json({ success: false, message: err.message });
      }
      res.status(201).json({ success: true, message: 'Student added successfully.' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --- 8. ADMIN: BULK IMPORT STUDENTS FROM CSV ---
app.post('/api/admin/students/bulk', async (req, res) => {
  const { students } = req.body;

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ success: false, message: 'No student data provided.' });
  }

  let successCount = 0;
  let errorCount = 0;

  for (const stu of students) {
    try {
      const name = stu.name || stu.Name;
      const prn = stu.prn || stu.PRN;
      const email = stu.email || stu.Email || `${(prn || '').toLowerCase()}@cdac.in`;
      
      if (!name || !prn || !email || prn.toLowerCase() === 'prn' || email.toLowerCase() === 'email') {
        errorCount++;
        continue;
      }

      const rawPassword = stu.password || stu.Password || 'student123';
      const phone = stu.phone || stu.Phone || '';
      const address = stu.address || stu.Address || '';
      const passout_year = stu.passout_year || stu.PassoutYear || 2026;
      
      const tenth = stu.tenth_marks || stu.TenthMarks || stu['10th'] || '';
      const twelfth = stu.twelfth_marks || stu.TwelfthMarks || stu['12th'] || '';
      const degree = stu.degree_marks || stu.DegreeMarks || stu['graduation'] || '';
      const postgrad = stu.postgrad_marks || stu.PostGradMarks || stu['post grad'] || '';
      const cmce = stu.cmce_marks || stu.CMCEMarks || '';
      const ccee = stu.ccee_marks || stu.CCEEMarks || '';
      const status = stu.status || stu.Status || 'Unplaced';
      const company = stu.company || stu.Company || '-';

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(rawPassword, salt);
      const assignedCalls = calculateInitialCalls(cmce, ccee);
      const degreeFull = `${degree} ${postgrad && postgrad !== '-' ? '(PG: ' + postgrad + ')' : ''}`.trim();

      const query = `
        INSERT INTO students (name, prn, email, password, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, calls, status, company)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          name = VALUES(name),
          phone = VALUES(phone),
          status = VALUES(status),
          company = VALUES(company),
          tenth_marks = VALUES(tenth_marks),
          twelfth_marks = VALUES(twelfth_marks),
          degree_marks = VALUES(degree_marks),
          cmce_marks = VALUES(cmce_marks),
          ccee_marks = VALUES(ccee_marks),
          calls = VALUES(calls)
      `;

      await runQuery(db, query, [
        name, prn, email, hashedPassword, phone, address, passout_year,
        tenth, twelfth, degreeFull, cmce, ccee, assignedCalls, status, company
      ]);

      successCount++;
    } catch (err) {
      console.error('Bulk Import Row Error:', err.message);
      errorCount++;
    }
  }

  res.status(200).json({
    success: true,
    message: `Bulk import completed. Successfully imported: ${successCount}, Failed/Skipped: ${errorCount}`
  });
});

// --- 9. ADMIN: CREATE DRIVE ---
app.post('/api/admin/drives', (req, res) => {
  const { company, role, package: pkg, location, drive_date, criteria } = req.body;

  const query = `
    INSERT INTO drives (company, role, package, location, drive_date, passout_year, criteria, status) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(query, [
    company || 'Company', 
    role || 'Role', 
    pkg || '5.0 LPA', 
    location || 'Pune', 
    drive_date || '30 Nov 2026', 
    2026, 
    criteria || 'Standard CDAC criteria', 
    'Active'
  ], (err) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.status(201).json({ success: true, message: 'Drive created successfully.' });
  });
});

// --- 10. ADMIN: CREATE ADMIN ---
app.post('/api/admin/create', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !password) return res.status(400).json({ success: false, message: 'Name and password required.' });

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const adminEmail = email || `${name.toLowerCase().replace(/\s+/g, '.')}@cdac.in`;

    db.query('INSERT INTO admins (name, email, phone, password) VALUES (?, ?, ?, ?)', [name, adminEmail, phone || '', hashedPassword], (err) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.status(201).json({ success: true, message: 'Admin created successfully.' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --- 11. ADMIN: UPDATE STUDENT ---
app.put('/api/admin/students/:id', (req, res) => {
  const studentId = req.params.id;
  const { name, prn, email, phone, address, status, company, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, calls } = req.body;

  const calculatedCalls = calculateInitialCalls(cmce_marks, ccee_marks);
  const finalCalls = calls !== undefined && calls !== '' ? calls : calculatedCalls;

  const query = 'UPDATE students SET name = ?, prn = ?, email = ?, phone = ?, address = ?, status = ?, company = ?, tenth_marks = ?, twelfth_marks = ?, degree_marks = ?, cmce_marks = ?, ccee_marks = ?, calls = ? WHERE id = ?';
  db.query(query, [name, prn, email, phone, address, status, company || '-', tenth_marks || '', twelfth_marks || '', degree_marks || '', cmce_marks || '', ccee_marks || '', finalCalls, studentId], (err) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.status(200).json({ success: true, message: 'Student updated successfully.' });
  });
});

// --- 12. ADMIN: DELETE STUDENT ---
app.delete('/api/admin/students/:id', (req, res) => {
  db.query('DELETE FROM students WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.status(200).json({ success: true, message: 'Student deleted successfully.' });
  });
});

// --- 13. ADMIN: DELETE DRIVE ---
app.delete('/api/admin/drives/:id', (req, res) => {
  const driveId = req.params.id;
  db.query('DELETE FROM drive_shortlists WHERE drive_id = ?', [driveId], () => {
    db.query('DELETE FROM drives WHERE id = ?', [driveId], (err) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.status(200).json({ success: true, message: 'Drive deleted successfully.' });
    });
  });
});

// --- ADMIN: END / COMPLETE DRIVE ENDPOINT ---
app.put('/api/admin/drives/:id/complete', (req, res) => {
  const driveId = req.params.id;
  const query = `UPDATE drives SET status = 'Completed', drive_date = NULL WHERE id = ?`;

  db.query(query, [driveId], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Drive marked as completed and date cleared.' });
  });
});

startServer();