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
const DRIVE_MARK_CRITERIA = [
  { studentField: 'tenth_marks', driveField: 'min_tenth_marks' },
  { studentField: 'twelfth_marks', driveField: 'min_twelfth_marks' },
  { studentField: 'degree_marks', driveField: 'min_degree_marks' },
  { studentField: 'cmce_marks', driveField: 'min_cmce_marks' },
  { studentField: 'ccee_marks', driveField: 'min_ccee_marks' }
];

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

function parseStudentMark(value) {
  const match = String(value ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*(?=%|\s|$)/);
  if (!match) return null;
  const mark = Number(match[1]);
  return mark >= 0 && mark <= 100 ? mark : null;
}

function isValidPercentage(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?\s*%?$/.test(text)) return false;
  const mark = Number(text.replace('%', '').trim());
  return Number.isFinite(mark) && mark >= 0 && mark <= 100;
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value.trim());
}

function isValidPhone(value) {
  return /^\d{10}$/.test(String(value ?? ''));
}

function studentMeetsDriveCriteria(student, drive) {
  if (String(student.status || '').trim().toLowerCase() === 'placed') return false;

  return DRIVE_MARK_CRITERIA.every(({ studentField, driveField }) => {
    const minimum = drive[driveField];
    if (minimum === null || minimum === undefined) return true;
    const mark = parseStudentMark(student[studentField]);
    return mark !== null && mark >= Number(minimum);
  });
}

async function syncDriveShortlist(driveId) {
  const [drive] = await runQuery(
    db,
    `SELECT status, deadline_date, shortlist_mode, ${DRIVE_MARK_CRITERIA.map(({ driveField }) => driveField).join(', ')}
     FROM drives WHERE id = ?`,
    [driveId]
  );
  if (!drive) throw new Error(`Drive ${driveId} was not found while updating its automatic shortlist.`);

  if (String(drive.status).toLowerCase() === 'completed' ||
    drive.shortlist_mode === 'manual' ||
    (drive.deadline_date && drive.deadline_date < getTodayInIndia())) return;

  const hasMinimums = DRIVE_MARK_CRITERIA.some(({ driveField }) =>
    drive[driveField] !== null && drive[driveField] !== undefined
  );
  if (!hasMinimums) return;

  const students = await runQuery(
    db,
    `SELECT id, status, ${DRIVE_MARK_CRITERIA.map(({ studentField }) => studentField).join(', ')}
     FROM students`
  );
  const previouslyShortlistedPlacedStudents = await runQuery(
    db,
    `SELECT ds.student_id
     FROM drive_shortlists ds
     INNER JOIN students s ON s.id = ds.student_id
     WHERE ds.drive_id = ? AND LOWER(TRIM(s.status)) = 'placed'`,
    [driveId]
  );
  const shortlistStudentIds = new Set([
    ...previouslyShortlistedPlacedStudents.map(({ student_id }) => Number(student_id)),
    ...students
      .filter((student) => studentMeetsDriveCriteria(student, drive))
      .map((student) => Number(student.id))
  ]);
  const shortlistRows = [...shortlistStudentIds].map((studentId) => [driveId, studentId]);

  await runQuery(db, 'DELETE FROM drive_shortlists WHERE drive_id = ?', [driveId]);
  if (shortlistRows.length > 0) {
    await runQuery(db, 'INSERT INTO drive_shortlists (drive_id, student_id) VALUES ?', [shortlistRows]);
    await runQuery(
      db,
      'INSERT IGNORE INTO student_drive_calls (student_id, drive_id) VALUES ?',
      [shortlistRows.map(([shortlistedDriveId, studentId]) => [studentId, shortlistedDriveId])]
    );
  }
  await runQuery(db, `
    UPDATE students s
    SET s.calls_used = (SELECT COUNT(*) FROM drive_shortlists ds WHERE ds.student_id = s.id)
  `);
}

async function syncAllAutomaticShortlists() {
  const criteriaColumns = DRIVE_MARK_CRITERIA.map(({ driveField }) => driveField);
  const configuredDrives = await runQuery(
    db,
    `SELECT id FROM drives
     WHERE shortlist_mode = 'automatic'
       AND (${criteriaColumns.map((column) => `${column} IS NOT NULL`).join(' OR ')})`
  );
  for (const drive of configuredDrives) {
    await syncDriveShortlist(drive.id);
  }
}
function getTodayInIndia() {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const dateValues = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  return `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
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
        calls_used_archived INT NOT NULL DEFAULT 0,
        status VARCHAR(30) DEFAULT 'Unplaced',
        company VARCHAR(100) DEFAULT '-',
        photo LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    const archivedCallsColumn = await runQuery(
      initConnection,
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'students' AND COLUMN_NAME = 'calls_used_archived'`,
      [DB_NAME]
    );
    if (archivedCallsColumn[0].count === 0) {
      await runQuery(
        initConnection,
        'ALTER TABLE students ADD COLUMN calls_used_archived INT NOT NULL DEFAULT 0'
      );
    }

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
        drive_date VARCHAR(50) NULL,
        deadline_date VARCHAR(10) NULL,
        min_tenth_marks DECIMAL(6,2) NULL,
        min_twelfth_marks DECIMAL(6,2) NULL,
        min_degree_marks DECIMAL(6,2) NULL,
        min_cmce_marks DECIMAL(6,2) NULL,
        min_ccee_marks DECIMAL(6,2) NULL,
        shortlist_mode VARCHAR(20) NOT NULL DEFAULT 'automatic',
        passout_year INT DEFAULT 2026,
        criteria VARCHAR(255) DEFAULT '',
        status VARCHAR(30) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    const deadlineColumn = await runQuery(
      initConnection,
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'drives' AND COLUMN_NAME = 'deadline_date'`,
      [DB_NAME]
    );
    if (deadlineColumn[0].count === 0) {
      await runQuery(initConnection, 'ALTER TABLE drives ADD COLUMN deadline_date VARCHAR(10) NULL');
    }
    for (const { driveField } of DRIVE_MARK_CRITERIA) {
      const column = await runQuery(
        initConnection,
        `SELECT COUNT(*) AS count
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'drives' AND COLUMN_NAME = ?`,
        [DB_NAME, driveField]
      );
      if (column[0].count === 0) {
        await runQuery(initConnection, `ALTER TABLE drives ADD COLUMN ${driveField} DECIMAL(6,2) NULL`);
      }
    }
    const shortlistModeColumn = await runQuery(
      initConnection,
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'drives' AND COLUMN_NAME = 'shortlist_mode'`,
      [DB_NAME]
    );
    if (shortlistModeColumn[0].count === 0) {
      await runQuery(
        initConnection,
        "ALTER TABLE drives ADD COLUMN shortlist_mode VARCHAR(20) NOT NULL DEFAULT 'automatic'"
      );
    }

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

    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS student_drive_calls (
        student_id INT NOT NULL,
        drive_id INT NOT NULL,
        PRIMARY KEY (student_id, drive_id)
      )`
    );
    await runQuery(
      initConnection,
      `INSERT IGNORE INTO student_drive_calls (student_id, drive_id)
       SELECT student_id, drive_id FROM drive_shortlists`
    );

    await runQuery(initConnection, `
      INSERT IGNORE INTO drive_shortlists (drive_id, student_id)
      SELECT dc.drive_id, dc.student_id
      FROM student_drive_calls dc
      INNER JOIN students s ON s.id = dc.student_id
      INNER JOIN drives d ON d.id = dc.drive_id
      WHERE LOWER(TRIM(s.status)) = 'placed'
    `);
    await runQuery(initConnection, `
      UPDATE students s
      SET s.calls_used = (SELECT COUNT(*) FROM drive_shortlists ds WHERE ds.student_id = s.id)
    `);

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
  const { email, password } = req.body;
  const loginEmail = typeof email === 'string' ? email.trim() : '';

  if (!loginEmail || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const studentQuery = 'SELECT * FROM students WHERE email = ?';
  db.query(studentQuery, [loginEmail], async (err, results) => {
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

    const adminQuery = 'SELECT * FROM admins WHERE email = ?';
    db.query(adminQuery, [loginEmail], async (adminErr, adminResults) => {
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
  const query = `
    SELECT s.id, s.name, s.prn, s.email, s.phone, s.address, s.passout_year,
      s.tenth_marks, s.twelfth_marks, s.degree_marks, s.cmce_marks, s.ccee_marks,
      s.calls, s.calls_used, s.status, s.company, s.photo, s.created_at,
      'student' AS role,
      (
        SELECT GROUP_CONCAT(
          DISTINCT CONCAT(d.company, ' - ', d.role)
          ORDER BY d.company, d.role SEPARATOR '|||'
        )
        FROM drive_shortlists ds
        INNER JOIN drives d ON d.id = ds.drive_id
        WHERE ds.student_id = s.id
      ) AS shortlisted_companies
    FROM students s
    ORDER BY s.id DESC
  `;
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });
    res.status(200).json({
      success: true,
      count: results.length,
      students: results.map((student) => ({
        ...student,
        shortlisted_companies: student.shortlisted_companies
          ? student.shortlisted_companies.split('|||')
          : []
      }))
    });
  });
});

// --- 4. GET ALL ADMINS ---
app.get('/api/admins', (req, res) => {
  db.query("SELECT id, name, email, phone, created_at, 'admin' AS role FROM admins ORDER BY id DESC", (err, results) => {
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
  db.query(
    `UPDATE drives SET status = 'Completed'
     WHERE deadline_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       AND deadline_date < ?
       AND status <> 'Completed'`,
    [getTodayInIndia()],
    (updateError) => {
      if (updateError) return res.status(500).json({ success: false, message: updateError.message });
      db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.status(200).json({
          success: true,
          drives: results.map((drive) => ({
            ...drive,
            status: String(drive.status).toLowerCase() === 'completed' ? 'Completed' : 'Ongoing'
          }))
        });
      });
    });
});

// --- 6. SHORTLISTING ENDPOINTS ---
app.get('/api/drives/:driveId/shortlist', (req, res) => {
  const driveId = req.params.driveId;
  db.query(
    `SELECT ds.student_id, s.name, s.prn, s.status
     FROM drive_shortlists ds
     INNER JOIN students s ON s.id = ds.student_id
     WHERE ds.drive_id = ?
     ORDER BY s.name`,
    [driveId],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.status(200).json({
        success: true,
        shortlistedStudentIds: results.map((student) => student.student_id),
        shortlistedStudents: results,
        records: results.map(({ student_id }) => ({ student_id }))
      });
    }
  );
});

app.post('/api/admin/drives/:driveId/shortlist', async (req, res) => {
  const driveId = Number(req.params.driveId);
  const { studentIds } = req.body;

  if (!Number.isInteger(driveId) || driveId <= 0 ||
    !Array.isArray(studentIds) ||
    studentIds.some((studentId) => !Number.isInteger(Number(studentId)) || Number(studentId) <= 0)) {
    return res.status(400).json({ success: false, message: 'A valid drive ID and studentIds array are required.' });
  }

  try {
    const [drive] = await runQuery(db, 'SELECT id FROM drives WHERE id = ?', [driveId]);
    if (!drive) return res.status(404).json({ success: false, message: 'Drive not found.' });

    const previouslyShortlistedPlacedStudents = await runQuery(
      db,
      `SELECT ds.student_id
       FROM drive_shortlists ds
       INNER JOIN students s ON s.id = ds.student_id
       WHERE ds.drive_id = ? AND LOWER(TRIM(s.status)) = 'placed'`,
      [driveId]
    );
    const existingPlacedStudentIds = new Set(
      previouslyShortlistedPlacedStudents.map(({ student_id }) => Number(student_id))
    );

    if (studentIds.length > 0) {
      const selectedStudents = await runQuery(
        db,
        'SELECT id, status FROM students WHERE id IN (?)',
        [studentIds.map(Number)]
      );
      const placedStudents = selectedStudents.filter(
        (student) =>
          String(student.status || '').trim().toLowerCase() === 'placed' &&
          !existingPlacedStudentIds.has(Number(student.id))
      );
      if (placedStudents.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Placed students cannot be added to a drive shortlist.',
          ineligibleStudentIds: placedStudents.map((student) => student.id)
        });
      }
    }

    const selectedIds = new Set([
      ...existingPlacedStudentIds,
      ...studentIds.map(Number)
    ]);

    await runQuery(db, 'DELETE FROM drive_shortlists WHERE drive_id = ?', [driveId]);
    if (selectedIds.size > 0) {
      const values = [...selectedIds].map((studentId) => [driveId, studentId]);
      await runQuery(db, 'INSERT IGNORE INTO drive_shortlists (drive_id, student_id) VALUES ?', [values]);
      await runQuery(
        db,
        'INSERT IGNORE INTO student_drive_calls (student_id, drive_id) VALUES ?',
        [values.map(([shortlistedDriveId, studentId]) => [studentId, shortlistedDriveId])]
      );
    }
    await runQuery(db, "UPDATE drives SET shortlist_mode = 'manual' WHERE id = ?", [driveId]);

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
    SELECT DISTINCT d.*
    FROM drives d
    INNER JOIN drive_shortlists ds ON d.id = ds.drive_id
    INNER JOIN students s ON s.id = ds.student_id
    WHERE 1 = 1
  `;
  const params = [];

  if (studentId) {
    sql += ' AND s.id = ?'; params.push(Number(studentId));
  } else if (email) {
    sql += ' AND s.email = ?'; params.push(email);
  } else if (prn) {
    sql += ' AND s.prn = ?'; params.push(prn);
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
  const marks = [tenthMarks, twelfthMarks, degreeMarks, cmceMarks, cceeMarks];
  if ([name, prn, email, password, phone, status, ...marks].some((value) =>
    value === null || value === undefined || String(value).trim() === ''
  )) {
    return res.status(400).json({ success: false, message: 'All student fields are required.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address, such as name@domain.com.' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: 'Phone number must contain exactly 10 digits.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
  }
  if (!['Unplaced', 'Placed'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Select a valid placement status.' });
  }
  if (marks.some((mark) => !isValidPercentage(mark))) {
    return res.status(400).json({ success: false, message: 'Student marks must be percentages between 0 and 100.' });
  }
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const studentEmail = email.trim();
    const assignedCalls = calculateInitialCalls(cmceMarks, cceeMarks);

    const query = 'INSERT INTO students (name, prn, email, password, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, calls, status, company, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    db.query(query, [
      name, prn, studentEmail, hashedPassword, phone, address || '', passout_year || 2026,
      tenthMarks, twelfthMarks, degreeMarks, cmceMarks, cceeMarks,
      assignedCalls, status, company || '-', photo || null
    ], async (err) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'Student already exists.' });
        return res.status(500).json({ success: false, message: err.message });
      }
      try {
        await syncAllAutomaticShortlists();
        res.status(201).json({ success: true, message: 'Student added successfully.' });
      } catch (syncError) {
        res.status(500).json({ success: false, message: `Student was added, but automatic shortlists could not be updated: ${syncError.message}` });
      }
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
      if ([tenth, twelfth, degree, cmce, ccee].some((mark) => !isValidPercentage(mark))) {
        errorCount++;
        continue;
      }

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

  try {
    await syncAllAutomaticShortlists();
    res.status(200).json({
      success: true,
      message: `Bulk import completed. Successfully imported: ${successCount}, Failed/Skipped: ${errorCount}`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Bulk import completed, but automatic shortlists could not be updated: ${err.message}`
    });
  }
});

const validateDriveFields = ({ company, role, package: pkg, location, drive_date, deadline_date, ...body }) => {
  const validDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const today = new Date().toISOString().slice(0, 10);

  if (!company?.trim() || !role?.trim() || !location?.trim()) {
    return 'Company, role, and location are required.';
  }
  if (typeof pkg !== 'number' || !Number.isFinite(pkg) || pkg <= 0 || !/^\d+(\.\d{1,2})?$/.test(String(pkg))) {
    return 'Package must be a positive number with up to two decimal places.';
  }
  if (!validDate(drive_date) || drive_date < today) {
    return 'Drive date must be today or a future date.';
  }
  if (!validDate(deadline_date) || deadline_date <= drive_date) {
    return 'Application deadline must be after the drive date.';
  }
  for (const { driveField } of DRIVE_MARK_CRITERIA) {
    const minimum = body[driveField];
    if (!isValidPercentage(minimum)) {
      return 'Minimum marks must be percentages between 0 and 100, or blank.';
    }
  }
  return null;
};

// --- 9. ADMIN: CREATE AND UPDATE DRIVE ---
app.post('/api/admin/drives', async (req, res) => {
  const { company, role, package: pkg, location, drive_date, deadline_date, criteria } = req.body;
  const validationError = validateDriveFields(req.body);
  if (validationError) return res.status(400).json({ success: false, message: validationError });

  try {
    const columns = DRIVE_MARK_CRITERIA.map(({ driveField }) => driveField);
    const values = DRIVE_MARK_CRITERIA.map(({ driveField }) => req.body[driveField] ?? null);
    const result = await runQuery(db, `
      INSERT INTO drives (company, role, package, location, drive_date, deadline_date, ${columns.join(', ')}, passout_year, criteria, status)
      VALUES (?, ?, ?, ?, ?, ?, ${columns.map(() => '?').join(', ')}, ?, ?, ?)
    `, [
      company.trim(), role.trim(), pkg.toFixed(2), location.trim(), drive_date, deadline_date,
      ...values, 2026, criteria || '', 'Ongoing'
    ]);
    await syncDriveShortlist(result.insertId);
    res.status(201).json({ success: true, message: 'Drive created and eligible students shortlisted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/drives/:id', async (req, res) => {
  const { company, role, package: pkg, location, drive_date, deadline_date, criteria } = req.body;
  const validationError = validateDriveFields(req.body);
  if (validationError) return res.status(400).json({ success: false, message: validationError });

  try {
    const [existingDrive] = await runQuery(
      db,
      'SELECT status, deadline_date FROM drives WHERE id = ?',
      [req.params.id]
    );
    if (!existingDrive) return res.status(404).json({ success: false, message: 'Drive not found.' });
    if (String(existingDrive.status).toLowerCase() === 'completed' ||
      (existingDrive.deadline_date && existingDrive.deadline_date < getTodayInIndia())) {
      return res.status(409).json({ success: false, message: 'Completed drives cannot be edited.' });
    }

    const criteriaColumns = DRIVE_MARK_CRITERIA.map(({ driveField }) => driveField);
    const result = await runQuery(db, `
      UPDATE drives
      SET company = ?, role = ?, package = ?, location = ?, drive_date = ?, deadline_date = ?,
          ${criteriaColumns.map((column) => `${column} = ?`).join(', ')}, criteria = ?
      WHERE id = ?
    `, [
      company.trim(), role.trim(), pkg.toFixed(2), location.trim(), drive_date, deadline_date,
      ...DRIVE_MARK_CRITERIA.map(({ driveField }) => req.body[driveField] ?? null),
      criteria || '', req.params.id
    ]);
    if (result.affectedRows === 0) {
      const rows = await runQuery(db, 'SELECT id FROM drives WHERE id = ?', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ success: false, message: 'Drive not found.' });
    }
    await syncDriveShortlist(req.params.id);
    res.status(200).json({ success: true, message: 'Drive updated and eligible students shortlisted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/drives/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['Ongoing', 'Completed'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be Ongoing or Completed.' });
  }

  db.query('SELECT deadline_date, status FROM drives WHERE id = ?', [req.params.id], (lookupError, rows) => {
    if (lookupError) return res.status(500).json({ success: false, message: lookupError.message });
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Drive not found.' });

    const { deadline_date: deadline, status: currentStatus } = rows[0];
    if (status === 'Ongoing' && String(currentStatus).toLowerCase() === 'completed') {
      return res.status(409).json({ success: false, message: 'A completed drive cannot be reopened.' });
    }
    if (status === 'Ongoing' && deadline && deadline < getTodayInIndia()) {
      return res.status(400).json({ success: false, message: 'A drive cannot be reopened after its application deadline.' });
    }

    db.query(
      `UPDATE drives SET status = ? WHERE id = ? ${status === 'Ongoing' ? "AND status <> 'Completed'" : ''}`,
      [status, req.params.id],
      (updateError, result) => {
      if (updateError) return res.status(500).json({ success: false, message: updateError.message });
      if (status === 'Ongoing' && result.affectedRows === 0) {
        return res.status(409).json({ success: false, message: 'A completed drive cannot be reopened.' });
      }
      res.status(200).json({ success: true, message: `Drive marked ${status.toLowerCase()}.` });
      }
    );
  });
});

// --- ADMIN: END / COMPLETE DRIVE ENDPOINT ---
app.put('/api/admin/drives/:id/complete', (req, res) => {
  const driveId = req.params.id;
  const query = `UPDATE drives SET status = 'Completed' WHERE id = ?`;

  db.query(query, [driveId], (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Drive marked as completed.' });
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

app.delete('/api/admin/admins/:id', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid admin ID.' });
  }

  db.query('DELETE FROM admins WHERE id = ?', [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }
    res.status(200).json({ success: true, message: 'Admin deleted successfully.' });
  });
});

// --- 11. ADMIN: UPDATE STUDENT ---
app.put('/api/admin/students/:id', (req, res) => {
  const studentId = req.params.id;
  const { name, prn, email, phone, address, status, company, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, calls } = req.body;
  const marks = [tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks];
  if ([name, prn, email, phone, status, ...marks].some((value) =>
    value === null || value === undefined || String(value).trim() === ''
  )) {
    return res.status(400).json({ success: false, message: 'All student fields are required.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address, such as name@domain.com.' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: 'Phone number must contain exactly 10 digits.' });
  }
  if (!['Unplaced', 'Placed'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Select a valid placement status.' });
  }
  if (marks.some((mark) => !isValidPercentage(mark))) {
    return res.status(400).json({ success: false, message: 'Student marks must be percentages between 0 and 100.' });
  }

  const calculatedCalls = calculateInitialCalls(cmce_marks, ccee_marks);
  const finalCalls = calls !== undefined && calls !== '' ? calls : calculatedCalls;

  const query = 'UPDATE students SET name = ?, prn = ?, email = ?, phone = ?, address = ?, status = ?, company = ?, tenth_marks = ?, twelfth_marks = ?, degree_marks = ?, cmce_marks = ?, ccee_marks = ?, calls = ? WHERE id = ?';
  db.query(query, [name, prn, email, phone, address, status, company || '-', tenth_marks || '', twelfth_marks || '', degree_marks || '', cmce_marks || '', ccee_marks || '', finalCalls, studentId], async (err) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    try {
      await syncAllAutomaticShortlists();
      res.status(200).json({ success: true, message: 'Student updated successfully.' });
    } catch (syncError) {
      res.status(500).json({ success: false, message: `Student was updated, but automatic shortlists could not be refreshed: ${syncError.message}` });
    }
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
  db.getConnection(async (connectionError, connection) => {
    if (connectionError) return res.status(500).json({ success: false, message: connectionError.message });

    try {
      await new Promise((resolve, reject) => {
        connection.beginTransaction((err) => err ? reject(err) : resolve());
      });
      const drives = await runQuery(
        connection,
        'SELECT id, status, deadline_date FROM drives WHERE id = ?',
        [driveId]
      );
      if (drives.length === 0) {
        await new Promise((resolve) => connection.rollback(() => resolve()));
        return res.status(404).json({ success: false, message: 'Drive not found.' });
      }
      if (String(drives[0].status).toLowerCase() === 'completed' ||
        (drives[0].deadline_date && drives[0].deadline_date < getTodayInIndia())) {
        await new Promise((resolve) => connection.rollback(() => resolve()));
        return res.status(409).json({ success: false, message: 'Completed drives cannot be deleted.' });
      }
      await runQuery(connection, 'DELETE FROM drive_shortlists WHERE drive_id = ?', [driveId]);
      await runQuery(connection, 'DELETE FROM student_drive_calls WHERE drive_id = ?', [driveId]);
      await runQuery(connection, 'DELETE FROM drives WHERE id = ?', [driveId]);
      await runQuery(connection, `
        UPDATE students s
        SET s.calls_used = (SELECT COUNT(*) FROM drive_shortlists ds WHERE ds.student_id = s.id)
      `);
      await new Promise((resolve, reject) => {
        connection.commit((err) => err ? reject(err) : resolve());
      });
      res.status(200).json({ success: true, message: 'Drive deleted successfully.' });
    } catch (err) {
      await new Promise((resolve) => connection.rollback(() => resolve()));
      res.status(500).json({ success: false, message: err.message });
    } finally {
      connection.release();
    }
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