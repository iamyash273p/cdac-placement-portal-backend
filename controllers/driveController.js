const { db } = require('../config/db');

// 1. Get All Drives (GET /api/drives)
exports.getAllDrives = (req, res) => {
  const query = `
    SELECT d.*,
      (SELECT COUNT(*) FROM drive_shortlists ds WHERE ds.drive_id = d.id) AS shortlisted_count
    FROM drives d
    ORDER BY d.id DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Database error fetching drives.'
      });
    }
    res.status(200).json({ success: true, drives: results });
  });
};

// 2. Create Drive by Admin (POST /api/admin/drives)
exports.createDrive = (req, res) => {
  const { company, role, package: pkg, location, drive_date, passout_year, criteria, status } = req.body;

  const query = `INSERT INTO drives (company, role, package, location, drive_date, passout_year, criteria, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(
    query,
    [
      company,
      role,
      pkg,
      location,
      drive_date,
      passout_year || 2026,
      criteria || '',
      status || 'Active'
    ],
    (err) => {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.status(201).json({ success: true, message: 'Drive created successfully.' });
    }
  );
};

// 3. Delete Drive by Admin (DELETE /api/admin/drives/:id)
exports.deleteDrive = (req, res) => {
  const driveId = req.params.id;
  const query = `DELETE FROM drives WHERE id = ?`;

  db.query(query, [driveId], (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(200).json({ success: true, message: 'Drive deleted successfully.' });
  });
};

// 4. Get Shortlisted Students for a Drive (GET /api/drives/:driveId/shortlist)
exports.getDriveShortlist = (req, res) => {
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
};

// 5. Update Shortlisted Students for a Drive (POST /api/admin/drives/:driveId/shortlist)
exports.updateDriveShortlist = (req, res) => {
  const driveId = Number(req.params.driveId);
  const { studentIds } = req.body;

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
};
