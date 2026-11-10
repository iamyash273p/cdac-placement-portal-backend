const bcrypt = require('bcryptjs');
const { db } = require('../config/db');

// 1. Get All Students (GET /api/students)
exports.getAllStudents = (req, res) => {
  const query = `SELECT id, name, prn, email, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, status, company, photo, created_at FROM students ORDER BY id DESC`;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Database error fetching students.'
      });
    }
    res.status(200).json({
      success: true,
      count: results.length,
      students: results
    });
  });
};

// 2. Add New Student by Admin (POST /api/admin/students)
exports.addStudent = async (req, res) => {
  const {
    name,
    prn,
    email,
    password,
    phone,
    address,
    passout_year,
    tenthMarks,
    twelfthMarks,
    degreeMarks,
    cmceMarks,
    cceeMarks,
    status,
    company,
    photo
  } = req.body;

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || 'cdac123', salt);
    const studentEmail = email || `${prn.toLowerCase()}@cdac.in`;

    const query = `INSERT INTO students (name, prn, email, password, phone, address, passout_year, tenth_marks, twelfth_marks, degree_marks, cmce_marks, ccee_marks, status, company, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(
      query,
      [
        name,
        prn,
        studentEmail,
        hashedPassword,
        phone || '',
        address || '',
        passout_year || 2026,
        tenthMarks || '',
        twelfthMarks || '',
        degreeMarks || '',
        cmceMarks || '',
        cceeMarks || '',
        status || 'Unplaced',
        company || '-',
        photo || null
      ],
      (err) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
              success: false,
              message: 'Student with this email or PRN already exists.'
            });
          }
          return res.status(500).json({ success: false, message: err.message });
        }
        res.status(201).json({ success: true, message: 'Student added successfully.' });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error adding student.' });
  }
};

// 3. Update Student by Admin (PUT /api/admin/students/:id)
exports.updateStudent = (req, res) => {
  const studentId = req.params.id;
  const {
    name,
    prn,
    email,
    phone,
    address,
    status,
    company,
    tenth_marks,
    twelfth_marks,
    degree_marks,
    cmce_marks,
    ccee_marks
  } = req.body;

  const query = `UPDATE students SET name = ?, prn = ?, email = ?, phone = ?, address = ?, status = ?, company = ?, tenth_marks = ?, twelfth_marks = ?, degree_marks = ?, cmce_marks = ?, ccee_marks = ? WHERE id = ?`;

  db.query(
    query,
    [
      name,
      prn,
      email,
      phone,
      address,
      status,
      company || '-',
      tenth_marks || '',
      twelfth_marks || '',
      degree_marks || '',
      cmce_marks || '',
      ccee_marks || '',
      studentId
    ],
    (err) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.status(200).json({ success: true, message: 'Student updated successfully.' });
    }
  );
};

// 4. Delete Student by Admin (DELETE /api/admin/students/:id)
exports.deleteStudent = (req, res) => {
  const studentId = req.params.id;
  const query = `DELETE FROM students WHERE id = ?`;

  db.query(query, [studentId], (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Student deleted successfully.' });
  });
};

// 5. Get Shortlisted Drives for a Student (GET /api/student/shortlisted-drives)
exports.getStudentShortlistedDrives = (req, res) => {
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
    return res.status(200).json({ success: true, drives: [] });
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
};
